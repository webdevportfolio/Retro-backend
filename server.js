const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Setup
const dbPath = path.resolve(__dirname, 'retro.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Initialize Database Tables
db.serialize(() => {
  // Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Messages Table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_username TEXT NOT NULL,
      receiver_username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )
  `);
});

// Root Health Check Route
app.get('/', (req, res) => {
  res.send('RETRO API Server is running.');
});

// 1. REGISTER ENDPOINT
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const query = `INSERT INTO users (username, password) VALUES (?, ?)`;
  db.run(query, [username, password], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      return res.status(500).json({ error: 'Database error while registering.' });
    }

    return res.status(201).json({
      message: 'User registered successfully.',
      user: { id: this.lastID, username }
    });
  });
});

// 2. LOGIN ENDPOINT
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const query = `SELECT * FROM users WHERE username = ? AND password = ?`;
  db.get(query, [username, password], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error while logging in.' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    return res.status(200).json({
      message: 'Login successful.',
      user: { id: user.id, username: user.username }
    });
  });
});

// 3. SEND MESSAGE ENDPOINT (5 minute expiration)
app.post('/api/messages', (req, res) => {
  const { sender_username, receiver_username, content, duration_minutes = 5 } = req.body;

  if (!sender_username || !receiver_username || !content) {
    return res.status(400).json({ error: 'Missing required message parameters.' });
  }

  // Calculate expiration time (default 5 minutes)
  const expiresAt = new Date(Date.now() + duration_minutes * 60 * 1000).toISOString();

  const query = `
    INSERT INTO messages (sender_username, receiver_username, content, expires_at)
    VALUES (?, ?, ?, ?)
  `;

  db.run(query, [sender_username, receiver_username, content, expiresAt], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to send message.' });
    }

    return res.status(201).json({
      message: 'Message sent successfully.',
      data: {
        id: this.lastID,
        sender_username,
        receiver_username,
        content,
        expires_at: expiresAt
      }
    });
  });
});

// 4. GET MESSAGES FOR A USER (Filters out expired messages automatically)
app.get('/api/messages/:username', (req, res) => {
  const { username } = req.params;
  const now = new Date().toISOString();

  // Delete expired messages on read
  db.run(`DELETE FROM messages WHERE expires_at <= ?`, [now]);

  const query = `
    SELECT * FROM messages 
    WHERE (receiver_username = ? OR sender_username = ?) AND expires_at > ?
    ORDER BY created_at ASC
  `;

  db.all(query, [username, username, now], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch messages.' });
    }
    return res.status(200).json(rows || []);
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`RETRO backend listening on port ${PORT}`);
});
