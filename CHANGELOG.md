# Changelog

## 0.0.2-beta (2025-04-03)

### Features
- **Auto-discovery** — probes well-known paths (`/openapi.json`, `/.well-known/openapi.yaml`, etc.) when no spec is configured
- **YAML support** — specs can be JSON or YAML, local files or remote URLs
- **Example inference** — generates types from response `example` when `schema` is missing
- **JSDoc descriptions** — property descriptions from the spec show up in hover tooltips
- **Typed headers** — required headers (API keys, auth) from OpenAPI security schemes
- **Depth limit raised** — nested types now resolve 4 levels deep (was 2)

### Fixes
- Fix TS server plugin loading (add `plugin.js` shim for non-exports-aware resolution)
- Reject non-2xx HTTP status codes when fetching specs
- Handle network errors (DNS failures, connection refused) gracefully
- Prevent generated types from being published to npm (`prepublishOnly` script)

### Chores
- Add MIT LICENSE
- Add CI workflow (GitHub Actions, Node 18/20/22)
- Convert tests from `.mjs` to `.ts`
- Remove hardcoded KNOWN_SPECS — all specs via config or auto-discovery
- Add `.gitignore` and `.npmignore`

## 0.0.1 (2025-03-15)

Initial release. TypeScript language service plugin and CLI for validating fetch calls against OpenAPI specs.
