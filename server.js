const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io with CORS enabled
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

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

// VAPID Setup
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
  const generatedKeys = webpush.generateVAPIDKeys();
  publicVapidKey = generatedKeys.publicKey;
  privateVapidKey = generatedKeys.privateKey;
  webpush.setVapidDetails(
    'mailto:mustaphaadegboyega801@gmail.com',
    publicVapidKey,
    privateVapidKey
  );
}

// Map to track connected users: username.toLowerCase() -> socket.id
const connectedUsers = new Map();

// Helper to generate consistent room IDs between two users
function getRoomId(user1, user2) {
  return [user1.toLowerCase().trim(), user2.toLowerCase().trim()].sort().join('_');
}

// Helper to send push notifications
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
// 2. HTTP REST ENDPOINTS (Auth & Profile)
// ==========================================
app.get('/', (req, res) => {
  res.status(200).send('Retro Backend API with Socket.io is live and healthy!');
});

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
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Username already taken.' });
      }
      return res.status(400).json({ error: error.message || 'Failed to create user account.' });
    }

    return res.status(201).json({ success: true, user: data });
  } catch (err) {
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
    return res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('username, profile_picture');

    if (error) throw error;
    res.json(users || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

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

    res.json({
      ...user,
      pfpUrl: user.profile_picture || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
});

const handlePfpUpdate = async (req, res) => {
  const { username, profile_picture, pfp, pfpUrl } = req.body;
  const cleanUser = (username || '').trim().replace('@', '');
  const pfpData = profile_picture || pfp || pfpUrl;

  if (!cleanUser || !pfpData) {
    return res.status(400).json({ error: 'Username and profile picture are required.' });
  }

  try {
    const { error } = await supabase
      .from('users')
      .update({ profile_picture: pfpData })
      .eq('username', cleanUser);

    if (error) throw error;

    res.json({ success: true, message: 'Profile updated successfully.', pfpUrl: pfpData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile picture.' });
  }
};

app.post('/api/users/profile', handlePfpUpdate);
app.post('/api/users/pfp', handlePfpUpdate);

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
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

app.get('/api/messages', async (req, res) => {
  const { user1, user2 } = req.query;
  if (!user1 || !user2) {
    return res.status(400).json({ error: 'Both user1 and user2 are required.' });
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
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

app.post('/api/subscribe', async (req, res) => {
  const { username, subscription } = req.body;
  const cleanUsername = (username || '').trim().replace('@', '');

  if (!cleanUsername || !subscription) {
    return res.status(400).json({ error: 'Username and subscription are required.' });
  }

  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({ 
        username: cleanUsername.toLowerCase(), 
        subscription: JSON.stringify(subscription) 
      }, { onConflict: 'username' });

    if (error) throw error;
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save subscription.' });
  }
});

// ==========================================
// 3. SOCKET.IO REAL-TIME ENGINE
// ==========================================
io.on('connection', (socket) => {

  // Register online user session
  socket.on('register_user', (username) => {
    if (!username) return;
    const cleanUser = username.trim().replace('@', '').toLowerCase();
    socket.username = cleanUser;
    connectedUsers.set(cleanUser, socket.id);

    // Broadcast user's online status
    io.emit('user_presence', { username: cleanUser, online: true });
  });

  // Query online status for a target user
  socket.on('check_online', (targetUsername) => {
    if (!targetUsername) return;
    const cleanTarget = targetUsername.trim().replace('@', '').toLowerCase();
    const isOnline = connectedUsers.has(cleanTarget);
    socket.emit('online_status', { username: cleanTarget, online: isOnline });
  });

  // Join private conversation room
  socket.on('join_room', ({ sender, receiver }) => {
    if (!sender || !receiver) return;
    const roomId = getRoomId(sender, receiver);
    socket.join(roomId);
  });

  // Real-time Messaging Event
  socket.on('send_message', async (data) => {
    const { sender_username, receiver_username, content, image_url, duration } = data;
    const cleanSender = (sender_username || '').trim().replace('@', '');
    const cleanReceiver = (receiver_username || '').trim().replace('@', '');

    if (!cleanSender || !cleanReceiver || (!content && !image_url)) return;

    let expires_at = null;
    if (duration && duration > 0) {
      expires_at = new Date(Date.now() + duration * 1000).toISOString();
    }

    try {
      // Save message to Supabase
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

      const roomId = getRoomId(cleanSender, cleanReceiver);

      // Emit to room instantly
      io.to(roomId).emit('receive_message', message);

      // Trigger web push if recipient isn't currently connected to the socket
      const isRecipientConnected = connectedUsers.has(cleanReceiver.toLowerCase());
      if (!isRecipientConnected) {
        sendPushNotification(cleanReceiver, {
          title: `@${cleanSender}`,
          body: content || (image_url ? 'Sent an image' : 'New message'),
          icon: '/icon.png',
          url: `/chat.html?user=${cleanSender}`
        });
      }
    } catch (err) {
      console.error('Error handling socket message:', err);
      socket.emit('message_error', { error: 'Failed to send message.' });
    }
  });

  // Real-time Typing Event
  socket.on('typing', ({ sender, receiver, isTyping }) => {
    if (!sender || !receiver) return;
    const roomId = getRoomId(sender, receiver);
    socket.to(roomId).emit('user_typing', { sender, isTyping: !!isTyping });
  });

  // Handle Disconnection
  socket.on('disconnect', () => {
    if (socket.username) {
      connectedUsers.delete(socket.username);
      io.emit('user_presence', { username: socket.username, online: false });
    }
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
