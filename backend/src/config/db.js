const { Pool } = require("pg");
require("dotenv").config();

// DB_SSL is opt-in via env, not inferred from NODE_ENV -- some
// deployments (e.g. a DB reachable only over a private network) don't
// need or want TLS, so this stays an explicit choice rather than a
// production-only default. Most managed Postgres providers (Render,
// Supabase, Railway, RDS) require SSL and present a cert that isn't in
// Node's default trust store, hence DB_SSL_REJECT_UNAUTHORIZED
// defaulting to false when SSL is on -- set it to "true" only if you've
// supplied a CA cert Node can actually validate against.
const sslEnabled = process.env.DB_SSL === "true";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslEnabled
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" }
    : false,
});

// Without this handler, an error on an idle client (e.g. the DB
// restarting, a dropped network connection) is an unhandled
// EventEmitter 'error' and crashes the entire process. Logging it here
// lets the pool recover (pg replaces the dead client) instead.
pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message);
});

module.exports = pool;
