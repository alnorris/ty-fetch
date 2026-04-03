import type { OpenAPISpec } from "./types";
export declare function resolveSchemaRef(schema: any, spec: OpenAPISpec): any;
export declare function getRequestBodySchema(operation: any): any | null;
export declare function getResponseSchema(operation: any): any | null;
export declare function isRequestBodyRequired(operation: any): boolean;
