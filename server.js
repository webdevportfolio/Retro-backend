const express=require('express'),cors=require('cors'),webpush=require('web-push'),{createClient}=require('@supabase/supabase-js');
const app=express();
app.use(cors({origin:'*',methods:['GET','POST','PUT','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization']}));app.options('*',cors());app.use(express.json({limit:'50mb'}));

const SUPABASE_URL=process.env.SUPABASE_URL||'https://your-supabase-url.supabase.co',SUPABASE_KEY=process.env.SUPABASE_KEY||'your-supabase-anon-key',supabase=createClient(SUPABASE_URL,SUPABASE_KEY);
let publicVapidKey=process.env.VAPID_PUBLIC_KEY,privateVapidKey=process.env.VAPID_PRIVATE_KEY;
if(!publicVapidKey||!privateVapidKey){const k=webpush.generateVAPIDKeys();publicVapidKey=publicVapidKey||k.publicKey;privateVapidKey=privateVapidKey||k.privateKey}
webpush.setVapidDetails('mailto:mustaphaadegboyega801@gmail.com',publicVapidKey,privateVapidKey);

app.get('/',(req,res)=>res.status(200).send('Retro Backend API is live and healthy!'));

async function deleteExpiredMessages(){try{const{error}=await supabase.from('direct_messages').delete().lte('expires_at',new Date().toISOString());if(error)console.error(error.message)}catch(e){console.error(e)}}
deleteExpiredMessages();setInterval(deleteExpiredMessages,60000);

const clean=u=>(u||'').trim().replace(/^@/,'');
const handleSignup=async(req,res)=>{const username=clean(req.body.username),password=req.body.password;if(!username||!password)return res.status(400).json({error:'Username and password are required.'});try{const{data,error}=await supabase.from('users').insert([{username,password}]).select().single();if(error)return res.status(400).json({error:error.code==='23505'?'Username already taken.':error.message});res.status(201).json({success:true,user:data})}catch(e){res.status(500).json({error:'Internal server error during signup.'})}};
app.post('/api/signup',handleSignup);app.post('/api/register',handleSignup);

app.post('/api/login',async(req,res)=>{const username=clean(req.body.username),password=req.body.password;if(!username||!password)return res.status(400).json({error:'Username and password are required.'});try{const{data:user,error}=await supabase.from('users').select('*').eq('username',username).eq('password',password).maybeSingle();if(error||!user)return res.status(401).json({error:'Invalid username or password.'});res.json({success:true,user})}catch(e){res.status(500).json({error:'Login failed due to a server error.'})}});

app.get('/api/users',async(req,res)=>{
try{
const{data,error}=await supabase.from('users').select('username,profile_picture');
if(error)throw error;
res.json(data||[]);
}catch(e){
console.error('Fetch users error:',e);
res.status(500).json({error:'Failed to fetch users.'});
}
});
app.get('/api/users/:username',async(req,res)=>{try{const{data,error}=await supabase.from('users').select('*').ilike('username',clean(req.params.username)).maybeSingle();if(error||!data)return res.status(404).json({error:'User not found.'});res.json(data)}catch(e){res.status(500).json({error:'Failed to fetch user profile.'})}});

app.post('/api/users/profile',async(req,res)=>{const username=clean(req.body.username),pfp=req.body.profile_picture||req.body.pfp;if(!username)return res.status(400).json({error:'Username is required.'});try{const{error}=await supabase.from('users').update({profile_picture:pfp}).eq('username',username);if(error)throw error;res.json({success:true,message:'Profile updated successfully.'})}catch(e){res.status(500).json({error:'Failed to update profile picture.'})}});

app.post('/api/users/pfp',async(req,res)=>{const username=clean(req.body.username),pfpUrl=req.body.pfpUrl||req.body.profile_picture||req.body.pfp;if(!username||!pfpUrl)return res.status(400).json({error:'Username and pfpUrl are required'});try{const{error}=await supabase.from('users').update({profile_picture:pfpUrl}).eq('username',username);if(error)throw error;res.json({success:true,pfpUrl})}catch(e){res.status(500).json({error:'Failed to save profile picture.'})}});

app.delete('/api/users/:username',async(req,res)=>{const u=clean(req.params.username);try{await supabase.from('push_subscriptions').delete().eq('username',u.toLowerCase());await supabase.from('direct_messages').delete().or(`sender_username.eq.${u},receiver_username.eq.${u}`);const{error}=await supabase.from('users').delete().eq('username',u);if(error)throw error;res.json({success:true,message:'Account deleted successfully.'})}catch(e){res.status(500).json({error:'Failed to delete account.'})}});

app.get('/api/vapid-public-key',(req,res)=>res.json({publicKey:publicVapidKey}));
app.post('/api/subscribe',async(req,res)=>{const username=clean(req.body.username),subscription=req.body.subscription;if(!username||!subscription)return res.status(400).json({error:'Username and subscription object are required.'});try{const{error}=await supabase.from('push_subscriptions').upsert({username:username.toLowerCase(),subscription:JSON.stringify(subscription)},{onConflict:'username'});if(error)throw error;res.status(201).json({success:true,message:'Push subscription saved.'})}catch(e){res.status(500).json({error:'Failed to save push subscription.'})}});

async function sendPushNotification(user,payload){try{const{data}=await supabase.from('push_subscriptions').select('subscription').eq('username',user.toLowerCase()).maybeSingle();if(data)await webpush.sendNotification(JSON.parse(data.subscription),JSON.stringify(payload))}catch(e){console.error('Push notification:',e.message)}}

app.get('/api/conversations',async(req,res)=>{const username=clean(req.query.username);if(!username)return res.status(400).json({error:'Username query parameter is required.'});try{const{data,error}=await supabase.from('direct_messages').select('*').or(`sender_username.eq.${username},receiver_username.eq.${username}`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at',{ascending:false});if(error)throw error;const map=new Map();(data||[]).forEach(m=>{const other=m.sender_username.toLowerCase()===username.toLowerCase()?m.receiver_username:m.sender_username;if(!map.has(other.toLowerCase()))map.set(other.toLowerCase(),{other_user:other,last_message:m.content||(m.image_url?'[Image]':''),created_at:m.created_at})});res.json({conversations:[...map.values()]})}catch(e){res.status(500).json({error:'Failed to fetch conversations.'})}});

app.get('/api/messages/:username',async(req,res)=>{const u=clean(req.params.username);if(!u)return res.status(400).json({error:'Username parameter is required.'});try{const{data,error}=await supabase.from('direct_messages').select('*').or(`sender_username.eq.${u},receiver_username.eq.${u}`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at',{ascending:true});if(error)throw error;res.json(data||[])}catch(e){res.status(500).json({error:'Failed to fetch messages.'})}});

app.get('/api/messages',async(req,res)=>{const u1=clean(req.query.user1),u2=clean(req.query.user2);if(!u1||!u2)return res.status(400).json({error:'Both user1 and user2 query parameters are required.'});try{const{data,error}=await supabase.from('direct_messages').select('*').or(`and(sender_username.eq.${u1},receiver_username.eq.${u2}),and(sender_username.eq.${u2},receiver_username.eq.${u1})`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at',{ascending:true});if(error)throw error;res.json({messages:data||[]})}catch(e){res.status(500).json({error:'Failed to fetch messages.'})}});

app.post('/api/messages',async(req,res)=>{const sender=clean(req.body.sender_username||req.body.sender),receiver=clean(req.body.receiver_username||req.body.receiver),content=req.body.content||'',image_url=req.body.image_url||null;if(!sender||!receiver||(!content&&!image_url))return res.status(400).json({error:'Sender, receiver, and content/image are required.'});try{const expires_at=new Date(Date.now()+86400000).toISOString();const{data:message,error}=await supabase.from('direct_messages').insert([{sender_username:sender,receiver_username:receiver,content,image_url,expires_at}]).select().single();if(error)throw error;sendPushNotification(receiver,{title:`@${sender}`,body:content.startsWith('[sticker]')?'🎨 Sticker':content.startsWith('[img]')?'🖼 Image':content.startsWith('[audio]')?'🎤 Voice note':content||'New message',icon:'/icon.png',url:`/chat.html?user=${encodeURIComponent(sender)}`,badgeCount:1});res.status(201).json({success:true,message})}catch(e){console.error('Send message:',e);res.status(500).json({error:'Failed to send message.'})}});

app.delete('/api/messages/conversation',async(req,res)=>{const u1=clean(req.body.user1),u2=clean(req.body.user2);if(!u1||!u2)return res.status(400).json({error:'Both user1 and user2 are required.'});try{const{error}=await supabase.from('direct_messages').delete().or(`and(sender_username.eq.${u1},receiver_username.eq.${u2}),and(sender_username.eq.${u2},receiver_username.eq.${u1})`);if(error)throw error;res.json({success:true,message:'Conversation permanently deleted.'})}catch(e){res.status(500).json({error:'Failed to permanently delete conversation.'})}});

const typingState=new Map(),userHeartbeats=new Map();
app.post('/api/typing',(req,res)=>{const{sender,receiver,isTyping}=req.body;if(sender&&receiver)typingState.set(`${sender.toLowerCase()}_${receiver.toLowerCase()}`,{isTyping:!!isTyping,timestamp:Date.now()});res.json({success:true})});
app.get('/api/typing/:sender/:receiver',(req,res)=>{const key=`${req.params.sender.toLowerCase()}_${req.params.receiver.toLowerCase()}`,s=typingState.get(key);res.json({isTyping:!!(s&&Date.now()-s.timestamp<4000&&s.isTyping)})});
app.post('/api/heartbeat',(req,res)=>{if(req.body.username)userHeartbeats.set(clean(req.body.username).toLowerCase(),Date.now());res.json({success:true})});
app.get('/api/online-status/:username',(req,res)=>{const t=userHeartbeats.get(clean(req.params.username).toLowerCase());res.json({online:!!(t&&Date.now()-t<30000)})});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'An unexpected server error occurred.'})});
const PORT=process.env.PORT||3000;app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
