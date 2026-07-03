-- Run this once to set up your database
-- psql -d yantriki_travel -f schema.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('traveller','reviewer','approver','accounts','director','admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FX rate cache
CREATE TABLE IF NOT EXISTS fx_rates (
  currency_code TEXT PRIMARY KEY,
  rate_to_inr NUMERIC(12,6) NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trips (one per submission)
CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  tracking_no TEXT UNIQUE NOT NULL,
  trip_type TEXT NOT NULL CHECK (trip_type IN ('domestic','international')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','returned','reviewed','approved','paid')),

  -- Billable
  billable TEXT NOT NULL CHECK (billable IN ('customer','internal')),
  internal_category TEXT,

  -- Customer
  customer_name TEXT,
  customer_location TEXT,
  po_number TEXT,
  po_date DATE,
  wo_number TEXT,
  wo_date DATE,
  invoice_number TEXT,

  -- Traveller
  traveller_id INTEGER REFERENCES users(id),
  traveller_name TEXT NOT NULL,
  vendor_code TEXT,
  job_order_no TEXT,
  travel_route TEXT,
  destination_country TEXT,
  travel_start_date DATE,
  travel_end_date DATE,

  -- Totals (stored for quick display)
  total_inr NUMERIC(14,2) DEFAULT 0,
  total_foreign NUMERIC(14,2) DEFAULT 0,
  manday_count INTEGER DEFAULT 0,
  manday_rate NUMERIC(10,2) DEFAULT 8000,
  grand_total_inr NUMERIC(14,2) DEFAULT 0,

  -- Workflow
  reviewer_id INTEGER REFERENCES users(id),
  approver_id INTEGER REFERENCES users(id),
  reviewer_comment TEXT,
  rejection_reason TEXT,

  -- Audit
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Expense line items
CREATE TABLE IF NOT EXISTS expense_lines (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  line_order INTEGER DEFAULT 0,
  expense_date DATE,
  description TEXT,
  mode TEXT,
  bill_no TEXT,
  amount_inr NUMERIC(12,2) DEFAULT 0,
  -- International fields
  currency_code TEXT DEFAULT 'INR',
  amount_foreign NUMERIC(12,2),
  fx_rate NUMERIC(12,6),
  amount_converted_inr NUMERIC(12,2),
  credit_card_ref TEXT,
  -- Domestic
  is_advance_deduction BOOLEAN DEFAULT FALSE,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attachments (per expense line)
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  expense_line_id INTEGER REFERENCES expense_lines(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_content BYTEA NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow audit log
CREATE TABLE IF NOT EXISTS workflow_events (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id),
  actor_name TEXT,
  from_status TEXT,
  to_status TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default users (passwords = username for dev; change in prod!)
INSERT INTO users (username, password_hash, full_name, role) VALUES
  ('admin',    '$2b$10$rBnqQpGvmqRGzJpEXSIhxeRJZ5nCuM.4K3qT7YBmV8n8BNDpT7/Oy', 'Admin User',      'admin'),
  ('traveller1','$2b$10$rBnqQpGvmqRGzJpEXSIhxeRJZ5nCuM.4K3qT7YBmV8n8BNDpT7/Oy', 'Malbin Antony',   'traveller'),
  ('reviewer1', '$2b$10$rBnqQpGvmqRGzJpEXSIhxeRJZ5nCuM.4K3qT7YBmV8n8BNDpT7/Oy', 'Hemant Kumar',    'reviewer'),
  ('approver1', '$2b$10$rBnqQpGvmqRGzJpEXSIhxeRJZ5nCuM.4K3qT7YBmV8n8BNDpT7/Oy', 'Rakesh R.',       'approver'),
  ('accounts1', '$2b$10$rBnqQpGvmqRGzJpEXSIhxeRJZ5nCuM.4K3qT7YBmV8n8BNDpT7/Oy', 'Accounts Team',   'accounts'),
  ('director1', '$2b$10$rBnqQpGvmqRGzJpEXSIhxeRJZ5nCuM.4K3qT7YBmV8n8BNDpT7/Oy', 'Director',        'director')
ON CONFLICT (username) DO NOTHING;

-- NOTE: All seed passwords are "admin" (bcrypt hash above)
-- Change immediately in production via the admin panel
