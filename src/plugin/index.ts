import type ts from "typescript";
import { generatePerDomain, type DomainSpec } from "../generate-types";
import {
  specCache, ensureSpec, registerSpecs,
  parseFetchUrl, getBasePath, stripBasePath,
  pathExistsInSpec, findClosestPath, findSpecPath,
  resolveSchemaRef, validateJsonBody,
  findFetchCalls,
  type OpenAPISpec,
} from "../core";

let lastGeneratedUrls = "";

function init(modules: { typescript: typeof import("typescript") }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const logger = (msg: string) =>
      info.project.projectService.logger.info(`[ty-fetch] ${msg}`);
    logger("Plugin initialized");

    // Register user-provided spec overrides from tsconfig plugin config
    const userSpecs = info.config?.specs as Record<string, string> | undefined;
    if (userSpecs && typeof userSpecs === "object") {
      const projectDir = info.project.getCurrentDirectory();
      registerSpecs(userSpecs, projectDir);
      logger(`Registered ${Object.keys(userSpecs).length} custom spec(s): ${Object.keys(userSpecs).join(", ")}`);
    }

    // Proxy all LS methods
    const proxy = Object.create(null) as ts.LanguageService;
    for (const k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
      const x = info.languageService[k]!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proxy as any)[k] = (...args: unknown[]) => (x as Function).apply(info.languageService, args);
    }

    function onSpecLoaded() {
      try { regenerateTypes(logger); } catch (e) { logger(`Type generation failed: ${e}`); }
      info.project.refreshDiagnostics();
    }

    function regenerateTypes(log: (msg: string) => void) {
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");

      const domainSpecs: DomainSpec[] = [];
      for (const [domain, entry] of specCache.entries()) {
        if (entry.status !== "loaded" || !entry.spec) continue;
        const basePath = getBasePath(entry.spec);
        domainSpecs.push({ domain, baseUrl: `https://${domain}`, basePath, spec: entry.spec });
      }
      if (domainSpecs.length === 0) return;

      const usedUrls: Array<{ domain: string; path: string }> = [];
      const program = info.languageService.getProgram();
      if (program) {
        for (const sf of program.getSourceFiles()) {
          if (sf.isDeclarationFile) continue;
          for (const { url } of findFetchCalls(ts, sf)) {
            const parsed = parseFetchUrl(url);
            if (parsed) usedUrls.push(parsed);
          }
        }
      }
      log(`Found ${usedUrls.length} fetch URL(s) in codebase`);

      const perDomain = generatePerDomain(domainSpecs, usedUrls);
      const projectDir = info.project.getCurrentDirectory();

      let typesDir: string;
      try {
        const pkgJson = require.resolve("ty-fetch/package.json", { paths: [projectDir] });
        typesDir = path.join(path.dirname(pkgJson), "__generated");
      } catch {
        log("Could not resolve ty-fetch package");
        return;
      }
      fs.mkdirSync(typesDir, { recursive: true });

      try {
        for (const existing of fs.readdirSync(typesDir)) {
          if (existing.endsWith(".d.ts")) fs.unlinkSync(path.join(typesDir, existing));
        }
        const filenames: string[] = [];
        for (const [filename, content] of perDomain.entries()) {
          fs.writeFileSync(path.join(typesDir, filename), content, "utf-8");
          filenames.push(filename);
        }
        const augmentations = filenames.map((f) => fs.readFileSync(path.join(typesDir, f), "utf-8"));
        const pkgDir = path.join(typesDir, "..");
        const baseTypes = fs.readFileSync(path.join(pkgDir, "base.d.ts"), "utf-8");
        fs.writeFileSync(path.join(pkgDir, "index.d.ts"), [baseTypes, "", ...augmentations].join("\n"), "utf-8");
        log(`Generated types for ${filenames.length} API(s): ${filenames.join(", ")}`);
      } catch (err) {
        log(`Failed to write types: ${err}`);
      }
    }

    // ── Diagnostics ─────────────────────────────────────────────────
    proxy.getSemanticDiagnostics = (fileName: string) => {
      const prior = info.languageService.getSemanticDiagnostics(fileName);
      const program = info.languageService.getProgram();
      if (!program) return prior;
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const calls = findFetchCalls(ts, sourceFile);
      const extra: ts.Diagnostic[] = [];

      for (const call of calls) {
        const parsed = parseFetchUrl(call.url);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
        if (entry.status !== "loaded" || !entry.spec) continue;

        const apiPath = stripBasePath(parsed.path, entry.spec);

        // Path validation
        if (!pathExistsInSpec(apiPath, entry.spec)) {
          const allPaths = Object.keys(entry.spec.paths);
          const suggestion = findClosestPath(apiPath, allPaths);
          const msg = `Path '${apiPath}' does not exist in ${entry.spec.info?.title ?? parsed.domain}.`
            + (suggestion ? ` Did you mean '${suggestion}'?` : "");
          extra.push({
            file: sourceFile, start: call.urlStart, length: call.urlLength,
            messageText: msg, category: ts.DiagnosticCategory.Error, code: 99001, source: "ty-fetch",
          });
        }

        // Body validation
        if (call.httpMethod && call.jsonBody) {
          const specPath = findSpecPath(apiPath, entry.spec);
          if (specPath) {
            const operation = entry.spec.paths[specPath]?.[call.httpMethod];
            const reqSchema =
              operation?.requestBody?.content?.["application/json"]?.schema ??
              operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema;
            if (reqSchema) {
              const resolved = resolveSchemaRef(reqSchema, entry.spec);
              if (resolved?.properties) {
                // Find jsonObj start from the call expression in the AST
                const callNode = sourceFile.statements.length > 0 ? findCallAtPosition(ts, sourceFile, call.callStart) : null;
                const jsonObjStart = callNode ? getJsonObjStart(ts, callNode) : call.callStart;

                const bodyDiags = validateJsonBody(call.jsonBody, resolved, entry.spec, jsonObjStart);
                for (const d of bodyDiags) {
                  extra.push({
                    file: sourceFile, start: d.start, length: d.length,
                    messageText: d.message, category: ts.DiagnosticCategory.Error, code: d.code, source: "ty-fetch",
                  });
                }
              }
            }
          }
        }
      }

      // Regenerate types when URLs change
      const currentUrls = calls.map((c) => c.url).filter((u) => parseFetchUrl(u)).sort().join("\n");
      if (currentUrls !== lastGeneratedUrls) {
        lastGeneratedUrls = currentUrls;
        try { regenerateTypes(logger); } catch (e) { logger(`Type generation failed: ${e}`); }
      }

      return [...prior, ...extra];
    };

    // ── Completions ─────────────────────────────────────────────────
    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const prior = info.languageService.getCompletionsAtPosition(fileName, position, options);
      const program = info.languageService.getProgram();
      if (!program) return prior;
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const calls = findFetchCalls(ts, sourceFile);
      for (const call of calls) {
        if (position < call.urlStart || position > call.urlStart + call.urlLength) continue;
        const parsed = parseFetchUrl(call.url);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
        if (entry.status !== "loaded" || !entry.spec) continue;

        const basePath = getBasePath(entry.spec);
        const urlPrefix = `https://${parsed.domain}${basePath}`;

        const pathEntries: ts.CompletionEntry[] = [];
        for (const [specPath, methods] of Object.entries(entry.spec.paths)) {
          const available = Object.keys(methods).filter((m) => !["parameters", "summary", "description"].includes(m));
          if (call.httpMethod && !available.includes(call.httpMethod)) continue;
          const fullUrl = `${urlPrefix}${specPath}`;
          pathEntries.push({
            name: fullUrl,
            kind: ts.ScriptElementKind.string,
            sortText: "0" + specPath,
            replacementSpan: { start: call.urlStart, length: call.urlLength },
            insertText: fullUrl,
            labelDetails: { description: available.map((m) => m.toUpperCase()).join(", ") },
          });
        }

        const filtered = pathEntries.filter((e) => e.name.startsWith(call.url) || call.url.endsWith("/"));
        return {
          isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false,
          entries: filtered.length > 0 ? filtered : pathEntries,
        };
      }
      return prior;
    };

    // ── Hover ───────────────────────────────────────────────────────
    proxy.getQuickInfoAtPosition = (fileName, position) => {
      const prior = info.languageService.getQuickInfoAtPosition(fileName, position);
      const program = info.languageService.getProgram();
      if (!program) return prior;
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const calls = findFetchCalls(ts, sourceFile);
      for (const call of calls) {
        if (position < call.urlStart || position > call.urlStart + call.urlLength) continue;
        const parsed = parseFetchUrl(call.url);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
        if (entry.status === "loading") {
          return {
            kind: ts.ScriptElementKind.string, kindModifiers: "",
            textSpan: { start: call.urlStart, length: call.urlLength },
            documentation: [],
            displayParts: [{ kind: "text", text: `Loading spec for ${parsed.domain}...` }],
          };
        }
        if (entry.status !== "loaded" || !entry.spec) continue;

        const hoverPath = stripBasePath(parsed.path, entry.spec);
        const specPath = findSpecPath(hoverPath, entry.spec);
        if (!specPath) continue;

        const methods = Object.entries(entry.spec.paths[specPath])
          .filter(([k]) => !["parameters", "summary", "description"].includes(k))
          .map(([m, d]) => `${m.toUpperCase()}: ${(d as any).summary ?? "(no description)"}`);

        return {
          kind: ts.ScriptElementKind.string, kindModifiers: "",
          textSpan: { start: call.urlStart, length: call.urlLength },
          documentation: [],
          displayParts: [{ kind: "text", text: [`${entry.spec.info?.title ?? parsed.domain} — ${hoverPath}`, "", ...methods].join("\n") }],
        };
      }
      return prior;
    };

    return proxy;
  }

  return { create };
}

// Helper to find a CallExpression at a position in the AST
function findCallAtPosition(ts: typeof import("typescript"), sourceFile: import("typescript").SourceFile, pos: number): import("typescript").CallExpression | null {
  let found: import("typescript").CallExpression | null = null;
  function visit(node: import("typescript").Node) {
    if (found) return;
    if (ts.isCallExpression(node) && node.getStart() === pos) { found = node; return; }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function getJsonObjStart(ts: typeof import("typescript"), call: import("typescript").CallExpression): number {
  if (call.arguments.length < 2) return call.getStart();
  const opts = call.arguments[1];
  if (!ts.isObjectLiteralExpression(opts)) return call.getStart();
  const jsonProp = opts.properties.find(
    (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "body"
  ) as import("typescript").PropertyAssignment | undefined;
  if (!jsonProp || !ts.isObjectLiteralExpression(jsonProp.initializer)) return call.getStart();
  return jsonProp.initializer.getStart();
}

export = init;
