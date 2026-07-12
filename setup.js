#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n┌─────────────────────────────┐');
console.log('│ NoteMeet — Setup            │');
console.log('└─────────────────────────────┘\n');

rl.question('Enter the Gmail address to receive signups (sangkalbe@gmail.com): ', (toEmail) => {
  rl.question('Enter the Gmail address that will SEND the emails: ', (fromEmail) => {
    rl.question('Enter the Gmail App Password for that account (16 chars): ', (password) => {
      const envContent = `# NoteMeet Email Configuration
EMAIL_TO=${toEmail || 'sangkalbe@gmail.com'}
EMAIL_FROM=${fromEmail || ''}
EMAIL_PASS=${password || ''}

# To get a Gmail App Password:
# 1. Go to https://myaccount.google.com/apppasswords
# 2. Select "Mail" and your device
# 3. Copy the 16-character password here
`;

      const envPath = path.join(__dirname, '.env');
      fs.writeFileSync(envPath, envContent);
      console.log('\n✅ .env file created at', envPath);
      console.log('Run `node server.js` to start the server.\n');
      rl.close();
    });
  });
});
