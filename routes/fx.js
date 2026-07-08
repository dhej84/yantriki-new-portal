const express = require('express');
const axios   = require('axios');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const CACHE_HOURS = 6;  // refresh every 6 hours

// Currencies Yantriki needs — add more as business expands
const CURRENCIES = ['USD','EUR','GBP','AED','SGD','BDT','MYR','JPY','CNY','SAR','QAR','THB','LKR','KWD','OMR'];

// ── GET /api/fx ───────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const rates = await getRates();
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/fx/:currency ─────────────────────────────────────────────────────
router.get('/:currency', requireAuth, async (req, res) => {
  try {
    const rates = await getRates();
    const code  = req.params.currency.toUpperCase();
    if (!rates[code]) return res.status(404).json({ error: `Currency ${code} not found` });
    res.json({ currency: code, ...rates[code] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/fx/refresh  (admin force-refresh) ───────────────────────────────
router.post('/refresh', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  try {
    const rates = await fetchAndStore();
    res.json({ refreshed: true, count: Object.keys(rates).length, source: rates._source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cache check ───────────────────────────────────────────────────────────────
async function getRates() {
  const { rows } = await db.query(
    `SELECT currency_code, rate_to_inr, fetched_at
     FROM fx_rates
     WHERE fetched_at > NOW() - INTERVAL '${CACHE_HOURS} hours'
     ORDER BY currency_code`
  );

  if (rows.length >= 5) {   // at least 5 currencies cached = valid cache
    const map = {};
    rows.forEach(r => {
      map[r.currency_code] = {
        rate_to_inr: Number(r.rate_to_inr),
        fetched_at:  r.fetched_at
      };
    });
    console.log(`[FX] Serving ${rows.length} rates from cache`);
    return map;
  }

  console.log('[FX] Cache stale or empty — fetching fresh rates');
  return fetchAndStore();
}

// ── Fetch with fallback chain ─────────────────────────────────────────────────
// Primary:  Frankfurter (api.frankfurter.dev) — no key, no cap, ECB daily
// Fallback: ExchangeRate-API open access     — no key, cache once/day
async function fetchAndStore() {
  let rawRates = null;
  let source   = null;

  // 1 ── Frankfurter (primary, no API key needed)
  try {
    console.log('[FX] Trying Frankfurter...');
    const codes = CURRENCIES.join(',');
    const url   = `https://api.frankfurter.dev/v2/rates?base=INR&quotes=${codes}`;
    const res   = await axios.get(url, { timeout: 8000 });

    // Frankfurter returns rates[code] = X per 1 INR
    // We want INR per 1 X → invert
    if (res.data?.rates) {
      rawRates = {};
      Object.entries(res.data.rates).forEach(([code, rate]) => {
        rawRates[code] = 1 / rate;
      });
      source = 'Frankfurter (ECB daily)';
      console.log(`[FX] Frankfurter OK — ${Object.keys(rawRates).length} currencies`);
    }
  } catch (err) {
    console.warn('[FX] Frankfurter failed:', err.message);
  }

  // 2 ── ExchangeRate-API open access (fallback, no key)
  if (!rawRates) {
    try {
      console.log('[FX] Trying ExchangeRate-API open access...');
      const res = await axios.get('https://open.er-api.com/v6/latest/INR', { timeout: 10000 });

      if (res.data?.result === 'success' && res.data?.rates) {
        rawRates = {};
        Object.entries(res.data.rates).forEach(([code, rate]) => {
          if (CURRENCIES.includes(code)) rawRates[code] = 1 / rate;
        });
        source = 'ExchangeRate-API (open access)';
        console.log(`[FX] ExchangeRate-API OK — ${Object.keys(rawRates).length} currencies`);
      }
    } catch (err) {
      console.warn('[FX] ExchangeRate-API failed:', err.message);
    }
  }

  // 3 ── Both failed — use last known rates from DB (even if stale)
  if (!rawRates) {
    console.warn('[FX] All APIs failed — using last known DB rates');
    const { rows } = await db.query(
      'SELECT currency_code, rate_to_inr, fetched_at FROM fx_rates ORDER BY currency_code'
    );
    if (rows.length === 0) throw new Error('No FX rates available — check internet connection');
    const map = {};
    rows.forEach(r => {
      map[r.currency_code] = { rate_to_inr: Number(r.rate_to_inr), fetched_at: r.fetched_at, stale: true };
    });
    return map;
  }

  // Store in DB
  const map = {};
  for (const [code, rateToInr] of Object.entries(rawRates)) {
    if (!CURRENCIES.includes(code)) continue;
    await db.query(
      `INSERT INTO fx_rates (currency_code, rate_to_inr, fetched_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (currency_code)
       DO UPDATE SET rate_to_inr = $2, fetched_at = NOW()`,
      [code, rateToInr]
    );
    map[code] = { rate_to_inr: rateToInr, fetched_at: new Date(), source };
  }

  console.log(`[FX] Stored ${Object.keys(map).length} rates from ${source}`);
  return map;
}

module.exports = router;