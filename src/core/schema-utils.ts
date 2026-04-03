import type { OpenAPISpec } from "./types";

export function resolveSchemaRef(schema: any, spec: OpenAPISpec): any {
  if (!schema) return null;
  if (schema.$ref) {
    const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
    if (match) return spec.components?.schemas?.[match[1]] ?? null;
    return null;
  }
  return schema;
}

export function getRequestBodySchema(operation: any): any | null {
  return (
    operation?.requestBody?.content?.["application/json"]?.schema ??
    operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema ??
    null
  );
}

export function getResponseSchema(operation: any): any | null {
  const resp = operation?.responses?.["200"] ?? operation?.responses?.["201"];
  return resp?.content?.["application/json"]?.schema ?? null;
}

export function isRequestBodyRequired(operation: any): boolean {
  return !!operation?.requestBody?.required;
}
