const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const customFetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Supabase Client with explicit fetch polyfill
const SUPABASE_URL = 'https://zeiilpgzoqeigbxzkjng.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Eq1Tqo9B6yYAQP5hFUvhhw_xigLm_to';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false
  },
  global: {
    fetch: customFetch
  }
});

app.get('/', (req, res) => {
  res.send('RETRO API is online');
});

// 1. REGISTER ENDPOINT
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const email = `${username.toLowerCase().trim()}@retro.app`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { 
        data: { username: username.trim() } 
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({ message: 'User registered successfully', username });
  } catch (err) {
    console.error('Register Endpoint Error:', err);
    return res.status(500).json({ error: err.message || 'Server backend connection error.' });
  }
});

// 2. LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('Login Endpoint Error:', err);
    return res.status(500).json({ error: err.message || 'Server backend connection error.' });
  }
});

app.listen(PORT, () => {
  console.log(`RETRO backend listening on port ${PORT}`);
});
