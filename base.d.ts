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

export interface ResponsePromise<T = unknown> extends PromiseLike<T> {
  json(): Promise<T>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaseOptions = Options<any, Record<string, any>, Record<string, any>>;

export interface TyFetch {
  (url: string, options?: BaseOptions): ResponsePromise<any>;
  get(url: string, options?: BaseOptions): ResponsePromise<any>;
  post(url: string, options?: BaseOptions): ResponsePromise<any>;
  put(url: string, options?: BaseOptions): ResponsePromise<any>;
  patch(url: string, options?: BaseOptions): ResponsePromise<any>;
  delete(url: string, options?: BaseOptions): ResponsePromise<any>;
  head(url: string, options?: BaseOptions): ResponsePromise<any>;
  create(defaults?: BaseOptions): TyFetch;
  extend(defaults?: BaseOptions): TyFetch;
  HTTPError: typeof HTTPError;
}

declare const tf: TyFetch;
export default tf;
