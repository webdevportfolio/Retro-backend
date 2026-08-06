const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Supabase Credentials
const SUPABASE_URL = 'https://zeiilpgzoqeigbxzkjng.supabase.co';
// Ensure SUPABASE_SERVICE_ROLE_KEY is set in your Render environment variables 
// so admin commands like auth.admin.deleteUser can execute.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_publishable_Eq1Tqo9B6yYAQP5hFUvhhw_xigLm_to';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false
  }
});

// Permanent Web Push Keys
const vapidKeys = {
  publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYPK5NjhY8',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'X_m8c8JzL2N2K6k0B5r3v1x4z7f9h2j5m8p1s4v7y0A'
};

webpush.setVapidDetails(
  'mailto:support@retro.app',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// State Stores
const typingUsers = new Map();
const onlineUsers = new Map();

// BASE ROUTE
app.get('/', (req, res) => {
  res.send('RETRO API is online');
});

// GET PUBLIC VAPID KEY
app.get('/api/vapid-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// SAVE PUSH SUBSCRIPTION
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

// 3. PROFILE PICTURE SYNC ENDPOINT
app.post('/api/users/profile', async (req, res) => {
  try {
    const { username } = req.body;
    const pfp = req.body.profile_picture || req.body['profile picture'] || req.body.pfp || req.body.avatar;

    if (!username || !pfp) {
      return res.status(400).json({ error: 'Username and profile picture are required.' });
    }

    const cleanUsername = username.trim();

    const updateData = {
      profile_picture: pfp,
      avatar: pfp
    };

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('username', cleanUsername)
      .select();

    if (error) {
      console.error('Failed to update profile picture in Supabase:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ message: 'Profile picture updated successfully', data });
  } catch (err) {
    console.error('Profile Endpoint Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. GET SINGLE USER ENDPOINT
app.get('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = username.trim();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Get User Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. GET ALL USERS ENDPOINT
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*');

    if (error) {
      console.error('Error fetching users:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Get Users Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 6. GET MESSAGES ENDPOINT
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

// 7. MARK MESSAGES AS READ
app.post('/api/messages/:username/mark-read', async (req, res) => {
  try {
    const { username } = req.params;
    const { other_user } = req.body;

    if (!other_user) return res.status(400).json({ error: 'Missing other_user' });

    const cleanUsername = username.trim();
    const cleanOther = other_user.trim();

    const { error } = await supabase
      .from('messages')
      .update({ read: true })
      .eq('receiver_username', cleanUsername)
      .eq('sender_username', cleanOther)
      .eq('read', false);

    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ message: 'Marked as read' });
  } catch (err) {
    console.error('Mark Read Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 8. SEND MESSAGE ENDPOINT
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
          expires_at: expiresAt,
          read: false
        }
      ])
      .select();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(400).json({ error: error.message });
    }

    // Retrieve Receiver's Push Subscription
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

      const { count: unreadCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_username', receiver_username.trim())
        .eq('read', false);

      const payload = JSON.stringify({
        title: sender_username,
        body: content,
        url: `/chat.html?user=${encodeURIComponent(sender_username)}`,
        badgeCount: unreadCount || 1
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

// 9. COMPLETE DELETE USER ENDPOINT
app.delete('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const cleanUsername = username.trim();
    const userEmail = `${cleanUsername.toLowerCase()}@retro.app`;

    // A. Delete Push Subscriptions
    await supabase
      .from('subscriptions')
      .delete()
      .eq('username', cleanUsername.toLowerCase());

    // B. Delete Messages
    const { error: msgError } = await supabase
      .from('messages')
      .delete()
      .or(`sender_username.eq.${cleanUsername},receiver_username.eq.${cleanUsername}`);

    if (msgError) console.error('Error deleting user messages:', msgError.message);

    // C. Delete Public User Record
    const { error: userError } = await supabase
      .from('users')
      .delete()
      .eq('username', cleanUsername);

    if (userError) console.error('Error deleting user record:', userError.message);

    // D. Delete Account from Supabase Auth System
    if (supabase.auth.admin) {
      const { data: authData, error: listError } = await supabase.auth.admin.listUsers();
      if (!listError && authData && authData.users) {
        const targetAuthUser = authData.users.find(u => u.email === userEmail);
        if (targetAuthUser) {
          const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(targetAuthUser.id);
          if (authDeleteErr) console.error('Error purging auth user:', authDeleteErr.message);
        }
      }
    }

    return res.status(200).json({ 
      message: `User '${cleanUsername}' and all associated records permanently removed.` 
    });
  } catch (err) {
    console.error('Delete User Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 10. TYPING INDICATOR ENDPOINTS
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

// 11. ONLINE STATUS & HEARTBEAT
app.post('/api/heartbeat', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  onlineUsers.set(username.trim().toLowerCase(), Date.now());
  res.json({ success: true });
});

app.get('/api/online-status/:username', (req, res) => {
  const target = req.params.username.trim().toLowerCase();
  const lastActive = onlineUsers.get(target);

  const isOnline = lastActive && (Date.now() - lastActive < 45000);
  res.json({ online: Boolean(isOnline) });
});
// ==========================================
// GROUP CHAT ENDPOINTS
// ==========================================

// 1. CREATE GROUP
app.post('/api/groups', async (req, res) => {
  const { name, avatar, created_by, members } = req.body;

  if (!name || !created_by) {
    return res.status(400).json({ error: 'Group name and creator are required.' });
  }

  try {
    // Insert new group
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .insert([{ name, avatar: avatar || null, created_by }])
      .select()
      .single();

    if (groupError) throw groupError;

    // Prepare members array (creator is 'admin', others are 'member')
    const uniqueMembers = Array.from(new Set([created_by, ...(members || [])]));
    const memberRows = uniqueMembers.map(username => ({
      group_id: group.id,
      username,
      role: username === created_by ? 'admin' : 'member'
    }));

    // Insert group members
    const { error: membersError } = await supabase
      .from('group_members')
      .insert(memberRows);

    if (membersError) throw membersError;

    // Insert initial system message
    await supabase.from('group_messages').insert([{
      group_id: group.id,
      sender_username: 'SYSTEM',
      content: `@${created_by} created the group "${name}"`
    }]);

    res.status(201).json({ success: true, group });
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Failed to create group.' });
  }
});

// 2. GET GROUPS FOR A SPECIFIC USER (Inbox List)
app.get('/api/groups/user/:username', async (req, res) => {
  const { username } = req.params;

  try {
    // Get all group_ids where user is a member
    const { data: memberOf, error: memberError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('username', username);

    if (memberError) throw memberError;

    if (!memberOf || memberOf.length === 0) {
      return res.json({ groups: [] });
    }

    const groupIds = memberOf.map(m => m.group_id);

    // Fetch details for those groups
    const { data: groups, error: groupError } = await supabase
      .from('groups')
      .select('*')
      .in('id', groupIds)
      .order('created_at', { ascending: false });

    if (groupError) throw groupError;

    res.json({ groups });
  } catch (err) {
    console.error('Error fetching user groups:', err);
    res.status(500).json({ error: 'Failed to fetch groups.' });
  }
});

// 3. GET GROUP METADATA & MEMBERS
app.get('/api/groups/:groupId', async (req, res) => {
  const { groupId } = req.params;

  try {
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .single();

    if (groupError) throw groupError;

    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('id, username, role, joined_at')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });

    if (membersError) throw membersError;

    res.json({ group, members });
  } catch (err) {
    console.error('Error fetching group details:', err);
    res.status(500).json({ error: 'Failed to fetch group details.' });
  }
});

// 4. GET GROUP MESSAGES (Filters out expired messages)
app.get('/api/groups/:groupId/messages', async (req, res) => {
  const { groupId } = req.params;

  try {
    const now = new Date().toISOString();

    const { data: messages, error } = await supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ messages });
  } catch (err) {
    console.error('Error fetching group messages:', err);
    res.status(500).json({ error: 'Failed to fetch group messages.' });
  }
});

// 5. POST A GROUP MESSAGE (Text & Picture with expiry support)
app.post('/api/groups/:groupId/messages', async (req, res) => {
  const { groupId } = req.params;
  const { sender_username, content, image_url, duration } = req.body;

  if (!sender_username || (!content && !image_url)) {
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
        sender_username,
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

// 6. UPDATE GROUP DETAILS (Admin Only)
app.patch('/api/groups/:groupId', async (req, res) => {
  const { groupId } = req.params;
  const { requester, name, avatar } = req.body;

  try {
    // Verify admin privileges
    const { data: member, error: memberError } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('username', requester)
      .single();

    if (memberError || !member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update group details.' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (avatar !== undefined) updates.avatar = avatar;

    const { data: group, error: updateError } = await supabase
      .from('groups')
      .update(updates)
      .eq('id', groupId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Post system notification
    if (name) {
      await supabase.from('group_messages').insert([{
        group_id: groupId,
        sender_username: 'SYSTEM',
        content: `@${requester} updated group name to "${name}"`
      }]);
    }

    res.json({ success: true, group });
  } catch (err) {
    console.error('Error updating group:', err);
    res.status(500).json({ error: 'Failed to update group.' });
  }
});

// 7. ADD MEMBERS TO GROUP (Admin Only)
app.post('/api/groups/:groupId/members', async (req, res) => {
  const { groupId } = req.params;
  const { requester, newMembers } = req.body; // newMembers = Array of usernames

  try {
    // Check admin rights
    const { data: member } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('username', requester)
      .single();

    if (!member || member.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can add members.' });
    }

    const rows = newMembers.map(username => ({
      group_id: groupId,
      username,
      role: 'member'
    }));

    const { error } = await supabase.from('group_members').insert(rows);
    if (error) throw error;

    // Log system message
    const addedList = newMembers.map(m => `@${m}`).join(', ');
    await supabase.from('group_messages').insert([{
      group_id: groupId,
      sender_username: 'SYSTEM',
      content: `@${requester} added ${addedList}`
    }]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error adding members:', err);
    res.status(500).json({ error: 'Failed to add members.' });
  }
});

// 8. REMOVE MEMBER OR LEAVE GROUP
app.delete('/api/groups/:groupId/members/:targetUsername', async (req, res) => {
  const { groupId, targetUsername } = req.params;
  const { requester } = req.body; // Username of person making the request

  try {
    const isSelfLeave = requester === targetUsername;

    // If removing someone else, requester MUST be admin
    if (!isSelfLeave) {
      const { data: adminCheck } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('username', requester)
        .single();

      if (!adminCheck || adminCheck.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can remove members.' });
      }
    }

    // Delete from group_members
    const { error: deleteError } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('username', targetUsername);

    if (deleteError) throw deleteError;

    // Log system message
    const systemText = isSelfLeave
      ? `@${targetUsername} left the group`
      : `@${requester} removed @${targetUsername}`;

    await supabase.from('group_messages').insert([{
      group_id: groupId,
      sender_username: 'SYSTEM',
      content: systemText
    }]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error removing member:', err);
    res.status(500).json({ error: 'Failed to remove member.' });
  }
});

app.listen(PORT, () => {
  console.log(`RETRO backend listening on port ${PORT}`);
});
