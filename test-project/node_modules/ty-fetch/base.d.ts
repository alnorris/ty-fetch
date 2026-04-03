export class HTTPError extends Error {
  response: Response;
}

export interface Options<
  TBody = never,
  TPathParams = never,
  TQueryParams = never,
> extends Omit<RequestInit, 'body'> {
  body?: TBody;
  params?: {
    path?: TPathParams;
    query?: TQueryParams;
  };
  prefixUrl?: string;
}

export interface ResponsePromise<T = unknown> extends PromiseLike<T> {
  json(): Promise<T>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
}

export interface TyFetch {
  (url: string, options?: Options): ResponsePromise;
  get(url: string, options?: Options): ResponsePromise;
  post(url: string, options?: Options): ResponsePromise;
  put(url: string, options?: Options): ResponsePromise;
  patch(url: string, options?: Options): ResponsePromise;
  delete(url: string, options?: Options): ResponsePromise;
  head(url: string, options?: Options): ResponsePromise;
  create(defaults?: Options<unknown>): TyFetch;
  extend(defaults?: Options<unknown>): TyFetch;
  HTTPError: typeof HTTPError;
}

declare const tf: TyFetch;
export default tf;
