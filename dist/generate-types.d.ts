/**
 * Converts OpenAPI response schemas to TypeScript type declarations.
 * Generates a .d.ts file with typed overloads for tyFetch().
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
    requestBody?: {
        content?: Record<string, {
            schema?: OpenAPISchema;
        }>;
        required?: boolean;
    };
    parameters?: Array<{
        name?: string;
        in?: string;
        required?: boolean;
        schema?: OpenAPISchema;
        $ref?: string;
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
export interface DomainSpec {
    domain: string;
    baseUrl: string;
    basePath: string;
    spec: FullOpenAPISpec;
}
/**
 * Filter spec paths to only those matching URLs seen in the codebase.
 * usedUrls is a Set of parsed { domain, path } objects.
 */
export declare function generatePerDomain(domainSpecs: DomainSpec[], usedUrls: Array<{
    domain: string;
    path: string;
}>): Map<string, string>;
export declare function generateDtsContent(domainSpecs: DomainSpec[]): string;
export {};
