# ⚡ ty-fetch

[![npm version](https://img.shields.io/npm/v/ty-fetch.svg)](https://www.npmjs.com/package/ty-fetch)
[![license](https://img.shields.io/npm/l/ty-fetch.svg)](https://github.com/alnorris/ty-fetch/blob/main/LICENSE)
[![CI](https://github.com/alnorris/ty-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/alnorris/ty-fetch/actions/workflows/ci.yml)

**Type-safe fetch from OpenAPI specs. No codegen, no build step.**

A tiny, zero-dependency HTTP client — a thin wrapper around the Fetch API — with a TypeScript plugin that automatically types your API calls from OpenAPI specs.

```bash
npm install ty-fetch
```

```jsonc
// tsconfig.json — that's the entire setup
{
  "compilerOptions": {
    "plugins": [{ "name": "ty-fetch/plugin" }]
  }
}
```

```ts
import tf from "ty-fetch";

const data = await tf.get("https://api.mycompany.com/v1/users").json();
//    ^ fully typed from your OpenAPI spec — autocomplete, hover docs, everything
```

If your API serves an OpenAPI spec at `/openapi.json` (or any well-known path), ty-fetch finds it automatically. No config, no codegen, no generated files. Just types.

---

## 🤔 How does it work?

ty-fetch is a **TypeScript language service plugin**. When you write a `tf.get("https://...")` call:

1. 🔍 It extracts the domain from the URL
2. 📡 Fetches the OpenAPI spec (checks `/openapi.json`, `/.well-known/openapi.yaml`, etc.)
3. 🏗️ Generates typed overloads on-the-fly — response types, query params, headers, everything
4. ✅ Validates your API paths and suggests corrections for typos

Types appear in your editor instantly. When the spec changes, types update automatically. No build step ever.

### Compared to other tools

| | ty-fetch | [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) | [openapi-fetch](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch) | [orval](https://github.com/orval-labs/orval) |
|---|---|---|---|---|
| **Codegen step** | None | `npx openapi-typescript ...` | Needs openapi-typescript first | `npx orval` |
| **Build step** | None | Required | Required | Required |
| **Generated files** | None | `.d.ts` files | `.d.ts` files | Full client |
| **Spec changes** | Auto-updates | Re-run codegen | Re-run codegen | Re-run codegen |
| **Editor integration** | TS plugin (autocomplete, hover, diagnostics) | Types only | Types only | Types only |
| **Path validation** | Typo detection with suggestions | None | None | None |
| **Auto-discovery** | Probes well-known paths | Manual | Manual | Manual |
| **Runtime** | Lightweight fetch wrapper | None (types only) | Fetch wrapper | Axios/fetch client |

---

## 📦 Quick start

### 1. Install

```bash
npm install ty-fetch
```

### 2. Add the plugin to tsconfig.json

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "ty-fetch/plugin" }]
  }
}
```

### 3. Use workspace TypeScript in VS Code

**Command Palette** → **TypeScript: Select TypeScript Version** → **Use Workspace Version**

### 4. Start fetching

```ts
import tf from "ty-fetch";

// If your API has a spec at /openapi.json — types just work
const users = await tf.get("https://api.mycompany.com/v1/users").json();
```

That's it. ✨

---

## 🔍 Spec discovery

### Auto-discovery (zero config)

When you call `tf.get("https://api.example.com/...")`, ty-fetch automatically probes the domain for an OpenAPI spec at these well-known paths:

```
/.well-known/openapi.json    /.well-known/openapi.yaml
/openapi.json                /openapi.yaml
/api/openapi.json            /docs/openapi.json
/swagger.json                /api-docs/openapi.json
```

If any path returns a valid OpenAPI spec, types are generated automatically.

**This means if your internal API serves a spec, ty-fetch will find it with zero configuration.**

### Point to specific specs

For APIs that don't serve specs at standard paths, or for local spec files:

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ty-fetch/plugin",
        "specs": {
          // Remote spec URL
          "api.mycompany.com": "https://api.mycompany.com/docs/v2/openapi.json",

          // Local file (resolved relative to tsconfig)
          "payments.internal.com": "./specs/payments.yaml",

          // Third-party API
          "api.partner.com": "https://partner.com/openapi.json"
        }
      }
    ]
  }
}
```

JSON and YAML specs both supported. Custom specs override auto-discovery for the same domain.

---

## 📖 API Reference

### `import tf from "ty-fetch"`

The default export is a pre-configured `TyFetch` instance. All methods return a `ResponsePromise`.

### HTTP Methods

```ts
tf.get(url, options?)      // GET
tf.post(url, options?)     // POST
tf.put(url, options?)      // PUT
tf.patch(url, options?)    // PATCH
tf.delete(url, options?)   // DELETE
tf.head(url, options?)     // HEAD
tf(url, options?)          // Custom method (set options.method)
```

When the plugin is active, the `url` parameter and all options are **typed from the OpenAPI spec** for the matching endpoint. Without the plugin, everything still works — just untyped.

### Options

```ts
tf.get("https://api.example.com/v1/users/{id}", {
  // Path params — replaces {placeholders} in the URL
  params: {
    path: { id: "123" },
    query: { include: "profile", limit: 10 },
  },

  // JSON request body (auto-serialized, Content-Type set automatically)
  body: { name: "Jane", email: "jane@example.com" },

  // Headers (typed from security schemes when plugin is active)
  headers: { "x-api-key": "sk_live_..." },

  // Prefix URL — prepended to the url argument
  prefixUrl: "https://api.example.com",

  // All standard fetch options are supported
  signal: AbortSignal.timeout(5000),
  cache: "no-store",
  credentials: "include",
})
```

The `Options` type extends `RequestInit` (standard fetch options) with these additions:

| Option | Type | Description |
|---|---|---|
| `body` | `object` | JSON body — auto-serialized, `Content-Type: application/json` set |
| `params.path` | `object` | Replaces `{placeholder}` segments in the URL |
| `params.query` | `object` | Appended as `?key=value` query string |
| `headers` | `object` | HTTP headers (typed from spec security schemes) |
| `prefixUrl` | `string` | Prepended to the URL (useful with `create`/`extend`) |

### ResponsePromise

Every method returns a `ResponsePromise<T>`, where `T` is the response type from the spec.

```ts
const promise = tf.get("https://api.example.com/v1/users");

// Parse as typed JSON
const users = await promise.json();        // Promise<T>

// Or use other formats
const text = await promise.text();         // Promise<string>
const blob = await promise.blob();         // Promise<Blob>
const buf = await promise.arrayBuffer();   // Promise<ArrayBuffer>
const form = await promise.formData();     // Promise<FormData>

// Or await directly (same as .json())
const users = await promise;               // T
```

Non-2xx responses throw an `HTTPError` automatically before any parsing.

### Error Handling

```ts
import tf, { HTTPError } from "ty-fetch";

try {
  const data = await tf.get("https://api.example.com/v1/users").json();
} catch (error) {
  if (error instanceof HTTPError) {
    console.log(error.response.status);  // 404, 500, etc.
    console.log(error.message);          // "404 Not Found"
    const body = await error.response.json(); // error response body
  }
}
```

### Creating Instances

Create pre-configured instances with default options:

```ts
// Create a new instance with defaults
const api = tf.create({
  prefixUrl: "https://api.mycompany.com",
  headers: { "x-api-key": process.env.API_KEY },
});

// Now use short paths
const users = await api.get("/v1/users").json();
const user = await api.post("/v1/users", {
  body: { name: "Jane" },
}).json();

// Extend an existing instance (merges options)
const adminApi = api.extend({
  headers: { "x-admin-token": process.env.ADMIN_TOKEN },
});
```

| Method | Description |
|---|---|
| `tf.create(defaults)` | Create a new instance with default options |
| `tf.extend(defaults)` | Create a new instance, merging with current defaults |

### Plugin Features (editor only)

When the TS plugin is active, you get these extras on top of the runtime API:

| Feature | What it does |
|---|---|
| **Typed responses** | `.json()` returns the spec's response type, not `any` |
| **Typed body** | `body` option is validated against the spec's request body schema |
| **Typed query params** | `params.query` keys and types from the spec's parameter definitions |
| **Typed path params** | `params.path` keys from `{placeholder}` segments |
| **Typed headers** | Required headers from the spec's security schemes |
| **Path validation** | Red squiggles on invalid API paths with "did you mean?" |
| **Autocomplete** | URL completions inside string literals, filtered by HTTP method |
| **Hover docs** | Hover over a URL to see available methods and descriptions |
| **JSDoc** | Property descriptions from the spec appear in hover tooltips |
| **Example inference** | Types inferred from response `example` when `schema` is missing |

---

## 🖥️ CLI

Validate API calls in CI — catches typos and bad paths without running the app:

```bash
npx ty-fetch                    # uses ./tsconfig.json
npx ty-fetch tsconfig.json      # explicit path
npx ty-fetch --verbose          # show spec fetching details
```

```
src/api.ts:21:11 - error TF99001: Path '/v1/uusers' does not exist.
                   Did you mean '/v1/users'?

1 error(s) found.
```

---

## 🧪 Development

```bash
npm run build          # compile TypeScript
npm run watch          # compile in watch mode
npm test               # run unit tests (74 tests)
```

## Roadmap

- [ ] Record demo GIF showing autocomplete + typo detection in VS Code
- [ ] Spec caching to disk (avoid re-fetching on TS server restart)
- [ ] `ty-fetch generate` CLI command to generate `.d.ts` for `tsc` compatibility
- [ ] Support OpenAPI 2.0 (Swagger) specs
- [ ] Request/response interceptors and middleware

## License

MIT
