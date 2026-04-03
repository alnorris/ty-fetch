#!/usr/bin/env node
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
Object.defineProperty(exports, "__esModule", { value: true });
const ts = __importStar(require("typescript"));
const path = __importStar(require("path"));
const core_1 = require("../core");
async function main() {
    const args = process.argv.slice(2);
    const tsconfigPath = args[0] ?? "tsconfig.json";
    const configFile = ts.readConfigFile(path.resolve(tsconfigPath), ts.sys.readFile);
    if (configFile.error) {
        console.error("Error reading tsconfig:", ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
        process.exit(1);
    }
    const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(path.resolve(tsconfigPath)));
    // Load custom spec overrides from tsconfig plugin config
    const plugins = configFile.config?.compilerOptions?.plugins ?? [];
    const pluginConfig = plugins.find((p) => p.name === "ty-fetch" || p.name === "ty-fetch/plugin");
    if (pluginConfig?.specs) {
        (0, core_1.registerSpecs)(pluginConfig.specs, path.dirname(path.resolve(tsconfigPath)));
    }
    const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
    // Step 1: Collect all fetch URLs and their domains
    const allCalls = [];
    const domains = new Set();
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile)
            continue;
        const calls = (0, core_1.findFetchCalls)(ts, sourceFile);
        for (const call of calls) {
            allCalls.push({ file: sourceFile, call });
            const parsed = (0, core_1.parseFetchUrl)(call.url);
            if (parsed)
                domains.add(parsed.domain);
        }
    }
    if (allCalls.length === 0) {
        console.log("No fetch calls found.");
        process.exit(0);
    }
    const log = (msg) => {
        if (args.includes("--verbose"))
            console.error(`[ty-fetch] ${msg}`);
    };
    // Step 2: Fetch all specs (async, in parallel)
    log(`Found ${allCalls.length} fetch call(s) across ${domains.size} domain(s)`);
    await Promise.all([...domains].map((d) => (0, core_1.fetchSpecForDomain)(d, log)));
    // Step 3: Validate
    const diagnostics = [];
    for (const { file: sourceFile, call } of allCalls) {
        const parsed = (0, core_1.parseFetchUrl)(call.url);
        if (!parsed)
            continue;
        const entry = await (0, core_1.fetchSpecForDomain)(parsed.domain, log);
        if (entry.status !== "loaded" || !entry.spec)
            continue;
        const apiPath = (0, core_1.stripBasePath)(parsed.path, entry.spec);
        // Path validation
        if (!(0, core_1.pathExistsInSpec)(apiPath, entry.spec)) {
            const allPaths = Object.keys(entry.spec.paths);
            const suggestion = (0, core_1.findClosestPath)(apiPath, allPaths);
            const msg = `Path '${apiPath}' does not exist in ${entry.spec.info?.title ?? parsed.domain}.`
                + (suggestion ? ` Did you mean '${suggestion}'?` : "");
            const pos = sourceFile.getLineAndCharacterOfPosition(call.urlStart);
            diagnostics.push({
                file: path.relative(process.cwd(), sourceFile.fileName),
                line: pos.line + 1, col: pos.character + 1,
                message: msg, code: 99001,
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
                        const jsonObjStart = call.jsonBody.length > 0 ? call.jsonBody[0].nameStart - 2 : call.callStart;
                        const bodyDiags = (0, core_1.validateJsonBody)(call.jsonBody, resolved, entry.spec, jsonObjStart);
                        for (const d of bodyDiags) {
                            const pos = sourceFile.getLineAndCharacterOfPosition(d.start);
                            diagnostics.push({
                                file: path.relative(process.cwd(), sourceFile.fileName),
                                line: pos.line + 1, col: pos.character + 1,
                                message: d.message, code: d.code,
                            });
                        }
                    }
                }
            }
        }
    }
    // Step 4: Output
    if (diagnostics.length === 0) {
        console.log("No errors found.");
        process.exit(0);
    }
    for (const d of diagnostics) {
        console.log(`${d.file}:${d.line}:${d.col} - error TF${d.code}: ${d.message}`);
    }
    console.log(`\n${diagnostics.length} error(s) found.`);
    process.exit(1);
}
main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(2);
});
