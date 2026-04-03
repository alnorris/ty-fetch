import ty from "ty-fetch";

// ─── Petstore API ──────────────────────────────────────────────────
// Spec configured in tsconfig.json → plugins[].specs
// All types below are generated automatically — no codegen step!

async function findPets() {
  // Typed response — status is "available" | "pending" | "sold"
  const { data, error } = await ty.get("https://petstore3.swagger.io/api/v3/pet/findByStatus", {
    params: { query: { status: 'available' } },
  });

  if (error) return console.error(error);
  console.log(data); // Pet[] — fully typed
}

async function getPet() {
  // Path params are typed — petId is required
  const { data, error } = await ty.get("https://petstore3.swagger.io/api/v3/pet/{petId}", {
    params: { path: { petId: "1" } },
  });

  if (error) return console.error(error);
  console.log(data); // Pet — name, status, photoUrls all typed
}

async function createPet() {
  // Body is validated against the spec
  const { data, error } = await ty.post("https://petstore3.swagger.io/api/v3/pet", {
    body: {
      name: "doggie",
      photoUrls: ["https://example.com/dog.jpg"],
      status: "available",
    },
  });

  if (error) return console.error(error);
  console.log("Created:", data);
}

// ─── Typo detection ────────────────────────────────────────────────
// Try uncommenting the line below — you'll see a red squiggle!

// ty.get("https://petstore3.swagger.io/api/v3/pets");
//   Error: Path '/pets' does not exist. Did you mean '/pet'?

// ─── Error handling ────────────────────────────────────────────────

async function handleError() {
  const { data, error, response } = await ty.get("https://petstore3.swagger.io/api/v3/pet/{petId}", {
    params: { path: { petId: "99999" } },
  });

  if (error) {
    console.log(`Error ${response.status}:`, error);
    return;
  }

  console.log(data);
}

// ─── Instances with defaults ───────────────────────────────────────

const petstore = ty.create({
  prefixUrl: "https://petstore3.swagger.io/api/v3",
});

async function withInstance() {
  const { data } = await petstore.get("/pet/findByStatus", {
    params: { query: { status: "sold" } },
  });
  console.log(data);
}

// ─── Middleware ─────────────────────────────────────────────────────

petstore.use({
  onResponse(response) {
    console.log(`${response.status} ${response.url}`);
  },
});
