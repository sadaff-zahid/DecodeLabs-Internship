// Tests the real web page (public/script.js) working together with the real API.
// This is the "frontend and backend integration" test. Run with: npm test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createApp } = require("./server");
const { makeTestPool } = require("./memory-db");

function readPublic(name) {
  return fs.readFileSync(path.join(__dirname, "public", name), "utf8");
}

// Polls until the page shows what we expect (the page updates after async requests)
async function waitFor(check, message) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  assert.fail("Timed out waiting for: " + message);
}

async function openPage(t) {
  const pool = await makeTestPool();
  const server = createApp(pool).listen(0);
  const base = "http://localhost:" + server.address().port;

  const html = readPublic("index.html").replace(/<script[^>]*><\/script>/, "").replace(/<link[^>]*>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: base + "/" });
  const w = dom.window;

  // The page uses fetch(), so we connect it to the real server
  const realFetch = function (url, options) {
    return fetch(new URL(url, base), Object.assign({}, options, { signal: undefined }));
  };
  w.fetch = realFetch;

  t.after(async function () { w.close(); server.close(); await pool.end(); });

  w.eval(readPublic("script.js"));
  const $ = function (selector) { return w.document.querySelector(selector); };
  const $$ = function (selector) { return w.document.querySelectorAll(selector); };
  return { w: w, $: $, $$: $$, realFetch: realFetch };
}

function submitForm(page, title, subject, date) {
  page.$("#task-title").value = title;
  page.$("#task-subject").value = subject || "";
  page.$("#task-date").value = date || "";
  page.$("#task-form").dispatchEvent(new page.w.Event("submit", { cancelable: true }));
}

test("The page and the API work together", async function (t) {
  const page = await openPage(t);
  const { $, $$ } = page;

  await t.test("it loads the data from the server and shows the empty state", async function () {
    await waitFor(function () { return !$("#empty-message").hidden; }, "empty message");
    assert.strictEqual($("#progress-text").textContent, "No tasks yet.");
    assert.ok($("#error-panel").hidden);
    assert.ok($("#spinner").hidden);
  });

  await t.test("the server's validation message appears in the form", async function () {
    submitForm(page, "ab");
    await waitFor(function () { return /3 and 80/.test($("#form-error").textContent); }, "validation message");
    assert.strictEqual($$(".task").length, 0);
    assert.strictEqual($("#add-button").disabled, false);
  });

  await t.test("adding a task sends a POST and shows the new data", async function () {
    submitForm(page, "Revise chapter 3", "Maths", "2026-12-31");
    await waitFor(function () { return $$(".task").length === 1; }, "new task card");
    assert.match($(".task-title").textContent, /Revise chapter 3/);
    assert.match($(".task-info").textContent, /Maths/);
    assert.match($("#toast").textContent, /Task added/);
    assert.strictEqual($("#form-error").textContent, "");
    assert.strictEqual($$("#subject-list option").length, 1);
    assert.strictEqual($("#stat-total").textContent, "1");
    assert.strictEqual($("#progress-text").textContent, "0 of 1 tasks done");
  });

  await t.test("Done sends a PATCH and the totals update", async function () {
    $$(".task-buttons .small-btn")[0].click();
    await waitFor(function () { return $$(".task.done").length === 1; }, "done task");
    assert.strictEqual($("#progress-text").textContent, "1 of 1 tasks done");
    assert.strictEqual($("#stat-done").textContent, "1");
  });

  await t.test("the filter asks the server for pending or done tasks", async function () {
    $$(".filter-btn")[1].click();   // Pending
    await waitFor(function () { return $$(".task").length === 0 && !$("#empty-message").hidden; }, "no pending tasks");
    $$(".filter-btn")[2].click();   // Done
    await waitFor(function () { return $$(".task").length === 1; }, "one done task");
    $$(".filter-btn")[0].click();   // All
    await waitFor(function () { return $$(".task").length === 1; }, "all tasks");
  });

  await t.test("user text is shown as text, not as HTML (XSS safety)", async function () {
    submitForm(page, "<img src=x onerror=alert(1)>");
    await waitFor(function () { return $$(".task").length === 2; }, "second task");
    assert.strictEqual($("img"), null);
    const titles = Array.from($$(".task-title")).map(function (p) { return p.textContent; });
    assert.ok(titles.indexOf("<img src=x onerror=alert(1)>") !== -1);
  });

  await t.test("a network failure shows the fallback screen, and Try again recovers", async function () {
    page.w.fetch = function () { return Promise.reject(new TypeError("Failed to fetch")); };
    $$(".filter-btn")[0].click();
    await waitFor(function () { return !$("#error-panel").hidden; }, "error panel");
    assert.match($("#error-message").textContent, /Could not reach the server/);
    assert.ok($("#spinner").hidden);   // the finally block stopped the spinner

    page.w.fetch = page.realFetch;
    $("#retry-button").click();
    await waitFor(function () { return $("#error-panel").hidden && $$(".task").length === 2; }, "recovery");
  });

  await t.test("a 503 from the server becomes a friendly message", async function () {
    page.w.fetch = function () {
      return Promise.resolve(new Response(JSON.stringify({ error: { status: 503, message: "x" } }), { status: 503 }));
    };
    $$(".filter-btn")[0].click();
    await waitFor(function () { return !$("#error-panel").hidden; }, "error panel for 503");
    assert.match($("#error-message").textContent, /database is not reachable/i);
    page.w.fetch = page.realFetch;
    $("#retry-button").click();
    await waitFor(function () { return $("#error-panel").hidden; }, "recovery after 503");
  });

  await t.test("deleting sends a DELETE and removes the card", async function () {
    $$(".task-buttons .small-btn")[1].click();
    await waitFor(function () { return $$(".task").length === 1; }, "task removed");
    assert.match($("#toast").textContent, /Task deleted/);
  });
});
