#!/usr/bin/env node
import * as ts from "typescript";
import * as path from "path";
import {
  parseFetchUrl, stripBasePath,
  pathExistsInSpec, findClosestPath, findSpecPath,
  resolveSchemaRef, validateJsonBody,
  fetchSpecForDomain, registerSpecs,
  findFetchCalls,
  type FetchCallInfo, type ValidationDiagnostic,
} from "../core";

interface FileDiagnostic {
  file: string;
  line: number;
  col: number;
  message: string;
  code: number;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: ty-fetch [tsconfig.json] [--verbose]

Validate API calls against OpenAPI specs.

Options:
  --verbose    Show spec fetching details
  --help, -h   Show this help message`);
    process.exit(0);
  }

  const tsconfigPath = args[0] ?? "tsconfig.json";

  const configFile = ts.readConfigFile(path.resolve(tsconfigPath), ts.sys.readFile);
  if (configFile.error) {
    console.error("Error reading tsconfig:", ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    process.exit(1);
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(path.resolve(tsconfigPath)));

  // Load custom spec overrides from tsconfig plugin config
  const plugins: Array<{ name?: string; specs?: Record<string, string> }> = configFile.config?.compilerOptions?.plugins ?? [];
  const pluginConfig = plugins.find((p) => p.name === "ty-fetch" || p.name === "ty-fetch/plugin");
  if (pluginConfig?.specs) {
    registerSpecs(pluginConfig.specs, path.dirname(path.resolve(tsconfigPath)));
  }

  const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);

  // Step 1: Collect all fetch URLs and their domains
  const allCalls: Array<{ file: ts.SourceFile; call: FetchCallInfo }> = [];
  const domains = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const calls = findFetchCalls(ts, sourceFile);
    for (const call of calls) {
      allCalls.push({ file: sourceFile, call });
      const parsed = parseFetchUrl(call.url);
      if (parsed) domains.add(parsed.domain);
    }
  }

  if (allCalls.length === 0) {
    console.log("No fetch calls found.");
    process.exit(0);
  }

  const log = (msg: string) => {
    if (args.includes("--verbose")) console.error(`[ty-fetch] ${msg}`);
  };

  // Step 2: Fetch all specs (async, in parallel)
  log(`Found ${allCalls.length} fetch call(s) across ${domains.size} domain(s)`);
  await Promise.all([...domains].map((d) => fetchSpecForDomain(d, log)));

  // Step 3: Validate
  const diagnostics: FileDiagnostic[] = [];

  for (const { file: sourceFile, call } of allCalls) {
    const parsed = parseFetchUrl(call.url);
    if (!parsed) continue;

    const entry = await fetchSpecForDomain(parsed.domain, log);
    if (entry.status !== "loaded" || !entry.spec) continue;

    const apiPath = stripBasePath(parsed.path, entry.spec);

    // Path validation
    if (!pathExistsInSpec(apiPath, entry.spec)) {
      const allPaths = Object.keys(entry.spec.paths);
      const suggestion = findClosestPath(apiPath, allPaths);
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
      const specPath = findSpecPath(apiPath, entry.spec);
      if (specPath) {
        const operation = entry.spec.paths[specPath]?.[call.httpMethod];
        const reqSchema =
          operation?.requestBody?.content?.["application/json"]?.schema ??
          operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema;
        if (reqSchema) {
          const resolved = resolveSchemaRef(reqSchema, entry.spec);
          if (resolved?.properties) {
            const jsonObjStart = call.jsonBody.length > 0 ? call.jsonBody[0].nameStart - 2 : call.callStart;
            const bodyDiags = validateJsonBody(call.jsonBody, resolved, entry.spec, jsonObjStart);
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
