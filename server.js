const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const schedule = require('node-schedule');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer: save uploads to /uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 16 * 1024 * 1024 } }); // 16MB max

let client = null;
let groups = [];
let scheduledJobs = {};
let scheduledMessages = [];

function initClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--aggressive-cache-discard',
            '--disable-cache',
            '--disable-application-cache',
            '--disable-offline-load-stale-cache',
            '--disk-cache-size=0',
            '--js-flags=--max-old-space-size=512'
        ]
    }
});

  client.on('qr', async (qr) => {
    const qrImage = await qrcode.toDataURL(qr);
    io.emit('qr', qrImage);
    io.emit('status', { type: 'info', message: 'Scan the QR code with WhatsApp' });
  });

  client.on('ready', async () => {
    io.emit('connected', true);
    io.emit('status', { type: 'success', message: 'WhatsApp connected successfully!' });
    await fetchGroups();
  });

  client.on('auth_failure', () => {
    io.emit('status', { type: 'error', message: 'Authentication failed. Please refresh and try again.' });
  });

  client.on('disconnected', () => {
    io.emit('connected', false);
    io.emit('status', { type: 'warning', message: 'WhatsApp disconnected.' });
    groups = [];
  });

  client.initialize();
}

async function fetchGroups() {
  try {
    const chats = await client.getChats();
    groups = chats
      .filter(c => c.isGroup)
      .map(g => ({ id: g.id._serialized, name: g.name, participants: g.participants?.length || 0 }));
    io.emit('groups', groups);
    io.emit('status', { type: 'success', message: `Fetched ${groups.length} groups` });
  } catch (err) {
    io.emit('status', { type: 'error', message: 'Failed to fetch groups: ' + err.message });
  }
}

async function sendToGroups(groupIds, message, imagePath, delayMs = 1500) {
  let sent = 0, failed = 0;
  for (const gid of groupIds) {
    try {
      const chat = await client.getChatById(gid);
      if (imagePath && fs.existsSync(imagePath)) {
        const media = MessageMedia.fromFilePath(imagePath);
        await chat.sendMessage(media, { caption: message || '' });
      } else {
        await chat.sendMessage(message);
      }
      sent++;
      const grp = groups.find(g => g.id === gid);
      io.emit('sendProgress', { groupId: gid, groupName: grp?.name, status: 'sent', sent, failed, total: groupIds.length });
      await delay(delayMs);
    } catch (err) {
      failed++;
      const grp = groups.find(g => g.id === gid);
      io.emit('sendProgress', { groupId: gid, groupName: grp?.name, status: 'failed', error: err.message, sent, failed, total: groupIds.length });
    }
  }
  io.emit('sendComplete', { sent, failed, total: groupIds.length });
  // Clean up temp image after sending
  if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
}

// Upload image endpoint
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, filename: req.file.filename, path: req.file.path });
});

// Send broadcast (with optional image)
app.post('/api/send', async (req, res) => {
  const { groupIds, message, imageFilename } = req.body;
  if (!client) return res.status(400).json({ error: 'Not connected' });
  if (!groupIds?.length) return res.status(400).json({ error: 'No groups selected' });
  if (!message && !imageFilename) return res.status(400).json({ error: 'Message or image required' });
  const imagePath = imageFilename ? path.join(uploadsDir, imageFilename) : null;
  sendToGroups(groupIds, message, imagePath);
  res.json({ ok: true });
});

// Send custom messages (per group, with optional per-group image)
app.post('/api/send-custom', async (req, res) => {
  const { messages } = req.body;
  if (!client) return res.status(400).json({ error: 'Not connected' });
  if (!messages?.length) return res.status(400).json({ error: 'Missing messages' });
  (async () => {
    let sent = 0, failed = 0;
    for (const item of messages) {
      try {
        const chat = await client.getChatById(item.groupId);
        if (item.imageFilename) {
          const imgPath = path.join(uploadsDir, item.imageFilename);
          if (fs.existsSync(imgPath)) {
            const media = MessageMedia.fromFilePath(imgPath);
            await chat.sendMessage(media, { caption: item.message || '' });
            fs.unlinkSync(imgPath);
          }
        } else {
          await chat.sendMessage(item.message);
        }
        sent++;
        const grp = groups.find(g => g.id === item.groupId);
        io.emit('sendProgress', { groupId: item.groupId, groupName: grp?.name, status: 'sent', sent, failed, total: messages.length });
        await delay(1500);
      } catch (err) {
        failed++;
        const grp = groups.find(g => g.id === item.groupId);
        io.emit('sendProgress', { groupId: item.groupId, groupName: grp?.name, status: 'failed', error: err.message, sent, failed, total: messages.length });
      }
    }
    io.emit('sendComplete', { sent, failed, total: messages.length });
  })();
  res.json({ ok: true });
});

// Schedule message
app.post('/api/schedule', (req, res) => {
  const { groupIds, message, scheduledAt, imageFilename } = req.body;
  if (!groupIds?.length || !scheduledAt) return res.status(400).json({ error: 'Missing fields' });
  if (!message && !imageFilename) return res.status(400).json({ error: 'Message or image required' });
  const date = new Date(scheduledAt);
  if (date <= new Date()) return res.status(400).json({ error: 'Scheduled time must be in the future' });
  const jobId = Date.now().toString();
  const imagePath = imageFilename ? path.join(uploadsDir, imageFilename) : null;
  const job = schedule.scheduleJob(date, () => {
    sendToGroups(groupIds, message, imagePath);
    scheduledMessages = scheduledMessages.map(m => m.id === jobId ? { ...m, status: 'sent' } : m);
    io.emit('scheduledMessages', scheduledMessages);
  });
  scheduledJobs[jobId] = job;
  const groupNames = groupIds.map(id => groups.find(g => g.id === id)?.name || id);
  scheduledMessages.push({ id: jobId, groupIds, groupNames, message, imageFilename, scheduledAt, status: 'pending' });
  io.emit('scheduledMessages', scheduledMessages);
  res.json({ ok: true, jobId });
});

app.delete('/api/schedule/:id', (req, res) => {
  const { id } = req.params;
  if (scheduledJobs[id]) { scheduledJobs[id].cancel(); delete scheduledJobs[id]; }
  scheduledMessages = scheduledMessages.filter(m => m.id !== id);
  io.emit('scheduledMessages', scheduledMessages);
  res.json({ ok: true });
});

app.get('/api/groups', (req, res) => res.json(groups));
app.get('/api/scheduled', (req, res) => res.json(scheduledMessages));
app.post('/api/refresh-groups', async (req, res) => {
  if (!client) return res.status(400).json({ error: 'Not connected' });
  await fetchGroups();
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.emit('groups', groups);
  socket.emit('scheduledMessages', scheduledMessages);
  if (client?.info) socket.emit('connected', true);
});

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
  initClient();
});
