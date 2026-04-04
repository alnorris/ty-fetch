import type ts from "typescript";
import {
  ensureSpec,
  findClosestPath,
  findCreateInstances,
  findFetchCalls,
  findSpecPath,
  getBasePath,
  getOperationParams,
  parseFetchUrl,
  pathExistsInSpec,
  registerSpecs,
  resolveSchemaRef,
  specCache,
  stripBasePath,
  validateJsonBody,
} from "../core";
import { type DomainSpec, generatePerDomain } from "../generate-types";

let lastGeneratedUrls = "";

function init(modules: { typescript: typeof import("typescript") }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const logger = (msg: string) => info.project.projectService.logger.info(`[ty-fetch] ${msg}`);
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
      try {
        regenerateTypes(logger);
      } catch (e) {
        logger(`Type generation failed: ${e}`);
      }
      info.project.refreshDiagnostics();
    }

    /** Build a map of variable name → prefixUrl from all source files. */
    function buildInstanceMap(): Map<string, string> {
      const instanceMap = new Map<string, string>();
      try {
        const program = info.languageService.getProgram();
        if (!program) return instanceMap;
        for (const sf of program.getSourceFiles()) {
          if (sf.isDeclarationFile) continue;
          for (const inst of findCreateInstances(ts, sf)) {
            instanceMap.set(inst.varName, inst.prefixUrl);
          }
        }
      } catch (e) {
        logger(`buildInstanceMap failed: ${e}`);
      }
      return instanceMap;
    }

    /** Resolve a fetch call URL to an absolute URL, using the instance map for relative paths. */
    function resolveUrl(url: string, instanceName: string | null, instanceMap: Map<string, string>): string | null {
      // Already absolute
      if (/^https?:\/\//.test(url)) return url;
      // Relative path — resolve via instance prefixUrl
      if (instanceName) {
        const prefix = instanceMap.get(instanceName);
        if (prefix) {
          const base = prefix.replace(/\/$/, "");
          const rel = url.startsWith("/") ? url : `/${url}`;
          return `${base}${rel}`;
        }
      }
      return null;
    }

    function regenerateTypes(log: (msg: string) => void) {
      const fs = require("node:fs") as typeof import("fs");
      const path = require("node:path") as typeof import("path");

      const domainSpecs: DomainSpec[] = [];
      for (const [domain, entry] of specCache.entries()) {
        if (entry.status !== "loaded" || !entry.spec) continue;
        const basePath = getBasePath(entry.spec);
        domainSpecs.push({ domain, baseUrl: `https://${domain}`, basePath, spec: entry.spec });
      }
      if (domainSpecs.length === 0) return;

      const instanceMap = buildInstanceMap();
      const usedUrls: Array<{ domain: string; path: string }> = [];
      const program = info.languageService.getProgram();
      if (program) {
        for (const sf of program.getSourceFiles()) {
          if (sf.isDeclarationFile) continue;
          for (const call of findFetchCalls(ts, sf)) {
            const resolved = resolveUrl(call.url, call.instanceName, instanceMap);
            if (!resolved) continue;
            const parsed = parseFetchUrl(resolved);
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
        // Only overwrite files for domains we regenerated — keep existing ones for other domains
        for (const [filename, content] of perDomain.entries()) {
          fs.writeFileSync(path.join(typesDir, filename), content, "utf-8");
        }
        // Rebuild index.d.ts from ALL generated files (not just the ones we just wrote)
        const allFiles = fs.readdirSync(typesDir).filter((f: string) => f.endsWith(".d.ts")).sort();
        const augmentations = allFiles.map((f: string) => fs.readFileSync(path.join(typesDir, f), "utf-8"));
        const pkgDir = path.join(typesDir, "..");
        const baseTypes = fs.readFileSync(path.join(pkgDir, "base.d.ts"), "utf-8");
        // Tighten base method overloads: set TPathParams and TQueryParams to never so the
        // base overload doesn't match when params are passed — forcing specific overloads to match.
        const tightenedBase = baseTypes
          .replace(/options\?: Options<never>\)/g, "options?: Options<never, never, never>)")
          .replace(/options\?: Options\)/g, "options?: Options<unknown, never, never>)");
        fs.writeFileSync(path.join(pkgDir, "index.d.ts"), [tightenedBase, "", ...augmentations].join("\n"), "utf-8");
        log(`Generated types for ${allFiles.length} API(s): ${allFiles.join(", ")}`);
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
      const instanceMap = buildInstanceMap();

      for (const call of calls) {
        const resolvedUrl = resolveUrl(call.url, call.instanceName, instanceMap);
        if (!resolvedUrl) continue;
        const parsed = parseFetchUrl(resolvedUrl);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
        if (entry.status !== "loaded" || !entry.spec) continue;

        const apiPath = stripBasePath(parsed.path, entry.spec);

        // Path validation
        if (!pathExistsInSpec(apiPath, entry.spec)) {
          const allPaths = Object.keys(entry.spec.paths);
          const suggestion = findClosestPath(apiPath, allPaths);
          const msg =
            `Path '${apiPath}' does not exist in ${entry.spec.info?.title ?? parsed.domain}.` +
            (suggestion ? ` Did you mean '${suggestion}'?` : "");
          extra.push({
            file: sourceFile,
            start: call.urlStart,
            length: call.urlLength,
            messageText: msg,
            category: ts.DiagnosticCategory.Error,
            code: 99001,
            source: "ty-fetch",
          });
        }

        const specPath = findSpecPath(apiPath, entry.spec);

        // Body validation
        if (call.httpMethod && call.jsonBody && specPath) {
          const operation = entry.spec.paths[specPath]?.[call.httpMethod];
          const reqSchema =
            operation?.requestBody?.content?.["application/json"]?.schema ??
            operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema;
          if (reqSchema) {
            const resolved = resolveSchemaRef(reqSchema, entry.spec);
            if (resolved?.properties) {
              const callNode =
                sourceFile.statements.length > 0 ? findCallAtPosition(ts, sourceFile, call.callStart) : null;
              const jsonObjStart = callNode ? getJsonObjStart(ts, callNode) : call.callStart;

              const bodyDiags = validateJsonBody(call.jsonBody, resolved, entry.spec, jsonObjStart);
              for (const d of bodyDiags) {
                extra.push({
                  file: sourceFile,
                  start: d.start,
                  length: d.length,
                  messageText: d.message,
                  category: ts.DiagnosticCategory.Error,
                  code: d.code,
                  source: "ty-fetch",
                });
              }
            }
          }
        }

        // Params validation (query + path)
        if (call.httpMethod && specPath) {
          const operation = entry.spec.paths[specPath]?.[call.httpMethod];
          const pathItem = entry.spec.paths[specPath];
          validateParams(call.queryParams, "query", operation, pathItem, entry.spec, sourceFile, extra);
          validateParams(call.pathParams, "path", operation, pathItem, entry.spec, sourceFile, extra);
        }
      }

      // Regenerate types when URLs change
      const currentUrls = calls
        .map((c) => resolveUrl(c.url, c.instanceName, instanceMap))
        .filter((u): u is string => u !== null && parseFetchUrl(u) !== null)
        .sort()
        .join("\n");
      if (currentUrls !== lastGeneratedUrls) {
        lastGeneratedUrls = currentUrls;
        try {
          regenerateTypes(logger);
        } catch (e) {
          logger(`Type generation failed: ${e}`);
        }
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
      const instanceMap = buildInstanceMap();
      for (const call of calls) {
        // URL completions
        if (position >= call.urlStart && position <= call.urlStart + call.urlLength) {
          const resolvedUrl = resolveUrl(call.url, call.instanceName, instanceMap);
          if (!resolvedUrl) continue;
          const parsed = parseFetchUrl(resolvedUrl);
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
              sortText: `0${specPath}`,
              replacementSpan: { start: call.urlStart, length: call.urlLength },
              insertText: fullUrl,
              labelDetails: { description: available.map((m) => m.toUpperCase()).join(", ") },
            });
          }

          const filtered = pathEntries.filter((e) => e.name.startsWith(call.url) || call.url.endsWith("/"));
          return {
            isGlobalCompletion: false,
            isMemberCompletion: false,
            isNewIdentifierLocation: false,
            entries: filtered.length > 0 ? filtered : pathEntries,
          };
        }

        // Param completions (query / path)
        const inQuery = call.queryObjRange && position > call.queryObjRange.start && position < call.queryObjRange.end;
        const inPath = call.pathObjRange && position > call.pathObjRange.start && position < call.pathObjRange.end;
        if ((inQuery || inPath) && call.httpMethod) {
          const resolvedUrl2 = resolveUrl(call.url, call.instanceName, instanceMap);
          if (!resolvedUrl2) continue;
          const parsed = parseFetchUrl(resolvedUrl2);
          if (!parsed) continue;
          const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
          if (entry.status !== "loaded" || !entry.spec) continue;
          const apiPath = stripBasePath(parsed.path, entry.spec);
          const specPath = findSpecPath(apiPath, entry.spec);
          if (!specPath) continue;
          const operation = entry.spec.paths[specPath]?.[call.httpMethod];
          const pathItem = entry.spec.paths[specPath];
          const filterIn = inQuery ? "query" : "path";
          const specParams = getOperationParams(operation, pathItem, entry.spec, filterIn as "query" | "path");
          const existing = (inQuery ? call.queryParams : call.pathParams) ?? [];
          const existingNames = new Set(existing.map((p) => p.name));
          const entries: ts.CompletionEntry[] = specParams
            .filter((p) => !existingNames.has(p.name))
            .map((p) => ({
              name: p.name,
              kind: ts.ScriptElementKind.memberVariableElement,
              sortText: p.required ? `0${p.name}` : `1${p.name}`,
              labelDetails: { description: p.required ? "(required)" : "(optional)" },
            }));
          if (entries.length > 0) {
            return {
              isGlobalCompletion: false,
              isMemberCompletion: true,
              isNewIdentifierLocation: false,
              entries: [...entries, ...(prior?.entries ?? [])],
            };
          }
        }

        // Body property completions
        const inBody = call.bodyObjRange && position > call.bodyObjRange.start && position < call.bodyObjRange.end;
        if (inBody && call.httpMethod) {
          const resolvedUrl3 = resolveUrl(call.url, call.instanceName, instanceMap);
          if (!resolvedUrl3) continue;
          const parsed = parseFetchUrl(resolvedUrl3);
          if (!parsed) continue;
          const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
          if (entry.status !== "loaded" || !entry.spec) continue;
          const apiPath = stripBasePath(parsed.path, entry.spec);
          const specPath = findSpecPath(apiPath, entry.spec);
          if (!specPath) continue;
          const operation = entry.spec.paths[specPath]?.[call.httpMethod];
          const reqSchema =
            operation?.requestBody?.content?.["application/json"]?.schema ??
            operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema;
          if (!reqSchema) continue;
          const resolved = resolveSchemaRef(reqSchema, entry.spec);
          if (!resolved?.properties) continue;
          const existingNames = new Set((call.jsonBody ?? []).map((p) => p.name));
          const requiredSet = new Set(resolved.required ?? []);
          const entries: ts.CompletionEntry[] = Object.keys(resolved.properties)
            .filter((name) => !existingNames.has(name))
            .map((name) => ({
              name,
              kind: ts.ScriptElementKind.memberVariableElement,
              sortText: requiredSet.has(name) ? `0${name}` : `1${name}`,
              labelDetails: { description: requiredSet.has(name) ? "(required)" : "(optional)" },
            }));
          if (entries.length > 0) {
            return {
              isGlobalCompletion: false,
              isMemberCompletion: true,
              isNewIdentifierLocation: false,
              entries: [...entries, ...(prior?.entries ?? [])],
            };
          }
        }
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
      const instanceMap = buildInstanceMap();
      for (const call of calls) {
        if (position < call.urlStart || position > call.urlStart + call.urlLength) continue;
        const resolvedUrl = resolveUrl(call.url, call.instanceName, instanceMap);
        if (!resolvedUrl) continue;
        const parsed = parseFetchUrl(resolvedUrl);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain, logger, onSpecLoaded);
        if (entry.status === "loading") {
          return {
            kind: ts.ScriptElementKind.string,
            kindModifiers: "",
            textSpan: { start: call.urlStart, length: call.urlLength },
            documentation: [],
            displayParts: [{ kind: "text", text: `Loading spec for ${parsed.domain}...` }],
          };
        }
        if (entry.status !== "loaded" || !entry.spec) continue;

        const hoverPath = stripBasePath(parsed.path, entry.spec);
        const specPath = findSpecPath(hoverPath, entry.spec);
        if (!specPath) continue;

        const pathObj = entry.spec.paths[specPath];
        const httpMethod = call.httpMethod?.toLowerCase() ?? null;
        const lines: string[] = [`${entry.spec.info?.title ?? parsed.domain} — ${hoverPath}`, ""];

        const methodEntries = Object.entries(pathObj)
          .filter(([k]) => !["parameters", "summary", "description"].includes(k));

        for (const [m, op] of methodEntries) {
          const operation = op as any;
          const isActive = httpMethod === m;
          const label = `${m.toUpperCase()}: ${operation.summary ?? "(no summary)"}`;
          lines.push(isActive ? `▸ ${label}` : label);

          // Show description for the active method, or all if no specific method
          if ((isActive || !httpMethod) && operation.description) {
            const desc = operation.description.trim();
            if (desc !== (operation.summary ?? "").trim()) {
              lines.push(`  ${desc}`);
            }
          }

          // Show parameters for the active method
          if (isActive) {
            const params: any[] = [...(pathObj.parameters ?? []), ...(operation.parameters ?? [])];
            if (params.length > 0) {
              lines.push("");
              lines.push("  Parameters:");
              for (const p of params) {
                const req = p.required ? " (required)" : "";
                const desc = p.description ? ` — ${p.description.trim()}` : "";
                lines.push(`    ${p.in} ${p.name}${req}${desc}`);
              }
            }
          }
        }

        return {
          kind: ts.ScriptElementKind.string,
          kindModifiers: "",
          textSpan: { start: call.urlStart, length: call.urlLength },
          documentation: [],
          displayParts: [
            {
              kind: "text",
              text: lines.join("\n"),
            },
          ],
        };
      }
      return prior;
    };

    return proxy;
  }

  return { create };
}

import type { ParamProperty, OpenAPISpec } from "../core/types";

function validateParams(
  params: ParamProperty[] | null,
  filterIn: "query" | "path",
  operation: any,
  pathItem: any,
  spec: OpenAPISpec,
  sourceFile: import("typescript").SourceFile,
  extra: import("typescript").Diagnostic[],
) {
  if (!params || params.length === 0) return;
  const ts = require("typescript") as typeof import("typescript");
  const specParams = getOperationParams(operation, pathItem, spec, filterIn);
  const validNames = new Set(specParams.map((p) => p.name));

  for (const param of params) {
    if (!validNames.has(param.name)) {
      const suggestions = specParams.map((p) => `'${p.name}'`).join(", ");
      extra.push({
        file: sourceFile,
        start: param.nameStart,
        length: param.nameLength,
        messageText: `Unknown ${filterIn} parameter '${param.name}'.${suggestions ? ` Available: ${suggestions}` : ""}`,
        category: ts.DiagnosticCategory.Error,
        code: 99005,
        source: "ty-fetch",
      });
    }
  }
}

// Helper to find a CallExpression at a position in the AST
function findCallAtPosition(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  pos: number,
): import("typescript").CallExpression | null {
  let found: import("typescript").CallExpression | null = null;
  function visit(node: import("typescript").Node) {
    if (found) return;
    if (ts.isCallExpression(node) && node.getStart() === pos) {
      found = node;
      return;
    }
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
    (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "body",
  ) as import("typescript").PropertyAssignment | undefined;
  if (!jsonProp || !ts.isObjectLiteralExpression(jsonProp.initializer)) return call.getStart();
  return jsonProp.initializer.getStart();
}

export = init;
