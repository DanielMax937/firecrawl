const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3200;

// Recordings directory (same as playwright-service-ts)
const RECORDINGS_DIR = path.resolve(__dirname, '../../recordings');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: List all recordings
app.get('/api/recordings', (req, res) => {
  try {
    if (!fs.existsSync(RECORDINGS_DIR)) {
      return res.json({ recordings: [] });
    }

    const files = fs.readdirSync(RECORDINGS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(RECORDINGS_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ recordings: files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get recording content
app.get('/api/recordings/:filename', (req, res) => {
  try {
    const filename = req.params.filename;

    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(RECORDINGS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const events = JSON.parse(content);

    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the player page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎬 rrweb Player Service running at http://localhost:${PORT}`);
  console.log(`📁 Recordings directory: ${RECORDINGS_DIR}`);
});
