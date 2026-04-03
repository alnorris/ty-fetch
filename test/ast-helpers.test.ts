import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ts from "typescript";
import { findFetchCalls } from "../src/core/index";

function parse(code: string) {
  return ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
}

describe("findFetchCalls", () => {
  it("detects fetch() calls", () => {
    const sf = parse(`fetch("https://api.stripe.com/v1/customers");`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.stripe.com/v1/customers");
    assert.equal(calls[0].httpMethod, null);
  });

  it("detects tf.get() calls", () => {
    const sf = parse(`tf.get("https://api.stripe.com/v1/customers");`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].httpMethod, "get");
  });

  it("detects api.post() calls", () => {
    const sf = parse(`api.post("https://api.stripe.com/v1/customers", { body: { name: "John" } });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].httpMethod, "post");
  });

  it("detects all HTTP methods", () => {
    const sf = parse(`
      a.get("https://x.com/1");
      a.post("https://x.com/2");
      a.put("https://x.com/3");
      a.patch("https://x.com/4");
      a.delete("https://x.com/5");
    `);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 5);
    assert.deepEqual(
      calls.map((c) => c.httpMethod),
      ["get", "post", "put", "patch", "delete"],
    );
  });

  it("detects direct call tf(url)", () => {
    const sf = parse(`tf("https://api.stripe.com/v1/customers");`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].httpMethod, null);
  });

  it("ignores non-fetch calls", () => {
    const sf = parse(`console.log("https://api.stripe.com/v1/customers");`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 0);
  });

  it("ignores dynamic URLs", () => {
    const sf = parse(`fetch(someVariable);`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 0);
  });

  it("extracts body properties", () => {
    const sf = parse(`tf.post("https://x.com/api", { body: { name: "John", age: 30 } });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].jsonBody);
    assert.equal(calls[0].jsonBody.length, 2);
    assert.equal(calls[0].jsonBody[0].name, "name");
    assert.equal(calls[0].jsonBody[0].valueKind, "string");
    assert.equal(calls[0].jsonBody[0].valueText, "John");
    assert.equal(calls[0].jsonBody[1].name, "age");
    assert.equal(calls[0].jsonBody[1].valueKind, "number");
  });

  it("returns null jsonBody when no body", () => {
    const sf = parse(`tf.get("https://x.com/api");`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls[0].jsonBody, null);
  });

  it("returns null jsonBody when body is not object literal", () => {
    const sf = parse(`tf.post("https://x.com/api", { body: someVar });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls[0].jsonBody, null);
  });

  it("detects boolean values", () => {
    const sf = parse(`tf.post("https://x.com/api", { body: { active: true } });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls[0].jsonBody[0].valueKind, "boolean");
    assert.equal(calls[0].jsonBody[0].valueText, "true");
  });

  it("detects array values", () => {
    const sf = parse(`tf.post("https://x.com/api", { body: { tags: ["a", "b"] } });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls[0].jsonBody[0].valueKind, "array");
  });

  it("correct URL positions", () => {
    const code = `tf.get("https://x.com/api");`;
    const sf = parse(code);
    const calls = findFetchCalls(ts, sf);
    // URL starts after the opening quote
    const urlInCode = code.substring(calls[0].urlStart, calls[0].urlStart + calls[0].urlLength);
    assert.equal(urlInCode, "https://x.com/api");
  });

  it("finds multiple calls in one file", () => {
    const sf = parse(`
      fetch("https://a.com/1");
      tf.get("https://b.com/2");
      api.post("https://c.com/3");
    `);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 3);
  });

  it("extracts query params", () => {
    const sf = parse(`tf.get("https://x.com/api", { params: { query: { status: "available", limit: 10 } } });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].queryParams);
    assert.equal(calls[0].queryParams.length, 2);
    assert.equal(calls[0].queryParams[0].name, "status");
    assert.equal(calls[0].queryParams[1].name, "limit");
  });

  it("extracts path params", () => {
    const sf = parse(`tf.get("https://x.com/api/{id}", { params: { path: { id: "123" } } });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].pathParams);
    assert.equal(calls[0].pathParams.length, 1);
    assert.equal(calls[0].pathParams[0].name, "id");
  });

  it("extracts both query and path params", () => {
    const sf = parse(`tf.get("https://x.com/api/{id}", { params: { path: { id: "1" }, query: { expand: "all" } } });`);
    const calls = findFetchCalls(ts, sf);
    assert.ok(calls[0].pathParams);
    assert.ok(calls[0].queryParams);
    assert.equal(calls[0].pathParams[0].name, "id");
    assert.equal(calls[0].queryParams[0].name, "expand");
  });

  it("returns null params when no params option", () => {
    const sf = parse(`tf.get("https://x.com/api");`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls[0].queryParams, null);
    assert.equal(calls[0].pathParams, null);
    assert.equal(calls[0].queryObjRange, null);
    assert.equal(calls[0].pathObjRange, null);
  });

  it("returns null params when params is not object literal", () => {
    const sf = parse(`tf.get("https://x.com/api", { params: someVar });`);
    const calls = findFetchCalls(ts, sf);
    assert.equal(calls[0].queryParams, null);
    assert.equal(calls[0].pathParams, null);
  });

  it("sets queryObjRange for query object", () => {
    const code = `tf.get("https://x.com/api", { params: { query: { status: "ok" } } });`;
    const sf = parse(code);
    const calls = findFetchCalls(ts, sf);
    assert.ok(calls[0].queryObjRange);
    const slice = code.substring(calls[0].queryObjRange.start, calls[0].queryObjRange.end);
    assert.equal(slice, `{ status: "ok" }`);
  });

  it("sets pathObjRange for path object", () => {
    const code = `tf.get("https://x.com/{id}", { params: { path: { id: "1" } } });`;
    const sf = parse(code);
    const calls = findFetchCalls(ts, sf);
    assert.ok(calls[0].pathObjRange);
    const slice = code.substring(calls[0].pathObjRange.start, calls[0].pathObjRange.end);
    assert.equal(slice, `{ id: "1" }`);
  });

  it("correct nameStart positions for param properties", () => {
    const code = `tf.get("https://x.com/api", { params: { query: { status: "ok" } } });`;
    const sf = parse(code);
    const calls = findFetchCalls(ts, sf);
    const param = calls[0].queryParams![0];
    const nameInCode = code.substring(param.nameStart, param.nameStart + param.nameLength);
    assert.equal(nameInCode, "status");
  });
});
