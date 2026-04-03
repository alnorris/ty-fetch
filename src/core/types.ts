export interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  paths: Record<string, Record<string, any>>;
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
  components?: { schemas?: Record<string, any> };
  security?: Array<Record<string, string[]>>;
}

export interface SpecEntry {
  status: "loading" | "loaded" | "not-found";
  spec: OpenAPISpec | null;
  fetchedAt: number;
}

export interface ParsedUrl {
  domain: string;
  path: string;
}

export interface FetchCallInfo {
  url: string;
  httpMethod: string | null;
  /** The identifier used for the call (e.g. "petstore" in petstore.get()) */
  instanceName: string | null;
  /** Position of the URL string in the source (after opening quote) */
  urlStart: number;
  /** Length of the URL string (excluding quotes) */
  urlLength: number;
  /** Position of the call expression */
  callStart: number;
  callLength: number;
  /** JSON body properties if present: [{ name, nameStart, nameLength, valueStart, valueLength, valueText, valueKind }] */
  jsonBody: JsonBodyProperty[] | null;
  /** params.query properties */
  queryParams: ParamProperty[] | null;
  /** params.path properties */
  pathParams: ParamProperty[] | null;
  /** Position range of the query object literal (for completions) */
  queryObjRange: { start: number; end: number } | null;
  /** Position range of the path object literal (for completions) */
  pathObjRange: { start: number; end: number } | null;
  /** Position range of the body object literal (for completions) */
  bodyObjRange: { start: number; end: number } | null;
}

export interface CreateInstanceInfo {
  varName: string;
  prefixUrl: string;
}

export interface ParamProperty {
  name: string;
  nameStart: number;
  nameLength: number;
}

export interface JsonBodyProperty {
  name: string;
  nameStart: number;
  nameLength: number;
  valueStart: number;
  valueLength: number;
  valueText: string;
  valueKind: "string" | "number" | "boolean" | "array" | "object" | "null" | "other";
}

export interface ValidationDiagnostic {
  start: number;
  length: number;
  message: string;
  code: number; // 99001=bad path, 99002=unknown prop, 99003=type mismatch, 99004=missing required
}
