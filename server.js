const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const customFetch = require('node-fetch');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Supabase Client
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

// Configure Web Push Keys
const vapidKeys = (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) 
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : webpush.generateVAPIDKeys();

webpush.setVapidDetails(
  'mailto:support@retro.app',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

app.get('/', (req, res) => {
  res.send('RETRO API is online');
});

// GET PUBLIC VAPID KEY
app.get('/api/vapid-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// SAVE PUSH SUBSCRIPTION (Persisted in Supabase DB)
app.post('/api/subscribe', async (req, res) => {
  try {
    const { username, subscription } = req.body;
    if (!username || !subscription) return res.status(400).json({ error: 'Missing subscription details' });

    const cleanUser = username.trim().toLowerCase();

    const { error } = await supabase
      .from('subscriptions')
      .upsert(
        { username: cleanUser, subscription: JSON.stringify(subscription), updated_at: new Date().toISOString() },
        { onConflict: 'username' }
      );

    if (error) {
      console.error('Failed to save subscription:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ message: 'Subscribed to notifications successfully' });
  } catch (err) {
    console.error('Subscribe Endpoint Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 1. REGISTER ENDPOINT
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const cleanUsername = username.trim();
    const email = `${cleanUsername.toLowerCase()}@retro.app`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { 
        data: { username: cleanUsername } 
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const { error: dbError } = await supabase
      .from('users')
      .insert([{ username: cleanUsername, password_hash: password }]);

    if (dbError) {
      console.error('Warning: Could not insert into public users table:', dbError.message);
    }

    return res.status(201).json({ message: 'User registered successfully', username: cleanUsername });
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

// 3. GET MESSAGES ENDPOINT
app.get('/api/messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = username.trim();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_username.eq.${cleanUsername},receiver_username.eq.${cleanUsername}`)
      .gt('expires_at', nowIso);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Get Messages Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. SEND MESSAGE ENDPOINT (Triggers System Push Notification from Persistent Subscriptions)
app.post('/api/messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, duration_minutes } = req.body;

    if (!sender_username || !receiver_username || !content) {
      return res.status(400).json({ error: 'Missing required message fields.' });
    }

    const duration = duration_minutes || 1440;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60000).toISOString();

    const { data, error } = await supabase
      .from('messages')
      .insert([
        {
          sender_username: sender_username.trim(),
          receiver_username: receiver_username.trim(),
          content: content.trim(),
          created_at: now.toISOString(),
          expires_at: expiresAt
        }
      ])
      .select();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(400).json({ error: error.message });
    }

    // Retrieve Receiver's Push Subscription from Supabase
    const receiverKey = receiver_username.trim().toLowerCase();
    const { data: subData } = await supabase
      .from('subscriptions')
      .select('subscription')
      .eq('username', receiverKey)
      .maybeSingle();

    if (subData && subData.subscription) {
      const pushSub = typeof subData.subscription === 'string' 
        ? JSON.parse(subData.subscription) 
        : subData.subscription;

      const payload = JSON.stringify({
        title: sender_username,
        body: content,
        url: `/chat.html?user=${encodeURIComponent(sender_username)}`
      });

      webpush.sendNotification(pushSub, payload).catch((pushErr) => {
        console.error('Push notification trigger error:', pushErr);
      });
    }

    return res.status(201).json({ message: 'Message sent successfully', data });
  } catch (err) {
    console.error('Send Message Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. DELETE USER & ASSOCIATED MESSAGES ENDPOINT
app.delete('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = username.trim();

    await supabase
      .from('subscriptions')
      .delete()
      .eq('username', cleanUsername.toLowerCase());

    const { error: msgError } = await supabase
      .from('messages')
      .delete()
      .or(`sender_username.eq.${cleanUsername},receiver_username.eq.${cleanUsername}`);

    if (msgError) {
      console.error('Error deleting user messages:', msgError.message);
    }

    const { error: userError } = await supabase
      .from('users')
      .delete()
      .eq('username', cleanUsername);

    if (userError) {
      console.error('Error deleting user record:', userError.message);
      return res.status(400).json({ error: userError.message });
    }

    return res.status(200).json({ 
      message: `User '${cleanUsername}' and all associated chat logs deleted successfully.` 
    });
  } catch (err) {
    console.error('Delete User Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// TYPING INDICATOR REAL-TIME STORE
const typingUsers = new Map();

app.post('/api/typing', (req, res) => {
  const { sender, receiver, isTyping } = req.body;
  if (!sender || !receiver) return res.status(400).json({ error: 'Missing parameters' });

  const key = `${sender.toLowerCase()}_${receiver.toLowerCase()}`;
  typingUsers.set(key, { isTyping, timestamp: Date.now() });
  
  res.json({ success: true });
});

app.get('/api/typing/:sender/:receiver', (req, res) => {
  const { sender, receiver } = req.params;
  const key = `${sender.toLowerCase()}_${receiver.toLowerCase()}`;
  const status = typingUsers.get(key);

  if (status && status.isTyping && (Date.now() - status.timestamp < 4000)) {
    return res.json({ isTyping: true });
  }

  res.json({ isTyping: false });
});

app.listen(PORT, () => {
  console.log(`RETRO backend listening on port ${PORT}`);
});
