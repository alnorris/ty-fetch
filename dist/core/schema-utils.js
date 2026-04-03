"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSchemaRef = resolveSchemaRef;
exports.getRequestBodySchema = getRequestBodySchema;
exports.getResponseSchema = getResponseSchema;
exports.isRequestBodyRequired = isRequestBodyRequired;
function resolveSchemaRef(schema, spec) {
    if (!schema)
        return null;
    if (schema.$ref) {
        const match = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
        if (match)
            return spec.components?.schemas?.[match[1]] ?? null;
        return null;
    }
    return schema;
}
function getRequestBodySchema(operation) {
    return (operation?.requestBody?.content?.["application/json"]?.schema ??
        operation?.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema ??
        null);
}
function getResponseSchema(operation) {
    const resp = operation?.responses?.["200"] ?? operation?.responses?.["201"];
    return resp?.content?.["application/json"]?.schema ?? null;
}
function isRequestBodyRequired(operation) {
    return !!operation?.requestBody?.required;
}
