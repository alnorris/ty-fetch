import type { OpenAPISpec } from "./types";
export declare function matchesPathTemplate(actualPath: string, templatePath: string): boolean;
export declare function pathExistsInSpec(path: string, spec: OpenAPISpec): boolean;
export declare function findSpecPath(apiPath: string, spec: OpenAPISpec): string | null;
export declare function findClosestPath(target: string, paths: string[]): string | null;
