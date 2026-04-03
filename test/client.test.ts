import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";

// Import the runtime client
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

describe("ty-fetch client", () => {
  it("GET returns { data, response } on success", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ users: [{ id: 1 }] }));
    });
    try {
      const { data, error, response } = await ty.get(url);
      assert.deepEqual(data, { users: [{ id: 1 }] });
      assert.equal(error, undefined);
      assert.equal(response.status, 200);
    } finally {
      server.close();
    }
  });

  it("POST sends JSON body and returns typed response", async () => {
    const { server, url } = await startServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "123", name: parsed.name }));
      });
    });
    try {
      const { data, error } = await ty.post(url, { body: { name: "Jane" } });
      assert.equal(data.id, "123");
      assert.equal(data.name, "Jane");
      assert.equal(error, undefined);
    } finally {
      server.close();
    }
  });

  it("returns { error } on non-2xx response", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Validation failed", code: "INVALID" }));
    });
    try {
      const { data, error, response } = await ty.get(url);
      assert.equal(data, undefined);
      assert.equal(error.message, "Validation failed");
      assert.equal(error.code, "INVALID");
      assert.equal(response.status, 422);
    } finally {
      server.close();
    }
  });

  it("returns text error body when error response is not JSON", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    });
    try {
      const { data, error } = await ty.get(url);
      assert.equal(data, undefined);
      assert.ok(error.message);
    } finally {
      server.close();
    }
  });

  it("returns text data when content-type is not JSON", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Hello, world!");
    });
    try {
      const { data, error } = await ty.get(url);
      assert.equal(data, "Hello, world!");
      assert.equal(error, undefined);
    } finally {
      server.close();
    }
  });

  it("replaces path params", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
    try {
      const { data } = await ty.get(`${url}/users/{id}/posts/{postId}`, {
        params: { path: { id: "42", postId: "99" } },
      });
      assert.equal(data.path, "/users/42/posts/99");
    } finally {
      server.close();
    }
  });

  it("appends query params", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: req.url }));
    });
    try {
      const { data } = await ty.get(`${url}/search`, {
        params: { query: { q: "hello", limit: 10 } },
      });
      assert.ok(data.url.includes("q=hello"));
      assert.ok(data.url.includes("limit=10"));
    } finally {
      server.close();
    }
  });

  it("skips null/undefined query params", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: req.url }));
    });
    try {
      const { data } = await ty.get(`${url}/search`, {
        params: { query: { q: "hello", empty: null, missing: undefined } },
      });
      assert.ok(data.url.includes("q=hello"));
      assert.ok(!data.url.includes("empty"));
      assert.ok(!data.url.includes("missing"));
    } finally {
      server.close();
    }
  });

  it("sends custom headers", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ auth: req.headers["x-api-key"] }));
    });
    try {
      const { data } = await ty.get(url, {
        headers: { "x-api-key": "secret123" },
      });
      assert.equal(data.auth, "secret123");
    } finally {
      server.close();
    }
  });

  it("sets content-type for JSON body", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ contentType: req.headers["content-type"] }));
    });
    try {
      const { data } = await ty.post(url, { body: { key: "value" } });
      assert.ok(data.contentType.includes("application/json"));
    } finally {
      server.close();
    }
  });

  it("all HTTP methods work", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ method: req.method }));
    });
    try {
      assert.equal((await ty.get(url)).data.method, "GET");
      assert.equal((await ty.post(url)).data.method, "POST");
      assert.equal((await ty.put(url)).data.method, "PUT");
      assert.equal((await ty.patch(url)).data.method, "PATCH");
      assert.equal((await ty.delete(url)).data.method, "DELETE");
    } finally {
      server.close();
    }
  });
});

describe("ty.create / ty.extend", () => {
  it("create sets default prefixUrl", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
    try {
      const api = ty.create({ prefixUrl: url });
      const { data } = await api.get("/users");
      assert.equal(data.path, "/users");
    } finally {
      server.close();
    }
  });

  it("extend merges with existing defaults", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ auth: req.headers["x-api-key"], admin: req.headers["x-admin"] }));
    });
    try {
      const api = ty.create({ prefixUrl: url, headers: { "x-api-key": "key1" } });
      const admin = api.extend({ headers: { "x-admin": "yes" } });
      const { data } = await admin.get("/test");
      assert.equal(data.admin, "yes");
    } finally {
      server.close();
    }
  });
});

describe("middleware", () => {
  it("onRequest modifies the request", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ auth: req.headers.authorization }));
    });
    try {
      const api = ty.create({ prefixUrl: url });
      api.use({
        onRequest(request: Request) {
          const headers = new Headers(request.headers);
          headers.set("Authorization", "Bearer test-token");
          return new Request(request, { headers });
        },
      });
      const { data } = await api.get("/test");
      assert.equal(data.auth, "Bearer test-token");
    } finally {
      server.close();
    }
  });

  it("onResponse can modify response", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ original: true }));
    });
    try {
      const api = ty.create({ prefixUrl: url });
      api.use({
        onResponse(_response: Response) {
          return new Response(JSON.stringify({ intercepted: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });
      const { data } = await api.get("/test");
      assert.equal(data.intercepted, true);
      assert.equal(data.original, undefined);
    } finally {
      server.close();
    }
  });

  it("multiple middleware run in order", async () => {
    const order: string[] = [];
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    try {
      const api = ty.create({ prefixUrl: url });
      api.use({ onRequest() { order.push("first"); } });
      api.use({ onRequest() { order.push("second"); } });
      await api.get("/test");
      assert.deepEqual(order, ["first", "second"]);
    } finally {
      server.close();
    }
  });
});
