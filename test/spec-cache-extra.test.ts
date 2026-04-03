import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import {
  ensureSpec,
  ensureSpecSync,
  fetchSpecForDomain,
  configuredSpecs,
  registerSpecs,
  specCache,
} from "../src/core/spec-cache";

function startServer(routes: Record<string, { status?: number; contentType?: string; body: string; delay?: number }>) {
  return new Promise<{ server: ReturnType<typeof createServer>; port: number }>((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const handler = routes[req.url!];
      if (handler) {
        const { status = 200, contentType = "application/json", body, delay = 0 } = handler;
        const send = () => {
          res.writeHead(status, { "Content-Type": contentType });
          res.end(body);
        };
        if (delay > 0) setTimeout(send, delay);
        else send();
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

const validSpec = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0" },
  paths: { "/test": { get: { responses: { "200": { description: "OK" } } } } },
});

// ── ensureSpec (async, plugin-style) ───────────────────────────────

describe("ensureSpec", () => {
  it("returns loading entry on first call and resolves to loaded", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { body: validSpec },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/openapi.json`;
      const entry = ensureSpec(domain, () => {});
      assert.equal(entry.status, "loading");
      // Wait for async load
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Test API");
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("returns cached entry on second call", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { body: validSpec },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/openapi.json`;
      const entry1 = ensureSpec(domain, () => {});
      const entry2 = ensureSpec(domain, () => {});
      assert.strictEqual(entry1, entry2, "should return same entry object");
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("calls onLoaded callback when spec loads", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { body: validSpec },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/openapi.json`;
      let callbackDomain = "";
      ensureSpec(domain, () => {}, (d) => { callbackDomain = d; });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(callbackDomain, domain);
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("sets not-found on fetch failure", async () => {
    const domain = "127.0.0.1:99999";
    specCache.delete(domain);
    configuredSpecs[domain] = "http://127.0.0.1:99999/nope.json";
    const entry = ensureSpec(domain, () => {});
    assert.equal(entry.status, "loading");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(entry.status, "not-found");
    delete configuredSpecs[domain];
  });

  it("probes well-known URLs when no spec configured", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { body: validSpec },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      delete configuredSpecs[domain];
      const entry = ensureSpec(domain, () => {});
      assert.equal(entry.status, "loading");
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(entry.status, "loaded");
    } finally {
      server.close();
    }
  });
});

// ── ensureSpecSync ─────────────────────────────────────────────────

describe("ensureSpecSync", () => {
  it("returns existing loaded entry", async () => {
    const domain = "sync-test.example.com";
    specCache.set(domain, { status: "loaded", spec: { openapi: "3.0.0", paths: {}, info: { title: "Sync" } }, fetchedAt: Date.now() });
    const entry = await ensureSpecSync(domain, () => {});
    assert.equal(entry.status, "loaded");
    specCache.delete(domain);
  });

  it("returns not-found for unknown domain", async () => {
    const entry = await ensureSpecSync("nonexistent.example.com", () => {});
    assert.equal(entry.status, "not-found");
  });

  it("returns loading entry if still loading", async () => {
    const domain = "loading-test.example.com";
    specCache.set(domain, { status: "loading", spec: null, fetchedAt: Date.now() });
    const entry = await ensureSpecSync(domain, () => {});
    assert.equal(entry.status, "loading");
    specCache.delete(domain);
  });
});

// ── registerSpecs ──────────────────────────────────────────────────

describe("registerSpecs", () => {
  it("registers URL specs", () => {
    registerSpecs({ "custom.com": "https://custom.com/openapi.json" }, "/tmp");
    assert.equal(configuredSpecs["custom.com"], "https://custom.com/openapi.json");
    delete configuredSpecs["custom.com"];
  });

  it("resolves relative file paths against basePath", () => {
    registerSpecs({ "local.com": "./specs/api.json" }, "/projects/myapp");
    assert.ok(configuredSpecs["local.com"]?.includes("/projects/myapp/specs/api.json"));
    delete configuredSpecs["local.com"];
  });

  it("clears cached entry for re-registered domain", () => {
    const domain = "recache.com";
    specCache.set(domain, { status: "loaded", spec: { openapi: "3.0.0", paths: {} }, fetchedAt: Date.now() });
    registerSpecs({ [domain]: "https://recache.com/openapi.json" }, "/tmp");
    assert.equal(specCache.has(domain), false);
    delete configuredSpecs[domain];
  });
});

// ── HTTP error handling ────────────────────────────────────────────

describe("HTTP error handling", () => {
  it("returns not-found on 404 response", async () => {
    const { server, port } = await startServer({});
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/nonexistent.json`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "not-found");
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("returns not-found on 500 response", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { status: 500, body: "Internal Server Error" },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/openapi.json`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "not-found");
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("returns not-found on invalid JSON", async () => {
    const { server, port } = await startServer({
      "/openapi.json": { body: "not json {{{" },
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/openapi.json`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "not-found");
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("returns not-found on connection refused", async () => {
    const domain = "127.0.0.1:1";
    specCache.delete(domain);
    configuredSpecs[domain] = "http://127.0.0.1:1/openapi.json";
    const entry = await fetchSpecForDomain(domain, () => {});
    assert.equal(entry.status, "not-found");
    delete configuredSpecs[domain];
  });

  it("follows redirects", async () => {
    const { server, port } = await startServer({
      "/old": { status: 301, body: "", contentType: "text/plain" },
      "/openapi.json": { body: validSpec },
    });
    // Patch the redirect handler to include Location header
    server.removeAllListeners("request");
    server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/old") {
        res.writeHead(301, { Location: `http://127.0.0.1:${port}/openapi.json` });
        res.end();
      } else if (req.url === "/openapi.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(validSpec);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    try {
      const domain = `127.0.0.1:${port}`;
      specCache.delete(domain);
      configuredSpecs[domain] = `http://127.0.0.1:${port}/old`;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Test API");
    } finally {
      delete configuredSpecs[`127.0.0.1:${port}`];
      server.close();
    }
  });

  it("returns already-loaded entry without refetching", async () => {
    const domain = "cached.example.com";
    specCache.set(domain, {
      status: "loaded",
      spec: { openapi: "3.0.0", paths: {}, info: { title: "Cached" } },
      fetchedAt: Date.now(),
    });
    const entry = await fetchSpecForDomain(domain, () => { throw new Error("should not log"); });
    assert.equal(entry.status, "loaded");
    assert.equal(entry.spec?.info?.title, "Cached");
    specCache.delete(domain);
  });
});

// ── Local file loading ────────────────────────────────────────────

describe("local file spec loading", () => {
  it("loads a JSON spec from disk", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpFile = path.join(os.tmpdir(), `ty-fetch-test-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, validSpec);
    try {
      const domain = "local-json.test";
      specCache.delete(domain);
      configuredSpecs[domain] = tmpFile;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Test API");
    } finally {
      delete configuredSpecs["local-json.test"];
      fs.unlinkSync(tmpFile);
    }
  });

  it("loads a YAML spec from disk", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpFile = path.join(os.tmpdir(), `ty-fetch-test-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `openapi: "3.0.0"\ninfo:\n  title: Local YAML\npaths:\n  /test:\n    get:\n      responses:\n        "200":\n          description: OK\n`);
    try {
      const domain = "local-yaml.test";
      specCache.delete(domain);
      configuredSpecs[domain] = tmpFile;
      const entry = await fetchSpecForDomain(domain, () => {});
      assert.equal(entry.status, "loaded");
      assert.equal(entry.spec?.info?.title, "Local YAML");
    } finally {
      delete configuredSpecs["local-yaml.test"];
      fs.unlinkSync(tmpFile);
    }
  });
});
