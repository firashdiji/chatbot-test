// Minimal Node/Express server to accept file uploads and proxy chat to OpenAI
// Usage:
//   - install: npm install express multer dotenv node-fetch
//   - set env: OPENAI_API_KEY=sk-...
//   - run: node server.js
//
// Note: For production add validation, auth, HTTPS, rate limiting.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn('Warning: OPENAI_API_KEY not set. /api/chat will fail without it.');
}

// storage for uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // unique filename
    const safe = Date.now() + '-' + Math.random().toString(36).slice(2,8) + path.extname(file.originalname);
    cb(null, safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir)); // serve uploaded files

// simple upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url, name: req.file.originalname, type: req.file.mimetype });
});

// chat endpoint: forwards to OpenAI Chat Completions (server-side only)
app.post('/api/chat', async (req, res) => {
  const { text, attachments } = req.body || {};
  if (!text && (!attachments || attachments.length===0)) {
    return res.status(400).json({ error: 'No text or attachments' });
  }
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured on server' });
  }

  // Build a prompt that includes attachments summary.
  let userContent = text || '';
  if (attachments && attachments.length){
    userContent += '\n\nAttachments:\n';
    attachments.forEach((a, idx) => {
      userContent += `${idx+1}. ${a.name || 'file'} (${a.type || 'unknown'}) - ${a.url || 'no-url'}\n`;
    });
    userContent += '\nPlease consider these attachments when answering. If you cannot access an attachment, mention that you could not access it.';
  }

  // Compose messages for the Chat API
  const messages = [
    { role: 'system', content: 'You are an assistant that replies helpfully and concisely. If attachments are included, mention their filenames and explain you may not be able to view them directly unless the server provided extracted text.' },
    { role: 'user', content: userContent }
  ];

  try {
    // Call OpenAI Chat Completion API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // change to preferred model
        messages,
        max_tokens: 500,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('OpenAI error:', errText);
      return res.status(500).json({ error: 'OpenAI API error', detail: errText });
    }
    const data = await response.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : 'No reply';

    // Optionally, you can analyze attachments here (OCR, image captioning) and include results.
    // For now, we just return the reply and echo the attachments (with their public URLs).
    res.json({ reply, attachments: (attachments || []).map(a => ({ name: a.name, url: a.url, type: a.type })) });
  } catch (err) {
    console.error('Chat error', err);
    res.status(500).json({ error: 'Server error', detail: String(err) });
  }
});

app.listen(PORT, ()=> {
  console.log(`Server running on http://localhost:${PORT}`);
});