import type { OpenAPISpec, SpecEntry } from "./types";

export const KNOWN_SPECS: Record<string, string> = {
  "api.stripe.com":
    "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  "petstore3.swagger.io":
    "https://petstore3.swagger.io/api/v3/openapi.json",
  "api.github.com":
    "https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json",
};

export const specCache = new Map<string, SpecEntry>();

/**
 * Register user-provided spec mappings (from tsconfig plugin config).
 * Values can be URLs (https://...) or file paths (resolved relative to basePath).
 * These override built-in KNOWN_SPECS for the same domain.
 */
export function registerSpecs(
  specs: Record<string, string>,
  basePath: string,
): void {
  const pathMod = require("path") as typeof import("path");
  for (const [domain, value] of Object.entries(specs)) {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      KNOWN_SPECS[domain] = value;
    } else {
      // Resolve relative file paths against basePath
      KNOWN_SPECS[domain] = pathMod.resolve(basePath, value);
    }
    // Clear any cached entry so the new source is used
    specCache.delete(domain);
  }
}

/**
 * Ensure a spec is loaded for the given domain.
 * Fires an async fetch if this is the first time seeing the domain.
 * @param onLoaded — called when the spec finishes loading (for triggering side effects)
 */
export function ensureSpec(
  domain: string,
  log: (msg: string) => void,
  onLoaded?: (domain: string, spec: OpenAPISpec) => void,
): SpecEntry {
  const existing = specCache.get(domain);
  if (existing) return existing;

  const specUrl = KNOWN_SPECS[domain];
  if (!specUrl) {
    const entry: SpecEntry = { status: "not-found", spec: null, fetchedAt: Date.now() };
    specCache.set(domain, entry);
    return entry;
  }

  const entry: SpecEntry = { status: "loading", spec: null, fetchedAt: Date.now() };
  specCache.set(domain, entry);

  log(`Fetching spec for ${domain} from ${specUrl}`);

  fetchSpec(specUrl)
    .then((spec) => {
      entry.status = "loaded";
      entry.spec = spec;
      const pathCount = Object.keys(spec.paths || {}).length;
      log(`Spec loaded for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
      onLoaded?.(domain, spec);
    })
    .catch((err) => {
      entry.status = "not-found";
      log(`Failed to fetch spec for ${domain}: ${err}`);
    });

  return entry;
}

/**
 * Synchronous version — fetches and blocks. Used by CLI.
 */
export async function ensureSpecSync(
  domain: string,
  log: (msg: string) => void,
): Promise<SpecEntry> {
  const existing = specCache.get(domain);
  if (existing?.status !== "loading") return existing ?? { status: "not-found", spec: null, fetchedAt: 0 };

  // Already loading — wait for it (shouldn't happen in CLI flow)
  return existing;
}

export async function fetchSpecForDomain(
  domain: string,
  log: (msg: string) => void,
): Promise<SpecEntry> {
  const existing = specCache.get(domain);
  if (existing && existing.status === "loaded") return existing;

  const specUrl = KNOWN_SPECS[domain];
  if (!specUrl) {
    const entry: SpecEntry = { status: "not-found", spec: null, fetchedAt: Date.now() };
    specCache.set(domain, entry);
    return entry;
  }

  log(`Fetching spec for ${domain} from ${specUrl}`);
  try {
    const spec = await fetchSpec(specUrl);
    const entry: SpecEntry = { status: "loaded", spec, fetchedAt: Date.now() };
    specCache.set(domain, entry);
    const pathCount = Object.keys(spec.paths || {}).length;
    log(`Spec loaded for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
    return entry;
  } catch (err) {
    const entry: SpecEntry = { status: "not-found", spec: null, fetchedAt: Date.now() };
    specCache.set(domain, entry);
    log(`Failed to fetch spec for ${domain}: ${err}`);
    return entry;
  }
}

async function fetchSpec(urlOrPath: string): Promise<OpenAPISpec> {
  // Local file path — read from disk
  if (!urlOrPath.startsWith("http://") && !urlOrPath.startsWith("https://")) {
    const fs = require("fs") as typeof import("fs");
    const data = fs.readFileSync(urlOrPath, "utf-8");
    return JSON.parse(data);
  }

  // Remote URL — fetch via HTTPS/HTTP
  const mod = urlOrPath.startsWith("https://") ? await import("https") : await import("http");
  return new Promise((resolve, reject) => {
    mod.get(urlOrPath, { headers: { "User-Agent": "ty-fetch" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchSpec(res.headers.location).then(resolve, reject);
        return;
      }
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid JSON")); }
      });
      res.on("error", reject);
    });
  });
}
