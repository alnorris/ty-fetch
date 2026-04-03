import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateDtsContent, generatePerDomain } from "../src/generate-types";

const petSpec = {
  info: { title: "Petstore" },
  servers: [{ url: "/api/v3" }],
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name", "photoUrls"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          photoUrls: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["available", "pending", "sold"] },
        },
      },
    },
  },
  paths: {
    "/pet": {
      put: {
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } },
      },
      post: {
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } },
      },
    },
    "/pet/{petId}": {
      get: {
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
      },
    },
    "/pet/findByStatus": {
      get: {
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { "200": { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } } } },
      },
    },
  },
};

const ds = { domain: "petstore.io", baseUrl: "https://petstore.io", basePath: "/api/v3", spec: petSpec };

describe("generateDtsContent", () => {
  const result = generateDtsContent([ds]);

  it("generates response types", () => {
    assert.match(result, /export type Petstore_Pet_Put/);
    assert.match(result, /export type Petstore_Pet_Post/);
    assert.match(result, /export type Petstore_Pet_PetId_Get/);
    assert.match(result, /export type Petstore_Pet_FindByStatus_Get/);
  });

  it("generates body types for PUT/POST", () => {
    assert.match(result, /export type Petstore_Pet_Put_Body/);
    assert.match(result, /export type Petstore_Pet_Post_Body/);
  });

  it("generates path params for /pet/{petId}", () => {
    assert.match(result, /Petstore_Pet_PetId_Get_PathParams.*petId: string/);
  });

  it("generates query params for /pet/findByStatus", () => {
    assert.match(result, /Petstore_Pet_FindByStatus_Get_QueryParams.*status/);
  });

  it("emits overloads with Options<Body, PathParams, QueryParams, Headers>", () => {
    // PUT /pet has body, no path params
    assert.match(result, /put\(url:.*\/pet`.*Options<Petstore_Pet_Put_Body, never, never/);
    // GET /pet/{petId} has path params, no body
    assert.match(result, /get\(url:.*pet\/\$\{string\}`.*Options<never, Petstore_Pet_PetId_Get_PathParams, never/);
    // GET /pet/findByStatus has query params
    assert.match(result, /get\(url:.*findByStatus`.*Options<never, never, Petstore_Pet_FindByStatus_Get_QueryParams/);
  });

  it("wraps overloads in TyFetch interface", () => {
    assert.match(result, /export interface TyFetch/);
  });

  it("uses template literals for parameterized URLs", () => {
    assert.match(result, /`https:\/\/petstore\.io\/api\/v3\/pet\/\$\{string\}`/);
  });

  it("resolves $ref to component schemas", () => {
    // The Pet type should have name: string (from resolved schema)
    assert.match(result, /name\??: string/);
    assert.match(result, /photoUrls\??: string\[\]/);
  });

  it("handles enum types", () => {
    assert.match(result, /"available" \| "pending" \| "sold"/);
  });
});

describe("generatePerDomain", () => {
  it("filters to only used URLs", () => {
    const usedUrls = [
      { domain: "petstore.io", path: "/api/v3/pet/findByStatus" },
    ];
    const files = generatePerDomain([ds], usedUrls);
    assert.equal(files.size, 1);
    const content = [...files.values()][0];
    assert.match(content, /findByStatus/);
    assert.doesNotMatch(content, /put\(/); // PUT /pet not included
  });

  it("returns empty for unused domain", () => {
    const usedUrls = [{ domain: "other.com", path: "/foo" }];
    const files = generatePerDomain([ds], usedUrls);
    assert.equal(files.size, 0);
  });

  it("matches parameterized paths", () => {
    const usedUrls = [{ domain: "petstore.io", path: "/api/v3/pet/42" }];
    const files = generatePerDomain([ds], usedUrls);
    const content = [...files.values()][0];
    assert.match(content, /PetId_Get/);
  });
});
