import tf from "ty-fetch";

// ─── Stripe API ──────────────────────────────────────────────────────

async function listCustomers() {
  // Typed response — data, has_more, object, url all autocomplete
  const customers = await tf.get("https://api.stripe.com/v1/customers").json();
  console.log(customers.data, customers.has_more);
}

async function createCustomer() {
  // Typed body — name, email, description etc. autocomplete
  const customer = await tf.post("https://api.stripe.com/v1/customers", {
    body: { name: "Jane Doe", email: "jane@example.com" },
  }).json();
  return customer;
}

// Wrong path → red squiggle: "Did you mean '/v1/customers'?"
async function typoDemo() {
  tf.get("https://api.stripe.com/v1/cutsomers");
}

// ─── Petstore API ────────────────────────────────────────────────────

async function findPets() {
  // Query params typed — status autocomplete
  const pets = await tf.get("https://petstore3.swagger.io/api/v3/pet/findByStatus", {
    params: { query: { status: "available" } },
  }).json();
  return pets;
}

async function getPet() {
  // Path params typed — petId required
  const pet = await tf.get("https://petstore3.swagger.io/api/v3/pet/{petId}", {
    params: { path: { petId: "42" } },
  }).json();
  console.log(pet.name, pet.status);
}

async function updatePet() {
  // Body typed — name, photoUrls required; status is enum
  const updated = await tf.put("https://petstore3.swagger.io/api/v3/pet", {
    body: {
      id: 1,
      name: "doggie",
      photoUrls: ["https://example.com/dog.jpg"],
      status: "available",
    },
  }).json();
  return updated;
}

// Wrong path → red squiggle: "Did you mean '/pet'?"
async function petTypoDemo() {
  tf.get("https://petstore3.swagger.io/api/v3/pets");
}

// ─── GitHub API ──────────────────────────────────────────────────────

async function getRepo() {
  // Path params for owner/repo — typed response with full_name, stargazers_count etc.
  const repo = await tf.get("https://api.github.com/repos/{owner}/{repo}", {
    params: { path: { owner: "anthropics", repo: "claude-code" } },
  }).json();
  console.log(repo.full_name, repo.stargazers_count, repo.language);
  return repo;
}

// ─── Multiple response formats ──────────────────────────────────────

async function responseFormats() {
  // .json() → typed object
  const data = await tf.get("https://api.stripe.com/v1/customers").json();

  // .text() → string
  const raw = await tf.get("https://api.stripe.com/v1/customers").text();

  // await directly → typed (same as .json())
  const direct = await tf.get("https://api.stripe.com/v1/customers");
}
