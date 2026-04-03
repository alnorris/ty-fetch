"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.specCache = exports.KNOWN_SPECS = void 0;
exports.ensureSpec = ensureSpec;
exports.ensureSpecSync = ensureSpecSync;
exports.fetchSpecForDomain = fetchSpecForDomain;
exports.KNOWN_SPECS = {
    "api.stripe.com": "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    "petstore3.swagger.io": "https://petstore3.swagger.io/api/v3/openapi.json",
    "api.github.com": "https://api.apis.guru/v2/specs/github.com/api.github.com/1.1.4/openapi.json",
};
exports.specCache = new Map();
/**
 * Ensure a spec is loaded for the given domain.
 * Fires an async fetch if this is the first time seeing the domain.
 * @param onLoaded — called when the spec finishes loading (for triggering side effects)
 */
function ensureSpec(domain, log, onLoaded) {
    const existing = exports.specCache.get(domain);
    if (existing)
        return existing;
    const specUrl = exports.KNOWN_SPECS[domain];
    if (!specUrl) {
        const entry = { status: "not-found", spec: null, fetchedAt: Date.now() };
        exports.specCache.set(domain, entry);
        return entry;
    }
    const entry = { status: "loading", spec: null, fetchedAt: Date.now() };
    exports.specCache.set(domain, entry);
    log(`Fetching spec for ${domain} from ${specUrl}`);
    fetchSpec(specUrl)
        .then((spec) => {
        entry.status = "loaded";
        entry.spec = spec;
        const pathCount = Object.keys(spec.paths || {}).length;
        log(`Spec loaded for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
        onLoaded?.(domain, spec);
    })
        .catch((err) => {
        entry.status = "not-found";
        log(`Failed to fetch spec for ${domain}: ${err}`);
    });
    return entry;
}
/**
 * Synchronous version — fetches and blocks. Used by CLI.
 */
async function ensureSpecSync(domain, log) {
    const existing = exports.specCache.get(domain);
    if (existing?.status !== "loading")
        return existing ?? { status: "not-found", spec: null, fetchedAt: 0 };
    // Already loading — wait for it (shouldn't happen in CLI flow)
    return existing;
}
async function fetchSpecForDomain(domain, log) {
    const existing = exports.specCache.get(domain);
    if (existing && existing.status === "loaded")
        return existing;
    const specUrl = exports.KNOWN_SPECS[domain];
    if (!specUrl) {
        const entry = { status: "not-found", spec: null, fetchedAt: Date.now() };
        exports.specCache.set(domain, entry);
        return entry;
    }
    log(`Fetching spec for ${domain} from ${specUrl}`);
    try {
        const spec = await fetchSpec(specUrl);
        const entry = { status: "loaded", spec, fetchedAt: Date.now() };
        exports.specCache.set(domain, entry);
        const pathCount = Object.keys(spec.paths || {}).length;
        log(`Spec loaded for ${domain}: ${spec.info?.title ?? "unknown"} (${pathCount} paths)`);
        return entry;
    }
    catch (err) {
        const entry = { status: "not-found", spec: null, fetchedAt: Date.now() };
        exports.specCache.set(domain, entry);
        log(`Failed to fetch spec for ${domain}: ${err}`);
        return entry;
    }
}
async function fetchSpec(url) {
    const https = await Promise.resolve().then(() => __importStar(require("https")));
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "ty-fetch" } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchSpec(res.headers.location).then(resolve, reject);
                return;
            }
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    reject(new Error("Invalid JSON"));
                }
            });
            res.on("error", reject);
        });
    });
}
