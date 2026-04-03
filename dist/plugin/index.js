"use strict";
const generate_types_1 = require("../generate-types");
const core_1 = require("../core");
let lastGeneratedUrls = "";
function init(modules) {
    const ts = modules.typescript;
    function create(info) {
        const logger = (msg) => info.project.projectService.logger.info(`[ty-fetch] ${msg}`);
        logger("Plugin initialized");
        // Proxy all LS methods
        const proxy = Object.create(null);
        for (const k of Object.keys(info.languageService)) {
            const x = info.languageService[k];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            proxy[k] = (...args) => x.apply(info.languageService, args);
        }
        function onSpecLoaded() {
            try {
                regenerateTypes(logger);
            }
            catch (e) {
                logger(`Type generation failed: ${e}`);
            }
            info.project.refreshDiagnostics();
        }
        function regenerateTypes(log) {
            const fs = require("fs");
            const path = require("path");
            const domainSpecs = [];
            for (const [domain, entry] of core_1.specCache.entries()) {
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                const basePath = (0, core_1.getBasePath)(entry.spec);
                domainSpecs.push({ domain, baseUrl: `https://${domain}`, basePath, spec: entry.spec });
            }
            if (domainSpecs.length === 0)
                return;
            const usedUrls = [];
            const program = info.languageService.getProgram();
            if (program) {
                for (const sf of program.getSourceFiles()) {
                    if (sf.isDeclarationFile)
                        continue;
                    for (const { url } of (0, core_1.findFetchCalls)(ts, sf)) {
                        const parsed = (0, core_1.parseFetchUrl)(url);
                        if (parsed)
                            usedUrls.push(parsed);
                    }
                }
            }
            log(`Found ${usedUrls.length} fetch URL(s) in codebase`);
            const perDomain = (0, generate_types_1.generatePerDomain)(domainSpecs, usedUrls);
            const projectDir = info.project.getCurrentDirectory();
            let typesDir;
            try {
                const pkgJson = require.resolve("ty-fetch/package.json", { paths: [projectDir] });
                typesDir = path.join(path.dirname(pkgJson), "__generated");
            }
            catch {
                log("Could not resolve ty-fetch package");
                return;
            }
            fs.mkdirSync(typesDir, { recursive: true });
            try {
                for (const existing of fs.readdirSync(typesDir)) {
                    if (existing.endsWith(".d.ts"))
                        fs.unlinkSync(path.join(typesDir, existing));
                }
                const filenames = [];
                for (const [filename, content] of perDomain.entries()) {
                    fs.writeFileSync(path.join(typesDir, filename), content, "utf-8");
                    filenames.push(filename);
                }
                const augmentations = filenames.map((f) => fs.readFileSync(path.join(typesDir, f), "utf-8"));
                const pkgDir = path.join(typesDir, "..");
                const baseTypes = fs.readFileSync(path.join(pkgDir, "base.d.ts"), "utf-8");
                fs.writeFileSync(path.join(pkgDir, "index.d.ts"), [baseTypes, "", ...augmentations].join("\n"), "utf-8");
                log(`Generated types for ${filenames.length} API(s): ${filenames.join(", ")}`);
            }
            catch (err) {
                log(`Failed to write types: ${err}`);
            }
        }
        // ── Diagnostics ─────────────────────────────────────────────────
        proxy.getSemanticDiagnostics = (fileName) => {
            const prior = info.languageService.getSemanticDiagnostics(fileName);
            const program = info.languageService.getProgram();
            if (!program)
                return prior;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return prior;
            const calls = (0, core_1.findFetchCalls)(ts, sourceFile);
            const extra = [];
            for (const call of calls) {
                const parsed = (0, core_1.parseFetchUrl)(call.url);
                if (!parsed)
                    continue;
                const entry = (0, core_1.ensureSpec)(parsed.domain, logger, onSpecLoaded);
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                const apiPath = (0, core_1.stripBasePath)(parsed.path, entry.spec);
                // Path validation
                if (!(0, core_1.pathExistsInSpec)(apiPath, entry.spec)) {
                    const allPaths = Object.keys(entry.spec.paths);
                    const suggestion = (0, core_1.findClosestPath)(apiPath, allPaths);
                    const msg = `Path '${apiPath}' does not exist in ${entry.spec.info?.title ?? parsed.domain}.`
                        + (suggestion ? ` Did you mean '${suggestion}'?` : "");
                    extra.push({
                        file: sourceFile, start: call.urlStart, length: call.urlLength,
                        messageText: msg, category: ts.DiagnosticCategory.Error, code: 99001, source: "ty-fetch",
                    });
                }
                // Body validation
                if (call.httpMethod && call.jsonBody) {
                    const specPath = (0, core_1.findSpecPath)(apiPath, entry.spec);
                    if (specPath) {
                        const operation = entry.spec.paths[specPath]?.[call.httpMethod];
                        const reqSchema = operation?.requestBody?.content?.["application/json"]?.schema ??
                            operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema;
                        if (reqSchema) {
                            const resolved = (0, core_1.resolveSchemaRef)(reqSchema, entry.spec);
                            if (resolved?.properties) {
                                // Find jsonObj start from the call expression in the AST
                                const callNode = sourceFile.statements.length > 0 ? findCallAtPosition(ts, sourceFile, call.callStart) : null;
                                const jsonObjStart = callNode ? getJsonObjStart(ts, callNode) : call.callStart;
                                const bodyDiags = (0, core_1.validateJsonBody)(call.jsonBody, resolved, entry.spec, jsonObjStart);
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
            const currentUrls = calls.map((c) => c.url).filter((u) => (0, core_1.parseFetchUrl)(u)).sort().join("\n");
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
        // ── Completions ─────────────────────────────────────────────────
        proxy.getCompletionsAtPosition = (fileName, position, options) => {
            const prior = info.languageService.getCompletionsAtPosition(fileName, position, options);
            const program = info.languageService.getProgram();
            if (!program)
                return prior;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return prior;
            const calls = (0, core_1.findFetchCalls)(ts, sourceFile);
            for (const call of calls) {
                if (position < call.urlStart || position > call.urlStart + call.urlLength)
                    continue;
                const parsed = (0, core_1.parseFetchUrl)(call.url);
                if (!parsed)
                    continue;
                const entry = (0, core_1.ensureSpec)(parsed.domain, logger, onSpecLoaded);
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                const basePath = (0, core_1.getBasePath)(entry.spec);
                const urlPrefix = `https://${parsed.domain}${basePath}`;
                const pathEntries = [];
                for (const [specPath, methods] of Object.entries(entry.spec.paths)) {
                    const available = Object.keys(methods).filter((m) => !["parameters", "summary", "description"].includes(m));
                    if (call.httpMethod && !available.includes(call.httpMethod))
                        continue;
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
            if (!program)
                return prior;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile)
                return prior;
            const calls = (0, core_1.findFetchCalls)(ts, sourceFile);
            for (const call of calls) {
                if (position < call.urlStart || position > call.urlStart + call.urlLength)
                    continue;
                const parsed = (0, core_1.parseFetchUrl)(call.url);
                if (!parsed)
                    continue;
                const entry = (0, core_1.ensureSpec)(parsed.domain, logger, onSpecLoaded);
                if (entry.status === "loading") {
                    return {
                        kind: ts.ScriptElementKind.string, kindModifiers: "",
                        textSpan: { start: call.urlStart, length: call.urlLength },
                        documentation: [],
                        displayParts: [{ kind: "text", text: `Loading spec for ${parsed.domain}...` }],
                    };
                }
                if (entry.status !== "loaded" || !entry.spec)
                    continue;
                const hoverPath = (0, core_1.stripBasePath)(parsed.path, entry.spec);
                const specPath = (0, core_1.findSpecPath)(hoverPath, entry.spec);
                if (!specPath)
                    continue;
                const methods = Object.entries(entry.spec.paths[specPath])
                    .filter(([k]) => !["parameters", "summary", "description"].includes(k))
                    .map(([m, d]) => `${m.toUpperCase()}: ${d.summary ?? "(no description)"}`);
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
function findCallAtPosition(ts, sourceFile, pos) {
    let found = null;
    function visit(node) {
        if (found)
            return;
        if (ts.isCallExpression(node) && node.getStart() === pos) {
            found = node;
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return found;
}
function getJsonObjStart(ts, call) {
    if (call.arguments.length < 2)
        return call.getStart();
    const opts = call.arguments[1];
    if (!ts.isObjectLiteralExpression(opts))
        return call.getStart();
    const jsonProp = opts.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "body");
    if (!jsonProp || !ts.isObjectLiteralExpression(jsonProp.initializer))
        return call.getStart();
    return jsonProp.initializer.getStart();
}
module.exports = init;
