const express = require('express');
const db      = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const mailer  = require('../mailer');

const router = express.Router();

// ── Helper ────────────────────────────────────────────────────────────────────

async function transition(tripId, actorId, actorName, toStatus, comment, res) {
  const { rows } = await db.query(
    `UPDATE trips
     SET status = $1, updated_at = NOW(), updated_by = $2
     WHERE id = $3 AND deleted_at IS NULL
     RETURNING *`,
    [toStatus, actorId, tripId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });

  await db.query(
    `INSERT INTO workflow_events (trip_id, actor_id, actor_name, from_status, to_status, comment)
     SELECT $1, $2, $3, status, $4, $5 FROM trips WHERE id = $1`,
    [tripId, actorId, actorName, toStatus, comment || null]
  );

  return rows[0];
}

async function getRelatedEmails(tripId) {
  const { rows } = await db.query(
    `SELECT
       tu.email  AS traveller_email,
       ru.email  AS reviewer_email,
       au.email  AS approver_email
     FROM trips t
     LEFT JOIN users tu ON tu.id = t.traveller_id
     LEFT JOIN users ru ON ru.id = t.reviewer_id
     LEFT JOIN users au ON au.id = t.approver_id
     WHERE t.id = $1`,
    [tripId]
  );
  return rows[0] || {};
}

async function getAccountsAndDirectors() {
  const { rows } = await db.query(
    `SELECT email FROM users WHERE role IN ('accounts','director') AND email IS NOT NULL`
  );
  return rows.map(r => r.email).join(',');
}

// ── POST /api/workflow/:id/submit ─────────────────────────────────────────────
router.post('/:id/submit', requireAuth, async (req, res) => {
  const user = req.session.user;
  try {
    const trip = await transition(req.params.id, user.id, user.full_name, 'submitted', null, res);
    if (!trip) return;

    const emails = await getRelatedEmails(req.params.id);
    await mailer.onTripSubmitted(trip, emails.reviewer_email).catch(console.error);

    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/return  (reviewer sends back) ─────────────────────
router.post('/:id/return', requireRole('reviewer','approver','admin'), async (req, res) => {
  const user    = req.session.user;
  const comment = req.body.comment;
  if (!comment) return res.status(400).json({ error: 'A comment is required when returning a trip' });

  try {
    await db.query('UPDATE trips SET reviewer_comment = $1 WHERE id = $2', [comment, req.params.id]);
    const trip = await transition(req.params.id, user.id, user.full_name, 'returned', comment, res);
    if (!trip) return;

    const emails = await getRelatedEmails(req.params.id);
    await mailer.onTripReturned(trip, emails.traveller_email, comment).catch(console.error);

    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/review  (reviewer accepts) ────────────────────────
router.post('/:id/review', requireRole('reviewer','admin'), async (req, res) => {
  const user = req.session.user;
  try {
    const trip = await transition(req.params.id, user.id, user.full_name, 'reviewed', req.body.comment || null, res);
    if (!trip) return;

    const emails = await getRelatedEmails(req.params.id);
    await mailer.onTripReviewed(trip, emails.approver_email).catch(console.error);

    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/approve ────────────────────────────────────────────
router.post('/:id/approve', requireRole('approver','admin'), async (req, res) => {
  const user = req.session.user;
  try {
    await db.query(
      'UPDATE trips SET approved_by = $1, approved_date = NOW() WHERE id = $2',
      [user.full_name, req.params.id]
    );
    const trip = await transition(req.params.id, user.id, user.full_name, 'approved', req.body.comment || null, res);
    if (!trip) return;

    const recipients = await getAccountsAndDirectors();
    await mailer.onTripApproved(trip, recipients).catch(console.error);

    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/workflow/:id/paid  (accounts / director marks paid) ─────────────
router.post('/:id/paid', requireRole('accounts','director','admin'), async (req, res) => {
  const user = req.session.user;
  try {
    const trip = await transition(req.params.id, user.id, user.full_name, 'paid', req.body.comment || null, res);
    if (!trip) return;

    const emails = await getRelatedEmails(req.params.id);
    await mailer.onTripPaid(trip, emails.traveller_email).catch(console.error);

    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/workflow/:id/history ─────────────────────────────────────────────
router.get('/:id/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT we.*, u.full_name AS actor_name
       FROM workflow_events we
       LEFT JOIN users u ON u.id = we.actor_id
       WHERE we.trip_id = $1
       ORDER BY we.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
