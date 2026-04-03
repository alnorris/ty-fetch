import yaml from "js-yaml";
import type { OpenAPISpec, SpecEntry } from "./types";

export const KNOWN_SPECS: Record<string, string> = {};

export const specCache = new Map<string, SpecEntry>();

/**
 * Register user-provided spec mappings (from tsconfig plugin config).
 * Values can be URLs (https://...) or file paths (resolved relative to basePath).
 * These override built-in KNOWN_SPECS for the same domain.
 */
export function registerSpecs(specs: Record<string, string>, basePath: string): void {
  const pathMod = require("node:path") as typeof import("path");
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

  const entry: SpecEntry = { status: "loading", spec: null, fetchedAt: Date.now() };
  specCache.set(domain, entry);

  if (specUrl) {
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
  } else {
    log(`No spec configured for ${domain}, probing well-known URLs...`);
    probeWellKnownSpecs(domain, log)
      .then((spec) => {
        if (spec) {
          entry.status = "loaded";
          entry.spec = spec;
          const pathCount = Object.keys(spec.paths || {}).length;
          log(`Spec discovered for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
          onLoaded?.(domain, spec);
        } else {
          entry.status = "not-found";
          log(`No spec found for ${domain} at well-known URLs`);
        }
      })
      .catch(() => {
        entry.status = "not-found";
      });
  }

  return entry;
}

/**
 * Synchronous version — fetches and blocks. Used by CLI.
 */
export async function ensureSpecSync(domain: string, _log: (msg: string) => void): Promise<SpecEntry> {
  const existing = specCache.get(domain);
  if (existing?.status !== "loading") return existing ?? { status: "not-found", spec: null, fetchedAt: 0 };

  // Already loading — wait for it (shouldn't happen in CLI flow)
  return existing;
}

export async function fetchSpecForDomain(domain: string, log: (msg: string) => void): Promise<SpecEntry> {
  const existing = specCache.get(domain);
  if (existing && existing.status === "loaded") return existing;

  const specUrl = KNOWN_SPECS[domain];

  if (specUrl) {
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

  log(`No spec configured for ${domain}, probing well-known URLs...`);
  const spec = await probeWellKnownSpecs(domain, log);
  if (spec) {
    const entry: SpecEntry = { status: "loaded", spec, fetchedAt: Date.now() };
    specCache.set(domain, entry);
    const pathCount = Object.keys(spec.paths || {}).length;
    log(`Spec discovered for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
    return entry;
  }
  const entry: SpecEntry = { status: "not-found", spec: null, fetchedAt: Date.now() };
  specCache.set(domain, entry);
  log(`No spec found for ${domain} at well-known URLs`);
  return entry;
}

const WELL_KNOWN_PATHS = [
  "/.well-known/openapi.json",
  "/.well-known/openapi.yaml",
  "/.well-known/openapi.yml",
  "/openapi.json",
  "/openapi.yaml",
  "/openapi.yml",
  "/api/openapi.json",
  "/api/openapi.yaml",
  "/docs/openapi.json",
  "/docs/openapi.yaml",
  "/swagger.json",
  "/api-docs/openapi.json",
];

async function probeWellKnownSpecs(domain: string, log: (msg: string) => void): Promise<OpenAPISpec | null> {
  // Try HTTPS first, then HTTP for local/dev servers
  const protocols = domain.startsWith("127.0.0.1") || domain.startsWith("localhost") ? ["http"] : ["https", "http"];
  for (const proto of protocols) {
    for (const path of WELL_KNOWN_PATHS) {
      const url = `${proto}://${domain}${path}`;
      try {
        const spec = await fetchSpec(url);
        if (spec?.openapi || spec?.swagger) {
          log(`Found spec at ${url}`);
          return spec;
        }
      } catch {
        // try next
      }
    }
  }
  return null;
}

function parseSpec(data: string, source: string): OpenAPISpec {
  const isYaml = /\.ya?ml$/i.test(source) || (!source.endsWith(".json") && !data.trimStart().startsWith("{"));
  if (isYaml) {
    return yaml.load(data) as OpenAPISpec;
  }
  return JSON.parse(data);
}

async function fetchSpec(urlOrPath: string): Promise<OpenAPISpec> {
  // Local file path — read from disk
  if (!urlOrPath.startsWith("http://") && !urlOrPath.startsWith("https://")) {
    const fs = require("node:fs") as typeof import("fs");
    const data = fs.readFileSync(urlOrPath, "utf-8");
    return parseSpec(data, urlOrPath);
  }

  // Remote URL — fetch via HTTPS/HTTP
  const mod = urlOrPath.startsWith("https://") ? await import("node:https") : await import("node:http");
  return new Promise((resolve, reject) => {
    mod
      .get(urlOrPath, { headers: { "User-Agent": "ty-fetch" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchSpec(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(parseSpec(data, urlOrPath));
          } catch (err) {
            reject(new Error(`Failed to parse spec: ${err}`));
          }
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
}
