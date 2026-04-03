# ty-fetch-plugin

## What this is

A TypeScript Language Service plugin POC that validates `fetch()`/`api.get()` calls against OpenAPI specs — autocomplete, diagnostics (red squiggles), and **typed responses** with zero manual types. Specs are fetched async on-demand when a domain is first seen in code.

## Architecture

```
src/index.ts          — TS LS plugin (diagnostics, completions, hover, type generation)
src/generate-types.ts — Converts OpenAPI response schemas to TS type declarations
test-project/         — Test project with example.ts using the plugin
```

### How it works

1. Plugin intercepts `getSemanticDiagnostics`, `getCompletionsAtPosition`, `getQuickInfoAtPosition`
2. Finds `fetch()` / `api.get()` / `api.post()` etc calls with string literal URLs
3. Extracts domain, kicks off async HTTPS fetch of OpenAPI spec (first encounter only)
4. Spec arrives → stored in `specCache` Map → `refreshDiagnostics()` triggers editor re-evaluation
5. Path validation + fuzzy "did you mean?" suggestions via Levenshtein distance
6. **Type generation**: scans ALL project files for used URLs, generates typed overloads into `node_modules/ty-fetch/index.d.ts` via interface merging

### The `ty-fetch` client

A ky-like API client (`api.get()`, `api.post()`, etc.) that returns parsed JSON directly. Types come from generated `TyFetchClient` interface overloads — the user never specifies types manually.

```ts
import { api } from "ty-fetch";
const data = await api.get("https://api.stripe.com/v1/customers");
// data is fully typed as Stripe_V1_Customers_Get
```

## Critical lessons learned (DO NOT repeat these mistakes)

### Response typing via fetch() override — DOES NOT WORK
- `interface TypedResponse<T> extends Response { json(): Promise<T> }` — TS always resolves `Response.json()` to `Promise<any>` from the base `Body` class. The override is ignored.
- `Omit<Response, 'json'> & { json(): Promise<T> }` — works in isolation but TS gives up on complex return types in overload resolution.
- Overriding the global `fetch()` with `declare function fetch(...)` hits a hard TS limit of ~500 overloads across ALL loaded `.d.ts` files combined.
- **Solution**: custom client (`api.get()`) with interface merging. We control the return type completely.

### Module/type loading
- `@types/ty-fetch` is IGNORED by TS when `node_modules/ty-fetch` has its own `index.d.ts`. Don't use `@types` for augmentation of packages that already ship types.
- `/// <reference path>` from inside `node_modules` is unreliable — TS caches resolutions and doesn't re-read on change.
- `declare module 'ty-fetch'` augmentation CANNOT appear in the same file that IS the module. Use `export interface` merging directly in `index.d.ts` instead.
- **What works**: plugin writes generated overloads + base exports into a single `node_modules/ty-fetch/index.d.ts`. Interface declaration merging handles the rest.

### Type generation
- `interface Foo { ... } | { ... }` is invalid — use `type Foo = ... | ...` for unions.
- `private` is a reserved word — must be quoted as `"private"` in type literals. Full reserved word list in `safePropName()`.
- Type names from URL paths must sanitize hyphens: `/app-manifests/` → `App_manifests`, not `App-manifests`.
- Depth limit for schema→type conversion is 2 (not 3+). GitHub's repo schema nests the same 500-line object 3 times (`parent`, `source`, `template_repository`). Large inline types cause TS to give up on overload resolution.
- **Only generate types for URLs actually used in the codebase** — the plugin scans all project files via `findFetchCalls`, passes used URLs to the generator which filters spec paths. This keeps overload count minimal (~5-10 instead of 500+).

### Async pattern (graphqlsp-style)
- TS LS plugin API is synchronous. On first encounter of a domain, fire async fetch, store result in mutable `SpecEntry` object, return no extra diagnostics.
- Call `info.project.refreshDiagnostics()` when spec arrives — this makes tsserver re-query diagnostics.
- Regenerate types whenever the set of used URLs changes (tracked via `lastGeneratedUrls` string comparison in `getSemanticDiagnostics`).

## Known spec URLs (hardcoded for POC)

```
api.stripe.com     → GitHub raw (7.6MB, 414 paths)
petstore3.swagger.io → swagger.io (tiny, 13 paths)
api.github.com     → APIs.guru (551 paths)
```

Production would use APIs.guru lookup + well-known URL probing per the spec in `docs/spec.md`.

## Build & test

```bash
npm run build              # or: npx tsc -p tsconfig.build.json
cd test-project && node verify.mjs   # programmatic verification
# In VS Code: open test-project/, use workspace TS version, restart TS server
```

## Completions behavior

- Shows full URLs (not just paths) — selecting replaces the entire string
- Filters by typed prefix
- Filters by HTTP method: `api.post()` only shows POST endpoints
- Methods shown in label details (e.g. "GET, POST")
