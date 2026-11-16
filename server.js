require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');

const authRoutes     = require('./routes/auth');
const tripRoutes     = require('./routes/trips');
const workflowRoutes = require('./routes/workflow');
const fxRoutes       = require('./routes/fx');
const fileRoutes     = require('./routes/files');
const { pool } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000   // 8 hours
  }
}));

// ── Static files ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ──────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/trips',    tripRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/fx',       fxRoutes);
app.use('/api/files',    fileRoutes);

// ── Page routes ─────────────────────────────────────────────
app.get('/login',    (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/app',      (_req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/review',   (_req, res) => res.sendFile(path.join(__dirname, 'public', 'review.html')));
app.get('/',         (_req, res) => res.redirect('/login'));

// ── 404 ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`\n  Yantriki Travel Portal`);
  console.log(`  Running at http://localhost:${PORT}\n`);
});