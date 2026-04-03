import ty from "ty-fetch";

// ─── Basic GET ──────────────────────────────────────────────────────
// Response is auto-parsed — { data, error, response }

async function getUsers() {
  const { data, error } = await ty.get("https://jsonplaceholder.typicode.com/users");

  if (error) {
    console.error("Failed:", error);
    return;
  }

  console.log(data); // typed from spec (when plugin is active)
}

// ─── POST with body ─────────────────────────────────────────────────

async function createPost() {
  const { data, error } = await ty.post("https://jsonplaceholder.typicode.com/posts", {
    body: {
      title: "Hello from ty-fetch",
      body: "This is a typed API call with zero codegen.",
      userId: 1,
    },
  });

  if (error) return console.error(error);
  console.log("Created:", data);
}

// ─── Path params ────────────────────────────────────────────────────

async function getPost() {
  const { data } = await ty.get("https://jsonplaceholder.typicode.com/posts/{id}", {
    params: { path: { id: "1" } },
  });
  console.log(data);
}

// ─── Query params ───────────────────────────────────────────────────

async function getUserPosts() {
  const { data } = await ty.get("https://jsonplaceholder.typicode.com/posts", {
    params: { query: { userId: 1 } },
  });
  console.log(`User has ${data?.length} posts`);
}

// ─── Error handling ─────────────────────────────────────────────────

async function handleErrors() {
  const { data, error, response } = await ty.get("https://jsonplaceholder.typicode.com/posts/99999");

  if (error) {
    console.log(`Error ${response.status}:`, error);
    return;
  }

  console.log(data);
}

// ─── Create instances with defaults ─────────────────────────────────

const api = ty.create({
  prefixUrl: "https://jsonplaceholder.typicode.com",
});

async function withInstance() {
  const { data } = await api.get("/users");
  console.log(data);
}

// ─── Middleware ──────────────────────────────────────────────────────

const authedApi = ty.create({
  prefixUrl: "https://jsonplaceholder.typicode.com",
});

authedApi.use({
  onRequest(request) {
    request.headers.set("Authorization", "Bearer my-token");
    return request;
  },
});

authedApi.use({
  onResponse(response) {
    console.log(`${response.status} ${response.url}`);
    return response;
  },
});

// ─── Run examples ───────────────────────────────────────────────────

async function main() {
  await getUsers();
  await createPost();
  await getPost();
  await getUserPosts();
  await handleErrors();
  await withInstance();
}

main();
