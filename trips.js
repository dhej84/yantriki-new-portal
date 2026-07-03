const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTrackingNo(type, id) {
  const prefix = type === 'international' ? 'INT' : 'DOM';
  const year   = new Date().getFullYear();
  const seq    = String(id).padStart(4, '0');
  return `YTS-${prefix}-${year}-${seq}`;
}

async function recalcTotals(client, tripId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN is_advance_deduction THEN -amount_inr ELSE amount_inr END), 0) AS total_inr,
       COALESCE(SUM(CASE WHEN currency_code <> 'INR' THEN amount_converted_inr ELSE 0 END), 0) AS total_converted
     FROM expense_lines WHERE trip_id = $1`,
    [tripId]
  );
  const trip = await client.query('SELECT trip_type, manday_count, manday_rate FROM trips WHERE id = $1', [tripId]);
  const t    = trip.rows[0];
  const base = t.trip_type === 'international'
    ? Number(rows[0].total_converted)
    : Number(rows[0].total_inr);
  const manday = Number(t.manday_count || 0) * Number(t.manday_rate || 8000);
  const grand  = base + manday;

  await client.query(
    `UPDATE trips
     SET total_inr = $1, total_foreign = $2, grand_total_inr = $3, updated_at = NOW()
     WHERE id = $4`,
    [rows[0].total_inr, rows[0].total_converted, grand, tripId]
  );
  return grand;
}

// ── GET /api/trips  (list) ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const user = req.session.user;
  const { status, type, search } = req.query;

  let where = ['t.deleted_at IS NULL'];
  const params = [];

  // Travellers only see their own trips
  if (user.role === 'traveller') {
    params.push(user.id);
    where.push(`t.traveller_id = $${params.length}`);
  }
  // Reviewer sees submitted trips assigned to them
  if (user.role === 'reviewer') {
    params.push(user.id);
    where.push(`(t.reviewer_id = $${params.length} OR t.status IN ('submitted','returned'))`);
  }

  if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
  if (type)   { params.push(type);   where.push(`t.trip_type = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(t.tracking_no ILIKE $${params.length} OR t.customer_name ILIKE $${params.length} OR t.traveller_name ILIKE $${params.length})`);
  }

  try {
    const { rows } = await db.query(
      `SELECT t.*,
              u.full_name AS reviewer_name,
              a.full_name AS approver_name
       FROM trips t
       LEFT JOIN users u ON u.id = t.reviewer_id
       LEFT JOIN users a ON a.id = t.approver_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/trips/:id ────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.*,
              u.full_name AS reviewer_name,
              a.full_name AS approver_name
       FROM trips t
       LEFT JOIN users u ON u.id = t.reviewer_id
       LEFT JOIN users a ON a.id = t.approver_id
       WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });

    const lines = await db.query(
      'SELECT * FROM expense_lines WHERE trip_id = $1 ORDER BY line_order, id',
      [req.params.id]
    );
    const attachments = await db.query(
      'SELECT id, trip_id, expense_line_id, file_name, file_type, uploaded_at FROM attachments WHERE trip_id = $1',
      [req.params.id]
    );
    const events = await db.query(
      `SELECT we.*, u.full_name AS actor_name
       FROM workflow_events we
       LEFT JOIN users u ON u.id = we.actor_id
       WHERE we.trip_id = $1 ORDER BY we.created_at ASC`,
      [req.params.id]
    );

    res.json({
      ...rows[0],
      expense_lines: lines.rows,
      attachments:   attachments.rows,
      workflow:      events.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/trips  (create) ─────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const user  = req.session.user;
  const body  = req.body;
  const lines = body.expense_lines || [];

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Insert trip (tracking_no generated after we have the id)
    const tripRes = await client.query(
      `INSERT INTO trips
         (trip_type, status, billable, internal_category,
          customer_name, customer_location, po_number, po_date,
          wo_number, wo_date, invoice_number,
          traveller_id, traveller_name, vendor_code, job_order_no,
          travel_route, destination_country, travel_start_date, travel_end_date,
          manday_count, manday_rate,
          reviewer_id, approver_id,
          created_by, tracking_no)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'TEMP')
       RETURNING id`,
      [
        body.trip_type        || 'domestic',
        'draft',
        body.billable         || 'customer',
        body.internal_category || null,
        body.customer_name    || null,
        body.customer_location|| null,
        body.po_number        || null,
        body.po_date          || null,
        body.wo_number        || null,
        body.wo_date          || null,
        body.invoice_number   || null,
        user.id,
        body.traveller_name   || user.full_name,
        body.vendor_code      || null,
        body.job_order_no     || null,
        body.travel_route     || null,
        body.destination_country || null,
        body.travel_start_date|| null,
        body.travel_end_date  || null,
        body.manday_count     || 0,
        body.manday_rate      || 8000,
        body.reviewer_id      || null,
        body.approver_id      || null,
        user.id
      ]
    );

    const tripId     = tripRes.rows[0].id;
    const trackingNo = buildTrackingNo(body.trip_type, tripId);
    await client.query('UPDATE trips SET tracking_no = $1 WHERE id = $2', [trackingNo, tripId]);

    // Insert expense lines
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO expense_lines
           (trip_id, line_order, expense_date, description, mode, bill_no,
            amount_inr, currency_code, amount_foreign, fx_rate, amount_converted_inr,
            credit_card_ref, is_advance_deduction, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          tripId, i,
          l.expense_date          || null,
          l.description           || null,
          l.mode                  || null,
          l.bill_no               || null,
          l.amount_inr            || 0,
          l.currency_code         || 'INR',
          l.amount_foreign        || null,
          l.fx_rate               || null,
          l.amount_converted_inr  || null,
          l.credit_card_ref       || null,
          l.is_advance_deduction  || false,
          l.remarks               || null
        ]
      );
    }

    await recalcTotals(client, tripId);

    // Workflow event
    await client.query(
      `INSERT INTO workflow_events (trip_id, actor_id, actor_name, from_status, to_status, comment)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tripId, user.id, user.full_name, null, 'draft', 'Trip created']
    );

    await client.query('COMMIT');

    const result = await db.query('SELECT * FROM trips WHERE id = $1', [tripId]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PUT /api/trips/:id  (update) ──────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const user  = req.session.user;
  const body  = req.body;
  const lines = body.expense_lines;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Only travellers (own trip) or admin can edit; and only if draft/returned
    const existing = await client.query('SELECT * FROM trips WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Trip not found' });

    const trip = existing.rows[0];
    if (user.role === 'traveller' && trip.traveller_id !== user.id)
      return res.status(403).json({ error: 'Not your trip' });
    if (!['draft','returned'].includes(trip.status) && user.role !== 'admin')
      return res.status(400).json({ error: `Cannot edit a trip in '${trip.status}' status` });

    await client.query(
      `UPDATE trips SET
         trip_type=$1, billable=$2, internal_category=$3,
         customer_name=$4, customer_location=$5, po_number=$6, po_date=$7,
         wo_number=$8, wo_date=$9, invoice_number=$10,
         traveller_name=$11, vendor_code=$12, job_order_no=$13,
         travel_route=$14, destination_country=$15,
         travel_start_date=$16, travel_end_date=$17,
         manday_count=$18, manday_rate=$19,
         reviewer_id=$20, approver_id=$21,
         updated_by=$22, updated_at=NOW()
       WHERE id = $23`,
      [
        body.trip_type         || trip.trip_type,
        body.billable          || trip.billable,
        body.internal_category ?? trip.internal_category,
        body.customer_name     ?? trip.customer_name,
        body.customer_location ?? trip.customer_location,
        body.po_number         ?? trip.po_number,
        body.po_date           ?? trip.po_date,
        body.wo_number         ?? trip.wo_number,
        body.wo_date           ?? trip.wo_date,
        body.invoice_number    ?? trip.invoice_number,
        body.traveller_name    ?? trip.traveller_name,
        body.vendor_code       ?? trip.vendor_code,
        body.job_order_no      ?? trip.job_order_no,
        body.travel_route      ?? trip.travel_route,
        body.destination_country ?? trip.destination_country,
        body.travel_start_date ?? trip.travel_start_date,
        body.travel_end_date   ?? trip.travel_end_date,
        body.manday_count      ?? trip.manday_count,
        body.manday_rate       ?? trip.manday_rate,
        body.reviewer_id       ?? trip.reviewer_id,
        body.approver_id       ?? trip.approver_id,
        user.id,
        req.params.id
      ]
    );

    // Replace expense lines if provided
    if (Array.isArray(lines)) {
      await client.query('DELETE FROM expense_lines WHERE trip_id = $1', [req.params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await client.query(
          `INSERT INTO expense_lines
             (trip_id, line_order, expense_date, description, mode, bill_no,
              amount_inr, currency_code, amount_foreign, fx_rate, amount_converted_inr,
              credit_card_ref, is_advance_deduction, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            req.params.id, i,
            l.expense_date || null, l.description || null, l.mode || null, l.bill_no || null,
            l.amount_inr || 0, l.currency_code || 'INR',
            l.amount_foreign || null, l.fx_rate || null, l.amount_converted_inr || null,
            l.credit_card_ref || null, l.is_advance_deduction || false, l.remarks || null
          ]
        );
      }
    }

    await recalcTotals(client, req.params.id);
    await client.query('COMMIT');

    const result = await db.query('SELECT * FROM trips WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/trips/:id  (soft delete) ──────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const user = req.session.user;
  try {
    const { rows } = await db.query('SELECT * FROM trips WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'traveller' && rows[0].traveller_id !== user.id)
      return res.status(403).json({ error: 'Not your trip' });

    await db.query(
      'UPDATE trips SET deleted_at = NOW(), updated_by = $1 WHERE id = $2',
      [user.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
