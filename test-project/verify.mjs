/**
 * Verifies the ty-fetch plugin works by programmatically running
 * the TS language service with the plugin loaded.
 *
 * Usage: node verify.mjs
 *
 * This simulates what VS Code does: create a TS language service,
 * load the plugin, and ask for diagnostics.
 */
import ts from "typescript";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve } from "path";

const require = createRequire(import.meta.url);

// Load the plugin init function
const pluginInit = require("ty-fetch/plugin");
const pluginModule = pluginInit({ typescript: ts });

// Set up a minimal language service host
const fileName = resolve("example.ts");
const fileContent = readFileSync(fileName, "utf-8");

/** @type {ts.LanguageServiceHost} */
const host = {
  getScriptFileNames: () => [fileName],
  getScriptVersion: () => "1",
  getScriptSnapshot: (name) => {
    if (name === fileName) {
      return ts.ScriptSnapshot.fromString(fileContent);
    }
    try {
      return ts.ScriptSnapshot.fromString(readFileSync(name, "utf-8"));
    } catch {
      return undefined;
    }
  },
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => ({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
  }),
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

const ls = ts.createLanguageService(host);

// Create the plugin proxy — simulating what tsserver does
const pluginProxy = pluginModule.create({
  languageService: ls,
  languageServiceHost: host,
  project: {
    projectService: {
      logger: { info: (msg) => console.log(`  [tsserver] ${msg}`) },
    },
    getCurrentDirectory: () => process.cwd(),
    refreshDiagnostics: () => {
      console.log("  → refreshDiagnostics() called — specs loaded, re-checking...\n");
      showDiagnostics();
    },
  },
  serverHost: ts.sys,
  config: {},
});

function showDiagnostics() {
  const diags = pluginProxy.getSemanticDiagnostics(fileName);
  const custom = diags.filter((d) => d.source === "ty-fetch");

  if (custom.length === 0) {
    console.log("  No ty-fetch diagnostics (specs may still be loading...)");
  } else {
    console.log(`  Found ${custom.length} ty-fetch diagnostic(s):\n`);
    for (const d of custom) {
      const pos = d.file
        ? d.file.getLineAndCharacterOfPosition(d.start ?? 0)
        : null;
      const loc = pos ? `line ${pos.line + 1}:${pos.character + 1}` : "";
      console.log(`  ❌ ${loc} — ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    }
  }
  console.log();
}

console.log("=== ty-fetch POC verification ===\n");
console.log("1. Initial diagnostics (specs not yet loaded):");
showDiagnostics();

console.log("2. Waiting for async spec fetches...\n");
// The plugin fires async fetches. Wait for them to complete.
// refreshDiagnostics() will be called automatically when each spec loads.

// Give it up to 30 seconds
setTimeout(() => {
  console.log("3. Final check:");
  showDiagnostics();
  process.exit(0);
}, 30000);
