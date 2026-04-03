import { typedFetch } from "typed-fetch";

async function getStripeCustomers() {
  // Wrong path → red squiggle with "Did you mean '/v1/customers'?"
  const bad = fetch("https://api.stripe.com/v1/cutsomers");

  // Correct path → typed response
  const data = await typedFetch("https://api.stripe.com/v1/customers");
  console.log(data.data, data.has_more, data.object, data.url);
}

async function getPets() {
  // Wrong path → red squiggle
  const bad = fetch("https://petstore3.swagger.io/api/v3/pets");

  // Correct path → typed response
  const pets = await typedFetch("https://petstore3.swagger.io/api/v3/pet/findByStatus");
  return pets;
}

async function testUnknownApi() {
  // No spec → Promise<unknown>, no extra errors
  const data = await typedFetch("https://some-random-api.example.com/v1/data");
  return data;
}



async function blah() {
  const kaljd = await typedFetch('https://httpbin.org/ip')
  


}