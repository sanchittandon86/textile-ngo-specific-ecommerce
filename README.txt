================================================================
 AARANYA TEXTILES & LIVING -- E-COMMERCE PLATFORM
================================================================

A handmade/artisan textile store: guest storefront (no customer
accounts), Razorpay checkout, and a read-only admin dashboard.

This is a two-part project in one repository:

    backend/    Node.js + Express.js + PostgreSQL REST API
    frontend/   Next.js (App Router, TypeScript, Tailwind CSS)
                public storefront + /admin dashboard

----------------------------------------------------------------
 ARCHITECTURE
----------------------------------------------------------------

backend/   (http://localhost:3000)
    - Public APIs: categories, products, guest cart, guest
      checkout, guest order lookup, Razorpay payments + webhook.
      No customer accounts -- customers shop entirely as guests,
      identified only by a server-issued cart/order token.
    - Admin APIs (/api/auth, /api/admin): JWT-based admin login
      (access token + rotating httpOnly refresh cookie), and
      read-only admin endpoints (dashboard summary, products,
      categories, orders). No public admin registration --
      admin accounts are seeded directly (see below).
    - PostgreSQL via the `pg` package, one shared connection pool.
    - See backend/README.md, backend/docs/checkout-api.md and
      backend/docs/payments-api.md for full endpoint-level docs.

frontend/   (http://localhost:3001)
    - Public storefront: home, product listing/search/filter,
      product detail, cart, checkout, Razorpay payment, order
      confirmation. Backend is always the source of truth for
      prices, stock, and totals.
    - /admin section: login, dashboard overview, orders,
      products, categories (view-only in this first version --
      no create/edit/delete yet).
    - The admin login/session code (in-memory access token,
      httpOnly rotating refresh cookie, auto-refresh-and-retry
      fetch wrapper) is ported from
      https://github.com/sanchittandon86/Login-application,
      adapted to this project's conventions.

----------------------------------------------------------------
 PREREQUISITES
----------------------------------------------------------------

    - Node.js (v20+ recommended)
    - PostgreSQL running locally (or reachable), with an empty
      database created for this project (default name:
      textile_store)

----------------------------------------------------------------
 SETUP
----------------------------------------------------------------

1. Backend environment

    cd backend
    cp .env.example .env

   Fill in:
    - DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
    - CLIENT_URL   (the frontend's dev URL, default
                    http://localhost:3001 -- required for CORS)
    - RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
      (Razorpay Dashboard, Test Mode -- see backend/docs/payments-api.md)
    - JWT_SECRET / JWT_REFRESH_SECRET
      Generate with:
        node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
      (run twice, once for each -- they must be different values)

2. Install dependencies and run database migrations, in order

    cd backend
    npm install

    psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/001_create_guest_cart.sql
    psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/002_create_guest_checkout.sql
    psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/003_create_razorpay_payments.sql
    psql -h localhost -p 5432 -U <DB_USER> -d textile_store -f migrations/004_create_admin_auth.sql

   Each migration is idempotent (safe to re-run) and never drops
   or truncates existing data.

   You'll also need at least one category and one published
   product in the `categories` / `products` tables for the
   storefront to show anything -- these tables and their seed
   data are managed outside this migration set.

3. Seed an admin account (there is no public registration form)

    cd backend
    node scripts/seed-admin.js "Your Name" you@example.com "a-strong-password"

4. Frontend environment

    cd frontend
    cp .env.example .env.local

   NEXT_PUBLIC_API_URL should point at the backend
   (default http://localhost:3000).

    npm install

----------------------------------------------------------------
 RUNNING THE PROJECT
----------------------------------------------------------------

In two terminals:

    cd backend  && npm run dev     ->  http://localhost:3000
    cd frontend && npm run dev     ->  http://localhost:3001

Storefront:   http://localhost:3001
Admin login:  http://localhost:3001/admin/login

----------------------------------------------------------------
 RUNNING TESTS
----------------------------------------------------------------

    cd backend && npm test

(Backend tests mock the database pool -- no live Postgres
connection is required to run them. The frontend has no
automated test suite yet; it was verified via `npx tsc --noEmit`,
`npx eslint src`, `npm run build`, and manual browser testing.)

----------------------------------------------------------------
 KNOWN LIMITATIONS
----------------------------------------------------------------

    - Admin dashboard is read-only: no product/category/order
      editing yet, and no mutation endpoints exist on the
      backend for them.
    - Single active admin session per account (logging in
      elsewhere revokes the previous session, by design).
    - No stock reservation between checkout and payment --
      see backend/docs/payments-api.md for the documented
      "paid_fulfillment_blocked" edge case and why no automatic
      refund is implemented.
    - No real product/lifestyle photography yet -- the
      storefront shows clearly-labeled placeholder panels
      wherever a real photo would go.
    - Newsletter signup on the homepage is UI-only (no backend).

----------------------------------------------------------------
 FURTHER READING
----------------------------------------------------------------

    backend/README.md                  Cart + general API setup
    backend/docs/checkout-api.md        Guest checkout endpoints
    backend/docs/payments-api.md        Razorpay integration
