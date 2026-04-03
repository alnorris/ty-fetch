import type { OpenAPISpec, ParsedUrl } from "./types";

/** Parse an HTTP(S) URL string into its domain and path components. */
export function parseFetchUrl(text: string): ParsedUrl | null {
  const match = text.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/);
  if (!match) return null;
  return { domain: match[1], path: match[2] || "/" };
}

/** Extract the base path prefix from an OpenAPI spec (Swagger 2.0 basePath or OpenAPI 3.x servers). */
export function getBasePath(spec: OpenAPISpec): string {
  // Swagger 2.0: basePath is a top-level field
  if ((spec as any).basePath) {
    const bp = (spec as any).basePath as string;
    return bp.replace(/\/$/, "");
  }
  // OpenAPI 3.x: extract from servers[].url
  const serverUrl = spec.servers?.[0]?.url;
  if (!serverUrl) return "";
  if (serverUrl.startsWith("/")) return serverUrl.replace(/\/$/, "");
  try {
    const parsed = new URL(serverUrl);
    return parsed.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Remove the spec's base path prefix from a URL path to get the API-relative path. */
export function stripBasePath(urlPath: string, spec: OpenAPISpec): string {
  const base = getBasePath(spec);
  if (base && urlPath.startsWith(base)) {
    return urlPath.slice(base.length) || "/";
  }
  return urlPath;
}
