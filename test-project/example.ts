import tf from "typed-fetch";

async function getStripeCustomers() {
  // Wrong path → red squiggle
  tf.get("https://api.stripe.com/v1/cutsomers");

  // Correct path → typed .json()
  const data = await tf.get("https://api.stripe.com/v1/customers").json();
  console.log(data.data, data.has_more, data.object, data.url);
}

async function getPets() {
  // Wrong path → red squiggle
  tf.get("https://petstore3.swagger.io/api/v3/pets");

  // Correct path → typed
  const pets = await tf.get("https://petstore3.swagger.io/api/v3/pet/findByStatus").json();

  // PUT with typed request body
  const updated = await tf.put("https://petstore3.swagger.io/api/v3/pet", {
    json: { id: 1, name: "doggie", photoUrls: ["http://example.com/dog.jpg"], status: "available" },
  }).json();

  return pets;
}

async function getGitHubRepo() {
  const repo = await tf.get("https://api.github.com/repos/anthropics/claude-code").json();
  console.log(repo.full_name);
  return repo;
}

async function createCustomer() {
  const customer = await tf.post("https://api.stripe.com/v1/customers", {
    json: { name: "John Doe", email: "john@example.com" },
  }).json();
  return customer;
}

// Custom instance with base URL
const stripe = tf.create({ prefixUrl: "https://api.stripe.com" });
