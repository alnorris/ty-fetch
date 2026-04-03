import type ts from "typescript";
import { generateDtsContent } from "./generate-types";

/**
 * POC: TypeScript Language Service Plugin that validates fetch() calls
 * against OpenAPI specs, loaded asynchronously on demand per domain.
 */

interface OpenAPISpec {
  paths: Record<string, Record<string, { summary?: string; description?: string }>>;
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
}

interface SpecEntry {
  status: "loading" | "loaded" | "not-found";
  spec: OpenAPISpec | null;
  fetchedAt: number;
}

// Well-known spec URLs for POC (skip APIs.guru, just prove the concept)
const KNOWN_SPECS: Record<string, string> = {
  "api.stripe.com":
    "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  "petstore3.swagger.io":
    "https://petstore3.swagger.io/api/v3/openapi.json",
  "api.github.com":
    "https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json",
};

// In-memory spec cache — persists across diagnostic calls within the same editor session
const specCache = new Map<string, SpecEntry>();

function init(modules: { typescript: typeof import("typescript") }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const logger = (msg: string) =>
      info.project.projectService.logger.info(`[typed-fetch] ${msg}`);

    logger("Plugin initialized");

    const proxy = Object.create(null) as ts.LanguageService;
    for (const k of Object.keys(info.languageService) as Array<
      keyof ts.LanguageService
    >) {
      const x = info.languageService[k]!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proxy as any)[k] = (...args: unknown[]) => (x as Function).apply(info.languageService, args);
    }

    // ── Async spec fetcher ──────────────────────────────────────────
    function ensureSpec(domain: string): SpecEntry {
      const existing = specCache.get(domain);
      if (existing) return existing;

      const specUrl = KNOWN_SPECS[domain];
      if (!specUrl) {
        const entry: SpecEntry = {
          status: "not-found",
          spec: null,
          fetchedAt: Date.now(),
        };
        specCache.set(domain, entry);
        return entry;
      }

      // Mark as loading — no diagnostics until it arrives
      const entry: SpecEntry = {
        status: "loading",
        spec: null,
        fetchedAt: Date.now(),
      };
      specCache.set(domain, entry);

      logger(`Fetching spec for ${domain} from ${specUrl}`);

      // Fire async fetch — the result lands in `entry` mutably
      fetchSpec(specUrl)
        .then((spec) => {
          entry.status = "loaded";
          entry.spec = spec;
          const pathCount = Object.keys(spec.paths || {}).length;
          logger(
            `Spec loaded for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`
          );
          // Generate typed overloads for typedFetch()
          try { regenerateTypes(logger); } catch (e) { logger(`Type generation failed: ${e}`); }
          // Force a project update so diagnostics re-run
          info.project.refreshDiagnostics();
        })
        .catch((err) => {
          entry.status = "not-found";
          logger(`Failed to fetch spec for ${domain}: ${err}`);
        });

      return entry;
    }

    function regenerateTypes(log: (msg: string) => void) {
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");

      // Collect all loaded specs
      const domainSpecs: Array<{
        domain: string;
        baseUrl: string;
        basePath: string;
        spec: any;
      }> = [];

      for (const [domain, entry] of specCache.entries()) {
        if (entry.status !== "loaded" || !entry.spec) continue;
        const serverUrl = entry.spec.servers?.[0]?.url;
        let basePath = "";
        if (serverUrl) {
          if (serverUrl.startsWith("/")) {
            basePath = serverUrl.replace(/\/$/, "");
          } else {
            try {
              basePath = new URL(serverUrl).pathname.replace(/\/$/, "");
            } catch {}
          }
        }
        domainSpecs.push({
          domain,
          baseUrl: `https://${domain}`,
          basePath,
          spec: entry.spec,
        });
      }

      if (domainSpecs.length === 0) return;

      const content = generateDtsContent(domainSpecs);
      const projectDir = info.project.getCurrentDirectory();

      // Resolve the typed-fetch package directory
      let pkgDir: string;
      try {
        const pkgJson = require.resolve("typed-fetch/package.json", { paths: [projectDir] });
        pkgDir = path.dirname(pkgJson);
      } catch {
        log("Could not resolve typed-fetch package");
        return;
      }
      const outPath = path.join(pkgDir, "__generated.d.ts");

      try {
        fs.writeFileSync(outPath, content, "utf-8");
        log(`Generated ${outPath} with types for ${domainSpecs.length} API(s)`);
      } catch (err) {
        log(`Failed to write types: ${err}`);
      }
    }

    async function fetchSpec(url: string): Promise<OpenAPISpec> {
      const https = await import("https");
      return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "typed-fetch-poc" } }, (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            fetchSpec(res.headers.location).then(resolve, reject);
            return;
          }
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("Invalid JSON"));
            }
          });
          res.on("error", reject);
        });
      });
    }

    // ── URL parsing helpers ─────────────────────────────────────────
    function parseFetchUrl(text: string): { domain: string; path: string } | null {
      // Match http(s)://domain/path
      const match = text.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/);
      if (!match) return null;
      return { domain: match[1], path: match[2] || "/" };
    }

    function findFetchCalls(
      sourceFile: ts.SourceFile
    ): Array<{ node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral; url: string }> {
      const results: Array<{
        node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
        url: string;
      }> = [];

      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          (node.expression.text === "fetch" || node.expression.text === "typedFetch") &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0];
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            results.push({ node: arg, url: arg.text });
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      return results;
    }

    // ── Base path stripping ───────────────────────────────────────
    function getBasePath(spec: OpenAPISpec): string {
      const serverUrl = spec.servers?.[0]?.url;
      if (!serverUrl) return "";
      // Only use path-only server URLs (e.g. "/api/v3"), ignore full URLs
      if (serverUrl.startsWith("/")) return serverUrl.replace(/\/$/, "");
      try {
        const parsed = new URL(serverUrl);
        return parsed.pathname.replace(/\/$/, "");
      } catch {
        return "";
      }
    }

    function stripBasePath(urlPath: string, spec: OpenAPISpec): string {
      const base = getBasePath(spec);
      if (base && urlPath.startsWith(base)) {
        return urlPath.slice(base.length) || "/";
      }
      return urlPath;
    }

    // ── Fuzzy "did you mean?" ───────────────────────────────────────
    function levenshtein(a: string, b: string): number {
      const m = a.length,
        n = b.length;
      const dp: number[][] = Array.from({ length: m + 1 }, () =>
        Array(n + 1).fill(0)
      );
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
          );
      return dp[m][n];
    }

    function findClosestPath(
      target: string,
      paths: string[]
    ): string | null {
      let best: string | null = null;
      let bestDist = Infinity;
      for (const p of paths) {
        const d = levenshtein(target, p);
        if (d < bestDist && d <= Math.max(target.length, p.length) * 0.4) {
          bestDist = d;
          best = p;
        }
      }
      return best;
    }

    // ── Match paths with parameters (e.g. /pet/{petId}) ────────────
    function matchesPathTemplate(
      actualPath: string,
      templatePath: string
    ): boolean {
      const actualParts = actualPath.split("/");
      const templateParts = templatePath.split("/");
      if (actualParts.length !== templateParts.length) return false;
      return templateParts.every(
        (tp, i) => tp.startsWith("{") || tp === actualParts[i]
      );
    }

    function pathExistsInSpec(path: string, spec: OpenAPISpec): boolean {
      if (spec.paths[path]) return true;
      return Object.keys(spec.paths).some((tp) =>
        matchesPathTemplate(path, tp)
      );
    }

    // ── getSemanticDiagnostics — the core hook ──────────────────────
    proxy.getSemanticDiagnostics = (fileName: string) => {
      const prior = info.languageService.getSemanticDiagnostics(fileName);
      const program = info.languageService.getProgram();
      if (!program) return prior;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const fetchCalls = findFetchCalls(sourceFile);
      const extra: ts.Diagnostic[] = [];

      for (const { node, url } of fetchCalls) {
        const parsed = parseFetchUrl(url);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain);

        if (entry.status !== "loaded" || !entry.spec) continue;

        const apiPath = stripBasePath(parsed.path, entry.spec);

        if (!pathExistsInSpec(apiPath, entry.spec)) {
          const allPaths = Object.keys(entry.spec.paths);
          const suggestion = findClosestPath(apiPath, allPaths);
          const msgParts = [
            `Path '${apiPath}' does not exist in ${entry.spec.info?.title ?? parsed.domain}.`,
          ];
          if (suggestion) {
            msgParts.push(`Did you mean '${suggestion}'?`);
          }

          extra.push({
            file: sourceFile,
            start: node.getStart() + 1, // skip opening quote
            length: node.getText().length - 2, // exclude quotes
            messageText: msgParts.join(" "),
            category: ts.DiagnosticCategory.Error,
            code: 99001,
            source: "typed-fetch",
          });
        }
      }

      return [...prior, ...extra];
    };

    // ── getCompletionsAtPosition — path autocomplete ────────────────
    proxy.getCompletionsAtPosition = (
      fileName: string,
      position: number,
      options: ts.GetCompletionsAtPositionOptions | undefined
    ) => {
      const prior = info.languageService.getCompletionsAtPosition(
        fileName,
        position,
        options
      );

      const program = info.languageService.getProgram();
      if (!program) return prior;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      // Check if cursor is inside a fetch() string argument
      const fetchCalls = findFetchCalls(sourceFile);
      for (const { node, url } of fetchCalls) {
        const textStart = node.getStart() + 1; // after opening quote
        const textEnd = node.getEnd() - 1; // before closing quote
        if (position < textStart || position > textEnd) continue;

        const parsed = parseFetchUrl(url);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain);
        if (entry.status !== "loaded" || !entry.spec) continue;

        // Provide path completions
        const pathEntries: ts.CompletionEntry[] = Object.entries(
          entry.spec.paths
        ).map(([path, methods]) => {
          const methodList = Object.keys(methods)
            .filter((m) => m !== "parameters" && m !== "summary" && m !== "description")
            .map((m) => m.toUpperCase())
            .join(", ");
          return {
            name: path,
            kind: ts.ScriptElementKind.string,
            sortText: "0" + path,
            insertText: path,
            labelDetails: { description: methodList },
          };
        });

        // Filter by what's been typed so far
        const typed = stripBasePath(parsed.path, entry.spec);
        const filtered = pathEntries.filter((e) =>
          e.name.startsWith(typed) || typed === "/"
        );

        return {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: filtered.length > 0 ? filtered : pathEntries,
        };
      }

      return prior;
    };

    // ── getQuickInfoAtPosition — hover info ─────────────────────────
    proxy.getQuickInfoAtPosition = (
      fileName: string,
      position: number
    ) => {
      const prior = info.languageService.getQuickInfoAtPosition(
        fileName,
        position
      );

      const program = info.languageService.getProgram();
      if (!program) return prior;

      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) return prior;

      const fetchCalls = findFetchCalls(sourceFile);
      for (const { node, url } of fetchCalls) {
        const textStart = node.getStart() + 1;
        const textEnd = node.getEnd() - 1;
        if (position < textStart || position > textEnd) continue;

        const parsed = parseFetchUrl(url);
        if (!parsed) continue;

        const entry = ensureSpec(parsed.domain);
        if (entry.status === "loading") {
          return {
            kind: ts.ScriptElementKind.string,
            kindModifiers: "",
            textSpan: { start: textStart, length: textEnd - textStart },
            documentation: [],
            displayParts: [
              { kind: "text", text: `Loading spec for ${parsed.domain}...` },
            ],
          };
        }

        if (entry.status !== "loaded" || !entry.spec) continue;

        const hoverApiPath = stripBasePath(parsed.path, entry.spec);

        // Find matching path (including parameterized)
        const matchedPath =
          entry.spec.paths[hoverApiPath] ??
          Object.entries(entry.spec.paths).find(([tp]) =>
            matchesPathTemplate(hoverApiPath, tp)
          )?.[1];

        if (!matchedPath) continue;

        const methods = Object.entries(matchedPath)
          .filter(
            ([k]) =>
              !["parameters", "summary", "description"].includes(k)
          )
          .map(([method, details]) => {
            const d = details as { summary?: string };
            return `${method.toUpperCase()}: ${d.summary ?? "(no description)"}`;
          });

        const title = entry.spec.info?.title ?? parsed.domain;
        const lines = [`${title} — ${hoverApiPath}`, "", ...methods];

        return {
          kind: ts.ScriptElementKind.string,
          kindModifiers: "",
          textSpan: { start: textStart, length: textEnd - textStart },
          documentation: [],
          displayParts: [{ kind: "text", text: lines.join("\n") }],
        };
      }

      return prior;
    };

    return proxy;
  }

  return { create };
}

export = init;
