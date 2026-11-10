// Database connection and setup (PostgreSQL, using the native "pg" driver)

const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// By default "pg" turns a DATE into a JavaScript Date, which can shift by a day in some
// time zones. We keep it as plain text like "2026-12-31" instead.
types.setTypeParser(1082, function (value) { return value; });

// Makes a pool: a small set of connections that the app reuses.
function createPool(connectionString) {
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(connectionString);
  const pool = new Pool({
    connectionString: connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },   // cloud databases need SSL
    max: 5
  });
  // An idle connection can drop. Log it instead of crashing the whole server.
  pool.on("error", function (err) {
    console.error("Database connection problem:", err.message);
  });
  return pool;
}

// Creates the tables from schema.sql if they do not exist yet.
async function initSchema(pool) {
  const text = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const withoutComments = text.replace(/--.*$/gm, "");
  const statements = withoutComments.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
}

module.exports = { createPool: createPool, initSchema: initSchema };
