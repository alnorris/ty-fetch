class HTTPError extends Error {
  constructor(response) {
    super(`${response.status} ${response.statusText}`);
    this.name = "HTTPError";
    this.response = response;
  }
}

class ResponsePromise {
  constructor(fetchPromise) {
    this._promise = fetchPromise.then((res) => {
      if (!res.ok) throw new HTTPError(res);
      return res;
    });
  }
  then(resolve, reject) { return this._promise.then(resolve, reject); }
  catch(fn) { return this._promise.catch(fn); }
  finally(fn) { return this._promise.finally(fn); }
  json() { return this._promise.then((r) => r.json()); }
  text() { return this._promise.then((r) => r.text()); }
  blob() { return this._promise.then((r) => r.blob()); }
  arrayBuffer() { return this._promise.then((r) => r.arrayBuffer()); }
  formData() { return this._promise.then((r) => r.formData()); }
}

function createInstance(defaults = {}) {
  function tf(url, options = {}) {
    const merged = { ...defaults, ...options };
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

    return new ResponsePromise(fetch(fullUrl, fetchOpts));
  }

  tf.get = (url, opts) => tf(url, { ...opts, method: "GET" });
  tf.post = (url, opts) => tf(url, { ...opts, method: "POST" });
  tf.put = (url, opts) => tf(url, { ...opts, method: "PUT" });
  tf.patch = (url, opts) => tf(url, { ...opts, method: "PATCH" });
  tf.delete = (url, opts) => tf(url, { ...opts, method: "DELETE" });
  tf.head = (url, opts) => tf(url, { ...opts, method: "HEAD" });
  tf.create = (newDefaults) => createInstance(newDefaults);
  tf.extend = (newDefaults) => createInstance({ ...defaults, ...newDefaults });
  tf.HTTPError = HTTPError;

  return tf;
}

module.exports = createInstance();
module.exports.default = module.exports;
