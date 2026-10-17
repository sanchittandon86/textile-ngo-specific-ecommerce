require("dotenv").config();

const app = require("./app");
const pool = require("./config/db");
const validateEnv = require("./config/validateEnv");

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = 10000;

let httpServer = null;
let shuttingDown = false;

// Shared by signal handling and crash handling below -- stops accepting
// new connections, lets in-flight requests finish, then closes the DB
// pool. A hard timeout forces exit if something hangs (e.g. a request
// stuck waiting on a DB query) rather than leaving the process zombied.
function shutdown(reason, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Shutting down (${reason})...`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing exit");
    process.exit(exitCode);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  const closeServer = httpServer
    ? new Promise((resolve) => httpServer.close(resolve))
    : Promise.resolve();

  closeServer
    .then(() => pool.end())
    .catch((error) => console.error("Error during shutdown:", error.message))
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(exitCode);
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));

// An uncaught exception or unhandled rejection means something escaped
// a try/catch and process state may be inconsistent -- log it and exit
// rather than keep serving requests from a possibly-corrupted process.
// A process manager (systemd/PM2/container orchestrator) is expected to
// restart it.
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  shutdown("unhandledRejection", 1);
});

async function startServer() {
  const envErrors = validateEnv();
  if (envErrors.length > 0) {
    console.error("Invalid configuration, refusing to start:");
    for (const message of envErrors) console.error(`  - ${message}`);
    process.exit(1);
  }

  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected successfully");

    httpServer = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
