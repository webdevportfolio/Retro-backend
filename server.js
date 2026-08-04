const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Supabase Admin Client
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 1. REGISTER ENDPOINT
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const email = `${username.toLowerCase()}@retro.app`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(201).json({ message: 'User registered successfully', user: data.user });
});

// 2. LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const email = `${username.toLowerCase()}@retro.app`;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(400).json({ error: 'Invalid username or password.' });
  }

  return res.status(200).json({ message: 'Login successful', user: data.user });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
