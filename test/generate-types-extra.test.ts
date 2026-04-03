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

  it("generates empty TyFetch interface for endpoints with no response content", () => {
    const spec = makeSpec({
      "/void": {
        delete: {
          responses: { "204": { description: "No Content" } },
        },
      },
    });
    const result = generatePerDomain([makeDomain(spec)], [{ domain: "test.com", path: "/void" }]);
    // The path matches but no overloads are generated (no JSON response)
    if (result.size > 0) {
      const content = result.get("test_com.d.ts")!;
      assert.ok(!content.includes("delete("), "should not generate overload for 204");
    }
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
