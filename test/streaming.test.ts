import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";

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

describe("ty.stream", () => {
  it("streams SSE (Server-Sent Events)", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write("data: {\"id\":1,\"text\":\"hello\"}\n\n");
      res.write("data: {\"id\":2,\"text\":\"world\"}\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    });
    try {
      const chunks: unknown[] = [];
      for await (const chunk of ty.stream(url)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 2);
      assert.deepEqual(chunks[0], { id: 1, text: "hello" });
      assert.deepEqual(chunks[1], { id: 2, text: "world" });
    } finally {
      server.close();
    }
  });

  it("streams NDJSON", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write('{"line":1}\n');
      res.write('{"line":2}\n');
      res.write('{"line":3}\n');
      res.end();
    });
    try {
      const chunks: unknown[] = [];
      for await (const chunk of ty.stream(url)) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 3);
      assert.deepEqual(chunks[0], { line: 1 });
      assert.deepEqual(chunks[2], { line: 3 });
    } finally {
      server.close();
    }
  });

  it("streams raw text when content-type is not SSE or NDJSON", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("chunk1");
      res.write("chunk2");
      res.end();
    });
    try {
      const chunks: unknown[] = [];
      for await (const chunk of ty.stream(url)) {
        chunks.push(chunk);
      }
      assert.ok(chunks.length > 0);
      assert.equal(chunks.join(""), "chunk1chunk2");
    } finally {
      server.close();
    }
  });

  it("throws HTTPError on non-2xx response", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end("fail");
    });
    try {
      await assert.rejects(async () => {
        for await (const _chunk of ty.stream(url)) {
          // should not reach here
        }
      }, (err: Error) => err.name === "HTTPError");
    } finally {
      server.close();
    }
  });

  it("sends query params and headers", async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ url: req.url, auth: req.headers.authorization }) + "\n");
      res.end();
    });
    try {
      const chunks: any[] = [];
      for await (const chunk of ty.stream(`${url}/events`, {
        params: { query: { channel: "test" } },
        headers: { Authorization: "Bearer tok" },
      })) {
        chunks.push(chunk);
      }
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].url.includes("channel=test"));
      assert.equal(chunks[0].auth, "Bearer tok");
    } finally {
      server.close();
    }
  });

  it("handles SSE with multi-line data", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: {\"multi\":\n");
      res.write("data: true}\n\n");
      res.end();
    });
    try {
      const chunks: unknown[] = [];
      for await (const chunk of ty.stream(url)) {
        chunks.push(chunk);
      }
      // Multi-line data gets joined
      assert.equal(chunks.length, 1);
    } finally {
      server.close();
    }
  });
});
