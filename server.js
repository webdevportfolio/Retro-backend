const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middleware & Explicit CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

// ==========================================
// 1. ENVIRONMENT & DATABASE SETUP
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-supabase-url.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'your-supabase-anon-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// VAPID Setup with Safe Fallback Handling
let publicVapidKey = process.env.VAPID_PUBLIC_KEY;
let privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (!publicVapidKey || !privateVapidKey) {
  const generatedKeys = webpush.generateVAPIDKeys();
  publicVapidKey = publicVapidKey || generatedKeys.publicKey;
  privateVapidKey = privateVapidKey || generatedKeys.privateKey;
}

try {
  webpush.setVapidDetails(
    'mailto:mustaphaadegboyega801@gmail.com',
    publicVapidKey,
    privateVapidKey
  );
} catch (e) {
  console.error('VAPID setup error, generating fresh fallback pair:', e.message);
  const generatedKeys = webpush.generateVAPIDKeys();
  publicVapidKey = generatedKeys.publicKey;
  privateVapidKey = generatedKeys.privateKey;
  webpush.setVapidDetails(
    'mailto:mustaphaadegboyega801@gmail.com',
    publicVapidKey,
    privateVapidKey
  );
}

// ==========================================
// 2. HEALTH CHECK
// ==========================================
app.get('/', (req, res) => {
  res.status(200).send('Retro Backend API is live and healthy!');
});

// ==========================================
// 3. AUTHENTICATION & USER PROFILE ENDPOINTS
// ==========================================
const handleSignup = async (req, res) => {
  const { username, password } = req.body;
  const cleanUsername = (username || '').trim().replace('@', '');

  if (!cleanUsername || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{ username: cleanUsername, password }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Username already taken.' });
      }
      return res.status(400).json({ error: error.message || 'Failed to create user account.' });
    }

    return res.status(201).json({ success: true, user: data });
  } catch (err) {
    console.error('Unexpected error during signup:', err);
    return res.status(500).json({ error: 'Internal server error during signup.' });
  }
};

app.post('/api/signup', handleSignup);
app.post('/api/register', handleSignup);

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const cleanUsername = (username || '').trim().replace('@', '');

  if (!cleanUsername || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', cleanUsername)
      .eq('password', password)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

// Fetch All Users (for Chat Code Search)
app.get('/api/users', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('username');

    if (error) throw error;
    res.json(users ? users.map(u => u.username) : []);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// Fetch Single User Profile (for profile.html)
app.get('/api/users/:username', async (req, res) => {
  const { username } = req.params;
  const cleanUser = (username || '').trim().replace('@', '');

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .ilike('username', cleanUser)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
});

// Update Profile Picture
app.post('/api/users/profile', async (req, res) => {
  const { username, profile_picture, pfp } = req.body;
  const cleanUser = (username || '').trim().replace('@', '');

  if (!cleanUser) {
    return res.status(400).json({ error: 'Username is required.' });
  }

  const pfpData = profile_picture || pfp;

  try {
    const { error } = await supabase
      .from('users')
      .update({ profile_picture: pfpData })
      .eq('username', cleanUser);

    if (error) throw error;

    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('Error updating profile picture:', err);
    res.status(500).json({ error: 'Failed to update profile picture.' });
  }
});

// Delete Account
app.delete('/api/users/:username', async (req, res) => {
  const { username } = req.params;
  const cleanUser = (username || '').trim().replace('@', '');

  if (!cleanUser) {
    return res.status(400).json({ error: 'Username is required.' });
  }

  try {
    await supabase.from('push_subscriptions').delete().eq('username', cleanUser.toLowerCase());
    await supabase.from('direct_messages').delete().or(`sender_username.eq.${cleanUser},receiver_username.eq.${cleanUser}`);
    const { error } = await supabase.from('users').delete().eq('username', cleanUser);

    if (error) throw error;

    res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (err) {
    console.error('Error deleting account:', err);
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

// ==========================================
// 4. PUSH NOTIFICATION ENDPOINTS & HELPER
// ==========================================
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

app.post('/api/subscribe', async (req, res) => {
  const { username, subscription } = req.body;
  const cleanUsername = (username || '').trim().replace('@', '');

  if (!cleanUsername || !subscription) {
    return res.status(400).json({ error: 'Username and subscription object are required.' });
  }

  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({ 
        username: cleanUsername.toLowerCase(), 
        subscription: JSON.stringify(subscription) 
      }, { onConflict: 'username' });

    if (error) throw error;
    res.status(201).json({ success: true, message: 'Push subscription saved.' });
  } catch (err) {
    console.error('Error saving subscription:', err);
    res.status(500).json({ error: 'Failed to save subscription.' });
  }
});

async function sendPushNotification(targetUsername, payload) {
  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('username', targetUsername.toLowerCase())
      .single();

    if (error || !data) return;

    const subscription = JSON.parse(data.subscription);
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    console.error(`Failed to send push notification to ${targetUsername}:`, err);
  }
}

// ==========================================
// 5. DIRECT MESSAGES & CONVERSATIONS
// ==========================================
app.get('/api/conversations', async (req, res) => {
  const username = (req.query.username || '').trim().replace('@', '');
  if (!username) {
    return res.status(400).json({ error: 'Username query parameter is required.' });
  }

  try {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const map = new Map();
    (data || []).forEach(msg => {
      const other = msg.sender_username.toLowerCase() === username.toLowerCase() 
        ? msg.receiver_username 
        : msg.sender_username;

      if (!map.has(other.toLowerCase())) {
        map.set(other.toLowerCase(), {
          other_user: other,
          last_message: msg.content || (msg.image_url ? '[Image]' : ''),
          created_at: msg.created_at
        });
      }
    });

    res.json({ conversations: Array.from(map.values()) });
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

// Inbox metrics route endpoint: handles GET /api/messages/:username
app.get('/api/messages/:username', async (req, res) => {
  const { username } = req.params;
  const cleanUser = (username || '').trim().replace('@', '');

  if (!cleanUser) {
    return res.status(400).json({ error: 'Username parameter is required.' });
  }

  try {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`sender_username.eq.${cleanUser},receiver_username.eq.${cleanUser}`)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching inbox messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

app.get('/api/messages', async (req, res) => {
  const { user1, user2 } = req.query;
  
  if (!user1 || !user2) {
    return res.status(400).json({ error: 'Both user1 and user2 query parameters are required.' });
  }

  const u1 = user1.trim().replace('@', '');
  const u2 = user2.trim().replace('@', '');

  try {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`and(sender_username.eq.${u1},receiver_username.eq.${u2}),and(sender_username.eq.${u2},receiver_username.eq.${u1})`)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

app.post('/api/messages', async (req, res) => {
  const { sender_username, receiver_username, content, image_url, duration } = req.body;

  if (!sender_username || !receiver_username || (!content && !image_url)) {
    return res.status(400).json({ error: 'Sender, receiver, and content/image are required.' });
  }

  const cleanSender = sender_username.trim().replace('@', '');
  const cleanReceiver = receiver_username.trim().replace('@', '');

  try {
    let expires_at = null;
    if (duration && duration > 0) {
      expires_at = new Date(Date.now() + duration * 1000).toISOString();
    }

    const { data: message, error } = await supabase
      .from('direct_messages')
      .insert([{
        sender_username: cleanSender,
        receiver_username: cleanReceiver,
        content: content || '',
        image_url: image_url || null,
        expires_at
      }])
      .select()
      .single();

    if (error) throw error;

    sendPushNotification(cleanReceiver, {
      title: `@${cleanSender}`,
      body: content || (image_url ? 'Sent an image' : 'New message'),
      icon: '/icon.png',
      url: `/chat.html?user=${cleanSender}`,
      badgeCount: 1
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// Global Error Catching Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected internal server error occurred.' });
});

// ==========================================
// 6. SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
