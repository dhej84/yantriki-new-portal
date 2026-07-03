const express = require('express');
const axios   = require('axios');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const CACHE_HOURS = 12;   // refresh every 12 hours
const BASE_CURRENCY = 'INR';

// ── GET /api/fx  — return all cached rates ────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const rates = await getRates();
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/fx/:currency  — single rate ─────────────────────────────────────
router.get('/:currency', requireAuth, async (req, res) => {
  try {
    const rates = await getRates();
    const code  = req.params.currency.toUpperCase();
    if (!rates[code]) return res.status(404).json({ error: `Currency ${code} not found` });
    res.json({ currency: code, rate_to_inr: rates[code].rate_to_inr, fetched_at: rates[code].fetched_at });
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
    res.json({ refreshed: true, count: Object.keys(rates).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getRates() {
  // Check cache freshness
  const { rows } = await db.query(
    `SELECT currency_code, rate_to_inr, fetched_at
     FROM fx_rates
     WHERE fetched_at > NOW() - INTERVAL '${CACHE_HOURS} hours'
     ORDER BY currency_code`
  );

  if (rows.length > 0) {
    const map = {};
    rows.forEach(r => { map[r.currency_code] = { rate_to_inr: Number(r.rate_to_inr), fetched_at: r.fetched_at }; });
    return map;
  }

  // Cache stale — fetch fresh
  return fetchAndStore();
}

async function fetchAndStore() {
  const url = process.env.FX_API_URL || `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`;
  const response = await axios.get(url, { timeout: 8000 });

  if (response.data.result !== 'success')
    throw new Error('FX API returned an error');

  // rates here are X per 1 INR — we want INR per 1 X
  const rawRates = response.data.rates;
  const toStore  = ['USD','EUR','GBP','AED','SGD','BDT','MYR','JPY','CNY','SAR','QAR','THB','LKR'];

  const map = {};
  for (const code of toStore) {
    if (!rawRates[code]) continue;
    const rateToInr = 1 / rawRates[code];   // convert: if 1 INR = 0.012 USD → 1 USD = 83.3 INR
    await db.query(
      `INSERT INTO fx_rates (currency_code, rate_to_inr, fetched_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (currency_code)
       DO UPDATE SET rate_to_inr = $2, fetched_at = NOW()`,
      [code, rateToInr]
    );
    map[code] = { rate_to_inr: rateToInr, fetched_at: new Date() };
  }

  return map;
}

module.exports = router;
