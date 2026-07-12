# NoteMeet — AI Notepad for Indian Teams

AI meeting notes without a bot. Works for online meetings, WhatsApp calls, and in-person conversations. Built for India.

## Features
- No bot joins your meetings (listens from your device)
- Hinglish + 10 Indian languages
- WhatsApp & VoIP call capture
- On-device processing (DPDP compliant)
- ₹199/mo (vs ₹1,500 for Fireflies/Granola)

## Quick Start

```bash
# Install dependencies
npm install

# Set up email (Gmail App Password)
npm run setup

# Start the server
npm start
```

## Email Setup

To receive waitlist signups via email:

1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" + your device → generate a 16-char password
3. Run `npm run setup` and enter the password

Alternatively, create a `.env` file:
```
EMAIL_TO=sangkalbe@gmail.com
EMAIL_FROM=your-email@gmail.com
EMAIL_PASS=your-16-char-app-password
```

## Deploy

- **Static site**: Push to GitHub and enable Pages (branch: `main`, folder: `/`)
- **API server**: Deploy `server.js` to Render/Railway (free tier)

## Built With
- HTML/CSS/JS
- Express + Nodemailer
- GitHub Pages
