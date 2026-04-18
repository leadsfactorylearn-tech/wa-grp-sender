# 💬 WA Blaster — WhatsApp Group Messenger Tool

A full-featured web tool to fetch all your WhatsApp groups and send messages — individually, in bulk, or on a schedule.

## ✨ Features
- 🔐 Connect via QR code scan (no API key needed)
- 📋 Auto-fetch all your WhatsApp groups
- 💬 Send same message to all / selected groups
- ✏️ Send custom messages per group
- ⏰ Schedule messages for a future date/time
- 📊 Live activity log & send progress
- 💾 Session saved — no re-scan on restart

## 🚀 Setup

### 1. Install Node.js
Download from https://nodejs.org (v16 or higher)

### 2. Install dependencies
```bash
cd whatsapp-tool
npm install
```

### 3. Start the server
```bash
npm start
```

### 4. Open the tool
Go to: **http://localhost:3000**

### 5. Connect WhatsApp
1. Click **"Connect WhatsApp"**
2. Open WhatsApp on your phone
3. Go to **Settings → Linked Devices → Link a Device**
4. Scan the QR code shown in the browser
5. Your groups will load automatically ✅

## ⚠️ Important Notes

- **Anti-ban**: A 1.5s delay is added between each message send to reduce ban risk
- **Personal use only**: Don't use for spam or bulk marketing
- **Official API**: For business use, consider the official WhatsApp Business API
- **Session**: Your session is saved in `.wwebjs_auth/` folder — delete it to reset

## 📁 Project Structure
```
whatsapp-tool/
├── server.js        # Node.js + Express backend
├── package.json     # Dependencies
├── public/
│   └── index.html   # Web UI
└── README.md
```

## 🛠 Troubleshooting

**Puppeteer issues on Linux?**
```bash
sudo apt-get install -y chromium-browser
```

**QR not showing?**
- Delete `.wwebjs_auth/` folder and restart

**Groups not loading?**
- Make sure you have active WhatsApp groups
- Click the refresh button or reconnect
