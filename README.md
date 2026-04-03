# ⚡ ty-fetch

**Automatic TypeScript types for any REST API. No codegen. No manual types. Just fetch.**

ty-fetch is a TypeScript language service plugin that reads OpenAPI specs and gives you fully typed API calls — response types, request bodies, query params, headers, path validation, and autocomplete — all without a single line of generated code.

```ts
import tf from "ty-fetch";

// ✅ Fully typed — response, query params, headers all inferred from the spec
const data = await tf.get("https://api.stripe.com/v1/customers", {
  params: { query: { limit: 10 } },
}).json();
data.data // Customer[] — autocomplete just works

// ❌ Typo? Caught instantly with a suggestion
tf.get("https://api.stripe.com/v1/cutsomers");
//                                  ~~~~~~~~~~
// Error: Path '/v1/cutsomers' does not exist in Stripe API.
//        Did you mean '/v1/customers'?
```

---

## 🤔 Why ty-fetch?

Every other OpenAPI tool makes you **run a codegen step**. You generate a client, import from generated files, and re-run the generator when the spec changes. It works, but it's friction.

ty-fetch takes a completely different approach:

| | Traditional codegen | ty-fetch |
|---|---|---|
| **Setup** | Install generator, run codegen, import client | `npm install ty-fetch` and go |
| **When spec changes** | Re-run generator, fix imports | Types update automatically |
| **What you write** | `client.customers.list()` | `tf.get("https://api.stripe.com/v1/customers")` |
| **Build step** | Required | None |
| **Generated files** | Committed to repo or `.gitignore`'d | None — types live in node_modules |

**You write real URLs. The types just appear.**

---

## 🚀 Features

- 🔮 **Zero codegen** — types generated on-the-fly by a TS plugin, not a build step
- 📦 **Typed responses** — `.json()` returns the actual response type from the spec
- ✏️ **Typed request bodies** — body params validated against the schema
- 🔗 **Typed path & query params** — `params.path` and `params.query` based on the endpoint
- 🔑 **Typed headers** — required headers (API keys, auth) from security schemes
- 🚨 **Path validation** — red squiggles for typos, with "did you mean?" suggestions
- 💡 **Autocomplete** — URL path completions inside string literals
- 📖 **JSDoc descriptions** — property descriptions from the spec in hover tooltips
- 🔍 **Auto-discovery** — probes well-known paths (`/openapi.json`, `/.well-known/openapi.yaml`) when no spec is configured
- 📄 **YAML + JSON** — specs can be either format, local files or remote URLs
- 🧠 **Example inference** — generates types from response `example` when `schema` is missing
- ⚡ **On-demand** — only fetches specs and generates types for APIs you actually call

---

## 📦 Setup

```bash
npm install ty-fetch
```

Add the plugin to your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "ty-fetch/plugin" }]
  }
}
```

In VS Code, use the workspace TypeScript version:
**Command Palette** → **TypeScript: Select TypeScript Version** → **Use Workspace Version**

That's it. Start writing `tf.get("https://...")` and types appear automatically. ✨

---

## 🔧 Usage

```ts
import tf from "ty-fetch";

// 📥 GET with typed response
const customers = await tf.get("https://api.stripe.com/v1/customers").json();

// 📤 POST with typed body
const customer = await tf.post("https://api.stripe.com/v1/customers", {
  body: { name: "Jane Doe", email: "jane@example.com" },
}).json();

// 🔗 Path params
const repo = await tf.get("https://api.github.com/repos/{owner}/{repo}", {
  params: { path: { owner: "anthropics", repo: "claude-code" } },
}).json();

// 🔍 Query params
const results = await tf.get("https://hn.algolia.com/api/v1/search_by_date", {
  params: { query: { query: "typescript", hitsPerPage: 10 } },
}).json();

// 🔑 Headers (typed from security schemes)
const data = await tf.get("https://api.example.com/v1/data", {
  headers: { "x-api-key": process.env.API_KEY },
}).json();
```

### Response methods

| Method | Returns |
|---|---|
| `.json()` | `Promise<T>` — typed from spec |
| `.text()` | `Promise<string>` |
| `.blob()` | `Promise<Blob>` |
| `.arrayBuffer()` | `Promise<ArrayBuffer>` |
| `await` directly | `T` — same as `.json()` |

---

## 🔍 Spec discovery

### Auto-discovery (zero config)

When ty-fetch encounters an API domain it hasn't seen before, it automatically probes these well-known paths:

```
/.well-known/openapi.json
/.well-known/openapi.yaml
/openapi.json
/openapi.yaml
/api/openapi.json
/docs/openapi.json
/swagger.json
```

If any return a valid OpenAPI spec → types are generated automatically. No config needed.

### Custom specs

Map domains to local files or remote URLs in your tsconfig:

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ty-fetch/plugin",
        "specs": {
          "api.internal.company.com": "./specs/internal-api.yaml",
          "api.partner.com": "https://partner.com/openapi.json"
        }
      }
    ]
  }
}
```

- 📁 File paths resolved relative to tsconfig directory
- 🌐 URLs fetched over HTTPS
- 📄 JSON and YAML both supported
- Custom specs override auto-discovery for the same domain
- Works in both the editor plugin and the CLI

---

## 🖥️ CLI

Validate API calls in CI — no editor required:

```bash
npx ty-fetch                    # uses ./tsconfig.json
npx ty-fetch tsconfig.json      # explicit path
npx ty-fetch --verbose          # show spec fetching details
```

```
src/api.ts:21:11 - error TF99001: Path '/v1/cutsomers' does not exist in Stripe API.
                   Did you mean '/v1/customers'?

1 error(s) found.
```

---

## ⚙️ How it works

1. 🔌 Plugin intercepts the TS language service
2. 🔎 Finds `tf.get()` / `tf.post()` / `fetch()` calls with string literal URLs
3. 📡 Extracts the domain, fetches the OpenAPI spec on-demand (cached after first fetch)
4. ✅ Validates paths, suggests corrections via Levenshtein distance
5. 🏗️ Generates typed overloads into `node_modules/ty-fetch/index.d.ts` via declaration merging — **only for URLs you actually use**

Types are generated **only for endpoints you call** — not the entire spec. A 500-path API might produce just 5 overloads if that's all you use. This keeps TypeScript fast.

---

## 🧪 Development

```bash
npm run build          # compile TypeScript
npm run watch          # compile in watch mode
npm test               # run unit tests (74 tests)
```

## License

MIT
