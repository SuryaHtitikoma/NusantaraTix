CREATE DATABASE IF NOT EXISTS nusantaratix;
USE nusantaratix;

-- Menggunakan sequence berurutan (1, 2, 3...) agar ID rapi untuk generate_series & SPLIT AT
SET serial_normalization = 'sql_sequence';

-- ============================================================================
-- 1. TABEL MASTER (Users, Events, Ticket Tiers)
-- ============================================================================
CREATE TABLE users (
    user_id BIGSERIAL PRIMARY KEY,
    username STRING NOT NULL UNIQUE,
    email STRING NOT NULL UNIQUE,
    password_hash STRING NOT NULL,
    role STRING NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'CUSTOMER', 'ANALYST')),
    region STRING NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
    event_id BIGSERIAL PRIMARY KEY,
    event_name STRING NOT NULL,
    venue STRING NOT NULL,
    city STRING NOT NULL,
    region STRING NOT NULL,
    event_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ticket_tiers (
    tier_id BIGSERIAL PRIMARY KEY,
    event_id INT8 NOT NULL REFERENCES events(event_id),
    tier_name STRING NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    total_quota INT NOT NULL,
    available_quota INT NOT NULL CHECK (available_quota >= 0) -- Mencegah kuota minus saat war tiket
);

-- Seed Master Users (4 Akun RBAC Demo + 1.000 Customer)
INSERT INTO users (user_id, username, email, password_hash, role, region) VALUES
(1, 'admin_pusat', 'admin@nusantaratix.id', 'admin123', 'ADMIN', 'JAKARTA'),
(2, 'operator_jkt', 'op.jkt@nusantaratix.id', 'op123', 'OPERATOR', 'JAKARTA'),
(3, 'operator_sby', 'op.sby@nusantaratix.id', 'op123', 'OPERATOR', 'SURABAYA'),
(4, 'analyst_uas', 'analyst@nusantaratix.id', 'analyst123', 'ANALYST', 'BALI');

INSERT INTO users (user_id, username, email, password_hash, role, region)
SELECT
    i,
    'user_' || i,
    'user' || i || '@mail.com',
    'pass123',
    'CUSTOMER',
    (ARRAY['JAKARTA', 'SURABAYA', 'BALI'])[1 + (i % 3)]
FROM generate_series(5, 1004) AS g(i);

SELECT setval('users_user_id_seq', 1004);

-- Seed Master Events (6 Event Regional)
INSERT INTO events (event_id, event_name, venue, city, region, event_date) VALUES
(1, 'Jakarta Soundfest 2026', 'GBK Main Stadium', 'Jakarta', 'JAKARTA', '2026-12-12 19:00:00+07'),
(2, 'Surabaya Indie Night', 'Jatim Expo', 'Surabaya', 'SURABAYA', '2026-12-18 18:30:00+07'),
(3, 'Bali Sunset Beach Fest', 'GWK Cultural Park', 'Badung', 'BALI', '2026-12-25 17:00:00+08'),
(4, 'Orchestra Nusantara', 'ICE BSD Hall 5', 'Tangerang', 'JAKARTA', '2027-01-10 19:30:00+07'),
(5, 'East Java Rock Arena', 'Gelora Bung Tomo', 'Surabaya', 'SURABAYA', '2027-01-20 19:00:00+07'),
(6, 'Nusa Dua Jazz Festival', 'Bali Nusa Dua Convention', 'Badung', 'BALI', '2027-02-05 18:00:00+08');

SELECT setval('events_event_id_seq', 6);

-- Seed Master Ticket Tiers (18 Kategori Tiket)
INSERT INTO ticket_tiers (tier_id, event_id, tier_name, price, total_quota, available_quota)
SELECT
    i,
    1 + ((i - 1) / 3),
    (ARRAY['TRIBUNE', 'FESTIVAL', 'VIP'])[1 + ((i - 1) % 3)],
    (ARRAY[350000.00, 750000.00, 1500000.00])[1 + ((i - 1) % 3)],
    500000,
    250000
FROM generate_series(1, 18) AS g(i);

SELECT setval('ticket_tiers_tier_id_seq', 18);

-- ============================================================================
-- 2. TIGA TABEL PERANG (Masing-masing 1.000.000 Baris + Range Splitting)
-- ============================================================================

-- TABEL PERANG 1: bookings
CREATE TABLE bookings (
    booking_id BIGSERIAL PRIMARY KEY,
    user_id INT8 NOT NULL REFERENCES users(user_id),
    event_id INT8 NOT NULL REFERENCES events(event_id),
    region STRING NOT NULL,
    booking_status STRING NOT NULL CHECK (booking_status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED')),
    total_amount DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_bookings_created (created_at DESC),
    INDEX idx_bookings_region (region, booking_status)
);

-- Insert 1.000.000 baris (dibagi 2 batch @500rb agar ringan di RAM laptop)
INSERT INTO bookings (booking_id, user_id, event_id, region, booking_status, total_amount, created_at)
SELECT
    i,
    5 + (i % 1000),
    1 + (i % 6),
    (ARRAY['JAKARTA', 'SURABAYA', 'BALI'])[1 + (i % 3)],
    (ARRAY['PAID', 'PAID', 'PAID', 'PENDING', 'EXPIRED'])[1 + (i % 5)],
    (ARRAY[350000.00, 750000.00, 1500000.00])[1 + (i % 3)],
    now() - (i || ' seconds')::INTERVAL
FROM generate_series(1, 500000) AS g(i);

INSERT INTO bookings (booking_id, user_id, event_id, region, booking_status, total_amount, created_at)
SELECT
    i,
    5 + (i % 1000),
    1 + (i % 6),
    (ARRAY['JAKARTA', 'SURABAYA', 'BALI'])[1 + (i % 3)],
    (ARRAY['PAID', 'PAID', 'PAID', 'PENDING', 'EXPIRED'])[1 + (i % 5)],
    (ARRAY[350000.00, 750000.00, 1500000.00])[1 + (i % 3)],
    now() - (i || ' seconds')::INTERVAL
FROM generate_series(500001, 1000000) AS g(i);

SELECT setval('bookings_booking_id_seq', 1000000);

-- Pecah Range setiap 100.000 baris agar terdistribusi ke 3 node (Jakarta, Surabaya, Bali)
ALTER TABLE bookings SPLIT AT SELECT generate_series(100001, 900001, 100000);


-- TABEL PERANG 2: booking_tickets
CREATE TABLE booking_tickets (
    ticket_id BIGSERIAL PRIMARY KEY,
    booking_id INT8 NOT NULL REFERENCES bookings(booking_id),
    tier_id INT8 NOT NULL REFERENCES ticket_tiers(tier_id),
    attendee_name STRING NOT NULL,
    ticket_code STRING NOT NULL UNIQUE,
    is_checked_in BOOL NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_tickets_booking (booking_id)
);

INSERT INTO booking_tickets (ticket_id, booking_id, tier_id, attendee_name, ticket_code, is_checked_in, created_at)
SELECT
    i,
    i,
    1 + (i % 18),
    'Pengunjung ' || i,
    'TIX-' || lpad(i::STRING, 8, '0'),
    (i % 4 = 0),
    now() - (i || ' seconds')::INTERVAL
FROM generate_series(1, 500000) AS g(i);

INSERT INTO booking_tickets (ticket_id, booking_id, tier_id, attendee_name, ticket_code, is_checked_in, created_at)
SELECT
    i,
    i,
    1 + (i % 18),
    'Pengunjung ' || i,
    'TIX-' || lpad(i::STRING, 8, '0'),
    (i % 4 = 0),
    now() - (i || ' seconds')::INTERVAL
FROM generate_series(500001, 1000000) AS g(i);

SELECT setval('booking_tickets_ticket_id_seq', 1000000);

ALTER TABLE booking_tickets SPLIT AT SELECT generate_series(100001, 900001, 100000);


-- TABEL PERANG 3: payment_transactions
CREATE TABLE payment_transactions (
    payment_id BIGSERIAL PRIMARY KEY,
    booking_id INT8 NOT NULL REFERENCES bookings(booking_id),
    payment_method STRING NOT NULL CHECK (payment_method IN ('QRIS', 'VA_BCA', 'VA_MANDIRI', 'GOPAY', 'OVO')),
    amount_paid DECIMAL(12,2) NOT NULL,
    payment_status STRING NOT NULL CHECK (payment_status IN ('SUCCESS', 'FAILED', 'REFUNDED')),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_payments_paid_at (paid_at DESC)
);

INSERT INTO payment_transactions (payment_id, booking_id, payment_method, amount_paid, payment_status, paid_at)
SELECT
    i,
    i,
    (ARRAY['QRIS', 'VA_BCA', 'VA_MANDIRI', 'GOPAY', 'OVO'])[1 + (i % 5)],
    (ARRAY[350000.00, 750000.00, 1500000.00])[1 + (i % 3)],
    (ARRAY['SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILED', 'REFUNDED'])[1 + (i % 5)],
    now() - (i || ' seconds')::INTERVAL
FROM generate_series(1, 500000) AS g(i);

INSERT INTO payment_transactions (payment_id, booking_id, payment_method, amount_paid, payment_status, paid_at)
SELECT
    i,
    i,
    (ARRAY['QRIS', 'VA_BCA', 'VA_MANDIRI', 'GOPAY', 'OVO'])[1 + (i % 5)],
    (ARRAY[350000.00, 750000.00, 1500000.00])[1 + (i % 3)],
    (ARRAY['SUCCESS', 'SUCCESS', 'SUCCESS', 'FAILED', 'REFUNDED'])[1 + (i % 5)],
    now() - (i || ' seconds')::INTERVAL
FROM generate_series(500001, 1000000) AS g(i);

SELECT setval('payment_transactions_payment_id_seq', 1000000);

ALTER TABLE payment_transactions SPLIT AT SELECT generate_series(100001, 900001, 100000);

-- ============================================================================
-- 3. RBAC LEVEL DATABASE (Admin, Operator Loket, Data Analyst UAS)
-- ============================================================================
CREATE ROLE admin_role WITH LOGIN PASSWORD 'AdminPassword123!';
CREATE ROLE operator_role WITH LOGIN PASSWORD 'OperatorPassword123!';
CREATE ROLE analyst_role WITH LOGIN PASSWORD 'AnalystPassword123!';

-- Admin: Akses penuh semua tabel
GRANT ALL ON DATABASE nusantaratix TO admin_role;
GRANT ALL ON TABLE users, events, ticket_tiers, bookings, booking_tickets, payment_transactions TO admin_role;

-- Operator / Aplikasi Transaksi: Baca master, potong kuota, dan tulis tabel perang
GRANT SELECT ON TABLE users, events, ticket_tiers TO operator_role;
GRANT UPDATE (available_quota) ON TABLE ticket_tiers TO operator_role;
GRANT SELECT, INSERT, UPDATE ON TABLE bookings, booking_tickets, payment_transactions TO operator_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO operator_role;

-- Analyst (Untuk narik data ke DuckDB saat UAS): Read-only (SELECT)
GRANT SELECT ON TABLE users, events, ticket_tiers, bookings, booking_tickets, payment_transactions TO analyst_role;