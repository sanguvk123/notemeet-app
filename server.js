const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ─── Security Headers ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // we'll set our own
  crossOriginEmbedderPolicy: false,
}));

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:"],
    frameSrc: ["https://challenges.cloudflare.com"],
    connectSrc: ["'self'", "https://api.web3forms.com"],
  }
}));

// ─── CORS ──────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://sanguvk123.github.io',
  'https://notemeet.app', // placeholder for custom domain
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (origin.endsWith('.github.io')) return cb(null, true);
    cb(null, true); // allow all for now — tighten after launch
  },
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '10kb' })); // prevent large payloads

// ─── Rate Limiting ─────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // max 30 requests per 15 min per IP
  message: { error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // max 3 signups per hour per IP
  message: { error: 'Too many signups from this IP. Try again later.' },
});

app.use('/api/', apiLimiter);
app.use('/api/waitlist', formLimiter);

// ─── Static files ─────────────────────────────────────────────────
app.use(express.static(__dirname, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ─── Data ──────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'waitlist.json');
const PORT = process.env.PORT || 3000;

const EMAIL_TO = process.env.EMAIL_TO || 'sangkalbe@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_PASS = process.env.EMAIL_PASS;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';

const transporter = EMAIL_PASS ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_FROM, pass: EMAIL_PASS }
}) : null;

function getWaitlist() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveEntry(entry) {
  const list = getWaitlist();
  list.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

// ─── Validation ────────────────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, '').trim().slice(0, 200);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isDuplicate(email) {
  return getWaitlist().some(e => e.email.toLowerCase() === email.toLowerCase());
}

// ─── Turnstile verification ────────────────────────────────────────
async function verifyTurnstile(token) {
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: TURNSTILE_SECRET, response: token })
    });
    const data = await res.json();
    return data.success;
  } catch { return false; }
}

// ─── Email ─────────────────────────────────────────────────────────
async function sendEmail(entry) {
  if (!transporter) {
    console.log('[Email] Not configured — skipping');
    return;
  }
  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject: `[NoteMeet] New signup — ${entry.email}`,
      text: [
        `New NoteMeet waitlist signup!`,
        ``,
        `Email: ${entry.email}`,
        `Role: ${entry.role}`,
        `Time: ${entry.timestamp}`,
        `IP: ${entry.ip}`,
        `Total signups: ${getWaitlist().length}`,
      ].join('\n'),
    });
    console.log(`[Email] Sent for ${entry.email}`);
  } catch (err) {
    console.error('[Email] Failed:', err.message);
  }
}

// ─── Routes ────────────────────────────────────────────────────────
app.post('/api/waitlist', async (req, res) => {
  const { email, role, cfTurnstileToken } = req.body;

  // Validate Turnstile if configured
  if (TURNSTILE_SECRET) {
    const valid = await verifyTurnstile(cfTurnstileToken);
    if (!valid) {
      return res.status(403).json({ error: 'Bot detected. Please try again.' });
    }
  }

  // Validate input
  const cleanEmail = sanitize(email);
  const cleanRole = sanitize(role);

  if (!cleanEmail || !cleanRole) {
    return res.status(400).json({ error: 'Email and role required' });
  }

  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const validRoles = ['founder', 'engineer', 'pm', 'designer', 'other'];
  if (!validRoles.includes(cleanRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Check duplicate
  if (isDuplicate(cleanEmail)) {
    return res.status(409).json({ error: 'This email is already on the list!' });
  }

  const entry = {
    email: cleanEmail,
    role: cleanRole,
    ip: req.ip || req.connection?.remoteAddress || 'unknown',
    timestamp: new Date().toISOString(),
  };

  saveEntry(entry);
  console.log(`[Waitlist] ${cleanEmail} — ${cleanRole}`);

  sendEmail(entry).catch(() => {});

  res.json({ success: true, message: 'You are on the list!' });
});

app.get('/api/waitlist/count', (req, res) => {
  const list = getWaitlist();
  const recent = list.slice(-5).reverse().map(e => ({
    role: e.role,
    time: e.timestamp,
  }));
  res.json({ count: list.length, recent });
});

// ─── Prevent direct access to data file ────────────────────────────
app.get('/waitlist.json', (req, res) => {
  res.status(403).json({ error: 'Forbidden' });
});

// ─── GDPR cleanup endpoint ─────────────────────────────────────────
app.post('/api/waitlist/delete', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const list = getWaitlist();
  const filtered = list.filter(e => e.email.toLowerCase() !== email.toLowerCase());
  fs.writeFileSync(DATA_FILE, JSON.stringify(filtered, null, 2));
  res.json({ success: true, message: 'Data deleted.' });
});

// ─── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`NoteMeet running on http://localhost:${PORT}`);
  if (!EMAIL_PASS) console.log('⚠️  Email disabled. Set EMAIL_PASS in .env');
  if (!TURNSTILE_SECRET) console.log('⚠️  Turnstile disabled. Bot protection not active.');
});
