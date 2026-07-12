const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'waitlist.json');
const PORT = process.env.PORT || 3000;

// Email config — set these in a .env file or replace directly
const EMAIL_TO = 'sangkalbe@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || 'notemeet.waitlist@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || ''; // Gmail App Password

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_FROM, pass: EMAIL_PASS }
});

function getWaitlist() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveEntry(entry) {
  const list = getWaitlist();
  list.push({ ...entry, timestamp: new Date().toISOString() });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

async function sendEmail(entry) {
  if (!EMAIL_PASS) {
    console.log('[Email] No EMAIL_PASS set — skipping email');
    return;
  }
  const text = `New NoteMeet waitlist signup!

Email: ${entry.email}
Role: ${entry.role}
Time: ${entry.timestamp}

Total signups: ${getWaitlist().length}`;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject: `[NoteMeet] New waitlist signup — ${entry.email}`,
      text
    });
    console.log(`[Email] Notification sent for ${entry.email}`);
  } catch (err) {
    console.error('[Email] Failed to send:', err.message);
  }
}

app.post('/api/waitlist', async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ error: 'Email and role required' });
  }

  const entry = { email, role, timestamp: new Date().toISOString() };
  saveEntry(entry);
  console.log(`[Waitlist] ${email} — ${role}`);

  // Fire email (don't block response)
  sendEmail(entry);

  res.json({ success: true, message: 'You are on the list!' });
});

app.get('/api/waitlist', (req, res) => {
  res.json(getWaitlist());
});

app.listen(PORT, () => {
  console.log(`NoteMeet running on http://localhost:${PORT}`);
  console.log(`Waitlist API: http://localhost:${PORT}/api/waitlist`);
  if (!EMAIL_PASS) {
    console.log('⚠️  Email sending disabled. Set EMAIL_PASS env var to enable.');
    console.log('   Get a Gmail App Password at: https://myaccount.google.com/apppasswords');
  }
});
