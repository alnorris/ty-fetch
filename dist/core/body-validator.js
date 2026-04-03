"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateJsonBody = validateJsonBody;
const schema_utils_1 = require("./schema-utils");
/**
 * Validate a JSON body object against an OpenAPI schema.
 * Returns diagnostics with positions pointing at the specific offending properties.
 */
function validateJsonBody(properties, schema, spec, jsonObjectStart) {
    const diagnostics = [];
    const schemaProps = schema.properties;
    if (!schemaProps)
        return diagnostics;
    const requiredSet = new Set(schema.required ?? []);
    // Check each property
    for (const prop of properties) {
        // Unknown property
        if (!schemaProps[prop.name]) {
            diagnostics.push({
                start: prop.nameStart,
                length: prop.nameLength,
                message: `Property '${prop.name}' does not exist in the request body schema.`,
                code: 99002,
            });
            continue;
        }
        // Type mismatch
        const expectedSchema = (0, schema_utils_1.resolveSchemaRef)(schemaProps[prop.name], spec);
        if (!expectedSchema?.type)
            continue;
        const mismatch = checkTypeMismatch(prop, expectedSchema);
        if (mismatch) {
            diagnostics.push({
                start: prop.valueStart,
                length: prop.valueLength,
                message: mismatch,
                code: 99003,
            });
        }
    }
    // Missing required properties
    const providedNames = new Set(properties.map((p) => p.name));
    for (const reqProp of requiredSet) {
        if (!providedNames.has(reqProp)) {
            diagnostics.push({
                start: jsonObjectStart,
                length: 1, // opening brace
                message: `Missing required property '${reqProp}' in request body.`,
                code: 99004,
            });
        }
    }
    return diagnostics;
}
function checkTypeMismatch(prop, schema) {
    const expectedType = schema.type;
    const enumValues = schema.enum;
    switch (prop.valueKind) {
        case "number":
            if (expectedType === "string")
                return `Type 'number' is not assignable to type 'string'.`;
            break;
        case "string":
            if (expectedType === "number" || expectedType === "integer")
                return `Type 'string' is not assignable to type 'number'.`;
            if (enumValues && !enumValues.includes(prop.valueText))
                return `Value '${prop.valueText}' is not assignable to type '${enumValues.map((v) => `"${v}"`).join(" | ")}'.`;
            break;
        case "boolean":
            if (expectedType === "string")
                return `Type 'boolean' is not assignable to type 'string'.`;
            if (expectedType === "number" || expectedType === "integer")
                return `Type 'boolean' is not assignable to type 'number'.`;
            break;
        case "array":
            if (expectedType !== "array")
                return `Type 'array' is not assignable to type '${expectedType}'.`;
            break;
        case "object":
            if (expectedType !== "object" && !schema.properties)
                return `Type 'object' is not assignable to type '${expectedType}'.`;
            break;
    }
    return null;
}
