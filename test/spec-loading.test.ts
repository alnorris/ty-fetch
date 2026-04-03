import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { fetchSpecForDomain, KNOWN_SPECS, specCache } from "../src/core/spec-cache";
import { generatePerDomain } from "../src/generate-types";

// ── Helper: start a local HTTP server ──────────────────────────────

function startServer(routes: Record<string, { status?: number; contentType?: string; body: string }>) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const handler = routes[req.url];
      if (handler) {
        const { status = 200, contentType = "application/json", body } = handler;
        res.writeHead(status, { "Content-Type": contentType });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ── YAML spec loading ──────────────────────────────────────────────

describe("YAML spec loading", () => {
  it("parses a YAML spec from a URL ending in .yaml", async () => {
    const yamlSpec = `
openapi: "3.0.0"
info:
  title: YAML Test API
  version: "1.0"
servers:
  - url: https://yaml-test.example.com
paths:
  /health:
    get:
      summary: Health check
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
`;
    const { server, port } = await startServer({
      "/spec.yaml": { body: yamlSpec, contentType: "text/yaml" },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      KNOWN_SPECS[domain] = `http://127.0.0.1:${port}/spec.yaml`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "YAML Test API");
      assert.ok(entry.spec?.paths?.["/health"]);
    } finally {
      delete KNOWN_SPECS[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("parses YAML content even without .yaml extension (content sniffing)", async () => {
    const yamlSpec = `
openapi: "3.0.0"
info:
  title: Sniffed YAML
  version: "1.0"
paths:
  /ping:
    get:
      summary: Ping
      responses:
        "200":
          description: Pong
          content:
            application/json:
              schema:
                type: object
                properties:
                  pong:
                    type: boolean
`;
    const { server, port } = await startServer({
      "/api-spec": { body: yamlSpec, contentType: "text/plain" },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      KNOWN_SPECS[domain] = `http://127.0.0.1:${port}/api-spec`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Sniffed YAML");
    } finally {
      delete KNOWN_SPECS[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("still parses JSON specs correctly", async () => {
    const jsonSpec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "JSON API", version: "1.0" },
      paths: { "/test": { get: { responses: { "200": { description: "OK" } } } } },
    });
    const { server, port } = await startServer({
      "/spec.json": { body: jsonSpec },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      KNOWN_SPECS[domain] = `http://127.0.0.1:${port}/spec.json`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "JSON API");
    } finally {
      delete KNOWN_SPECS[`127.0.0.1:${port}`];
      server.close();
    }
  });
});

// ── Well-known URL probing ─────────────────────────────────────────

describe("well-known URL probing", () => {
  it("discovers spec at /openapi.json", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Discovered API", version: "1.0" },
      paths: { "/items": { get: { responses: { "200": { description: "OK" } } } } },
    });
    const { server, port } = await startServer({
      "/openapi.json": { body: spec },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      delete KNOWN_SPECS[domain];
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Discovered API");
    } finally {
      server.close();
    }
  });

  it("discovers spec at /.well-known/openapi.yaml", async () => {
    const yamlSpec = `
openapi: "3.0.0"
info:
  title: Well-Known YAML
  version: "1.0"
paths:
  /data:
    get:
      summary: Get data
      responses:
        "200":
          description: OK
`;
    const { server, port } = await startServer({
      "/.well-known/openapi.yaml": { body: yamlSpec, contentType: "text/yaml" },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      delete KNOWN_SPECS[domain];
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Well-Known YAML");
    } finally {
      server.close();
    }
  });

  it("returns not-found when no well-known path has a spec", async () => {
    const { server, port } = await startServer({});
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      delete KNOWN_SPECS[domain];
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "not-found");
    } finally {
      server.close();
    }
  });

  it("skips non-OpenAPI JSON at well-known paths", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { body: JSON.stringify({ hello: "world" }) },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      delete KNOWN_SPECS[domain];
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "not-found");
    } finally {
      server.close();
    }
  });
});

// ── Example-to-schema inference ────────────────────────────────────

describe("example inference in type generation", () => {
  it("generates types from response examples when schema is missing", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Example API" },
      servers: [{ url: "https://example.com" }],
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    example: {
                      users: [{ id: 1, name: "Alice", active: true }],
                      total: 42,
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = {
      domain: "example.com",
      baseUrl: "https://example.com",
      basePath: "",
      spec,
    };
    const result = generatePerDomain([ds], [{ domain: "example.com", path: "/users" }]);
    const content = result.get("example_com.d.ts");
    assert.ok(content, "should generate a .d.ts file");
    assert.ok(content.includes("users?:"), "should have users property");
    assert.ok(content.includes("name?: string"), "should infer string type from example");
    assert.ok(content.includes("active?: boolean"), "should infer boolean type from example");
    assert.ok(content.includes("total?: number"), "should infer number type from example");
  });

  it("prefers schema over example when both are present", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Both API" },
      servers: [{ url: "https://both.com" }],
      paths: {
        "/data": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        fromSchema: { type: "string" },
                      },
                    },
                    example: {
                      fromExample: "should not appear",
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "both.com", baseUrl: "https://both.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "both.com", path: "/data" }]);
    const content = result.get("both_com.d.ts");
    assert.ok(content.includes("fromSchema"), "should use schema");
    assert.ok(!content.includes("fromExample"), "should not use example");
  });
});

// ── JSDoc descriptions ─────────────────────────────────────────────

describe("JSDoc descriptions in generated types", () => {
  it("includes operation summary as JSDoc on response type", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Docs API" },
      servers: [{ url: "https://docs.com" }],
      paths: {
        "/items": {
          get: {
            summary: "List all items",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { items: { type: "array", items: { type: "string" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "docs.com", baseUrl: "https://docs.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "docs.com", path: "/items" }]);
    const content = result.get("docs_com.d.ts");
    assert.ok(content.includes("/** GET /items — List all items */"), "should have operation JSDoc");
  });

  it("includes property descriptions as JSDoc", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Props API" },
      servers: [{ url: "https://props.com" }],
      paths: {
        "/thing": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "The name of the thing" },
                        count: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "props.com", baseUrl: "https://props.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "props.com", path: "/thing" }]);
    const content = result.get("props_com.d.ts");
    assert.ok(content.includes("/** The name of the thing */"), "should have property JSDoc");
    assert.ok(!content.includes("/** */"), "should not have empty JSDoc for undescribed props");
  });

  it("includes query param descriptions as JSDoc", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Query API" },
      servers: [{ url: "https://query.com" }],
      paths: {
        "/search": {
          get: {
            parameters: [
              {
                name: "q",
                in: "query",
                required: true,
                description: "Search query string",
                schema: { type: "string" },
              },
              { name: "limit", in: "query", description: "Max results to return", schema: { type: "integer" } },
            ],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { results: { type: "array", items: { type: "string" } } } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "query.com", baseUrl: "https://query.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "query.com", path: "/search" }]);
    const content = result.get("query_com.d.ts");
    assert.ok(content.includes("/** Search query string */"), "should have query param JSDoc");
    assert.ok(content.includes("/** Max results to return */"), "should have limit param JSDoc");
  });
});

// ── Headers from security schemes ──────────────────────────────────

describe("headers from security schemes", () => {
  it("generates header types from apiKey security scheme", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Secure API" },
      servers: [{ url: "https://secure.com" }],
      security: [{ apiKey: [] }],
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "Your API key" },
        },
      },
      paths: {
        "/data": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "secure.com", baseUrl: "https://secure.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "secure.com", path: "/data" }]);
    const content = result.get("secure_com.d.ts");
    assert.ok(content.includes("_Headers"), "should generate a Headers type");
    assert.ok(content.includes('"X-API-Key": string'), "should require the API key header");
    assert.ok(content.includes("/** Your API key */"), "should have header description");
  });
});
