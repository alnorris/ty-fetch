# ty-fetch

TypeScript tooling that validates API calls against OpenAPI specs. Get autocomplete, diagnostics, and fully typed responses with zero manual types.

```ts
import tf from "ty-fetch";

const customers = await tf.get("https://api.stripe.com/v1/customers").json();
// customers is fully typed — data, has_more, object, url all autocomplete

tf.get("https://api.stripe.com/v1/cutsomers");
//                                  ~~~~~~~~~~
// Error: Path '/v1/cutsomers' does not exist in Stripe API.
//        Did you mean '/v1/customers'?
```

## What it does

- **Path validation** — red squiggles for typos in API URLs, with "did you mean?" suggestions
- **Typed responses** — response types generated from OpenAPI schemas, no manual `as` casts
- **Typed request bodies** — body params validated against the spec
- **Path & query params** — typed `params.path` and `params.query` based on the endpoint
- **Autocomplete** — URL path completions inside string literals, filtered by HTTP method
- **Hover info** — hover over a URL to see available methods and descriptions

Works as both a **TS language service plugin** (editor DX) and a **CLI** (CI validation).

## Setup

```bash
npm install github:alnorris/ty-fetch
```

Add the plugin to your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "ty-fetch/plugin" }]
  }
}
```

In VS Code, make sure you're using the workspace TypeScript version (not the built-in one). Open the command palette and run **TypeScript: Select TypeScript Version** > **Use Workspace Version**.

## Usage

### The `ty-fetch` client

A lightweight HTTP client (similar to [ky](https://github.com/sindresorhus/ky)) with typed methods:

```ts
import tf from "ty-fetch";

// GET with typed response
const customers = await tf.get("https://api.stripe.com/v1/customers").json();

// POST with typed body
const customer = await tf.post("https://api.stripe.com/v1/customers", {
  body: { name: "Jane Doe", email: "jane@example.com" },
}).json();

// Path params
const repo = await tf.get("https://api.github.com/repos/{owner}/{repo}", {
  params: { path: { owner: "anthropics", repo: "claude-code" } },
}).json();

// Query params
const pets = await tf.get("https://petstore3.swagger.io/api/v3/pet/findByStatus", {
  params: { query: { status: "available" } },
}).json();
```

Response methods:

| Method | Returns |
|---|---|
| `.json()` | `Promise<T>` (typed from spec) |
| `.text()` | `Promise<string>` |
| `.blob()` | `Promise<Blob>` |
| `.arrayBuffer()` | `Promise<ArrayBuffer>` |
| `await` directly | `T` (same as `.json()`) |

### CLI

Run validation in CI or from the terminal:

```bash
npx ty-fetch                    # uses ./tsconfig.json
npx ty-fetch tsconfig.json      # explicit path
npx ty-fetch --verbose          # show spec fetching details
```

```
example.ts:21:11 - error TF99001: Path '/v1/cutsomers' does not exist in Stripe API. Did you mean '/v1/customers'?
example.ts:57:11 - error TF99001: Path '/pets' does not exist in Swagger Petstore. Did you mean '/pet'?

2 error(s) found.
```

## Custom specs

Map domains to local files or URLs in your tsconfig plugin config:

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ty-fetch/plugin",
        "specs": {
          "api.internal.company.com": "./specs/internal-api.json",
          "api.partner.com": "https://partner.com/openapi.json"
        }
      }
    ]
  }
}
```

- **File paths** are resolved relative to the tsconfig directory
- **URLs** are fetched over HTTPS
- Custom specs override built-in defaults for the same domain

This works in both the editor plugin and the CLI.

### Built-in specs

These APIs are supported out of the box (no config needed):

| Domain | API | Paths |
|---|---|---|
| `api.stripe.com` | Stripe API | 414 |
| `petstore3.swagger.io` | Swagger Petstore | 13 |
| `api.github.com` | GitHub REST API | 551 |

## How it works

1. Plugin intercepts the TS language service (`getSemanticDiagnostics`, `getCompletionsAtPosition`, `getQuickInfoAtPosition`)
2. Finds `fetch()` / `tf.get()` / `tf.post()` etc. calls with string literal URLs
3. Extracts the domain and fetches the OpenAPI spec on-demand (cached after first fetch)
4. Validates paths against the spec, suggests corrections via Levenshtein distance
5. Generates typed overloads into `node_modules/ty-fetch/index.d.ts` using interface declaration merging — only for URLs actually used in your code

Spec fetching is async. On first encounter of a domain, the plugin fires a background fetch and returns no extra diagnostics. When the spec arrives, `refreshDiagnostics()` triggers the editor to re-check. This follows the same pattern as [graphqlsp](https://github.com/0no-co/graphqlsp).

## Architecture

```
src/
  plugin/index.ts      TS language service plugin (diagnostics, completions, hover)
  cli/index.ts         CLI entry point for CI validation
  core/                Shared logic (URL parsing, spec cache, path matching, body validation)
  generate-types.ts    OpenAPI schema -> TypeScript type declarations
test-project/          Example project using the plugin
test/                  Unit tests
```

## Development

```bash
npm run build          # compile TypeScript
npm run watch          # compile in watch mode
npm test               # run unit tests
```

To test the editor experience:

1. Open `test-project/` in VS Code
2. Select the workspace TypeScript version
3. Restart the TS server (`TypeScript: Restart TS Server`)
4. Edit `test-project/example.ts` and observe diagnostics/completions
