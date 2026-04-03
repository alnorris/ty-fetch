# typed-fetch: Automatic REST API Validation for TypeScript

Validate `fetch()` calls against OpenAPI specs — autocomplete, diagnostics, and hover info with zero manual setup. Works with plain `fetch()`, no wrapper functions or codegen.

## Problem

When developers write `fetch('https://api.stripe.com/v1/customers')`, TypeScript has no idea whether that endpoint exists, what parameters it accepts, or what it returns. The response is `Promise<Response>` — completely untyped. Mistakes in URL paths, missing query parameters, and wrong request bodies are only caught at runtime.

## Solution

Two packages from a single project, sharing a core validation engine:

| Package | What it does |
|---|---|
| `eslint-plugin-typed-fetch` | Diagnostics — red squiggles in editor + errors in CI via `eslint` |
| `typed-fetch-language-server` | DX — autocomplete for URL paths + hover info showing response shapes |

### User Setup

```bash
npm install -D eslint-plugin-typed-fetch typed-fetch-language-server
```

```js
// eslint.config.js
import typedFetch from 'eslint-plugin-typed-fetch'

export default [
  typedFetch.configs.recommended,
  // ... your other config
]
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "plugins": [{ "name": "typed-fetch-language-server" }]
  }
}
```

That's it. No wrapper functions, no codegen, no patched compiler. Plain `fetch()` everywhere.

### What Each Package Provides

| Feature | ESLint plugin | TS LS plugin |
|---|---|---|
| Red squiggles in editor | Yes | — |
| Errors in CI (`npm run check`) | Yes | — |
| Autocomplete for URL paths | — | Yes |
| Hover info (response shape, methods) | — | Yes |
| Spec auto-discovery | Shared core | Shared core |

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  @typed-fetch/core                │
│                                                  │
│  URL parsing · domain extraction · spec lookup   │
│  path validation · fuzzy matching · caching      │
└─────────────┬────────────────────┬───────────────┘
              │                    │
    ┌─────────▼─────────┐  ┌──────▼──────────────┐
    │  eslint-plugin-    │  │  typed-fetch-        │
    │  typed-fetch       │  │  language-server     │
    │                    │  │                      │
    │  • ESLint rule     │  │  • TS LS plugin      │
    │  • Uses TS type    │  │  • getCompletions    │
    │    checker via     │  │  • getQuickInfo      │
    │    typescript-     │  │  • getSemanticDiags  │
    │    eslint parser   │  │    (optional, for    │
    │  • Runs in editor  │  │    editors that use  │
    │    AND CLI         │  │    tsserver directly) │
    └────────────────────┘  └──────────────────────┘
              │                    │
              ▼                    ▼
    ┌────────────────────────────────────────────┐
    │           Spec Resolution Layer            │
    │                                            │
    │  On-demand only — specs are fetched when   │
    │  a domain is first seen in code, not from  │
    │  a bulk registry download.                 │
    │                                            │
    │  1. Check disk cache (~/.typed-fetch/)      │
    │  2. Query APIs.guru for that domain        │
    │  3. Probe well-known URLs as fallback      │
    │  4. Cache to disk for future runs          │
    └────────────────────────────────────────────┘
```

### Why Two Packages?

TypeScript language service plugins only run inside the editor (tsserver). They are ignored by `tsc` and have no CLI presence. This is by design — the TypeScript team has explicitly declined to support compiler plugins ([microsoft/TypeScript#16607](https://github.com/microsoft/TypeScript/issues/16607), open since 2017, 1,200+ upvotes, no resolution).

ESLint rules run everywhere — in the editor (via ESLint extensions) and in CI (via `eslint` CLI). But ESLint cannot provide autocomplete or hover info.

So the split is necessary:
- **ESLint plugin** = validation (the important part — catches bugs)
- **TS LS plugin** = completions and hover (the nice-to-have — speeds up development)

Both share `@typed-fetch/core` so the spec resolution, caching, and validation logic is written once.

## How It Works

### 1. URL Detection

Both plugins walk the AST looking for call expressions matching:

```ts
fetch('...')
fetch(`...`)
```

The URL string literal (or template literal head) is extracted. Dynamic URLs like `fetch(someVariable)` are skipped — only string literals are analyzed.

### 2. On-Demand Spec Resolution

From `fetch('https://api.stripe.com/v1/customers')`, the core extracts domain `api.stripe.com` and resolves the spec **only for that domain**. No bulk downloads. No fetching specs you don't use.

The resolution chain:

1. **Disk cache** — check `~/.typed-fetch/specs/api.stripe.com.json`
2. **APIs.guru** — query `https://api.apis.guru/v2/{service}.json` for that domain
3. **Well-known URLs** — probe the domain directly:
   - `https://{domain}/openapi.json`
   - `https://{domain}/.well-known/openapi.json`
   - `https://{domain}/swagger.json`
   - `https://{domain}/api-docs`
4. **Cache result** — write to disk, populate in-memory ref
5. **Not found** — mark as not-found, TTL 24h before retrying

#### Async Handling

The TS language service plugin API is synchronous. The plugin handles this with the same pattern as [graphqlsp](https://github.com/0no-co/graphqlsp):

- On first encounter of a new domain, fire an async fetch in the background
- Store the result in a mutable `SpecRef` object
- Return no extra diagnostics/completions until the spec loads
- On the next editor event (keystroke, save), the spec is available

The ESLint plugin can be synchronous — it reads from the disk cache, and a `typed-fetch sync` CLI command pre-populates the cache during install or CI setup.

### 3. Path Validation (ESLint Plugin)

Given `fetch('https://api.stripe.com/v1/cutsomers')`:

1. Extract path: `/v1/cutsomers`
2. Look up in spec: `paths['/v1/cutsomers']` → not found
3. Report ESLint error:

```
error  Path '/v1/cutsomers' does not exist in the Stripe API.
       Did you mean '/v1/customers'?  typed-fetch/valid-endpoint
```

Additional validations:

- **HTTP method** — if `{ method: 'DELETE' }` is passed, check that the path supports DELETE
- **Required parameters** — if the spec defines required query/path params, warn if missing

This error shows as a red squiggle in any editor with ESLint integration, AND fails `eslint` in CI.

### 4. Autocomplete (TS LS Plugin)

`getCompletionsAtPosition` provides path completions when the cursor is inside a `fetch()` URL string:

```ts
fetch('https://api.stripe.com/v1/c|')
//                                 ^ cursor here
```

Returns completions:

```
/v1/customers        — List or create customers
/v1/charges          — List or create charges
/v1/coupons          — List or create coupons
/v1/checkout/sessions — Create checkout sessions
```

Each completion entry includes the path, available HTTP methods, and a brief description from the spec.

### 5. Hover Info (TS LS Plugin)

`getQuickInfoAtPosition` on a `fetch()` call displays the endpoint details:

```
fetch('https://api.stripe.com/v1/customers')

// Hover shows:
// GET /v1/customers
// List all customers. Returns a paginated list.
//
// Response 200:
//   object: "list"
//   data: Customer[]
//   has_more: boolean
//   url: string
```

## Spec Resolution

### On-Demand, Not Bulk

The plugin does **not** download the full APIs.guru directory (2,500+ specs). It only resolves specs for domains that actually appear in `fetch()` calls in your code. If your project only calls Stripe and GitHub, only those two specs are fetched and cached.

### Primary Source: APIs.guru

[APIs.guru](https://apis.guru/openapi-directory/) maintains 2,500+ OpenAPI specs with a lookup API. The plugin queries it per-domain as needed.

### Local/Private APIs

For internal APIs not in any public registry, configure spec paths directly:

```jsonc
// eslint.config.js
typedFetch.configs.recommended({
  specs: {
    'api.internal.company.com': './specs/internal-api.yaml',
    'localhost:3000': './specs/dev-api.json',
  }
})
```

The same `specs` mapping is available in the TS plugin config in `tsconfig.json`.

### Caching

```
~/.typed-fetch/
  specs/
    api.stripe.com.json       # parsed OpenAPI doc (fetched on first use)
    api.github.com.json       # only specs you actually use
  config.json                 # user preferences
```

- Specs are cached to disk on first fetch, refreshed when the plugin detects a version change
- In-memory cache is populated from disk on first access per session
- "Not found" entries have a 24h TTL before retrying
- `typed-fetch sync` CLI command pre-populates cache (useful for CI)

## Configuration

```jsonc
// eslint.config.js — validation config
import typedFetch from 'eslint-plugin-typed-fetch'

export default [
  typedFetch.configs.recommended({
    // Custom spec mappings for private APIs
    specs: {
      'api.internal.com': './specs/internal.yaml',
    },

    // Domains to ignore (skip spec resolution)
    ignore: ['localhost', '127.0.0.1'],

    // Disable network fetching (offline mode, local specs only)
    offline: false,
  }),
]
```

```jsonc
// tsconfig.json — completions config
{
  "compilerOptions": {
    "plugins": [{
      "name": "typed-fetch-language-server",
      "specs": {
        "api.internal.com": "./specs/internal.yaml"
      },
      "ignore": ["localhost", "127.0.0.1"]
    }]
  }
}
```

## Limitations

### What works

- `fetch('https://api.stripe.com/v1/customers')` — static string literal
- `` fetch(`https://api.stripe.com/v1/customers/${id}`) `` — template literal with dynamic segments matched against path parameters
- `fetch(url, { method: 'POST', body: JSON.stringify(data) })` — method and body validation when URL is a literal

### What doesn't work

- `fetch(baseUrl + '/customers')` — concatenated strings, URL not extractable
- `fetch(getApiUrl())` — dynamic URLs from function calls
- Redirects, middleware, or proxy URLs that obscure the real API domain
- APIs without published OpenAPI specs

### Graceful Degradation

When the plugin can't resolve a spec or parse a URL:

- No extra diagnostics are emitted
- No completions are added
- The default `fetch()` typing (`Promise<Response>`) remains unchanged
- Existing TypeScript and ESLint behavior is never broken

## Comparison to Existing Tools

| Feature | typed-fetch | openapi-fetch | gql.tada | discofetch |
|---|---|---|---|---|
| Zero-config for public APIs | Yes | No | No | No |
| Auto-discovers specs | Yes (on-demand) | No | No | Probes live API |
| Works with raw `fetch()` | Yes | No (custom client) | N/A | No (custom client) |
| No wrapper function needed | Yes | No | No | No |
| Editor autocomplete | Yes (TS LS plugin) | Via types | Via graphqlsp | No |
| CLI / CI errors | Yes (ESLint) | Via tsc | Via tsc | Via tsc |
| Multiple API vendors | Yes | One at a time | One schema | One at a time |
| Private API support | Via config | Yes | Yes | Yes |

## Implementation Plan

### Phase 1: Core + ESLint Plugin

- `@typed-fetch/core` — URL parsing, domain extraction, spec resolution, disk caching, path validation, fuzzy "did you mean?" suggestions
- `eslint-plugin-typed-fetch` — `typed-fetch/valid-endpoint` rule using `@typescript-eslint/parser` for AST access
- `typed-fetch sync` CLI — pre-populate spec cache for CI environments
- Test against Stripe, GitHub, and Twilio APIs

### Phase 2: TS Language Server Plugin

- `typed-fetch-language-server` — tsserver plugin wrapping `getCompletionsAtPosition` and `getQuickInfoAtPosition`
- Async spec loading with mutable ref pattern (following graphqlsp architecture)
- Path autocomplete inside URL string literals
- Hover info showing endpoint description and response schema

### Phase 3: Ecosystem

- Community-contributed spec mappings for APIs not in APIs.guru
- Editor-specific extensions for status indicators (VS Code, Zed)
- Monorepo support (per-package spec configs)
- `typed-fetch update` CLI to refresh cached specs

