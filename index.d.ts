export class HTTPError extends Error {
  response: Response;
}

export interface Options<
  TBody = never,
  TPathParams = never,
  TQueryParams = never,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaseOptions = Options<any, Record<string, any>, Record<string, any>>;

export interface TyFetch {
  (url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  get(url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  post(url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  put(url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  patch(url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  delete(url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  head(url: string, options?: BaseOptions): Promise<FetchResult<any>>;
  create(defaults?: BaseOptions): TyFetch;
  extend(defaults?: BaseOptions): TyFetch;
  use(middleware: Middleware): TyFetch;
  HTTPError: typeof HTTPError;
}

declare const ty: TyFetch;
export default ty;
