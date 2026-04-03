# ⚡ ty-fetch

**Type-safe `fetch` for TypeScript. Reads your OpenAPI specs, types your API calls. No codegen.**

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

### Compared to codegen tools

| | Traditional codegen | ty-fetch |
|---|---|---|
| **Setup** | Install generator, run codegen, import client | `npm install` + one tsconfig line |
| **Spec changes** | Re-run generator, fix imports | Types update automatically |
| **What you write** | `client.users.list()` | `tf.get("https://api.mycompany.com/v1/users")` |
| **Generated files** | Committed to repo or `.gitignore`'d | None |
| **Build step** | Required | None |

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

## 🔧 Usage

```ts
import tf from "ty-fetch";

// 📥 GET — response is fully typed
const users = await tf.get("https://api.mycompany.com/v1/users").json();

// 📤 POST — body is validated against the spec
const user = await tf.post("https://api.mycompany.com/v1/users", {
  body: { name: "Jane Doe", email: "jane@example.com" },
}).json();

// 🔗 Path params — typed from the spec's {param} placeholders
const user = await tf.get("https://api.mycompany.com/v1/users/{id}", {
  params: { path: { id: "123" } },
}).json();

// 🔍 Query params — typed from the spec's parameter definitions
const results = await tf.get("https://api.mycompany.com/v1/users", {
  params: { query: { role: "admin", limit: 10 } },
}).json();

// 🔑 Headers — required API keys typed from security schemes
const data = await tf.get("https://api.mycompany.com/v1/data", {
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

## 🚀 Features

- 🔮 **Zero codegen** — types generated on-the-fly by a TS plugin, not a build step
- 🔍 **Auto-discovery** — finds OpenAPI specs at well-known paths automatically
- 📦 **Typed responses** — `.json()` returns the actual response type
- ✏️ **Typed request bodies** — body params validated against the schema
- 🔗 **Typed path & query params** — based on the endpoint definition
- 🔑 **Typed headers** — required API keys from security schemes
- 🚨 **Path validation** — red squiggles for typos, with "did you mean?" suggestions
- 💡 **Autocomplete** — URL path completions inside string literals
- 📖 **JSDoc descriptions** — property descriptions from the spec in hover tooltips
- 📄 **YAML + JSON** — specs can be either format, local files or remote URLs
- 🧠 **Example inference** — generates types from response `example` when `schema` is missing
- ⚡ **On-demand** — only fetches specs for APIs you actually call in your code

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

## License

MIT
