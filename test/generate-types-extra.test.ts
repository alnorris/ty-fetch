import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDtsContent, generatePerDomain } from "../src/generate-types";

function makeSpec(paths: Record<string, any>, components?: any) {
  return {
    info: { title: "Test" },
    servers: [{ url: "https://test.com" }],
    components,
    paths,
  };
}

function makeDomain(spec: any) {
  return { domain: "test.com", baseUrl: "https://test.com", basePath: "", spec };
}

// ── Type generation edge cases ─────────────────────────────────────

describe("type generation edge cases", () => {
  it("handles nullable types", () => {
    const spec = makeSpec({
      "/nullable": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { name: { type: "string", nullable: true } } },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/nullable" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("string | null"), "nullable string should include null union");
  });

  it("handles oneOf unions", () => {
    const spec = makeSpec({
      "/union": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { type: "object", properties: { type: { type: "string" }, name: { type: "string" } } },
                      { type: "object", properties: { type: { type: "string" }, code: { type: "number" } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/union" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("|"), "should generate union type");
  });

  it("handles allOf intersections", () => {
    const spec = makeSpec({
      "/intersection": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { type: "object", properties: { id: { type: "number" } } },
                      { type: "object", properties: { name: { type: "string" } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/intersection" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("&"), "should generate intersection type");
  });

  it("handles additionalProperties", () => {
    const spec = makeSpec({
      "/map": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { id: { type: "string" } },
                    additionalProperties: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/map" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("[key: string]: string"), "should have index signature");
  });

  it("handles empty object schema", () => {
    const spec = makeSpec({
      "/empty": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/empty" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("Record<string, any>"), "empty object should be Record");
  });

  it("handles array response", () => {
    const spec = makeSpec({
      "/list": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { type: "object", properties: { id: { type: "number" } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/list" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("[]"), "should have array type");
  });

  it("handles 201 response code", () => {
    const spec = makeSpec({
      "/create": {
        post: {
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { id: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/create" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("post("), "should generate POST overload from 201 response");
  });

  it("generates overload with void response for endpoints with no response content", () => {
    const spec = makeSpec({
      "/void": {
        delete: {
          responses: { "204": { description: "No Content" } },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/void" }]);
    assert.ok(result.size > 0, "should generate a .d.ts file");
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("delete("), "should generate overload for 204");
    assert.ok(content.includes("void"), "response type should be void");
  });

  it("generates void response with typed path params for no-body endpoints", () => {
    const spec = makeSpec({
      "/items/{itemId}": {
        delete: {
          summary: "Delete an item",
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": { description: "No Content" } },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/items/123" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("delete("), "should generate delete overload");
    assert.ok(content.includes("FetchResult<Test_Items_ItemId_Delete>"), "should reference response type");
    assert.ok(content.includes("type Test_Items_ItemId_Delete = void"), "response type should be void");
    assert.ok(content.includes("PathParams"), "should generate path params type");
    assert.ok(content.includes("itemId: string"), "should have itemId param");
  });

  it("includes JSDoc with summary on overloads", () => {
    const spec = makeSpec({
      "/pets": {
        get: {
          summary: "List all pets",
          responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.ok(result.includes("/** List all pets */"), "overload should have JSDoc with summary");
  });

  it("includes JSDoc with summary and description on overloads", () => {
    const spec = makeSpec({
      "/pets": {
        get: {
          summary: "List all pets",
          description: "Returns a paginated list of all pets in the store.",
          responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.ok(result.includes("List all pets"), "should include summary");
    assert.ok(result.includes("Returns a paginated list"), "should include description");
  });

  it("omits duplicate description when same as summary", () => {
    const spec = makeSpec({
      "/pets": {
        get: {
          summary: "List all pets",
          description: "List all pets",
          responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    const matches = result.match(/List all pets/g);
    // summary appears in type comment + JSDoc, but description should not duplicate JSDoc
    assert.ok(matches, "should include summary");
    // Count JSDoc occurrences (each overload gets one, but description shouldn't double up within a single JSDoc)
    const jsdocBlocks = result.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
    for (const block of jsdocBlocks) {
      const count = (block.match(/List all pets/g) ?? []).length;
      assert.ok(count <= 1, `JSDoc block should not repeat summary, found ${count} times`);
    }
  });

  it("includes property descriptions in response types", () => {
    const spec = makeSpec({
      "/pets": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "The pet's name" },
                      status: { type: "string", description: "Current adoption status" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.ok(result.includes("/** The pet's name */"), "should include property description for name");
    assert.ok(result.includes("/** Current adoption status */"), "should include property description for status");
  });

  it("handles $ref in response schema", () => {
    const spec = makeSpec(
      {
        "/ref": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
        },
      },
      { schemas: { User: { type: "object", properties: { name: { type: "string" }, email: { type: "string" } } } } },
    );
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/ref" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("name?:"), "should resolve $ref and include properties");
    assert.ok(content.includes("email?:"), "should include email from resolved ref");
  });

  it("handles reserved word property names", () => {
    const spec = makeSpec({
      "/reserved": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      "private": { type: "string" },
                      "class": { type: "string" },
                      normalProp: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/reserved" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes('"private"'), "should quote reserved word 'private'");
    assert.ok(content.includes('"class"'), "should quote reserved word 'class'");
    assert.ok(content.includes("normalProp"), "normal prop should not be quoted");
  });

  it("handles multiple HTTP methods on same path", () => {
    const spec = makeSpec({
      "/items": {
        get: {
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } } } } } } },
        },
        post: {
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
          responses: { "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/items" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("get("), "should have GET overload");
    assert.ok(content.includes("post("), "should have POST overload");
  });

  it("handles header parameters", () => {
    const spec = makeSpec({
      "/header": {
        get: {
          parameters: [
            { name: "X-Request-ID", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/header" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("X-Request-ID"), "should include header param");
  });

  it("generates FetchResult return type", () => {
    const spec = makeSpec({
      "/result": {
        get: {
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/result" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content.includes("Promise<FetchResult<"), "should use FetchResult return type");
  });

  it("infers types from null/undefined examples", () => {
    const spec = makeSpec({
      "/null-example": {
        get: {
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { example: null } },
            },
          },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/null-example" }]);
    const content = result.get("test_com.d.ts")!;
    assert.ok(content, "should generate types even from null example");
  });
});

// ── Swagger 2.0 support ───────────────────────────────────────────

describe("Swagger 2.0 support", () => {
  it("generates types from Swagger 2.0 spec with basePath", () => {
    const spec = {
      swagger: "2.0",
      info: { title: "Swagger API" },
      basePath: "/v2",
      paths: {
        "/pets": {
          get: {
            responses: {
              "200": {
                description: "OK",
                schema: {
                  type: "array",
                  items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    };
    const { getBasePath } = require("../src/core/url-parser");
    const basePath = getBasePath(spec);
    assert.equal(basePath, "/v2", "should extract basePath from Swagger 2.0 spec");
    const ds = { domain: "swagger.com", baseUrl: "https://swagger.com", basePath, spec };
    const result = generatePerDomain([ds], [{ domain: "swagger.com", path: "/v2/pets" }]);
    const content = result.get("swagger_com.d.ts")!;
    assert.ok(content, "should generate types from Swagger 2.0 spec");
    assert.ok(content.includes("id?: number"), "should have id property");
    assert.ok(content.includes("name?: string"), "should have name property");
  });

  it("handles Swagger 2.0 body parameter", () => {
    const spec = {
      swagger: "2.0",
      info: { title: "Swagger Body" },
      basePath: "/api",
      paths: {
        "/users": {
          post: {
            parameters: [
              { name: "body", in: "body", required: true, schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" } } } },
            ],
            responses: {
              "201": {
                description: "Created",
                schema: { type: "object", properties: { id: { type: "string" } } },
              },
            },
          },
        },
      },
    };
    const { getBasePath } = require("../src/core/url-parser");
    const basePath = getBasePath(spec);
    const ds = { domain: "swagger-body.com", baseUrl: "https://swagger-body.com", basePath, spec };
    const result = generatePerDomain([ds], [{ domain: "swagger-body.com", path: "/api/users" }]);
    const content = result.get("swagger_body_com.d.ts")!;
    assert.ok(content.includes("post("), "should generate POST overload");
    assert.ok(content.includes("_Body"), "should generate body type");
  });

  it("handles Swagger 2.0 path params", () => {
    const spec = {
      swagger: "2.0",
      info: { title: "Swagger Params" },
      basePath: "/v1",
      paths: {
        "/users/{userId}": {
          get: {
            parameters: [{ name: "userId", in: "path", required: true, type: "string" }],
            responses: {
              "200": {
                description: "OK",
                schema: { type: "object", properties: { name: { type: "string" } } },
              },
            },
          },
        },
      },
    };
    const { getBasePath } = require("../src/core/url-parser");
    const ds = { domain: "swagger-params.com", baseUrl: "https://swagger-params.com", basePath: getBasePath(spec), spec };
    const result = generatePerDomain([ds], [{ domain: "swagger-params.com", path: "/v1/users/abc" }]);
    const content = result.get("swagger_params_com.d.ts")!;
    assert.ok(content.includes("PathParams"), "should generate path params type");
    assert.ok(content.includes("userId: string"), "should have userId param");
  });
});

// ── Query param enum types ──────────────────────────────────────

describe("query param type inference", () => {
  it("generates enum union for query param with enum", () => {
    const spec = makeSpec({
      "/search": {
        get: {
          parameters: [{ name: "sort", in: "query", schema: { type: "string", enum: ["asc", "desc"] } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /sort\??: "asc" \| "desc"/);
    assert.doesNotMatch(result, /sort\??: string/);
  });

  it("generates number type for integer query param", () => {
    const spec = makeSpec({
      "/items": {
        get: {
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /limit\??: number/);
  });

  it("generates boolean type for boolean query param", () => {
    const spec = makeSpec({
      "/items": {
        get: {
          parameters: [{ name: "active", in: "query", schema: { type: "boolean" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /active\??: boolean/);
  });

  it("generates array type for array query param with enum items", () => {
    const spec = makeSpec({
      "/filter": {
        get: {
          parameters: [{
            name: "tags",
            in: "query",
            schema: { type: "array", items: { type: "string", enum: ["a", "b", "c"] } },
          }],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /tags\??: \("a" \| "b" \| "c"\)\[\]/);
  });

  it("generates numeric enum values", () => {
    const spec = makeSpec({
      "/levels": {
        get: {
          parameters: [{ name: "level", in: "query", schema: { type: "integer", enum: [1, 2, 3] } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /level\??: 1 \| 2 \| 3/);
  });

  it("defaults to string for query param with no schema", () => {
    const spec = makeSpec({
      "/bare": {
        get: {
          parameters: [{ name: "q", in: "query" }],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /q\??: string/);
  });

  it("marks required query params without ?", () => {
    const spec = makeSpec({
      "/search": {
        get: {
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const result = generateDtsContent([makeDomain(spec)]);
    assert.match(result, /q: string/);
    assert.match(result, /page\?: number/);
  });
});
