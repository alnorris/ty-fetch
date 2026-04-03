import type { OpenAPISpec, JsonBodyProperty, ValidationDiagnostic } from "./types";
/**
 * Validate a JSON body object against an OpenAPI schema.
 * Returns diagnostics with positions pointing at the specific offending properties.
 */
export declare function validateJsonBody(properties: JsonBodyProperty[], schema: any, spec: OpenAPISpec, jsonObjectStart: number): ValidationDiagnostic[];
