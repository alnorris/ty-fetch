export class HTTPError extends Error {
  response: Response;
}

export interface Options<
  TBody = unknown,
  TPathParams = Record<string, string>,
  TQueryParams = Record<string, string | number | boolean>,
  THeaders extends Record<string, string> = Record<string, string>,
> extends Omit<RequestInit, 'body' | 'headers'> {
  body?: TBody;
  params?: {
    path?: TPathParams;
    query?: TQueryParams;
  };
  headers?: THeaders & Record<string, string>;
  prefixUrl?: string;
}

export type FetchResult<TData = unknown, TError = unknown> =
  | { data: TData; error: undefined; response: Response }
  | { data: undefined; error: TError; response: Response };

export interface Middleware {
  onRequest?: (request: Request) => Request | RequestInit | void | Promise<Request | RequestInit | void>;
  onResponse?: (response: Response) => Response | void | Promise<Response | void>;
}

export interface StreamResult<T = unknown> extends AsyncIterable<T> {
  response: Promise<Response>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Untyped = any;

export interface TyFetch {
  <T = Untyped>(url: string, options?: Options): Promise<FetchResult<T>>;
  get<T = Untyped>(url: string, options?: Options<never>): Promise<FetchResult<T>>;
  post<T = Untyped>(url: string, options?: Options): Promise<FetchResult<T>>;
  put<T = Untyped>(url: string, options?: Options): Promise<FetchResult<T>>;
  patch<T = Untyped>(url: string, options?: Options): Promise<FetchResult<T>>;
  delete<T = Untyped>(url: string, options?: Options<never>): Promise<FetchResult<T>>;
  head<T = Untyped>(url: string, options?: Options<never>): Promise<FetchResult<T>>;
  stream<T = Untyped>(url: string, options?: Options): StreamResult<T>;
  create(defaults?: Options): TyFetch;
  extend(defaults?: Options): TyFetch;
  use(middleware: Middleware): TyFetch;
  HTTPError: typeof HTTPError;
}

declare const ty: TyFetch;
export default ty;
