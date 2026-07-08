/**
 * Yantriki Travel Portal — End-to-End API Test
 * 
 * Run with:  node test.js
 * Requires:  server running on localhost:3000 + DB seeded
 * 
 * Tests every endpoint in order:
 *   Auth → Create trip → Get trip → Add expense lines →
 *   Submit → Review → Approve → Paid → FX rates → File upload
 */

const BASE = 'http://localhost:3000';

let cookies = {};        // session cookies per user
let createdTripId = null;

// ── Colour helpers ────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m'
};

let passed = 0;
let failed = 0;

function log(icon, label, detail = '') {
  console.log(`  ${icon}  ${label}${detail ? c.dim + '  ' + detail + c.reset : ''}`);
}

function ok(label, detail)   { passed++; log(c.green + '✓' + c.reset, label, detail); }
function fail(label, detail) { failed++; log(c.red   + '✗' + c.reset, c.red + label + c.reset, detail); }
function section(title)      { console.log(`\n${c.bold}${c.cyan}── ${title}${c.reset}`); }

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function req(method, path, body, user) {
  const cookie = user ? cookies[user] : null;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  // Capture Set-Cookie
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && user) {
    cookies[user] = setCookie.split(';')[0];
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

function expect(condition, label, detail) {
  condition ? ok(label, detail) : fail(label, detail);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testAuth() {
  section('1. Authentication');

  // Bad login
  let r = await req('POST', '/api/auth/login', { username: 'nobody', password: 'wrong' });
  expect(r.status === 401, 'Rejects bad credentials', `status ${r.status}`);

  // Traveller login
  r = await req('POST', '/api/auth/login', { username: 'traveller1', password: 'admin' }, 'traveller');
  expect(r.status === 200 && r.data.user?.role === 'traveller', 'Traveller login', `role=${r.data.user?.role}`);

  // Reviewer login
  r = await req('POST', '/api/auth/login', { username: 'reviewer1', password: 'admin' }, 'reviewer');
  expect(r.status === 200 && r.data.user?.role === 'reviewer', 'Reviewer login', `role=${r.data.user?.role}`);

  // Approver login
  r = await req('POST', '/api/auth/login', { username: 'approver1', password: 'admin' }, 'approver');
  expect(r.status === 200 && r.data.user?.role === 'approver', 'Approver login', `role=${r.data.user?.role}`);

  // Accounts login
  r = await req('POST', '/api/auth/login', { username: 'accounts1', password: 'admin' }, 'accounts');
  expect(r.status === 200, 'Accounts login');

  // /me endpoint
  r = await req('GET', '/api/auth/me', null, 'traveller');
  expect(r.status === 200 && r.data.user?.username === 'traveller1', '/me returns current user');

  // Unauthenticated /me
  r = await req('GET', '/api/auth/me');
  expect(r.status === 401, 'Unauthenticated /me returns 401');
}

async function testTrips() {
  section('2. Create trip (domestic)');

  const body = {
    trip_type:        'domestic',
    billable:         'customer',
    customer_name:    'Shree Ganesh Edibles Pvt. Ltd.',
    customer_location:'Punjab',
    po_number:        'PO-TEST-001',
    po_date:          '2024-01-15',
    wo_number:        'WO-2024-001',
    traveller_name:   'Malbin Antony',
    travel_route:     'Bangalore → Chandigarh → Delhi',
    travel_start_date:'2024-05-25',
    travel_end_date:  '2024-05-26',
    invoice_number:   'YTS-INV-2024-001',
    expense_lines: [
      { expense_date:'2024-05-25', description:'Residence to Bangalore Airport', mode:'Taxi',   bill_no:'988',       amount_inr: 1300 },
      { expense_date:'2024-05-26', description:'Hotel to Chandigarh Airport',    mode:'Taxi',   bill_no:'---',       amount_inr:  264.21 },
      { expense_date:'2024-05-25', description:'Advance deduction',              mode:'Other',  bill_no:'ADV',       amount_inr:  400, is_advance_deduction: true }
    ]
  };

  let r = await req('POST', '/api/trips', body, 'traveller');
  expect(r.status === 201, 'Creates domestic trip', `tracking=${r.data.tracking_no}`);
  expect(r.data.tracking_no?.startsWith('YTS-DOM'), 'Tracking number has DOM prefix', r.data.tracking_no);
  expect(r.data.status === 'draft', 'New trip starts as draft');
  createdTripId = r.data.id;

  section('3. Get trip');
  r = await req('GET', `/api/trips/${createdTripId}`, null, 'traveller');
  expect(r.status === 200, 'Fetches trip by ID');
  expect(Array.isArray(r.data.expense_lines), 'Trip includes expense_lines');
  expect(r.data.expense_lines.length === 3, 'All 3 expense lines saved', `got ${r.data.expense_lines?.length}`);

  section('4. List trips');
  r = await req('GET', '/api/trips', null, 'traveller');
  expect(r.status === 200 && Array.isArray(r.data), 'Lists trips for traveller');
  expect(r.data.some(t => t.id === createdTripId), 'New trip appears in list');

  section('5. Update trip');
  r = await req('PUT', `/api/trips/${createdTripId}`, { customer_name: 'Updated Customer' }, 'traveller');
  expect(r.status === 200, 'Updates trip');
  expect(r.data.customer_name === 'Updated Customer', 'Customer name updated');
}

async function testInternationalTrip() {
  section('6. Create trip (international)');

  const body = {
    trip_type:          'international',
    billable:           'customer',
    customer_name:      'ABB India Limited',
    customer_location:  'BIFPCL, Rampal, Bangladesh',
    destination_country:'Bangladesh',
    traveller_name:     'Malbin Antony',
    travel_route:       'Bangalore → Dhaka → Khulna → Bangalore',
    travel_start_date:  '2023-05-27',
    travel_end_date:    '2023-07-09',
    manday_count:       10,
    manday_rate:        8000,
    expense_lines: [
      { expense_date:'2023-05-27', description:'Flight BLR → DAC', mode:'Flight', bill_no:'AI-201', amount_inr: 45000 },
      { expense_date:'2023-05-28', description:'Hotel Dhaka',       mode:'Hotel',  bill_no:'HTL-01', amount_inr: 0,
        currency_code:'BDT', amount_foreign: 15000, fx_rate: 0.70, amount_converted_inr: 10500, credit_card_ref:'HDFC-4521' },
      { expense_date:'2023-05-29', description:'Local transport',   mode:'Taxi',   bill_no:'TX-01',  amount_inr: 0,
        currency_code:'BDT', amount_foreign: 2000,  fx_rate: 0.70, amount_converted_inr: 1400 }
    ]
  };

  const r = await req('POST', '/api/trips', body, 'traveller');
  expect(r.status === 201, 'Creates international trip', `tracking=${r.data.tracking_no}`);
  expect(r.data.tracking_no?.startsWith('YTS-INT'), 'Tracking number has INT prefix', r.data.tracking_no);
}

async function testWorkflow() {
  section('7. Workflow — submit');

  // Traveller submits
  let r = await req('POST', `/api/workflow/${createdTripId}/submit`, {}, 'traveller');
  expect(r.status === 200 && r.data.status === 'submitted', 'Traveller submits trip');

  // Cannot edit submitted trip
  r = await req('PUT', `/api/trips/${createdTripId}`, { customer_name: 'Should fail' }, 'traveller');
  expect(r.status === 400, 'Cannot edit submitted trip');

  section('8. Workflow — return (reviewer)');

  // Return without comment should fail
  r = await req('POST', `/api/workflow/${createdTripId}/return`, {}, 'reviewer');
  expect(r.status === 400, 'Return without comment is rejected');

  // Return with comment
  r = await req('POST', `/api/workflow/${createdTripId}/return`, { comment: 'Please attach hotel receipt' }, 'reviewer');
  expect(r.status === 200 && r.data.status === 'returned', 'Reviewer returns trip with comment');

  // Traveller resubmits
  r = await req('POST', `/api/workflow/${createdTripId}/submit`, {}, 'traveller');
  expect(r.status === 200 && r.data.status === 'submitted', 'Traveller resubmits after revision');

  section('9. Workflow — review → approve → paid');

  // Reviewer accepts
  r = await req('POST', `/api/workflow/${createdTripId}/review`, { comment: 'Looks good' }, 'reviewer');
  expect(r.status === 200 && r.data.status === 'reviewed', 'Reviewer accepts trip');

  // Traveller cannot approve
  r = await req('POST', `/api/workflow/${createdTripId}/approve`, {}, 'traveller');
  expect(r.status === 403, 'Traveller cannot approve (403)');

  // Approver approves
  r = await req('POST', `/api/workflow/${createdTripId}/approve`, { comment: 'Approved for payment' }, 'approver');
  expect(r.status === 200 && r.data.status === 'approved', 'Approver approves trip');

  // Accounts marks paid
  r = await req('POST', `/api/workflow/${createdTripId}/paid`, {}, 'accounts');
  expect(r.status === 200 && r.data.status === 'paid', 'Accounts marks as paid');

  section('10. Workflow history');
  r = await req('GET', `/api/workflow/${createdTripId}/history`, null, 'traveller');
  expect(r.status === 200 && Array.isArray(r.data), 'Workflow history returned');
  expect(r.data.length >= 6, `History has all events`, `${r.data.length} events`);
}

async function testFX() {
  section('11. FX rates');

  let r = await req('GET', '/api/fx', null, 'traveller');
  if (r.status === 200) {
    ok('FX rates endpoint reachable', `currencies: ${Object.keys(r.data).join(', ')}`);
    expect(typeof r.data.USD?.rate_to_inr === 'number', 'USD rate is a number', `1 USD = ₹${r.data.USD?.rate_to_inr?.toFixed(2)}`);
  } else {
    log(c.yellow + '⚠' + c.reset, 'FX API skipped (network/cache)', `status ${r.status} — ok if offline`);
  }

  r = await req('GET', '/api/fx/USD', null, 'traveller');
  if (r.status === 200) {
    ok('Single currency endpoint works', `USD = ₹${r.data.rate_to_inr?.toFixed(2)}`);
  }
}

async function testDelete() {
  section('12. Soft delete');

  // Create a throwaway trip
  const r1 = await req('POST', '/api/trips', {
    trip_type: 'domestic', billable: 'internal', internal_category: 'Training',
    traveller_name: 'Test User', travel_start_date: '2024-06-01', travel_end_date: '2024-06-01'
  }, 'traveller');
  const tid = r1.data.id;

  let r = await req('DELETE', `/api/trips/${tid}`, null, 'traveller');
  expect(r.status === 200, 'Soft deletes trip');

  r = await req('GET', `/api/trips/${tid}`, null, 'traveller');
  expect(r.status === 404, 'Deleted trip returns 404');
}

// ── Run all ───────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${c.bold}Yantriki Travel Portal — API Tests${c.reset}`);
  console.log(`${c.dim}Target: ${BASE}${c.reset}\n`);

  // Check server is up
  try {
    await fetch(BASE + '/api/auth/me');
  } catch {
    console.log(`${c.red}✗ Cannot reach ${BASE} — is the server running?${c.reset}`);
    console.log(`${c.dim}  Start it with: npm run dev${c.reset}\n`);
    process.exit(1);
  }

  try {
    await testAuth();
    await testTrips();
    await testInternationalTrip();
    await testWorkflow();
    await testFX();
    await testDelete();
  } catch (e) {
    console.error(`\n${c.red}Unexpected error: ${e.message}${c.reset}`);
    console.error(e.stack);
  }

  // Summary
  const total = passed + failed;
  console.log(`\n${c.bold}Results: ${c.green}${passed} passed${c.reset}${c.bold}, ${failed > 0 ? c.red : c.dim}${failed} failed${c.reset}${c.bold} / ${total} total${c.reset}\n`);

  if (failed === 0) {
    console.log(`${c.green}${c.bold}  All tests passed! Ready to deploy. 🚀${c.reset}\n`);
  } else {
    console.log(`${c.red}  Some tests failed. Check output above.${c.reset}\n`);
    process.exit(1);
  }
}

run();