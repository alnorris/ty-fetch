import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { generateDtsContent, type DomainSpec } from "../src/generate-types";

/**
 * Type-safety regression tests.
 *
 * These tests generate a real .d.ts file, then type-check sample code against
 * it using the TypeScript compiler API. This catches regressions where overloads
 * silently fall through to `any` (e.g. when relative-path overloads are missing
 * for ty.create instances).
 */

// ── Shared spec fixtures ────────────────────────────────────────────

const petSpec = {
  info: { title: "Petstore" },
  servers: [{ url: "/api/v3" }],
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name", "photoUrls"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          photoUrls: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["available", "pending", "sold"] },
        },
      },
    },
  },
  paths: {
    "/pet": {
      post: {
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        },
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
    "/pet/findByStatus": {
      get: {
        parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["available", "pending", "sold"] } }],
        responses: {
          "200": {
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } },
          },
        },
      },
    },
    "/pet/{petId}": {
      get: {
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
  },
};

const ds: DomainSpec = {
  domain: "petstore.io",
  baseUrl: "https://petstore.io",
  basePath: "/api/v3",
  spec: petSpec as any,
};

// ── Helpers ─────────────────────────────────────────────────────────

let tmpDir: string;
let dtsPath: string;

function createTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ty-fetch-type-test-"));
  dtsPath = path.join(tmpDir, "ty-fetch.d.ts");
}

function writeDts(domainSpecs: DomainSpec[]) {
  const dtsContent = generateDtsContent(domainSpecs);
  const baseDts = fs.readFileSync(path.join(__dirname, "..", "base.d.ts"), "utf-8");
  // Apply the same tightening the plugin does: set TPathParams and TQueryParams to never
  // in base overloads so specific overloads take priority for params/body validation.
  const tightenedBase = baseDts
    .replace(/options\?: Options<never>\)/g, "options?: Options<never, never, never>)")
    .replace(/options\?: Options\)/g, "options?: Options<unknown, never, never>)");
  fs.writeFileSync(dtsPath, [tightenedBase, "", dtsContent].join("\n"), "utf-8");
}

function removeTmpDir() {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Type-check a snippet of TypeScript code against the generated .d.ts.
 * Returns an array of diagnostic messages. Empty = no errors.
 */
function typeCheck(code: string): string[] {
  const codePath = path.join(tmpDir, "test-code.ts");
  const fullCode = `/// <reference path="./ty-fetch.d.ts" />\n` +
    `declare const ty: import("./ty-fetch").TyFetch;\n` +
    code;
  fs.writeFileSync(codePath, fullCode, "utf-8");

  const program = ts.createProgram([codePath], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics
    .filter((d) => d.file?.fileName === codePath)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

/**
 * Resolve the type of a variable in a code snippet.
 * Returns the type string as TypeScript would display it.
 */
function resolveType(code: string, varName: string): string {
  const codePath = path.join(tmpDir, "type-resolve.ts");
  const fullCode = `/// <reference path="./ty-fetch.d.ts" />\n` +
    `declare const ty: import("./ty-fetch").TyFetch;\n` +
    code;
  fs.writeFileSync(codePath, fullCode, "utf-8");

  const program = ts.createProgram([codePath], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });

  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(codePath)!;

  let resultType = "unknown";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === varName) {
      const type = checker.getTypeAtLocation(node);
      resultType = checker.typeToString(type);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return resultType;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("type safety: full URL calls (ty.get)", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("GET full URL resolves to typed array, not any", () => {
    const type = resolveType(
      `async function test() {
         const { data } = await ty.get("https://petstore.io/api/v3/pet/findByStatus");
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "data should not be any for full URL GET");
  });

  it("POST full URL resolves body type to non-any", () => {
    const errors = typeCheck(
      `async function test() {
         const { data } = await ty.post("https://petstore.io/api/v3/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
       }`,
    );
    assert.deepEqual(errors, [], "POST with valid body should type-check");
  });

  it("GET with path params resolves to typed response", () => {
    const type = resolveType(
      `async function test() {
         const { data } = await ty.get("https://petstore.io/api/v3/pet/123");
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "data should not be any for parameterized path");
  });
});

describe("type safety: relative URL calls (ty.create instance)", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("GET relative path resolves to typed array, not any", () => {
    const type = resolveType(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         const { data } = await petstore.get("/pet/findByStatus");
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "data should not be any for relative path GET via instance");
  });

  it("POST relative path has typed body", () => {
    const errors = typeCheck(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         const { data } = await petstore.post("/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
       }`,
    );
    assert.deepEqual(errors, [], "POST with valid body via instance should type-check");
  });

  it("GET relative path with basePath prefix also resolves", () => {
    const type = resolveType(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io" });
       async function test() {
         const { data } = await petstore.get("/api/v3/pet/findByStatus");
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "data should not be any for basePath-prefixed relative path");
  });

  it("GET relative path with path params resolves, not any", () => {
    const type = resolveType(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         const { data } = await petstore.get("/pet/123");
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "data should not be any for relative parameterized path");
  });
});

describe("type safety: query params are typed on matched overload", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("valid query param compiles for full URL", () => {
    const errors = typeCheck(
      `async function test() {
         await ty.get("https://petstore.io/api/v3/pet/findByStatus", {
           params: { query: { status: "available" } },
         });
       }`,
    );
    assert.deepEqual(errors, [], "valid enum query param should compile for full URL");
  });

  it("valid query param compiles for relative URL", () => {
    const errors = typeCheck(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         await petstore.get("/pet/findByStatus", {
           params: { query: { status: "sold" } },
         });
       }`,
    );
    assert.deepEqual(errors, [], "valid enum query param should compile for relative URL");
  });
});

describe("type safety: body types are typed on matched overload", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("valid body compiles for full URL POST", () => {
    const errors = typeCheck(
      `async function test() {
         await ty.post("https://petstore.io/api/v3/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
       }`,
    );
    assert.deepEqual(errors, [], "valid body should compile for full URL POST");
  });

  it("valid body compiles for relative URL POST", () => {
    const errors = typeCheck(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         await petstore.post("/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
       }`,
    );
    assert.deepEqual(errors, [], "valid body should compile for relative URL POST");
  });

  it("POST response data is typed, not any", () => {
    const type = resolveType(
      `async function test() {
         const { data } = await ty.post("https://petstore.io/api/v3/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "POST response data should be typed, not any");
  });

  it("POST response data is typed for relative URL, not any", () => {
    const type = resolveType(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         const { data } = await petstore.post("/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "POST response data via instance should be typed, not any");
  });
});

describe("type safety: no basePath spec", () => {
  const noBaseDs: DomainSpec = {
    domain: "api.example.com",
    baseUrl: "https://api.example.com",
    basePath: "",
    spec: {
      info: { title: "Example" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } } },
                  },
                },
              },
            },
          },
        },
      },
    } as any,
  };

  it("generates only full URL and single relative overload (no duplicate)", () => {
    const content = generateDtsContent([noBaseDs]);
    const getOverloads = content.split("\n").filter((l) => l.includes("get(url:"));
    const usersOverloads = getOverloads.filter((l) => l.includes("/users"));
    // Should have full URL + relative (basePath + specPath = specPath when empty) = 2 overloads
    assert.equal(usersOverloads.length, 2, "empty basePath should produce exactly 2 overloads (full URL + relative)");
  });

  it("relative path overload works for empty basePath", () => {
    createTmpDir();
    writeDts([noBaseDs]);

    const type = resolveType(
      `const api = ty.create({ prefixUrl: "https://api.example.com" });
       async function test() {
         const { data } = await api.get("/users");
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "data should be typed for relative path with empty basePath");

    removeTmpDir();
  });
});

describe("type safety: invalid query params are rejected", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("rejects invalid enum value for full URL", () => {
    const errors = typeCheck(
      `async function test() {
         await ty.get("https://petstore.io/api/v3/pet/findByStatus", {
           params: { query: { status: "invalid" } },
         });
       }`,
    );
    assert.ok(errors.length > 0, "invalid enum value should produce a type error for full URL");
  });

  it("rejects invalid enum value for relative URL", () => {
    const errors = typeCheck(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         await petstore.get("/pet/findByStatus", {
           params: { query: { status: "invalid" } },
         });
       }`,
    );
    assert.ok(errors.length > 0, "invalid enum value should produce a type error for relative URL");
  });

  it("rejects unknown query param name for full URL", () => {
    const errors = typeCheck(
      `async function test() {
         await ty.get("https://petstore.io/api/v3/pet/findByStatus", {
           params: { query: { bogus: "value" } },
         });
       }`,
    );
    assert.ok(errors.length > 0, "unknown query param should produce a type error");
  });

  it("rejects unknown query param name for relative URL", () => {
    const errors = typeCheck(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         await petstore.get("/pet/findByStatus", {
           params: { query: { bogus: "value" } },
         });
       }`,
    );
    assert.ok(errors.length > 0, "unknown query param should produce a type error for relative URL");
  });
});

describe("type safety: body types resolve to specific type, not unknown", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("valid body matches specific overload for full URL POST", () => {
    const type = resolveType(
      `async function test() {
         const { data } = await ty.post("https://petstore.io/api/v3/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "POST response should be typed when body matches spec");
  });

  it("valid body matches specific overload for relative URL POST", () => {
    const type = resolveType(
      `const petstore = ty.create({ prefixUrl: "https://petstore.io/api/v3" });
       async function test() {
         const { data } = await petstore.post("/pet", {
           body: { name: "doggie", photoUrls: ["url"] },
         });
         return data;
       }
       const inferredResult = null! as Awaited<ReturnType<typeof test>>;`,
      "inferredResult",
    );
    assert.notEqual(type, "any", "POST response via instance should be typed when body matches spec");
  });
});

describe("type safety: tightened base overloads", () => {
  before(() => {
    createTmpDir();
    writeDts([ds]);
  });
  after(() => removeTmpDir());

  it("base get without params still compiles", () => {
    const errors = typeCheck(
      `async function test() {
         await ty.get("https://some-unknown-api.com/data");
       }`,
    );
    assert.deepEqual(errors, [], "GET without params on unknown URL should compile");
  });

  it("base post with body still compiles on unknown URL", () => {
    const errors = typeCheck(
      `async function test() {
         await ty.post("https://some-unknown-api.com/data", {
           body: { anything: "works" },
         });
       }`,
    );
    assert.deepEqual(errors, [], "POST with body on unknown URL should compile");
  });
});
