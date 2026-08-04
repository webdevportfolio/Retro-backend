const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Supabase Credentials
const SUPABASE_URL = 'https://zeiilpgzoeigbxzkjng.supabase.co';
const SUPABASE_SECRET_KEY = 'sb_secret_rHPwPpO5jNtPUqCQQA6gDA_Cz5dvntO'; // Replace with your secret key

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// 1. REGISTER USER ROUTE
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const { data: existingUser } = await supabase
    .from('users')
    .select('username')
    .eq('username', username)
    .single();

  if (existingUser) {
    return res.status(400).json({ error: 'Username already taken.' });
  }

  const { data, error } = await supabase
    .from('users')
    .insert([{ username, password_hash: password }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ message: 'Registered successfully!', user: data[0] });
});

// 2. LOGIN USER ROUTE
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', username)
    .eq('password_hash', password)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  return res.status(200).json({ message: 'Login successful!', user });
});

// 3. FETCH INBOX MESSAGES FOR A USER
app.get('/api/messages/:username', async (req, res) => {
  const { username } = req.params;

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .eq('receiver_username', username)
    .gt('expires_at', new Date().toISOString()) // Only fetch non-expired messages
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(messages);
});

// 4. SEND A NEW MESSAGE
app.post('/api/messages', async (req, res) => {
  const { sender_username, receiver_username, content, duration_minutes } = req.body;

  if (!sender_username || !receiver_username || !content) {
    return res.status(400).json({ error: 'Missing required message details.' });
  }

  // Calculate expiration time based on duration (default 5 mins)
  const minutes = duration_minutes || 5;
  const expires_at = new Date(Date.now() + minutes * 60000).toISOString();

  const { data, error } = await supabase
    .from('messages')
    .insert([{ sender_username, receiver_username, content, expires_at }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ message: 'Message sent successfully!', data: data[0] });
});

// TEST ROUTE
app.get('/', (req, res) => {
  res.json({ message: 'Retro API Server is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
