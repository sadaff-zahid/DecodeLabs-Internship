// StudyPlanner API - Project 2: Backend API Development
// Plain Express server. Tasks are saved in data/tasks.json (no database yet).

const express = require("express");
const compression = require("compression");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "tasks.json");

function createApp(dataFile, options) {
  options = options || {};
  const rateLimit = options.rateLimit || 100; // requests per minute for each visitor

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // ---------- Load saved tasks ----------
  let tasks = [];
  try {
    tasks = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(tasks)) tasks = [];
  } catch (e) {
    tasks = [];
  }

  function saveTasks() {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(tasks, null, 2));
  }

  // ---------- Helpers ----------
  function sendError(res, status, message, details) {
    const error = { status: status, message: message };
    if (details) error.details = details;
    res.status(status).json({ error: error });
  }

  // The gatekeeper: never trust the client.
  // Step 1 (syntactic): is the data the right type and format?
  // Step 2 (semantic): does the data make sense?
  function validateTask(body) {
    const errors = [];

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { errors: [{ field: "body", message: "Send a JSON object." }] };
    }

    // title (required)
    let title = body.title;
    if (typeof title !== "string") {
      errors.push({ field: "title", message: "Title is required and must be text." });
    } else {
      title = title.trim();
      if (title.length < 3 || title.length > 80) {
        errors.push({ field: "title", message: "Title must be between 3 and 80 characters." });
      }
    }

    // subject (optional)
    let subject = body.subject;
    if (subject === undefined || subject === null) subject = "";
    if (typeof subject !== "string") {
      errors.push({ field: "subject", message: "Subject must be text." });
    } else {
      subject = subject.trim();
      if (subject.length > 30) {
        errors.push({ field: "subject", message: "Subject can be at most 30 characters." });
      }
    }

    // dueDate (optional, format YYYY-MM-DD and a real calendar date)
    let dueDate = body.dueDate;
    if (dueDate === undefined || dueDate === null) dueDate = "";
    if (typeof dueDate !== "string") {
      errors.push({ field: "dueDate", message: "Due date must be text like 2026-12-31." });
    } else if (dueDate !== "") {
      const looksRight = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
      const d = new Date(dueDate + "T00:00:00Z");
      const isRealDate = looksRight && !isNaN(d) && d.toISOString().slice(0, 10) === dueDate;
      if (!isRealDate) {
        errors.push({ field: "dueDate", message: "Due date must be a real date in the format YYYY-MM-DD." });
      }
    }

    // done (optional)
    let done = body.done;
    if (done === undefined) done = false;
    if (typeof done !== "boolean") {
      errors.push({ field: "done", message: "Done must be true or false." });
    }

    return { errors: errors, value: { title: title, subject: subject, dueDate: dueDate, done: done } };
  }

  function findTask(id) {
    return tasks.find(function (t) { return t.id === id; });
  }

  // ---------- Middleware ----------
  app.use(compression());
  app.use(function (req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // CORS: lets a frontend on another website (like GitHub Pages) use this API
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "10kb" }));

  // Simple rate limit: too many requests gives 429
  const hits = new Map();
  app.use("/api", function (req, res, next) {
    const now = Date.now();
    if (hits.size > 1000) hits.clear();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + 60000 };
      hits.set(req.ip, entry);
    }
    entry.count++;
    if (entry.count > rateLimit) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return sendError(res, 429, "Too many requests. Please wait a minute.");
    }
    next();
  });

  // ---------- Routes (resources are nouns, methods are verbs) ----------

  // Check that the server is alive
  app.get("/api/health", function (req, res) {
    res.status(200).json({ data: { status: "ok" } });
  });

  // GET /api/tasks  (optional ?status=pending or ?status=done)
  app.get("/api/tasks", function (req, res) {
    const status = req.query.status;
    if (status !== undefined && status !== "pending" && status !== "done") {
      return sendError(res, 400, "Status must be pending or done.");
    }
    let list = tasks.slice();
    if (status === "pending") list = list.filter(function (t) { return !t.done; });
    if (status === "done") list = list.filter(function (t) { return t.done; });
    list.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    res.status(200).json({ data: list, count: list.length });
  });

  // GET /api/tasks/:id
  app.get("/api/tasks/:id", function (req, res) {
    const task = findTask(req.params.id);
    if (!task) return sendError(res, 404, "Task not found.");
    res.status(200).json({ data: task });
  });

  // POST /api/tasks  (create)
  app.post("/api/tasks", function (req, res) {
    const result = validateTask(req.body);
    if (result.errors.length > 0) {
      return sendError(res, 400, "Please fix the highlighted problems.", result.errors);
    }
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(),
      title: result.value.title,
      subject: result.value.subject,
      dueDate: result.value.dueDate,
      done: result.value.done,
      createdAt: now,
      updatedAt: now
    };
    tasks.push(task);
    saveTasks();
    res.status(201).location("/api/tasks/" + task.id).json({ data: task });
  });

  // PUT /api/tasks/:id  (replace the task's details)
  app.put("/api/tasks/:id", function (req, res) {
    const task = findTask(req.params.id);
    if (!task) return sendError(res, 404, "Task not found.");
    const result = validateTask(req.body);
    if (result.errors.length > 0) {
      return sendError(res, 400, "Please fix the highlighted problems.", result.errors);
    }
    task.title = result.value.title;
    task.subject = result.value.subject;
    task.dueDate = result.value.dueDate;
    task.done = result.value.done;
    task.updatedAt = new Date().toISOString();
    saveTasks();
    res.status(200).json({ data: task });
  });

  // DELETE /api/tasks/:id
  app.delete("/api/tasks/:id", function (req, res) {
    const index = tasks.findIndex(function (t) { return t.id === req.params.id; });
    if (index === -1) return sendError(res, 404, "Task not found.");
    tasks.splice(index, 1);
    saveTasks();
    res.sendStatus(204);
  });

  // Anything else under /api does not exist
  app.use("/api", function (req, res) {
    sendError(res, 404, "Route not found: " + req.method + " " + req.originalUrl);
  });

  // ---------- Frontend (the StudyPlanner page) ----------
  app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

  app.use(function (req, res) {
    sendError(res, 404, "Page not found.");
  });

  // ---------- Error handler (bad JSON, too big, or our own bug) ----------
  app.use(function (err, req, res, next) {
    if (err.type === "entity.parse.failed") {
      return sendError(res, 400, "The request body is not valid JSON.");
    }
    if (err.type === "entity.too.large") {
      return sendError(res, 413, "The request body is too large.");
    }
    console.error(err);
    sendError(res, 500, "Something went wrong on the server.");
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createApp(DATA_FILE).listen(PORT, function () {
    console.log("StudyPlanner is running at http://localhost:" + PORT);
  });
}

module.exports = { createApp: createApp };
