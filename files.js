const express = require('express');
const multer  = require('multer');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },   // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf','image/jpeg','image/png','image/jpg'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only PDF, JPG, PNG allowed'));
  }
});

// ── POST /api/files/upload/:tripId  (optionally attach to a line) ─────────────
router.post('/upload/:tripId', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { tripId }       = req.params;
  const { expense_line_id } = req.body;
  const user             = req.session.user;

  try {
    // Verify trip exists and belongs to user (or admin)
    const { rows } = await db.query('SELECT * FROM trips WHERE id = $1 AND deleted_at IS NULL', [tripId]);
    if (!rows[0]) return res.status(404).json({ error: 'Trip not found' });
    if (user.role === 'traveller' && rows[0].traveller_id !== user.id)
      return res.status(403).json({ error: 'Not your trip' });

    const result = await db.query(
      `INSERT INTO attachments (trip_id, expense_line_id, file_name, file_type, file_content, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, trip_id, expense_line_id, file_name, file_type, uploaded_at`,
      [
        tripId,
        expense_line_id || null,
        req.file.originalname,
        req.file.mimetype,
        req.file.buffer,
        user.id
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/files/:attachmentId  (download) ─────────────────────────────────
router.get('/:attachmentId', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM attachments WHERE id = $1',
      [req.params.attachmentId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'File not found' });

    res.set('Content-Type', rows[0].file_type);
    res.set('Content-Disposition', `inline; filename="${rows[0].file_name}"`);
    res.send(rows[0].file_content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/files/:attachmentId ──────────────────────────────────────────
router.delete('/:attachmentId', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM attachments WHERE id = $1', [req.params.attachmentId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/files/trip/:tripId  (list attachments for a trip) ───────────────
router.get('/trip/:tripId', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, trip_id, expense_line_id, file_name, file_type, uploaded_at
       FROM attachments WHERE trip_id = $1 ORDER BY uploaded_at`,
      [req.params.tripId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
