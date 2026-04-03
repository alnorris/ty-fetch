import type { OpenAPISpec, SpecEntry } from "./types";
export declare const KNOWN_SPECS: Record<string, string>;
export declare const specCache: Map<string, SpecEntry>;
/**
 * Register user-provided spec mappings (from tsconfig plugin config).
 * Values can be URLs (https://...) or file paths (resolved relative to basePath).
 * These override built-in KNOWN_SPECS for the same domain.
 */
export declare function registerSpecs(specs: Record<string, string>, basePath: string): void;
/**
 * Ensure a spec is loaded for the given domain.
 * Fires an async fetch if this is the first time seeing the domain.
 * @param onLoaded — called when the spec finishes loading (for triggering side effects)
 */
export declare function ensureSpec(domain: string, log: (msg: string) => void, onLoaded?: (domain: string, spec: OpenAPISpec) => void): SpecEntry;
/**
 * Synchronous version — fetches and blocks. Used by CLI.
 */
export declare function ensureSpecSync(domain: string, log: (msg: string) => void): Promise<SpecEntry>;
export declare function fetchSpecForDomain(domain: string, log: (msg: string) => void): Promise<SpecEntry>;
