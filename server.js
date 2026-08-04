const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Supabase Client
const SUPABASE_URL = 'https://zeiilpgzoeigbxzkjng.supabase.co
';
const SUPABASE_ANON_KEY = 'sb_publishable_Eq1Tqo9B6yYAQP5hFUvhhw_xigLm_to';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Health check
app.get('/', (req, res) => res.send('RETRO API online'));

// 1. REGISTER
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const email = `${username.toLowerCase().trim()}@retro.app`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(201).json({ message: 'User registered successfully', username });
});

// 2. LOGIN
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const email = `${username.toLowerCase().trim()}@retro.app`;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  return res.status(200).json({ message: 'Login successful', username });
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
