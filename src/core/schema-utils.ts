import type { OpenAPISpec } from "./types";

/** Resolve a $ref pointer to its target schema, or return the schema as-is if not a ref. */
export function resolveSchemaRef(schema: any, spec: OpenAPISpec): any {
  if (!schema) return null;
  if (schema.$ref) {
    const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
    if (match) return spec.components?.schemas?.[match[1]] ?? null;
    return null;
  }
  return schema;
}

/** Extract the JSON or form-encoded request body schema from an operation. */
export function getRequestBodySchema(operation: any): any | null {
  return (
    operation?.requestBody?.content?.["application/json"]?.schema ??
    operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema ??
    null
  );
}

/** Extract the JSON response schema from a 200 or 201 response. */
export function getResponseSchema(operation: any): any | null {
  const resp = operation?.responses?.["200"] ?? operation?.responses?.["201"];
  return resp?.content?.["application/json"]?.schema ?? null;
}

/** Return true if the operation's request body is marked as required. */
export function isRequestBodyRequired(operation: any): boolean {
  return !!operation?.requestBody?.required;
}
