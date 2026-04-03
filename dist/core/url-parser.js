"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFetchUrl = parseFetchUrl;
exports.getBasePath = getBasePath;
exports.stripBasePath = stripBasePath;
function parseFetchUrl(text) {
    const match = text.match(/^https?:\/\/([^/]+)(\/[^?#]*)?/);
    if (!match)
        return null;
    return { domain: match[1], path: match[2] || "/" };
}
function getBasePath(spec) {
    const serverUrl = spec.servers?.[0]?.url;
    if (!serverUrl)
        return "";
    if (serverUrl.startsWith("/"))
        return serverUrl.replace(/\/$/, "");
    try {
        const parsed = new URL(serverUrl);
        return parsed.pathname.replace(/\/$/, "");
    }
    catch {
        return "";
    }
}
function stripBasePath(urlPath, spec) {
    const base = getBasePath(spec);
    if (base && urlPath.startsWith(base)) {
        return urlPath.slice(base.length) || "/";
    }
    return urlPath;
}
