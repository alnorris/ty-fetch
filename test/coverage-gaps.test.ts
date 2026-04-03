import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { validateJsonBody } from "../src/core/body-validator";
import { resolveSchemaRef } from "../src/core/schema-utils";
import { generatePerDomain } from "../src/generate-types";

const ty = require("../index.js");

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ── index.js stream coverage gaps ──────────────────────────────────

describe("stream coverage gaps", () => {
  it("stream replaces path params", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ path: req.url }) + "\n");
      res.end();
    });
    try {
      const chunks: any[] = [];
      for await (const chunk of ty.stream(`${url}/users/{id}`, {
        params: { path: { id: "42" } },
      })) {
        chunks.push(chunk);
      }
      assert.equal(chunks[0].path, "/users/42");
    } finally {
      server.close();
    }
  });

  it("stream appends query params", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ url: req.url }) + "\n");
      res.end();
    });
    try {
      const chunks: any[] = [];
      for await (const chunk of ty.stream(`${url}/events`, {
        params: { query: { channel: "main" } },
      })) {
        chunks.push(chunk);
      }
      assert.ok(chunks[0].url.includes("channel=main"));
    } finally {
      server.close();
    }
  });

  it("stream sends JSON body", async () => {
    const { server, url } = await startServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ received: JSON.parse(body) }) + "\n");
        res.end();
      });
    });
    try {
      const chunks: any[] = [];
      for await (const chunk of ty.stream(url, {
        method: "POST",
        body: { prompt: "hello" },
      })) {
        chunks.push(chunk);
      }
      assert.deepEqual(chunks[0].received, { prompt: "hello" });
    } finally {
      server.close();
    }
  });

  it("stream handles response with no body", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(); // empty body
    });
    try {
      const chunks: any[] = [];
      for await (const chunk of ty.stream(url)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 0);
    } finally {
      server.close();
    }
  });

  it("stream flushes remaining buffer for NDJSON", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write('{"last":true}'); // no trailing newline
      res.end();
    });
    try {
      const chunks: any[] = [];
      for await (const chunk of ty.stream(url)) {
        chunks.push(chunk);
      }
      assert.ok(chunks.some((c) => c.last === true), "should flush remaining buffer");
    } finally {
      server.close();
    }
  });

  it("stream with prefixUrl", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ path: req.url }) + "\n");
      res.end();
    });
    try {
      const api = ty.create({ prefixUrl: url });
      const chunks: any[] = [];
      for await (const chunk of api.stream("/events")) {
        chunks.push(chunk);
      }
      assert.equal(chunks[0].path, "/events");
    } finally {
      server.close();
    }
  });
});

// ── body-validator coverage gaps ───────────────────────────────────

describe("body-validator coverage gaps", () => {
  it("validates nested object properties", () => {
    const schema = {
      type: "object" as const,
      required: ["address"],
      properties: {
        address: {
          type: "object" as const,
          required: ["street"],
          properties: {
            street: { type: "string" as const },
            city: { type: "string" as const },
          },
        },
      },
    };
    const diagnostics = validateJsonBody(
      [
        { name: "address", nameStart: 0, nameLength: 7, valueStart: 10, valueLength: 20, valueText: '{"street":"Main St"}', valueKind: "object" as const },
      ],
      schema,
      (ref: string) => undefined,
    );
    assert.equal(diagnostics.length, 0);
  });

  it("catches wrong type in nested value", () => {
    const schema = {
      type: "object" as const,
      properties: {
        count: { type: "number" as const },
      },
    };
    const diagnostics = validateJsonBody(
      [
        { name: "count", nameStart: 0, nameLength: 5, valueStart: 8, valueLength: 5, valueText: '"abc"', valueKind: "string" as const },
      ],
      schema,
      () => undefined,
    );
    assert.ok(diagnostics.length > 0, "should catch string where number expected");
  });

  it("handles array value kind", () => {
    const schema = {
      type: "object" as const,
      properties: {
        tags: { type: "array" as const, items: { type: "string" as const } },
      },
    };
    const diagnostics = validateJsonBody(
      [
        { name: "tags", nameStart: 0, nameLength: 4, valueStart: 7, valueLength: 10, valueText: '["a","b"]', valueKind: "array" as const },
      ],
      schema,
      () => undefined,
    );
    assert.equal(diagnostics.length, 0);
  });

  it("allows null value kind (lenient validation)", () => {
    const schema = {
      type: "object" as const,
      properties: {
        name: { type: "string" as const },
      },
    };
    const diagnostics = validateJsonBody(
      [
        { name: "name", nameStart: 0, nameLength: 4, valueStart: 7, valueLength: 4, valueText: "null", valueKind: "null" as const },
      ],
      schema,
      () => undefined,
    );
    // null is not type-checked against primitives (lenient)
    assert.equal(diagnostics.length, 0);
  });
});

// ── schema-utils coverage gap ──────────────────────────────────────

describe("schema-utils coverage gaps", () => {
  it("resolveSchemaRef returns resolved schema for $ref", () => {
    const spec = { paths: {}, components: { schemas: { User: { type: "object", properties: { name: { type: "string" } } } } } };
    const result = resolveSchemaRef({ $ref: "#/components/schemas/User" }, spec as any);
    assert.ok(result);
    assert.equal(result.type, "object");
  });

  it("resolveSchemaRef returns input when no $ref", () => {
    const schema = { type: "string" };
    const result = resolveSchemaRef(schema, { paths: {} } as any);
    assert.equal(result.type, "string");
  });
});

// ── generate-types coverage gap (line 150: operation.description fallback) ──

describe("generate-types coverage gaps", () => {
  it("uses operation description when summary is missing", () => {
    const spec = {
      info: { title: "Desc API" },
      servers: [{ url: "https://desc.com" }],
      paths: {
        "/items": {
          get: {
            description: "Retrieves all items from the store",
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } } } } },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "desc.com", baseUrl: "https://desc.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "desc.com", path: "/items" }]);
    const content = result.get("desc_com.d.ts")!;
    assert.ok(content.includes("Retrieves all items"), "should use description when no summary");
  });

  it("handles anyOf union types", () => {
    const spec = {
      info: { title: "AnyOf API" },
      servers: [{ url: "https://anyof.com" }],
      paths: {
        "/mixed": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      anyOf: [{ type: "string" }, { type: "number" }],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "anyof.com", baseUrl: "https://anyof.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "anyof.com", path: "/mixed" }]);
    const content = result.get("anyof_com.d.ts")!;
    assert.ok(content.includes("string | number"), "should handle anyOf");
  });

  it("handles boolean additionalProperties", () => {
    const spec = {
      info: { title: "Bool AP" },
      servers: [{ url: "https://boolap.com" }],
      paths: {
        "/map": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ds = { domain: "boolap.com", baseUrl: "https://boolap.com", basePath: "", spec };
    const result = generatePerDomain([ds], [{ domain: "boolap.com", path: "/map" }]);
    const content = result.get("boolap_com.d.ts")!;
    assert.ok(content.includes("[key: string]: any"), "boolean additionalProperties should use any");
  });
});
