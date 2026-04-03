import type { OpenAPISpec, ParsedUrl } from "./types";

export function parseFetchUrl(text: string): ParsedUrl | null {
  const match = text.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/);
  if (!match) return null;
  return { domain: match[1], path: match[2] || "/" };
}

export function getBasePath(spec: OpenAPISpec): string {
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

export function stripBasePath(urlPath: string, spec: OpenAPISpec): string {
  const base = getBasePath(spec);
  if (base && urlPath.startsWith(base)) {
    return urlPath.slice(base.length) || "/";
  }
  return urlPath;
}
