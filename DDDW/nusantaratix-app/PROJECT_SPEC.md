Simpan teks di bawah ini sebagai file **`PROJECT_SPEC.md`** di dalam folder project-mu (sejajar dengan folder `certs/`), lalu arahkan **Antigravity** untuk membaca dan mengeksekusi spesifikasi tersebut secara bertahap.

````markdown
# NusantaraTix — Distributed OLTP Ticketing System (CockroachDB + Node.js)

## 1. Project Context & System Narrative

**NusantaraTix** is a high-concurrency national concert & event ticketing platform built on a **3-node distributed CockroachDB cluster** running in **TLS Secure Mode** (no `--insecure`).

- **Regional Topology:**
  - **Node 1 (Jakarta):** `localhost:26257` (HTTP Admin: `https://localhost:8080`)
  - **Node 2 (Surabaya):** `localhost:26258` (HTTP Admin: `https://localhost:8081`)
  - **Node 3 (Bali):** `localhost:26259` (HTTP Admin: `https://localhost:8082`)
- **Core Objective:** Handle parallel "War Tiket" transactions safely using strict ACID transactions (preventing overselling/negative ticket quotas), enforce Role-Based Access Control (RBAC) at both the **CockroachDB SQL level** and **UI level**, remain operational when one node is terminated (_failover_), and query datasets containing **1,000,000+ rows per transactional table** without UI lag.
- **Future UAS Extension (Keep Clean & Modular):** This OLTP system will later connect to **DuckDB** (Staging/Data Lake -> Data Profiling -> Star Schema Data Warehouse). Keep code modular, clean, and free of unnecessary bloat.

---

## 2. Tech Stack & Folder Structure

Use a lightweight, zero-build-overhead stack so it runs immediately and is easy to inspect:

- **Backend:** Node.js + Express + `pg` (node-postgres)
- **Frontend:** Vanilla HTML5 + Tailwind CSS (via CDN) + Vanilla ES6 JavaScript (`fetch` API)
- **Folder Structure:**
  ```text
  nusantaratix-app/
  ├── certs/                  # Existing TLS certs (ca.crt, client.root.crt, client.root.key)
  ├── public/
  │   ├── index.html          # Main SPA-like dashboard with RBAC views & War Tiket simulator
  │   └── app.js              # Frontend state, pagination, RBAC UI rendering, concurrency tester
  ├── src/
  │   ├── db.js               # Multi-node CockroachDB SSL connection pools & failover router
  │   ├── routes/
  │   │   ├── auth.js         # Login & role session handling
  │   │   ├── events.js       # Master events & ticket tiers management (Admin/Public)
  │   │   ├── bookings.js     # ACID ticket purchase, War Tiket simulator, paginated table viewers
  │   │   └── analyst.js      # Read-only analytics & CSV/JSON export endpoint for DuckDB (UAS)
  │   └── server.js           # Express server entry point
  ├── package.json
  └── PROJECT_SPEC.md
  ```
````

---

## 3. Existing Database Schema & Credentials (DO NOT RECREATE)

The database `nusantaratix` is already created and seeded with **1,000,000 rows** in each of the 3 battle tables. Connect to it directly using these exact schemas:

### Master Tables

1. `users (user_id BIGSERIAL PK, username STRING, email STRING, password_hash STRING, role STRING ['ADMIN'|'OPERATOR'|'CUSTOMER'|'ANALYST'], region STRING, created_at TIMESTAMPTZ)`

- Seeded demo accounts:
- `admin_pusat` / `admin123` (role: `ADMIN`)
- `operator_jkt` / `op123` (role: `OPERATOR`)
- `operator_sby` / `op123` (role: `OPERATOR`)
- `analyst_uas` / `analyst123` (role: `ANALYST`)
- `user_5` .. `user_1004` / `pass123` (role: `CUSTOMER`)

2. `events (event_id BIGSERIAL PK, event_name STRING, venue STRING, city STRING, region STRING, event_date TIMESTAMPTZ, created_at TIMESTAMPTZ)`
3. `ticket_tiers (tier_id BIGSERIAL PK, event_id INT8 FK, tier_name STRING, price DECIMAL(12,2), total_quota INT, available_quota INT CHECK >= 0)`

### 3 Battle Tables ("Tabel Perang" — 1,000,000+ rows each)

1. `bookings (booking_id BIGSERIAL PK, user_id INT8 FK, event_id INT8 FK, region STRING, booking_status STRING ['PENDING'|'PAID'|'EXPIRED'|'CANCELLED'], total_amount DECIMAL(12,2), created_at TIMESTAMPTZ)`
2. `booking_tickets (ticket_id BIGSERIAL PK, booking_id INT8 FK, tier_id INT8 FK, attendee_name STRING, ticket_code STRING UNIQUE, is_checked_in BOOL, created_at TIMESTAMPTZ)`
3. `payment_transactions (payment_id BIGSERIAL PK, booking_id INT8 FK, payment_method STRING ['QRIS'|'VA_BCA'|'VA_MANDIRI'|'GOPAY'|'OVO'], amount_paid DECIMAL(12,2), payment_status STRING ['SUCCESS'|'FAILED'|'REFUNDED'], paid_at TIMESTAMPTZ)`

### CockroachDB SQL Roles (Already Created in DB)

- `admin_role` / password: `AdminPassword123!` (Full privileges)
- `operator_role` / password: `OperatorPassword123!` (SELECT master, UPDATE `available_quota`, SELECT/INSERT/UPDATE on 3 battle tables)
- `analyst_role` / password: `AnalystPassword123!` (Read-only `SELECT` on all tables)

---

## 4. Technical Requirements & Implementation Rules

### A. Secure TLS Connection & Distributed Failover (`src/db.js`)

- **No `--insecure`:** Every `pg.Pool` connection MUST enable SSL using `./certs/ca.crt`:

```javascript
ssl: {
  rejectUnauthorized: true,
  ca: fs.readFileSync(path.join(__dirname, '../certs/ca.crt')).toString(),
}

```

- **Multi-Node Failover & Node Selection:**
- Configure the 3 nodes: `[{ name: 'Jakarta (Node 1)', port: 26257 }, { name: 'Surabaya (Node 2)', port: 26258 }, { name: 'Bali (Node 3)', port: 26259 }]`.
- Implement a helper `queryWithFailover(role, sql, params)` that routes queries across active nodes (round-robin or user-selected target node) and **automatically retries on the next healthy node** if a connection error (`ECONNREFUSED` / timeout) occurs when a node is shut down during live failover demos.
- Include a `GET /api/cluster/status` endpoint that pings all 3 ports (`26257`, `26258`, `26259`) with `SELECT crdb_internal.node_id() AS node_id` so the UI displays live `ONLINE` / `OFFLINE` status badges for Jakarta, Surabaya, and Bali.

### B. Two-Layer RBAC (Database Role Mapping + UI Enforcement)

- Maintain separate DB connection credentials per role (`admin_role`, `operator_role`, `analyst_role`) so that database-level permissions are genuinely enforced by CockroachDB (not just hidden in frontend CSS).
- **UI & API Capabilities by Role:**

1. **`ADMIN` (`admin_role`):**

- Full dashboard access: Create new Events & Ticket Tiers, reset/adjust `available_quota` (useful before running a War Tiket demo), view all 3 battle tables, and run the War Tiket Simulator.

2. **`OPERATOR` (`operator_role`):**

- Ticket counter & check-in operations: Process live ticket bookings, check-in tickets (`UPDATE booking_tickets SET is_checked_in = true`), view paginated battle tables, and run the War Tiket Simulator.
- _RBAC Demo Proof:_ Attempting to create/delete an Event as `OPERATOR` must fail cleanly and show CockroachDB's permission error (`permission denied for table events`).

3. **`CUSTOMER` (`operator_role` scoped to own `user_id`):**

- Browse active events & remaining quotas, buy tickets (1–4 qty), and view their own recent bookings & e-ticket codes.

4. **`ANALYST` (`analyst_role`):**

- Read-only view of all 3 battle tables, regional summary stats, and a **"Export Batch for DuckDB (CSV/JSON)"** button (`GET /api/analyst/export?table=bookings&limit=50000`) to prepare for UAS data ingestion.

### C. High-Concurrency OLTP & "War Tiket" Simulator (`src/routes/bookings.js`)

1. **ACID Ticket Purchase Endpoint (`POST /api/bookings/purchase`):**

- Must execute inside an explicit SQL transaction (`BEGIN` ... `COMMIT`, with `ROLLBACK` on any error):

1. Atomically decrement quota:
   `UPDATE ticket_tiers SET available_quota = available_quota - $1 WHERE tier_id = $2 AND available_quota >= $1 RETURNING event_id, price, available_quota`
   If `rowCount === 0`, `ROLLBACK` and return `409 Conflict` ("Sold Out / Kuota Tidak Cukup").
2. Insert into `bookings` (`RETURNING booking_id`).
3. Insert `qty` rows into `booking_tickets` with unique `ticket_code` (e.g., `TIX-${Date.now()}-${rand}`).
4. Insert into `payment_transactions` (`payment_status = 'SUCCESS'`).
5. Query `SELECT crdb_internal.node_id() AS handled_by_node` before `COMMIT` so the UI can display which CockroachDB node processed the transaction.

6. **Parallel "War Tiket" Stress Simulator (`POST /api/war-ticket/simulate`):**

- Accepts `{ tier_id, concurrent_requests (e.g. 20 to 100), region_mode ('RANDOM' | 'JAKARTA' | 'SURABAYA' | 'BALI') }`.
- Fires `concurrent_requests` simultaneous ACID purchase transactions using `Promise.allSettled()`.
- Returns a detailed battle report: total requests fired, total succeeded, total rejected (sold out), execution time in milliseconds, final `available_quota` (proving it never drops below `0`), and distribution of transactions across Node 1, Node 2, and Node 3.

### D. 1,000,000+ Rows Performance Rules (CRITICAL)

- **NEVER** run `SELECT * FROM bookings` without a `LIMIT`.
- **Mandatory Pagination:** All 3 battle table viewers (`bookings`, `booking_tickets`, `payment_transactions`) must use indexed pagination (`ORDER BY <primary_key> DESC LIMIT $1 OFFSET $2`, default `limit = 20`) plus exact ID lookup (`WHERE booking_id = $1`) so queries return in `< 50ms` even with 1M+ rows.
- **Fast Row Counts:** Display approximate or indexed counts cleanly without blocking page load.

---

## 5. UI / UX Design Guidelines

- **Visual Theme:** Dark mode command-center aesthetic:
- Background: `#121212`, Elevated Cards/Panels: `#232223`, Borders: `#2D3436`
- Primary Accent: Deep Blue `#1F79AE`, Highlight/VIP/Node Badges: Gold `#D4AF37`
- Status Indicators: Emerald green for `ONLINE` / `SUCCESS` / `PAID`, Crimson red for `OFFLINE` / `SOLD OUT` / `FAILED`.

- **Layout Structure:**
- **Top Header Bar:** Brand (`NusantaraTix OLTP`), Live 3-Node Cluster Health Pills (`JKT :26257`, `SBY :26258`, `BALI :26259`), Target Node Selector (`Auto Failover` or pin specific node), Current User & Role Badge, and Quick Role Switcher / Login Modal.
- **Navigation Tabs (dynamically filtered by RBAC):**

1. `War Tiket & Live Booking` (Event cards with live quota + Concurrency Stress Simulator + Live Transaction Log showing which Node handled each request)
2. `Data Perang (1M+ Explorer)` (Sub-tabs for `bookings`, `booking_tickets`, `payment_transactions` with fast pagination, ID search, and row counter)
3. `Admin & Quota Control` (Create event/tier, set small quota e.g. `15` for live War Tiket demo, and RBAC permission test button)
4. `UAS DuckDB Staging Prep` (Read-only analytical preview & batch CSV/JSON exporter for `ANALYST` role)

- **Keep It Clean:** Avoid placeholder bloat or overly complex animations. Focus on clarity, real-time responsiveness, and unmistakable proof of distributed ACID transactions during live presentation.

---

## 6. Build & Execution Steps for Agent

1. Initialize `package.json` with dependencies: `express`, `pg`, `cors`, `dotenv`.
2. Build `src/db.js` first and verify TLS connectivity to `localhost:26257`, `26258`, and `26259` using `./certs/ca.crt`.
3. Implement backend routes (`auth.js`, `events.js`, `bookings.js`, `analyst.js`) and `src/server.js`.
4. Build `public/index.html` and `public/app.js` following the dark-mode command-center design and RBAC rules.
5. Start the server on `http://localhost:3000` and verify all endpoints.

```

### Cara Pakai di Antigravity:
1. Pastikan ketiga node CockroachDB (`26257`, `26258`, `26259`) sedang menyala dan folder `certs/` sudah ada di dalam folder project.
2. Buat file baru bernama `PROJECT_SPEC.md` di folder project tersebut lalu tempel isi di atas.
3. Di chat agent Antigravity, cukup berikan instruksi singkat:
   > *"Baca `PROJECT_SPEC.md` secara menyeluruh. Bangun seluruh struktur backend dan frontend sesuai spesifikasi tersebut, lalu jalankan server-nya dan uji koneksi ke cluster CockroachDB."*

```
