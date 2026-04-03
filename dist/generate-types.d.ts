/**
 * Converts OpenAPI response schemas to TypeScript type declarations.
 * Generates a .d.ts file with typed overloads for typedFetch().
 */
interface OpenAPISchema {
    type?: string;
    properties?: Record<string, OpenAPISchema>;
    items?: OpenAPISchema;
    required?: string[];
    $ref?: string;
    enum?: (string | number | boolean)[];
    oneOf?: OpenAPISchema[];
    anyOf?: OpenAPISchema[];
    allOf?: OpenAPISchema[];
    additionalProperties?: boolean | OpenAPISchema;
    description?: string;
    nullable?: boolean;
}
interface OpenAPIOperation {
    responses?: Record<string, {
        content?: Record<string, {
            schema?: OpenAPISchema;
        }>;
        description?: string;
    }>;
    summary?: string;
}
interface FullOpenAPISpec {
    paths: Record<string, Record<string, OpenAPIOperation>>;
    components?: {
        schemas?: Record<string, OpenAPISchema>;
    };
    servers?: Array<{
        url?: string;
    }>;
    info?: {
        title?: string;
        version?: string;
    };
}
interface DomainSpec {
    domain: string;
    baseUrl: string;
    basePath: string;
    spec: FullOpenAPISpec;
}
export declare function generateDtsContent(domainSpecs: DomainSpec[]): string;
export {};
