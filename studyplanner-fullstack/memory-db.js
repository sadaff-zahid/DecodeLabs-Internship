// Helper for the tests: gives every test its own database.
// By default it is a small in-memory PostgreSQL copy (pg-mem), so no setup is needed.
// To test on a real PostgreSQL, set TEST_DATABASE_URL to an EMPTY test database.
// Never use your real database for this, because the tests clear its tables.

const { createPool, initSchema } = require("./db");

async function makeTestPool() {
  if (process.env.TEST_DATABASE_URL) {
    const pool = createPool(process.env.TEST_DATABASE_URL);
    await initSchema(pool);
    await pool.query("TRUNCATE tasks, subjects");
    return pool;
  }

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
  const pool = new Pool();
  await initSchema(pool);
  return pool;
}

module.exports = { makeTestPool: makeTestPool };
