// Tests for the StudyPlanner API. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("./server");

function startServer(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studyplanner-"));
  const app = createApp(path.join(dir, "tasks.json"), options);
  return new Promise(function (resolve) {
    const server = app.listen(0, function () {
      resolve({ server: server, base: "http://localhost:" + server.address().port });
    });
  });
}

function send(base, method, url, body, rawBody) {
  const options = { method: method, headers: {} };
  if (body !== undefined || rawBody !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = rawBody !== undefined ? rawBody : JSON.stringify(body);
  }
  return fetch(base + url, options);
}

test("StudyPlanner API", async function (t) {
  const s = await startServer();
  t.after(function () { s.server.close(); });
  let id;

  await t.test("GET /api/health returns 200", async function () {
    const res = await send(s.base, "GET", "/api/health");
    assert.strictEqual(res.status, 200);
  });

  await t.test("POST /api/tasks creates a task (201)", async function () {
    const res = await send(s.base, "POST", "/api/tasks", { title: "Revise maths", subject: "Maths", dueDate: "2026-12-31" });
    assert.strictEqual(res.status, 201);
    assert.ok(res.headers.get("location").startsWith("/api/tasks/"));
    const body = await res.json();
    assert.strictEqual(body.data.title, "Revise maths");
    assert.strictEqual(body.data.done, false);
    id = body.data.id;
  });

  await t.test("POST with a short title is rejected (400)", async function () {
    const res = await send(s.base, "POST", "/api/tasks", { title: "ab" });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error.details[0].field, "title");
  });

  await t.test("POST with a missing title is rejected (400)", async function () {
    const res = await send(s.base, "POST", "/api/tasks", { subject: "Maths" });
    assert.strictEqual(res.status, 400);
  });

  await t.test("POST with an impossible date is rejected (400)", async function () {
    const res = await send(s.base, "POST", "/api/tasks", { title: "Read notes", dueDate: "2026-02-30" });
    assert.strictEqual(res.status, 400);
  });

  await t.test("POST with broken JSON is rejected (400)", async function () {
    const res = await send(s.base, "POST", "/api/tasks", undefined, "{ not json");
    assert.strictEqual(res.status, 400);
  });

  await t.test("GET /api/tasks lists tasks (200)", async function () {
    const res = await send(s.base, "GET", "/api/tasks");
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.count, 1);
  });

  await t.test("GET /api/tasks?status=wrong is rejected (400)", async function () {
    const res = await send(s.base, "GET", "/api/tasks?status=wrong");
    assert.strictEqual(res.status, 400);
  });

  await t.test("GET one task (200) and a missing task (404)", async function () {
    assert.strictEqual((await send(s.base, "GET", "/api/tasks/" + id)).status, 200);
    assert.strictEqual((await send(s.base, "GET", "/api/tasks/nope")).status, 404);
  });

  await t.test("PUT updates a task (200)", async function () {
    const res = await send(s.base, "PUT", "/api/tasks/" + id, { title: "Revise maths", done: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data.done, true);
    const pending = await (await send(s.base, "GET", "/api/tasks?status=pending")).json();
    assert.strictEqual(pending.count, 0);
  });

  await t.test("PUT on a missing task gives 404", async function () {
    const res = await send(s.base, "PUT", "/api/tasks/nope", { title: "Something" });
    assert.strictEqual(res.status, 404);
  });

  await t.test("DELETE removes a task (204), then it is gone (404)", async function () {
    assert.strictEqual((await send(s.base, "DELETE", "/api/tasks/" + id)).status, 204);
    assert.strictEqual((await send(s.base, "GET", "/api/tasks/" + id)).status, 404);
    assert.strictEqual((await send(s.base, "DELETE", "/api/tasks/" + id)).status, 404);
  });

  await t.test("Unknown API route gives 404", async function () {
    const res = await send(s.base, "GET", "/api/getUsers");
    assert.strictEqual(res.status, 404);
  });
});

test("Too many requests gives 429", async function (t) {
  const s = await startServer({ rateLimit: 3 });
  t.after(function () { s.server.close(); });
  let last;
  for (let i = 0; i < 4; i++) {
    last = await send(s.base, "GET", "/api/health");
  }
  assert.strictEqual(last.status, 429);
});
