// Tests for the StudyPlanner API and database. Run with: npm test
//
// By default the tests use a small in-memory PostgreSQL copy (pg-mem), so you do not need
// a real database. To test on a real PostgreSQL, set TEST_DATABASE_URL to an EMPTY test
// database. Never use your real database for this, because the tests clear its tables.

const test = require("node:test");
const assert = require("node:assert");
const { createApp } = require("./server");
const { createPool, initSchema } = require("./db");

async function makePool() {
  let pool;
  if (process.env.TEST_DATABASE_URL) {
    pool = createPool(process.env.TEST_DATABASE_URL);
    await initSchema(pool);
    await pool.query("TRUNCATE tasks, subjects");
  } else {
    const { newDb, DataType } = require("pg-mem");
    const memory = newDb();
    // pg-mem does not know char_length yet, so we teach it (real PostgreSQL has it built in)
    memory.public.registerFunction({
      name: "char_length",
      args: [DataType.text],
      returns: DataType.integer,
      implementation: function (text) { return text.length; }
    });
    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    await initSchema(pool);
  }
  return pool;
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, function () {
      resolve({ server: server, base: "http://localhost:" + server.address().port });
    });
  });
}

async function startServer(options) {
  const pool = await makePool();
  const s = await listen(createApp(pool, options));
  return { pool: pool, server: s.server, base: s.base };
}

function send(base, method, url, body, rawBody) {
  const options = { method: method, headers: {} };
  if (body !== undefined || rawBody !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = rawBody !== undefined ? rawBody : JSON.stringify(body);
  }
  return fetch(base + url, options);
}

test("StudyPlanner API with a database", async function (t) {
  const s = await startServer();
  t.after(async function () { s.server.close(); await s.pool.end(); });
  const base = s.base;
  let id1, id2;

  await t.test("GET /api/health checks the database (200)", async function () {
    const res = await send(base, "GET", "/api/health");
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data.database, "connected");
  });

  await t.test("POST /api/tasks creates a task and a new subject (201)", async function () {
    const res = await send(base, "POST", "/api/tasks", { title: "Revise chapter 3", subject: "Maths", dueDate: "2026-12-31" });
    assert.strictEqual(res.status, 201);
    assert.ok(res.headers.get("location").startsWith("/api/tasks/"));
    const task = (await res.json()).data;
    assert.strictEqual(task.title, "Revise chapter 3");
    assert.strictEqual(task.subject, "Maths");
    assert.strictEqual(task.dueDate, "2026-12-31");
    assert.strictEqual(task.done, false);
    id1 = task.id;
  });

  await t.test("The same subject in another letter case is reused (one-to-many)", async function () {
    const res = await send(base, "POST", "/api/tasks", { title: "Practice algebra", subject: "maths" });
    assert.strictEqual(res.status, 201);
    id2 = (await res.json()).data.id;
    const subjects = await (await send(base, "GET", "/api/subjects")).json();
    assert.strictEqual(subjects.count, 1);
    assert.strictEqual(subjects.data[0].name, "Maths");
    assert.strictEqual(subjects.data[0].taskCount, 2);
  });

  await t.test("Bad data is rejected (400)", async function () {
    const bad = [
      { title: "ab" },
      { subject: "Maths" },
      { title: "Read notes", dueDate: "2026-02-30" },
      { title: "Read notes", subject: "x".repeat(31) },
      { title: "Read notes", done: "yes" }
    ];
    for (const body of bad) {
      const res = await send(base, "POST", "/api/tasks", body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
    }
    const broken = await send(base, "POST", "/api/tasks", undefined, "{ not json");
    assert.strictEqual(broken.status, 400);
  });

  await t.test("GET /api/tasks lists and filters tasks (200)", async function () {
    await send(base, "PATCH", "/api/tasks/" + id1, { done: true });
    const all = await (await send(base, "GET", "/api/tasks")).json();
    assert.strictEqual(all.count, 2);
    const done = await (await send(base, "GET", "/api/tasks?status=done")).json();
    assert.strictEqual(done.count, 1);
    const pending = await (await send(base, "GET", "/api/tasks?status=pending")).json();
    assert.strictEqual(pending.count, 1);
    const subject = await (await send(base, "GET", "/api/tasks?subject=MATHS")).json();
    assert.strictEqual(subject.count, 2);
    assert.strictEqual((await send(base, "GET", "/api/tasks?status=wrong")).status, 400);
  });

  await t.test("GET one task (200), missing task and bad id (404)", async function () {
    assert.strictEqual((await send(base, "GET", "/api/tasks/" + id1)).status, 200);
    assert.strictEqual((await send(base, "GET", "/api/tasks/3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e11")).status, 404);
    assert.strictEqual((await send(base, "GET", "/api/tasks/nope")).status, 404);
  });

  await t.test("PUT replaces a task (200), missing fields (400), missing task (404)", async function () {
    const res = await send(base, "PUT", "/api/tasks/" + id2, { title: "Practice geometry", subject: "Science", dueDate: "2027-01-15", done: true });
    assert.strictEqual(res.status, 200);
    const task = (await res.json()).data;
    assert.strictEqual(task.title, "Practice geometry");
    assert.strictEqual(task.subject, "Science");
    assert.strictEqual(task.done, true);
    assert.strictEqual((await send(base, "PUT", "/api/tasks/" + id2, { subject: "Maths" })).status, 400);
    assert.strictEqual((await send(base, "PUT", "/api/tasks/3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e11", { title: "Something" })).status, 404);
  });

  await t.test("PATCH changes only the fields you send", async function () {
    const res = await send(base, "PATCH", "/api/tasks/" + id1, { done: false });
    assert.strictEqual(res.status, 200);
    const task = (await res.json()).data;
    assert.strictEqual(task.done, false);
    assert.strictEqual(task.title, "Revise chapter 3");
    assert.strictEqual(task.subject, "Maths");
    const cleared = await (await send(base, "PATCH", "/api/tasks/" + id1, { subject: "", dueDate: "" })).json();
    assert.strictEqual(cleared.data.subject, null);
    assert.strictEqual(cleared.data.dueDate, null);
    assert.strictEqual((await send(base, "PATCH", "/api/tasks/" + id1, {})).status, 400);
    assert.strictEqual((await send(base, "PATCH", "/api/tasks/3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e11", { done: true })).status, 404);
  });

  await t.test("SQL injection is treated as plain text", async function () {
    const evil = "'); DROP TABLE tasks; --";
    const res = await send(base, "POST", "/api/tasks", { title: evil });
    assert.strictEqual(res.status, 201);
    const list = await (await send(base, "GET", "/api/tasks")).json();
    assert.ok(list.data.some(function (task) { return task.title === evil; }));
    const probe = await (await send(base, "GET", "/api/tasks?subject=" + encodeURIComponent("' OR 1=1 --"))).json();
    assert.strictEqual(probe.count, 0);
  });

  await t.test("The database enforces its own rules", async function () {
    // PostgreSQL gives an error code. The in-memory copy only gives a message, so we accept either.
    function breaks(code, words) {
      return function (err) { return err.code === code || words.test(err.message); };
    }
    await assert.rejects(s.pool.query("INSERT INTO tasks (id, title) VALUES ('3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e12', 'ab')"), breaks("23514", /check/i));
    await assert.rejects(s.pool.query("INSERT INTO tasks (id, title) VALUES ('3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e13', NULL)"), breaks("23502", /null/i));
    await assert.rejects(s.pool.query("INSERT INTO subjects (id, name) VALUES ('3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e14', 'SCIENCE')"), breaks("23505", /unique|duplicate/i));
    await assert.rejects(s.pool.query("INSERT INTO tasks (id, title, subject_id) VALUES ('3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e15', 'Valid title', '3b1f0c52-6f0a-4a5e-9f55-2f0d8c0a7e99')"), breaks("23503", /foreign|reference|violates/i));
  });

  await t.test("Data survives a restart (a new app on the same database)", async function () {
    const second = await listen(createApp(s.pool));
    const list = await (await send(second.base, "GET", "/api/tasks")).json();
    second.server.close();
    assert.ok(list.count >= 3);
  });

  await t.test("DELETE removes a task (204), then it is gone (404)", async function () {
    assert.strictEqual((await send(base, "DELETE", "/api/tasks/" + id1)).status, 204);
    assert.strictEqual((await send(base, "GET", "/api/tasks/" + id1)).status, 404);
    assert.strictEqual((await send(base, "DELETE", "/api/tasks/" + id1)).status, 404);
  });

  await t.test("Unknown API route gives 404", async function () {
    assert.strictEqual((await send(base, "GET", "/api/getUsers")).status, 404);
  });
});

test("Too many requests gives 429", async function (t) {
  const s = await startServer({ rateLimit: 3 });
  t.after(async function () { s.server.close(); await s.pool.end(); });
  let last;
  for (let i = 0; i < 4; i++) {
    last = await send(s.base, "GET", "/api/health");
  }
  assert.strictEqual(last.status, 429);
});
