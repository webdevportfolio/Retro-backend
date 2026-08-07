const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Enable CORS for all origins (or specify your GitHub Pages URL)
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-supabase-url.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'your-supabase-anon-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 0. HEALTH CHECK ROUTE (Fixes UptimeRobot & Blank Screen)
// ==========================================
app.get('/', (req, res) => {
  res.status(200).send('Retro Backend API is live and healthy!');
});

// ==========================================
// 1. AUTHENTICATION ENDPOINTS (Fixes Sign Up Screen)
// ==========================================
app.post('/api/signup', async (req, res) => {
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

    if (error) throw error;
    res.status(201).json({ success: true, user: data });
  } catch (err) {
    console.error('Error during signup:', err);
    res.status(500).json({ error: err.message || 'Failed to create account.' });
  }
});

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
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ==========================================
// 2. GET USER CONVERSATIONS (INBOX DMs)
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

// ==========================================
// 3. GET USER GROUPS
// ==========================================
app.get('/api/groups', async (req, res) => {
  try {
    const { data: groups, error } = await supabase
      .from('groups')
      .select('*');

    if (error) throw error;
    res.json({ groups: groups || [] });
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ error: 'Failed to fetch groups.' });
  }
});

// ==========================================
// 4. GET SINGLE GROUP METADATA & MEMBERS
// ==========================================
app.get('/api/groups/:groupId', async (req, res) => {
  const { groupId } = req.params;
  try {
    const { data: group, error: gErr } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .single();

    if (gErr) throw gErr;

    const { data: members, error: mErr } = await supabase
      .from('group_members')
      .select('*')
      .eq('group_id', groupId);

    res.json({ group, members: members || [] });
  } catch (err) {
    console.error('Error fetching group metadata:', err);
    res.status(500).json({ error: 'Failed to fetch group details.' });
  }
});

// ==========================================
// 5. GET GROUP MESSAGES
// ==========================================
app.get('/api/groups/:groupId/messages', async (req, res) => {
  const { groupId } = req.params;
  try {
    const { data: messages, error } = await supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: messages || [] });
  } catch (err) {
    console.error('Error fetching group messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// ==========================================
// 6. POST GROUP MESSAGE
// ==========================================
app.post('/api/groups/:groupId/messages', async (req, res) => {
  const { groupId } = req.params;
  const { sender, sender_username, content, image_url, duration } = req.body;
  
  const activeSender = sender_username || sender;

  if (!activeSender || (!content && !image_url)) {
    return res.status(400).json({ error: 'Sender and content or image are required.' });
  }

  try {
    let expires_at = null;
    if (duration && duration > 0) {
      expires_at = new Date(Date.now() + duration * 1000).toISOString();
    }

    const { data: message, error } = await supabase
      .from('group_messages')
      .insert([{
        group_id: groupId,
        sender_username: activeSender.trim().replace('@', ''),
        content: content || '',
        image_url: image_url || null,
        expires_at
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('Error posting group message:', err);
    res.status(500).json({ error: 'Failed to post message.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
