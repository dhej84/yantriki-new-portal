const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username.trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.user = {
      id:        user.id,
      username:  user.username,
      full_name: user.full_name,
      email:     user.email,
      role:      user.role
    };

    res.json({ user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// GET /api/auth/users  (admin only — for reviewer/approver dropdowns)
router.get('/users', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, username, full_name, email, role
       FROM users
       ORDER BY full_name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/users  (admin only — create user)
router.post('/users', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });

  const { username, password, full_name, email, role } = req.body;
  if (!username || !password || !full_name || !role)
    return res.status(400).json({ error: 'username, password, full_name and role are required' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, full_name, email, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, email, role`,
      [username.trim().toLowerCase(), hash, full_name, email || null, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
