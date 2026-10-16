#!/usr/bin/env node
// Creates (or updates the password of) an admin account directly in the
// database. There is no public /register endpoint -- admins are always
// seeded this way.
//
// Usage:
//   node scripts/seed-admin.js "Sanchit Tandon" sanchit@example.com "Demo@123"
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../src/config/db");

async function main() {
  const [name, email, password] = process.argv.slice(2);

  if (!name || !email || !password) {
    console.error(
      'Usage: node scripts/seed-admin.js "Admin Name" admin@example.com "password"'
    );
    process.exitCode = 1;
    return;
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters long.");
    process.exitCode = 1;
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO admin_users (name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email)
     DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
     RETURNING id, name, email, created_at`,
    [name.trim(), normalizedEmail, passwordHash]
  );

  console.log("Admin account ready:", result.rows[0]);
}

main()
  .catch((error) => {
    console.error("Failed to seed admin:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
