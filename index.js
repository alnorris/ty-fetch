class HTTPError extends Error {
  constructor(response) {
    super(`${response.status} ${response.statusText}`);
    this.name = "HTTPError";
    this.response = response;
  }
}

function createInstance(defaults = {}) {
  const middlewares = [...(defaults._middlewares || [])];

  function ty(url, options = {}) {
    const merged = { ...defaults, ...options };
    delete merged._middlewares;
    const { body, params, prefixUrl, ...fetchOpts } = merged;

    // Build URL from prefix + path params
    let fullUrl = prefixUrl
      ? `${prefixUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`
      : url;

    // Replace path params: {account} → value
    if (params?.path) {
      for (const [key, value] of Object.entries(params.path)) {
        fullUrl = fullUrl.replace(`{${key}}`, encodeURIComponent(String(value)));
      }
    }

    // Append query params
    if (params?.query) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params.query)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) fullUrl += (fullUrl.includes("?") ? "&" : "?") + qs;
    }

    // JSON body
    if (body !== undefined) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers = { "content-type": "application/json", ...fetchOpts.headers };
    }

    // Build request
    const request = new Request(fullUrl, fetchOpts);

    // Run middleware chain
    const execute = async (req) => {
      let currentReq = req;
      const onResponses = [];

      for (const mw of middlewares) {
        if (mw.onRequest) {
          const result = await mw.onRequest(currentReq);
          if (result instanceof Request) currentReq = result;
          else if (result) currentReq = new Request(currentReq, result);
        }
        if (mw.onResponse) onResponses.push(mw.onResponse);
      }

      let response = await fetch(currentReq);

      for (const handler of onResponses) {
        const result = await handler(response);
        if (result instanceof Response) response = result;
      }

      return response;
    };

    return execute(request).then(async (response) => {
      if (!response.ok) {
        let error;
        try {
          error = await response.json();
        } catch {
          error = { message: response.statusText };
        }
        return { data: undefined, error, response };
      }
      let data;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      return { data, error: undefined, response };
    });
  }

  ty.get = (url, opts) => ty(url, { ...opts, method: "GET" });
  ty.post = (url, opts) => ty(url, { ...opts, method: "POST" });
  ty.put = (url, opts) => ty(url, { ...opts, method: "PUT" });
  ty.patch = (url, opts) => ty(url, { ...opts, method: "PATCH" });
  ty.delete = (url, opts) => ty(url, { ...opts, method: "DELETE" });
  ty.head = (url, opts) => ty(url, { ...opts, method: "HEAD" });
  ty.create = (newDefaults) => createInstance({ ...newDefaults, _middlewares: middlewares });
  ty.extend = (newDefaults) => createInstance({ ...defaults, ...newDefaults, _middlewares: middlewares });
  ty.use = (mw) => { middlewares.push(mw); return ty; };
  ty.HTTPError = HTTPError;

  return ty;
}

module.exports = createInstance();
module.exports.default = module.exports;
