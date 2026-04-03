"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const generate_types_1 = require("./generate-types");
// Well-known spec URLs for POC (skip APIs.guru, just prove the concept)
const KNOWN_SPECS = {
    "api.stripe.com": "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    "petstore3.swagger.io": "https://petstore3.swagger.io/api/v3/openapi.json",
    "api.github.com": "https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json",
};
// In-memory spec cache — persists across diagnostic calls within the same editor session
const specCache = new Map();
// Track which URLs we've generated types for — regenerate when this changes
let lastGeneratedUrls = "";
function init(modules) {
    const ts = modules.typescript;
    function create(info) {
        const logger = (msg) => info.project.projectService.logger.info(`[typed-fetch] ${msg}`);
        logger("Plugin initialized");
        const proxy = Object.create(null);
        for (const k of Object.keys(info.languageService)) {
            const x = info.languageService[k];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            proxy[k] = (...args) => x.apply(info.languageService, args);
        }
        // ── Async spec fetcher ──────────────────────────────────────────
        function ensureSpec(domain) {
            const existing = specCache.get(domain);
            if (existing)
                return existing;
            const specUrl = KNOWN_SPECS[domain];
            if (!specUrl) {
                const entry = {
                    status: "not-found",
                    spec: null,
                    fetchedAt: Date.now(),
                };
                specCache.set(domain, entry);
                return entry;
            }
            // Mark as loading — no diagnostics until it arrives
            const entry = {
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
                logger(`Spec loaded for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
                // Generate typed overloads for typedFetch()
                try {
                    regenerateTypes(logger);
                }
                catch (e) {
                    logger(`Type generation failed: ${e}`);
                }
                // Force a project update so diagnostics re-run
                info.project.refreshDiagnostics();
            })
                .catch((err) => {
                entry.status = "not-found";
                logger(`Failed to fetch spec for ${domain}: ${err}`);
            });
            return entry;
        }
        function regenerateTypes(log) {
            const fs = require("fs");
            const path = require("path");
            // Collect all loaded specs
            const domainSpecs = [];
            for (const [domain, entry] of specCache.entries()) {
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                const serverUrl = entry.spec.servers?.[0]?.url;
                let basePath = "";
                if (serverUrl) {
                    if (serverUrl.startsWith("/")) {
                        basePath = serverUrl.replace(/\/$/, "");
                    }
                    else {
                        try {
                            basePath = new URL(serverUrl).pathname.replace(/\/$/, "");
                        }
                        catch { }
                    }
                }
                domainSpecs.push({
                    domain,
                    baseUrl: `https://${domain}`,
                    basePath,
                    spec: entry.spec,
                });
            }
            if (domainSpecs.length === 0)
                return;
            // Scan all project files for fetch() URLs
            const usedUrls = [];
            const program = info.languageService.getProgram();
            if (program) {
                for (const sourceFile of program.getSourceFiles()) {
                    if (sourceFile.isDeclarationFile)
                        continue;
                    const calls = findFetchCalls(sourceFile);
                    for (const { url } of calls) {
                        const parsed = parseFetchUrl(url);
                        if (parsed)
                            usedUrls.push(parsed);
                    }
                }
            }
            log(`Found ${usedUrls.length} fetch URL(s) in codebase`);
            const perDomain = (0, generate_types_1.generatePerDomain)(domainSpecs, usedUrls);
            const projectDir = info.project.getCurrentDirectory();
            // Write into the typed-fetch package itself (not @types — TS ignores @types when package has own types)
            let typesDir;
            try {
                const pkgJson = require.resolve("typed-fetch/package.json", { paths: [projectDir] });
                typesDir = path.join(path.dirname(pkgJson), "__generated");
            }
            catch {
                log("Could not resolve typed-fetch package");
                return;
            }
            fs.mkdirSync(typesDir, { recursive: true });
            try {
                // Clean old generated .d.ts files
                for (const existing of fs.readdirSync(typesDir)) {
                    if (existing.endsWith(".d.ts") && existing !== "index.d.ts") {
                        fs.unlinkSync(path.join(typesDir, existing));
                    }
                }
                // Write per-domain files
                const filenames = [];
                for (const [filename, content] of perDomain.entries()) {
                    fs.writeFileSync(path.join(typesDir, filename), content, "utf-8");
                    filenames.push(filename);
                }
                // Concat base types + generated augmentations into index.d.ts
                const augmentations = [];
                for (const fname of filenames) {
                    augmentations.push(fs.readFileSync(path.join(typesDir, fname), "utf-8"));
                }
                const pkgDir = path.join(typesDir, "..");
                // Base FIRST, generated SECOND — TS interface merging gives later blocks higher overload priority
                const baseTypes = fs.readFileSync(path.join(pkgDir, "base.d.ts"), "utf-8");
                const content = [baseTypes, "", ...augmentations].join("\n");
                fs.writeFileSync(path.join(pkgDir, "index.d.ts"), content, "utf-8");
                log(`Generated types for ${filenames.length} API(s): ${filenames.join(", ")}`);
            }
            catch (err) {
                log(`Failed to write types: ${err}`);
            }
        }
        async function fetchSpec(url) {
            const https = await Promise.resolve().then(() => __importStar(require("https")));
            return new Promise((resolve, reject) => {
                https.get(url, { headers: { "User-Agent": "typed-fetch-poc" } }, (res) => {
                    // Follow redirects
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        fetchSpec(res.headers.location).then(resolve, reject);
                        return;
                    }
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch {
                            reject(new Error("Invalid JSON"));
                        }
                    });
                    res.on("error", reject);
                });
            });
        }
        // ── URL parsing helpers ─────────────────────────────────────────
        function parseFetchUrl(text) {
            // Match http(s)://domain/path
            const match = text.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/);
            if (!match)
                return null;
            return { domain: match[1], path: match[2] || "/" };
        }
        function findFetchCalls(sourceFile) {
            const results = [];
            function visit(node) {
                if (ts.isCallExpression(node) && node.arguments.length > 0) {
                    const expr = node.expression;
                    let httpMethod = null;
                    if (ts.isIdentifier(expr) && (expr.text === "fetch" || expr.text === "typedFetch")) {
                        // fetch("...") — method unknown
                        httpMethod = null;
                    }
                    else if (ts.isPropertyAccessExpression(expr) &&
                        ts.isIdentifier(expr.expression) &&
                        ["get", "post", "put", "patch", "delete", "head", "request"].includes(expr.name.text)) {
                        // *.get("..."), *.post("..."), etc. — matches any identifier (api, ky, tf, http, etc.)
                        httpMethod = expr.name.text === "request" || expr.name.text === "head" ? null : expr.name.text;
                    }
                    else if (ts.isIdentifier(expr)) {
                        // tf("...") — direct call, method unknown
                        httpMethod = null;
                    }
                    else {
                        ts.forEachChild(node, visit);
                        return;
                    }
                    const arg = node.arguments[0];
                    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
                        results.push({ node: arg, url: arg.text, httpMethod });
                    }
                }
                ts.forEachChild(node, visit);
            }
            visit(sourceFile);
            return results;
        }
        // ── Base path stripping ───────────────────────────────────────
        function getBasePath(spec) {
            const serverUrl = spec.servers?.[0]?.url;
            if (!serverUrl)
                return "";
            // Only use path-only server URLs (e.g. "/api/v3"), ignore full URLs
            if (serverUrl.startsWith("/"))
                return serverUrl.replace(/\/$/, "");
            try {
                const parsed = new URL(serverUrl);
                return parsed.pathname.replace(/\/$/, "");
            }
            catch {
                return "";
            }
        }
        function stripBasePath(urlPath, spec) {
            const base = getBasePath(spec);
            if (base && urlPath.startsWith(base)) {
                return urlPath.slice(base.length) || "/";
            }
            return urlPath;
        }
        // ── Fuzzy "did you mean?" ───────────────────────────────────────
        function levenshtein(a, b) {
            const m = a.length, n = b.length;
            const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
            for (let i = 0; i <= m; i++)
                dp[i][0] = i;
            for (let j = 0; j <= n; j++)
                dp[0][j] = j;
            for (let i = 1; i <= m; i++)
                for (let j = 1; j <= n; j++)
                    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            return dp[m][n];
        }
        function findClosestPath(target, paths) {
            let best = null;
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
        function matchesPathTemplate(actualPath, templatePath) {
            const actualParts = actualPath.split("/");
            const templateParts = templatePath.split("/");
            if (actualParts.length !== templateParts.length)
                return false;
            return templateParts.every((tp, i) => tp.startsWith("{") || tp === actualParts[i]);
        }
        function pathExistsInSpec(path, spec) {
            if (spec.paths[path])
                return true;
            return Object.keys(spec.paths).some((tp) => matchesPathTemplate(path, tp));
        }
        // ── getSemanticDiagnostics — the core hook ──────────────────────
        proxy.getSemanticDiagnostics = (fileName) => {
            const prior = info.languageService.getSemanticDiagnostics(fileName);
            const program = info.languageService.getProgram();
            if (!program)
                return prior;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return prior;
            const fetchCalls = findFetchCalls(sourceFile);
            const extra = [];
            for (const { node, url } of fetchCalls) {
                const parsed = parseFetchUrl(url);
                if (!parsed)
                    continue;
                const entry = ensureSpec(parsed.domain);
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
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
            // Check if URLs changed — regenerate types if needed
            const currentUrls = fetchCalls
                .map((c) => c.url)
                .filter((u) => parseFetchUrl(u))
                .sort()
                .join("\n");
            if (currentUrls !== lastGeneratedUrls) {
                lastGeneratedUrls = currentUrls;
                try {
                    regenerateTypes(logger);
                }
                catch (e) {
                    logger(`Type generation failed: ${e}`);
                }
            }
            return [...prior, ...extra];
        };
        // ── getCompletionsAtPosition — path autocomplete ────────────────
        proxy.getCompletionsAtPosition = (fileName, position, options) => {
            const prior = info.languageService.getCompletionsAtPosition(fileName, position, options);
            const program = info.languageService.getProgram();
            if (!program)
                return prior;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return prior;
            // Check if cursor is inside a fetch()/api.x() string argument
            const fetchCalls = findFetchCalls(sourceFile);
            for (const { node, url, httpMethod: calledMethod } of fetchCalls) {
                const textStart = node.getStart() + 1; // after opening quote
                const textEnd = node.getEnd() - 1; // before closing quote
                if (position < textStart || position > textEnd)
                    continue;
                const parsed = parseFetchUrl(url);
                if (!parsed)
                    continue;
                const entry = ensureSpec(parsed.domain);
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                // Build full URL completions (filtered by HTTP method if known)
                const basePath = getBasePath(entry.spec);
                const urlPrefix = `https://${parsed.domain}${basePath}`;
                const pathEntries = [];
                for (const [specPath, methods] of Object.entries(entry.spec.paths)) {
                    const availableMethods = Object.keys(methods)
                        .filter((m) => !["parameters", "summary", "description"].includes(m));
                    // Filter by called method if known
                    if (calledMethod && !availableMethods.includes(calledMethod))
                        continue;
                    const methodList = availableMethods.map((m) => m.toUpperCase()).join(", ");
                    const fullUrl = `${urlPrefix}${specPath}`;
                    pathEntries.push({
                        name: fullUrl,
                        kind: ts.ScriptElementKind.string,
                        sortText: "0" + specPath,
                        replacementSpan: { start: textStart, length: textEnd - textStart },
                        insertText: fullUrl,
                        labelDetails: { description: methodList },
                    });
                }
                // Filter by what the user has typed so far
                const typedUrl = url;
                const filtered = pathEntries.filter((e) => e.name.startsWith(typedUrl) || typedUrl.endsWith("/"));
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
        proxy.getQuickInfoAtPosition = (fileName, position) => {
            const prior = info.languageService.getQuickInfoAtPosition(fileName, position);
            const program = info.languageService.getProgram();
            if (!program)
                return prior;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return prior;
            const fetchCalls = findFetchCalls(sourceFile);
            for (const { node, url } of fetchCalls) {
                const textStart = node.getStart() + 1;
                const textEnd = node.getEnd() - 1;
                if (position < textStart || position > textEnd)
                    continue;
                const parsed = parseFetchUrl(url);
                if (!parsed)
                    continue;
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
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                const hoverApiPath = stripBasePath(parsed.path, entry.spec);
                // Find matching path (including parameterized)
                const matchedPath = entry.spec.paths[hoverApiPath] ??
                    Object.entries(entry.spec.paths).find(([tp]) => matchesPathTemplate(hoverApiPath, tp))?.[1];
                if (!matchedPath)
                    continue;
                const methods = Object.entries(matchedPath)
                    .filter(([k]) => !["parameters", "summary", "description"].includes(k))
                    .map(([method, details]) => {
                    const d = details;
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
module.exports = init;
