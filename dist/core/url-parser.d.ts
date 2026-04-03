import type { OpenAPISpec, ParsedUrl } from "./types";
export declare function parseFetchUrl(text: string): ParsedUrl | null;
export declare function getBasePath(spec: OpenAPISpec): string;
export declare function stripBasePath(urlPath: string, spec: OpenAPISpec): string;
