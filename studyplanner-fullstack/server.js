// StudyPlanner API - Project 4: Frontend and Backend Integration (database from Project 3)
// Express server + PostgreSQL. Every query uses placeholders ($1, $2...) so user input
// is treated as data and can never run as SQL (this stops SQL injection).

const express = require("express");
const compression = require("compression");
const path = require("path");
const crypto = require("crypto");
const { createPool, initSchema } = require("./db");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One task row joined with its subject name, shaped the way the API returns it
const SELECT_TASK =
  "SELECT t.id, t.title, s.name AS subject, t.due_date AS \"dueDate\", t.done, " +
  "t.created_at AS \"createdAt\", t.updated_at AS \"updatedAt\" " +
  "FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id";

// Makes sure a task's due date is always plain text like "2026-12-31"
function formatTask(row) {
  if (row && row.dueDate instanceof Date) {
    row.dueDate = row.dueDate.toISOString().slice(0, 10);
  }
  return row;
}

function createApp(pool, options) {
  options = options || {};
  const rateLimit = options.rateLimit || 100; // requests per minute for each visitor

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // ---------- Helpers ----------
  function sendError(res, status, message, details) {
    const error = { status: status, message: message };
    if (details) error.details = details;
    res.status(status).json({ error: error });
  }

  // Express 4 does not catch errors from async routes, so we pass them on ourselves
  function wrap(handler) {
    return function (req, res, next) {
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  }

  // The gatekeeper: never trust the client. This checks the format and the logic.
  // partial = true is for PATCH, where only the fields that were sent are checked.
  function validateTask(body, partial) {
    const errors = [];
    const value = {};

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { errors: [{ field: "body", message: "Send a JSON object." }], value: value };
    }

    // title
    if (!partial || body.title !== undefined) {
      if (typeof body.title !== "string") {
        errors.push({ field: "title", message: "Title is required and must be text." });
      } else {
        const title = body.title.trim();
        if (title.length < 3 || title.length > 80) {
          errors.push({ field: "title", message: "Title must be between 3 and 80 characters." });
        } else {
          value.title = title;
        }
      }
    }

    // subject (optional, empty means no subject)
    if (!partial || body.subject !== undefined) {
      const s = body.subject;
      if (s === undefined || s === null || s === "") {
        value.subject = null;
      } else if (typeof s !== "string") {
        errors.push({ field: "subject", message: "Subject must be text." });
      } else if (s.trim().length > 30) {
        errors.push({ field: "subject", message: "Subject can be at most 30 characters." });
      } else {
        value.subject = s.trim() || null;
      }
    }

    // dueDate (optional, format YYYY-MM-DD and a real calendar date)
    if (!partial || body.dueDate !== undefined) {
      const d = body.dueDate;
      if (d === undefined || d === null || d === "") {
        value.dueDate = null;
      } else if (typeof d !== "string") {
        errors.push({ field: "dueDate", message: "Due date must be text like 2026-12-31." });
      } else {
        const looksRight = /^\d{4}-\d{2}-\d{2}$/.test(d);
        const parsed = new Date(d + "T00:00:00Z");
        const isRealDate = looksRight && !isNaN(parsed) && parsed.toISOString().slice(0, 10) === d;
        if (isRealDate) {
          value.dueDate = d;
        } else {
          errors.push({ field: "dueDate", message: "Due date must be a real date in the format YYYY-MM-DD." });
        }
      }
    }

    // done
    if (body.done !== undefined) {
      if (typeof body.done !== "boolean") {
        errors.push({ field: "done", message: "Done must be true or false." });
      } else {
        value.done = body.done;
      }
    } else if (!partial) {
      value.done = false;
    }

    if (partial && errors.length === 0 && Object.keys(value).length === 0) {
      errors.push({ field: "body", message: "Send at least one field to update (title, subject, dueDate or done)." });
    }

    return { errors: errors, value: value };
  }

  // ---------- Database helpers ----------

  // Runs several queries as one unit: either all of them work or none of them.
  async function inTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // Gives the id of a subject, creating the subject first if it is new.
  async function findOrCreateSubject(db, name) {
    const find = "SELECT id FROM subjects WHERE lower(name) = lower($1)";
    const found = await db.query(find, [name]);
    if (found.rows.length > 0) return found.rows[0].id;

    await db.query("INSERT INTO subjects (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [crypto.randomUUID(), name]);
    const again = await db.query(find, [name]);
    return again.rows[0].id;
  }

  async function getTask(id) {
    const result = await pool.query(SELECT_TASK + " WHERE t.id = $1", [id]);
    return formatTask(result.rows[0]);
  }

  // Updates only the fields that are in "value". Returns false if the task does not exist.
  async function updateTask(id, value) {
    return inTransaction(async function (client) {
      const sets = [];
      const params = [];

      if ("title" in value) {
        params.push(value.title);
        sets.push("title = $" + params.length);
      }
      if ("subject" in value) {
        params.push(value.subject ? await findOrCreateSubject(client, value.subject) : null);
        sets.push("subject_id = $" + params.length);
      }
      if ("dueDate" in value) {
        params.push(value.dueDate);
        sets.push("due_date = $" + params.length);
      }
      if ("done" in value) {
        params.push(value.done);
        sets.push("done = $" + params.length);
      }
      sets.push("updated_at = now()");

      params.push(id);
      const result = await client.query(
        "UPDATE tasks SET " + sets.join(", ") + " WHERE id = $" + params.length + " RETURNING id",
        params
      );
      return result.rows.length > 0;
    });
  }

  // ---------- Middleware ----------
  app.use(compression());
  app.use(function (req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // CORS: lets a frontend on another website (like GitHub Pages) use this API
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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
  // CREATE = POST = INSERT, READ = GET = SELECT, UPDATE = PUT/PATCH = UPDATE, DELETE = DELETE = DELETE

  // Checks the server and the database are alive
  app.get("/api/health", wrap(async function (req, res) {
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      return sendError(res, 503, "The database is not reachable.");
    }
    res.status(200).json({ data: { status: "ok", database: "connected" } });
  }));

  // GET /api/subjects  (each subject with how many tasks it has)
  app.get("/api/subjects", wrap(async function (req, res) {
    const result = await pool.query(
      "SELECT s.id, s.name, COUNT(t.id)::int AS \"taskCount\" " +
      "FROM subjects s LEFT JOIN tasks t ON t.subject_id = s.id " +
      "GROUP BY s.id, s.name ORDER BY s.name"
    );
    res.status(200).json({ data: result.rows, count: result.rows.length });
  }));

  // GET /api/stats  (how many tasks there are in total, done, and still pending)
  app.get("/api/stats", wrap(async function (req, res) {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS total, COALESCE(SUM(CASE WHEN done THEN 1 ELSE 0 END), 0)::int AS done FROM tasks"
    );
    const total = result.rows[0].total;
    const done = result.rows[0].done;
    res.status(200).json({ data: { total: total, done: done, pending: total - done } });
  }));

  // GET /api/tasks  (optional ?status=pending|done and ?subject=Maths)
  app.get("/api/tasks", wrap(async function (req, res) {
    const status = req.query.status;
    const subject = req.query.subject;

    if (status !== undefined && status !== "pending" && status !== "done") {
      return sendError(res, 400, "Status must be pending or done.");
    }
    if (subject !== undefined && (typeof subject !== "string" || subject.length > 30)) {
      return sendError(res, 400, "Subject must be text of at most 30 characters.");
    }

    const conditions = [];
    const params = [];
    if (status !== undefined) {
      params.push(status === "done");
      conditions.push("t.done = $" + params.length);
    }
    if (subject !== undefined) {
      params.push(subject);
      conditions.push("lower(s.name) = lower($" + params.length + ")");
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";

    const result = await pool.query(SELECT_TASK + where + " ORDER BY t.created_at DESC", params);
    res.status(200).json({ data: result.rows.map(formatTask), count: result.rows.length });
  }));

  // GET /api/tasks/:id
  app.get("/api/tasks/:id", wrap(async function (req, res) {
    if (!UUID_PATTERN.test(req.params.id)) return sendError(res, 404, "Task not found.");
    const task = await getTask(req.params.id);
    if (!task) return sendError(res, 404, "Task not found.");
    res.status(200).json({ data: task });
  }));

  // POST /api/tasks  (create)
  app.post("/api/tasks", wrap(async function (req, res) {
    const result = validateTask(req.body, false);
    if (result.errors.length > 0) {
      return sendError(res, 400, "Please fix the highlighted problems.", result.errors);
    }
    const v = result.value;
    const id = crypto.randomUUID();

    await inTransaction(async function (client) {
      const subjectId = v.subject ? await findOrCreateSubject(client, v.subject) : null;
      await client.query(
        "INSERT INTO tasks (id, title, subject_id, due_date, done) VALUES ($1, $2, $3, $4, $5)",
        [id, v.title, subjectId, v.dueDate, v.done]
      );
    });

    res.status(201).location("/api/tasks/" + id).json({ data: await getTask(id) });
  }));

  // PUT /api/tasks/:id  (replace all the task's details)
  app.put("/api/tasks/:id", wrap(async function (req, res) {
    if (!UUID_PATTERN.test(req.params.id)) return sendError(res, 404, "Task not found.");
    const result = validateTask(req.body, false);
    if (result.errors.length > 0) {
      return sendError(res, 400, "Please fix the highlighted problems.", result.errors);
    }
    const found = await updateTask(req.params.id, result.value);
    if (!found) return sendError(res, 404, "Task not found.");
    res.status(200).json({ data: await getTask(req.params.id) });
  }));

  // PATCH /api/tasks/:id  (change only the fields you send)
  app.patch("/api/tasks/:id", wrap(async function (req, res) {
    if (!UUID_PATTERN.test(req.params.id)) return sendError(res, 404, "Task not found.");
    const result = validateTask(req.body, true);
    if (result.errors.length > 0) {
      return sendError(res, 400, "Please fix the highlighted problems.", result.errors);
    }
    const found = await updateTask(req.params.id, result.value);
    if (!found) return sendError(res, 404, "Task not found.");
    res.status(200).json({ data: await getTask(req.params.id) });
  }));

  // DELETE /api/tasks/:id
  app.delete("/api/tasks/:id", wrap(async function (req, res) {
    if (!UUID_PATTERN.test(req.params.id)) return sendError(res, 404, "Task not found.");
    const result = await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return sendError(res, 404, "Task not found.");
    res.sendStatus(204);
  }));

  // Anything else under /api does not exist
  app.use("/api", function (req, res) {
    sendError(res, 404, "Route not found: " + req.method + " " + req.originalUrl);
  });

  // ---------- Frontend (the StudyPlanner page) ----------
  app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

  app.use(function (req, res) {
    sendError(res, 404, "Page not found.");
  });

  // ---------- Error handler (bad JSON, database problems, or our own bug) ----------
  app.use(function (err, req, res, next) {
    if (err.type === "entity.parse.failed") {
      return sendError(res, 400, "The request body is not valid JSON.");
    }
    if (err.type === "entity.too.large") {
      return sendError(res, 413, "The request body is too large.");
    }

    // PostgreSQL error codes tell us what went wrong
    if (err.code === "23505") {
      return sendError(res, 409, "That value already exists.");
    }
    if (["23502", "23503", "23514", "22001", "22007", "22008", "22P02"].indexOf(err.code) !== -1) {
      return sendError(res, 400, "The database rejected this data.");
    }
    const connectionCodes = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P01", "57P03", "08000", "08001", "08006"];
    if (connectionCodes.indexOf(err.code) !== -1 || /Connection terminated|timeout/i.test(err.message || "")) {
      console.error("Database unavailable:", err.message);
      return sendError(res, 503, "The database is not reachable. Please try again.");
    }

    console.error(err);
    sendError(res, 500, "Something went wrong on the server.");
  });

  return app;
}

if (require.main === module) {
  require("dotenv").config();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Copy .env.example to .env and add your database address.");
    process.exit(1);
  }

  const pool = createPool(process.env.DATABASE_URL);
  const PORT = process.env.PORT || 3000;

  initSchema(pool)
    .then(function () {
      createApp(pool).listen(PORT, function () {
        console.log("StudyPlanner is running at http://localhost:" + PORT);
      });
    })
    .catch(function (err) {
      console.error("Could not connect to the database:", err.message);
      process.exit(1);
    });
}

module.exports = { createApp: createApp };
