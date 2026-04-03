import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Import core modules
import {
  findClosestPath,
  findSpecPath,
  getBasePath,
  matchesPathTemplate,
  parseFetchUrl,
  pathExistsInSpec,
  resolveSchemaRef,
  stripBasePath,
  validateJsonBody,
} from "../src/core/index";

// ── URL parsing ─────────────────────────────────────────────────

describe("parseFetchUrl", () => {
  it("parses full URL with path", () => {
    const result = parseFetchUrl("https://api.stripe.com/v1/customers");
    assert.deepEqual(result, { domain: "api.stripe.com", path: "/v1/customers" });
  });

  it("parses URL with no path", () => {
    const result = parseFetchUrl("https://api.stripe.com");
    assert.deepEqual(result, { domain: "api.stripe.com", path: "/" });
  });

  it("strips query params", () => {
    const result = parseFetchUrl("https://api.stripe.com/v1/customers?limit=10");
    assert.deepEqual(result, { domain: "api.stripe.com", path: "/v1/customers" });
  });

  it("strips hash", () => {
    const result = parseFetchUrl("https://api.stripe.com/v1/customers#section");
    assert.deepEqual(result, { domain: "api.stripe.com", path: "/v1/customers" });
  });

  it("returns null for non-URL", () => {
    assert.equal(parseFetchUrl("not-a-url"), null);
    assert.equal(parseFetchUrl("/relative/path"), null);
  });

  it("handles http (not just https)", () => {
    const result = parseFetchUrl("http://localhost:3000/api/test");
    assert.deepEqual(result, { domain: "localhost:3000", path: "/api/test" });
  });
});

// ── Base path ───────────────────────────────────────────────────

describe("getBasePath / stripBasePath", () => {
  const specWithBasePath = { paths: {}, servers: [{ url: "/api/v3" }] };
  const specNoBase = { paths: {}, servers: [{ url: "https://api.stripe.com" }] };
  const specEmpty = { paths: {} };

  it("extracts base path from server URL", () => {
    assert.equal(getBasePath(specWithBasePath), "/api/v3");
  });

  it("returns empty for full URL server", () => {
    assert.equal(getBasePath(specNoBase), "");
  });

  it("returns empty when no servers", () => {
    assert.equal(getBasePath(specEmpty), "");
  });

  it("strips base path from URL path", () => {
    assert.equal(stripBasePath("/api/v3/pet", specWithBasePath), "/pet");
  });

  it("returns original when no base", () => {
    assert.equal(stripBasePath("/v1/customers", specNoBase), "/v1/customers");
  });
});

// ── Path matching ───────────────────────────────────────────────

describe("matchesPathTemplate", () => {
  it("matches exact paths", () => {
    assert.equal(matchesPathTemplate("/v1/customers", "/v1/customers"), true);
  });

  it("matches parameterized paths", () => {
    assert.equal(matchesPathTemplate("/v1/customers/cus_123", "/v1/customers/{id}"), true);
  });

  it("matches multiple params", () => {
    assert.equal(matchesPathTemplate("/repos/anthropics/claude-code", "/repos/{owner}/{repo}"), true);
  });

  it("rejects different segment count", () => {
    assert.equal(matchesPathTemplate("/v1/customers", "/v1/customers/{id}"), false);
  });

  it("rejects mismatched segments", () => {
    assert.equal(matchesPathTemplate("/v1/charges", "/v1/customers"), false);
  });
});

describe("pathExistsInSpec", () => {
  const spec = {
    paths: {
      "/v1/customers": {},
      "/v1/customers/{id}": {},
      "/repos/{owner}/{repo}": {},
    },
  };

  it("finds exact path", () => {
    assert.equal(pathExistsInSpec("/v1/customers", spec), true);
  });

  it("finds parameterized path", () => {
    assert.equal(pathExistsInSpec("/v1/customers/cus_123", spec), true);
  });

  it("finds multi-param path", () => {
    assert.equal(pathExistsInSpec("/repos/anthropics/claude-code", spec), true);
  });

  it("returns false for unknown path", () => {
    assert.equal(pathExistsInSpec("/v1/charges", spec), false);
  });
});

describe("findClosestPath", () => {
  const paths = ["/v1/customers", "/v1/charges", "/v1/coupons"];

  it("finds closest match for typo", () => {
    assert.equal(findClosestPath("/v1/cutsomers", paths), "/v1/customers");
  });

  it("returns null for completely different path", () => {
    assert.equal(findClosestPath("/v2/something/totally/different", paths), null);
  });
});

describe("findSpecPath", () => {
  const spec = {
    paths: {
      "/pet": {},
      "/pet/{petId}": {},
    },
  };

  it("finds exact path", () => {
    assert.equal(findSpecPath("/pet", spec), "/pet");
  });

  it("finds parameterized path", () => {
    assert.equal(findSpecPath("/pet/123", spec), "/pet/{petId}");
  });

  it("returns null for unknown", () => {
    assert.equal(findSpecPath("/unknown", spec), null);
  });
});

// ── Schema utils ────────────────────────────────────────────────

describe("resolveSchemaRef", () => {
  const spec = {
    paths: {},
    components: {
      schemas: {
        Pet: { type: "object", properties: { name: { type: "string" } } },
      },
    },
  };

  it("resolves $ref", () => {
    const result = resolveSchemaRef({ $ref: "#/components/schemas/Pet" }, spec);
    assert.equal(result.type, "object");
    assert.equal(result.properties.name.type, "string");
  });

  it("returns schema as-is when no $ref", () => {
    const schema = { type: "string" };
    assert.equal(resolveSchemaRef(schema, spec), schema);
  });

  it("returns null for unknown $ref", () => {
    assert.equal(resolveSchemaRef({ $ref: "#/components/schemas/Nope" }, spec), null);
  });

  it("returns null for null input", () => {
    assert.equal(resolveSchemaRef(null, spec), null);
  });
});

// ── Body validation ─────────────────────────────────────────────

describe("validateJsonBody", () => {
  const spec = { paths: {}, components: { schemas: {} } };
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
      status: { type: "string", enum: ["active", "inactive"] },
    },
    required: ["name"],
  };

  it("passes valid body", () => {
    const props = [
      {
        name: "name",
        nameStart: 0,
        nameLength: 4,
        valueStart: 6,
        valueLength: 5,
        valueText: "John",
        valueKind: "string",
      },
    ];
    const diags = validateJsonBody(props, schema, spec, 0);
    assert.equal(diags.length, 0);
  });

  it("catches type mismatch — number instead of string", () => {
    const props = [
      {
        name: "name",
        nameStart: 0,
        nameLength: 4,
        valueStart: 6,
        valueLength: 3,
        valueText: "123",
        valueKind: "number",
      },
    ];
    const diags = validateJsonBody(props, schema, spec, 0);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].code, 99003);
    assert.match(diags[0].message, /not assignable to type 'string'/);
    assert.equal(diags[0].start, 6); // points at the value
  });

  it("catches invalid enum value", () => {
    const props = [
      {
        name: "name",
        nameStart: 0,
        nameLength: 4,
        valueStart: 6,
        valueLength: 4,
        valueText: "John",
        valueKind: "string",
      },
      {
        name: "status",
        nameStart: 12,
        nameLength: 6,
        valueStart: 20,
        valueLength: 7,
        valueText: "banana",
        valueKind: "string",
      },
    ];
    const diags = validateJsonBody(props, schema, spec, 0);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].code, 99003);
    assert.match(diags[0].message, /banana/);
    assert.match(diags[0].message, /active/);
  });

  it("catches unknown property", () => {
    const props = [
      {
        name: "name",
        nameStart: 0,
        nameLength: 4,
        valueStart: 6,
        valueLength: 4,
        valueText: "John",
        valueKind: "string",
      },
      {
        name: "bogus",
        nameStart: 12,
        nameLength: 5,
        valueStart: 19,
        valueLength: 1,
        valueText: "1",
        valueKind: "number",
      },
    ];
    const diags = validateJsonBody(props, schema, spec, 0);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].code, 99002);
    assert.match(diags[0].message, /bogus/);
    assert.equal(diags[0].start, 12); // points at the property name
  });

  it("catches missing required property", () => {
    const props = [
      { name: "age", nameStart: 0, nameLength: 3, valueStart: 5, valueLength: 2, valueText: "25", valueKind: "number" },
    ];
    const diags = validateJsonBody(props, schema, spec, 0);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].code, 99004);
    assert.match(diags[0].message, /name/);
    assert.equal(diags[0].start, 0); // points at opening brace position
  });

  it("catches multiple errors at once", () => {
    const props = [
      {
        name: "age",
        nameStart: 0,
        nameLength: 3,
        valueStart: 5,
        valueLength: 5,
        valueText: "young",
        valueKind: "string",
      },
      {
        name: "fake",
        nameStart: 12,
        nameLength: 4,
        valueStart: 18,
        valueLength: 1,
        valueText: "1",
        valueKind: "number",
      },
    ];
    const diags = validateJsonBody(props, schema, spec, 0);
    // missing "name" + type mismatch on "age" + unknown "fake"
    assert.equal(diags.length, 3);
  });
});
