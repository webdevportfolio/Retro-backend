const express=require('express'),cors=require('cors'),webpush=require('web-push'),{createClient}=require('@supabase/supabase-js');
const app=express();

app.use(cors({origin:'*',methods:['GET','POST','PUT','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization']}));
app.options('*',cors());
app.use(express.json({limit:'50mb'}));

const SUPABASE_URL=process.env.SUPABASE_URL||'https://your-supabase-url.supabase.co',SUPABASE_KEY=process.env.SUPABASE_KEY||'your-supabase-anon-key',supabase=createClient(SUPABASE_URL,SUPABASE_KEY);

let publicVapidKey=process.env.VAPID_PUBLIC_KEY,privateVapidKey=process.env.VAPID_PRIVATE_KEY;
if(!publicVapidKey||!privateVapidKey){
const k=webpush.generateVAPIDKeys();
publicVapidKey=publicVapidKey||k.publicKey;
privateVapidKey=privateVapidKey||k.privateKey
}

webpush.setVapidDetails('mailto:mustaphaadegboyega801@gmail.com',publicVapidKey,privateVapidKey);

app.get('/',(req,res)=>res.status(200).send('Retro Backend API is live and healthy!'));

const clean=u=>(u||'').trim().replace(/^@/,'');
const same=(a,b)=>(a||'').toLowerCase()===(b||'').toLowerCase();

async function deleteExpiredMessages(){
try{
const{error}=await supabase.from('direct_messages').delete().lte('expires_at',new Date().toISOString());
if(error)console.error(error.message)
}catch(e){console.error(e)}
}

deleteExpiredMessages();
setInterval(deleteExpiredMessages,60000);


/* =========================================================
   AUTH
========================================================= */

const handleSignup=async(req,res)=>{
const username=clean(req.body.username),password=req.body.password;

if(!username||!password)return res.status(400).json({error:'Username and password are required.'});

try{
const{data,error}=await supabase.from('users').insert([{username,password}]).select().single();

if(error){
return res.status(400).json({
error:error.code==='23505'?'Username already taken.':error.message
});
}

res.status(201).json({success:true,user:data});

}catch(e){
console.error('Signup:',e);
res.status(500).json({error:'Internal server error during signup.'});
}
};

app.post('/api/signup',handleSignup);
app.post('/api/register',handleSignup);


app.post('/api/login',async(req,res)=>{
const username=clean(req.body.username),password=req.body.password;

if(!username||!password){
return res.status(400).json({error:'Username and password are required.'});
}

try{
const{data:user,error}=await supabase
.from('users')
.select('*')
.ilike('username',username)
.eq('password',password)
.maybeSingle();

if(error||!user){
return res.status(401).json({error:'Invalid username or password.'});
}

res.json({success:true,user});

}catch(e){
console.error('Login:',e);
res.status(500).json({error:'Login failed due to a server error.'});
}
});


/* =========================================================
   USERS
========================================================= */

app.get('/api/users',async(req,res)=>{
try{
const{data,error}=await supabase
.from('users')
.select('id,username,profile_picture');

if(error)throw error;

res.json(data||[]);

}catch(e){
console.error('Fetch users error:',e);
res.status(500).json({error:'Failed to fetch users.'});
}
});


app.get('/api/users/:username',async(req,res)=>{
try{
const username=clean(req.params.username);

const{data,error}=await supabase
.from('users')
.select('*')
.ilike('username',username)
.maybeSingle();

if(error||!data){
return res.status(404).json({error:'User not found.'});
}

res.json(data);

}catch(e){
console.error('Fetch profile:',e);
res.status(500).json({error:'Failed to fetch user profile.'});
}
});


/* =========================================================
   CHANGE USERNAME + PROFILE
   IMPORTANT:
   The users.id NEVER changes.
   All username references are updated.
========================================================= */

async function renameUser(oldUsername,newUsername){

oldUsername=clean(oldUsername);
newUsername=clean(newUsername);

if(!oldUsername||!newUsername){
throw new Error('Both old and new usernames are required.');
}

if(same(oldUsername,newUsername)){
return {success:true,username:oldUsername,changed:false};
}


/* Check that old account exists */

const{data:user,error:userError}=await supabase
.from('users')
.select('id,username,profile_picture,password')
.ilike('username',oldUsername)
.maybeSingle();

if(userError)throw userError;

if(!user){
const e=new Error('Current user not found.');
e.code='USER_NOT_FOUND';
throw e;
}


/* Check new username */

const{data:existing,error:existingError}=await supabase
.from('users')
.select('id,username')
.ilike('username',newUsername)
.maybeSingle();

if(existingError)throw existingError;

if(existing&&!same(existing.username,oldUsername)){
const e=new Error('Username already taken.');
e.code='USERNAME_TAKEN';
throw e;
}


/*
   Update every table that stores the username.

   We do these BEFORE changing the users row.
   That way the original account still exists while
   its related records are being moved.
*/


/* DIRECT MESSAGES */

let result=await supabase
.from('direct_messages')
.update({sender_username:newUsername})
.eq('sender_username',oldUsername);

if(result.error)throw result.error;

result=await supabase
.from('direct_messages')
.update({receiver_username:newUsername})
.eq('receiver_username',oldUsername);

if(result.error)throw result.error;


/* GAME CHALLENGES */

result=await supabase
.from('game_challenges')
.update({sender:newUsername})
.eq('sender',oldUsername);

if(result.error)throw result.error;

result=await supabase
.from('game_challenges')
.update({receiver:newUsername})
.eq('receiver',oldUsername);

if(result.error)throw result.error;


/* GAME SESSIONS */

result=await supabase
.from('game_sessions')
.update({player1:newUsername})
.eq('player1',oldUsername);

if(result.error)throw result.error;

result=await supabase
.from('game_sessions')
.update({player2:newUsername})
.eq('player2',oldUsername);

if(result.error)throw result.error;

result=await supabase
.from('game_sessions')
.update({turn:newUsername})
.eq('turn',oldUsername);

if(result.error)throw result.error;

result=await supabase
.from('game_sessions')
.update({winner:newUsername})
.eq('winner',oldUsername);

if(result.error)throw result.error;


/* PUSH SUBSCRIPTIONS */

result=await supabase
.from('push_subscriptions')
.update({username:newUsername.toLowerCase()})
.eq('username',oldUsername.toLowerCase());

if(result.error)throw result.error;


/* FINALLY CHANGE THE USERS ROW */

result=await supabase
.from('users')
.update({username:newUsername})
.eq('id',user.id);

if(result.error)throw result.error;


/* Return the same account ID */

return{
success:true,
changed:true,
id:user.id,
username:newUsername,
profile_picture:user.profile_picture
};
}


/*
   MAIN PROFILE UPDATE ROUTE

   It supports:
   username only
   profile picture only
   username + profile picture
*/

app.post('/api/users/profile',async(req,res)=>{
const currentUsername=clean(
req.body.current_username||
req.body.old_username||
req.body.username
);

const requestedUsername=clean(
req.body.new_username||
req.body.username
);

const pfp=req.body.profile_picture||req.body.pfp;

if(!currentUsername){
return res.status(400).json({error:'Current username is required.'});
}

try{

let finalUsername=currentUsername;
let renamed=false;


/* Rename if a different username was requested */

if(
requestedUsername&&
!same(currentUsername,requestedUsername)
){

const renameResult=await renameUser(
currentUsername,
requestedUsername
);

finalUsername=renameResult.username;
renamed=renameResult.changed;

}else{

/* Verify user exists */

const{data:user,error:userError}=await supabase
.from('users')
.select('id,username')
.ilike('username',currentUsername)
.maybeSingle();

if(userError)throw userError;

if(!user){
return res.status(404).json({error:'User not found.'});
}
}


/* Update profile picture if supplied */

if(pfp){

const{error}=await supabase
.from('users')
.update({profile_picture:pfp})
.ilike('username',finalUsername);

if(error)throw error;
}


const{data:user,error:userError}=await supabase
.from('users')
.select('*')
.ilike('username',finalUsername)
.maybeSingle();

if(userError)throw userError;

res.json({
success:true,
renamed,
user
});

}catch(e){

console.error('Profile update:',e);

if(e.code==='USERNAME_TAKEN'){
return res.status(409).json({error:'Username already taken.'});
}

if(e.code==='USER_NOT_FOUND'){
return res.status(404).json({error:'Current user not found.'});
}

res.status(500).json({
error:e.message||'Failed to update profile.'
});
}
});


/*
   Dedicated username-change route.

   Your frontend can also use this directly:
   POST /api/users/rename
*/

app.post('/api/users/rename',async(req,res)=>{
const oldUsername=clean(
req.body.old_username||
req.body.current_username
);

const newUsername=clean(
req.body.new_username
);

if(!oldUsername||!newUsername){
return res.status(400).json({
error:'Old username and new username are required.'
});
}

try{

const result=await renameUser(
oldUsername,
newUsername
);

const{data:user,error}=await supabase
.from('users')
.select('*')
.ilike('username',newUsername)
.maybeSingle();

if(error)throw error;

res.json({
success:true,
user,
message:'Username changed successfully. Your account, profile, chats and games were preserved.'
});

}catch(e){

console.error('Rename user:',e);

if(e.code==='USERNAME_TAKEN'){
return res.status(409).json({error:'Username already taken.'});
}

if(e.code==='USER_NOT_FOUND'){
return res.status(404).json({error:'Current username not found.'});
}

res.status(500).json({
error:e.message||'Failed to change username.'
});
}
});


/* Profile picture shortcut */

app.post('/api/users/pfp',async(req,res)=>{
const username=clean(req.body.username),pfpUrl=req.body.pfpUrl||req.body.profile_picture||req.body.pfp;

if(!username||!pfpUrl){
return res.status(400).json({
error:'Username and pfpUrl are required'
});
}

try{

const{error}=await supabase
.from('users')
.update({profile_picture:pfpUrl})
.ilike('username',username);

if(error)throw error;

res.json({
success:true,
pfpUrl
});

}catch(e){
console.error('Save profile picture:',e);
res.status(500).json({error:'Failed to save profile picture.'});
}
});


/* DELETE ACCOUNT */

app.delete('/api/users/:username',async(req,res)=>{
const u=clean(req.params.username);

try{

await supabase
.from('push_subscriptions')
.delete()
.eq('username',u.toLowerCase());

await supabase
.from('direct_messages')
.delete()
.or(`sender_username.eq.${u},receiver_username.eq.${u}`);


/* Remove challenges involving user */

await supabase
.from('game_challenges')
.delete()
.or(`sender.eq.${u},receiver.eq.${u}`);


/* Remove games involving user */

await supabase
.from('game_sessions')
.delete()
.or(`player1.eq.${u},player2.eq.${u}`);


const{error}=await supabase
.from('users')
.delete()
.ilike('username',u);

if(error)throw error;

res.json({
success:true,
message:'Account deleted successfully.'
});

}catch(e){

console.error('Delete account:',e);

res.status(500).json({
error:'Failed to delete account.'
});
}
});


/* =========================================================
   PUSH NOTIFICATIONS
========================================================= */

app.get('/api/vapid-public-key',(req,res)=>{
res.json({publicKey:publicVapidKey});
});


app.post('/api/subscribe',async(req,res)=>{
const username=clean(req.body.username),subscription=req.body.subscription;

if(!username||!subscription){
return res.status(400).json({
error:'Username and subscription object are required.'
});
}

try{

const{error}=await supabase
.from('push_subscriptions')
.upsert(
{
username:username.toLowerCase(),
subscription:JSON.stringify(subscription)
},
{onConflict:'username'}
);

if(error)throw error;

res.status(201).json({
success:true,
message:'Push subscription saved.'
});

}catch(e){

console.error('Subscribe:',e);

res.status(500).json({
error:'Failed to save push subscription.'
});
}
});


async function sendPushNotification(user,payload){

try{

const{data}=await supabase
.from('push_subscriptions')
.select('subscription')
.eq('username',user.toLowerCase())
.maybeSingle();

if(data){

await webpush.sendNotification(
data.subscription?JSON.parse(data.subscription):null,
JSON.stringify(payload)
);

}

}catch(e){
console.error('Push notification:',e.message);
}
}


/* =========================================================
   CONVERSATIONS
========================================================= */

app.get('/api/conversations',async(req,res)=>{
const username=clean(req.query.username);

if(!username){
return res.status(400).json({
error:'Username query parameter is required.'
});
}

try{

const{data,error}=await supabase
.from('direct_messages')
.select('*')
.or(`sender_username.eq.${username},receiver_username.eq.${username}`)
.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
.order('created_at',{ascending:false});

if(error)throw error;

const map=new Map();

(data||[]).forEach(m=>{

const other=
same(m.sender_username,username)
?m.receiver_username
:m.sender_username;

if(!map.has(other.toLowerCase())){

map.set(other.toLowerCase(),{
other_user:other,
last_message:m.content||(m.image_url?'[Image]':''),
created_at:m.created_at
});

}

});

res.json({
conversations:[...map.values()]
});

}catch(e){

console.error('Conversations:',e);

res.status(500).json({
error:'Failed to fetch conversations.'
});
}
});


/* =========================================================
   MESSAGES
========================================================= */

app.get('/api/messages/:username',async(req,res)=>{
const u=clean(req.params.username);

if(!u){
return res.status(400).json({
error:'Username parameter is required.'
});
}

try{

const{data,error}=await supabase
.from('direct_messages')
.select('*')
.or(`sender_username.eq.${u},receiver_username.eq.${u}`)
.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
.order('created_at',{ascending:true});

if(error)throw error;

res.json(data||[]);

}catch(e){

console.error('Messages:',e);

res.status(500).json({
error:'Failed to fetch messages.'
});
}
});


app.get('/api/messages',async(req,res)=>{
const u1=clean(req.query.user1),u2=clean(req.query.user2);

if(!u1||!u2){
return res.status(400).json({
error:'Both user1 and user2 query parameters are required.'
});
}

try{

const{data,error}=await supabase
.from('direct_messages')
.select('*')
.or(
`and(sender_username.eq.${u1},receiver_username.eq.${u2}),and(sender_username.eq.${u2},receiver_username.eq.${u1})`
)
.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
.order('created_at',{ascending:true});

if(error)throw error;

res.json({
messages:data||[]
});

}catch(e){

console.error('Messages between users:',e);

res.status(500).json({
error:'Failed to fetch messages.'
});
}
});


app.post('/api/messages',async(req,res)=>{
const sender=clean(req.body.sender_username||req.body.sender);
const receiver=clean(req.body.receiver_username||req.body.receiver);
const content=req.body.content||'';
const image_url=req.body.image_url||null;

if(!sender||!receiver||(!content&&!image_url)){
return res.status(400).json({
error:'Sender, receiver, and content/image are required.'
});
}

try{

const expires_at=new Date(Date.now()+86400000).toISOString();

const{data:message,error}=await supabase
.from('direct_messages')
.insert([{
sender_username:sender,
receiver_username:receiver,
content,
image_url,
expires_at
}])
.select()
.single();

if(error)throw error;

sendPushNotification(receiver,{
title:sender,
body:
content.startsWith('[sticker]')
?'🎨 Sticker':
content.startsWith('[img]')
?'🖼 Image':
content.startsWith('[audio]')
?'🎤 Voice note':
content||'New message',
icon:'/icon.png',
url:`/chat.html?user=${encodeURIComponent(sender)}`,
badgeCount:1
});

res.status(201).json({
success:true,
message
});

}catch(e){

console.error('Send message:',e);

res.status(500).json({
error:'Failed to send message.'
});
}
});


app.delete('/api/messages/conversation',async(req,res)=>{
const u1=clean(req.body.user1),u2=clean(req.body.user2);

if(!u1||!u2){
return res.status(400).json({
error:'Both user1 and user2 are required.'
});
}

try{

const{error}=await supabase
.from('direct_messages')
.delete()
.or(
`and(sender_username.eq.${u1},receiver_username.eq.${u2}),and(sender_username.eq.${u2},receiver_username.eq.${u1})`
);

if(error)throw error;

res.json({
success:true,
message:'Conversation permanently deleted.'
});

}catch(e){

console.error('Delete conversation:',e);

res.status(500).json({
error:'Failed to permanently delete conversation.'
});
}
});


/* =========================================================
   GAMES — CHALLENGES
========================================================= */

app.post('/api/games/challenge',async(req,res)=>{
const sender=clean(req.body.sender);
const receiver=clean(req.body.receiver);
const game=(req.body.game||'').trim().toLowerCase();

if(!sender||!receiver||!game){
return res.status(400).json({
error:'Sender, receiver, and game are required.'
});
}

if(same(sender,receiver)){
return res.status(400).json({
error:'You cannot challenge yourself.'
});
}

if(!['tictactoe','chess'].includes(game)){
return res.status(400).json({
error:'Invalid game.'
});
}

try{

const{data:dm,error:dmError}=await supabase
.from('direct_messages')
.select('id')
.or(
`and(sender_username.eq.${sender},receiver_username.eq.${receiver}),and(sender_username.eq.${receiver},receiver_username.eq.${sender})`
)
.limit(1);

if(dmError)throw dmError;

if(!dm||!dm.length){
return res.status(403).json({
error:'You can only play with someone in your DMs.'
});
}


const{data:existing,error:existingError}=await supabase
.from('game_challenges')
.select('*')
.or(
`and(sender.eq.${sender},receiver.eq.${receiver}),and(sender.eq.${receiver},receiver.eq.${sender})`
)
.eq('game',game)
.eq('status','pending')
.limit(1);

if(existingError)throw existingError;

if(existing&&existing.length){
return res.status(409).json({
error:'There is already a pending challenge.'
});
}


const{data:challenge,error:challengeError}=await supabase
.from('game_challenges')
.insert([{
game,
sender,
receiver,
status:'pending'
}])
.select()
.single();

if(challengeError)throw challengeError;

sendPushNotification(receiver,{
title:'🎮 Game Challenge',
body:`${sender} challenged you to ${game==='tictactoe'?'Tic Tac Toe':'Chess'}.`,
icon:'/icon.png',
url:`/games.html?challenge=${encodeURIComponent(challenge.id)}`,
badgeCount:1
});

res.status(201).json({
success:true,
challenge
});

}catch(e){

console.error('Create game challenge:',e);

res.status(500).json({
error:'Failed to create game challenge.'
});
}
});


/* SENT CHALLENGES */

app.get('/api/games/challenges/sent/:username',async(req,res)=>{
const username=clean(req.params.username);

if(!username){
return res.status(400).json({
error:'Username is required.'
});
}

try{

const{data:challenges,error:challengeError}=await supabase
.from('game_challenges')
.select('*')
.eq('sender',username)
.order('created_at',{ascending:false})
.limit(20);

if(challengeError)throw challengeError;

const results=[];

for(const challenge of challenges||[]){

let game=null;

if(
challenge.status==='accepted'&&
challenge.game==='tictactoe'&&
challenge.game_id
){

const{data:games,error:gameError}=await supabase
.from('game_sessions')
.select('*')
.eq('game_id',challenge.game_id)
.eq('game_type','tictactoe')
.limit(1);

if(gameError)throw gameError;

if(games&&games.length){
game=games[0];
}
}


if(
challenge.status==='accepted'&&
challenge.game==='tictactoe'&&
!game
){

const{data:fallbackGames,error:fallbackError}=await supabase
.from('game_sessions')
.select('*')
.eq('game_type','tictactoe')
.eq('player1',challenge.sender)
.eq('player2',challenge.receiver)
.order('created_at',{ascending:false})
.limit(1);

if(fallbackError)throw fallbackError;

if(fallbackGames&&fallbackGames.length){
game=fallbackGames[0];
}
}


results.push({
...challenge,
game
});

}

res.json({
challenges:results
});

}catch(e){

console.error('Fetch sent game challenges:',e);

res.status(500).json({
error:'Failed to fetch sent challenges.'
});
}
});


/* INCOMING CHALLENGES */

app.get('/api/games/challenges/:username',async(req,res)=>{
const username=clean(req.params.username);

if(!username){
return res.status(400).json({
error:'Username is required.'
});
}

try{

const{data,error}=await supabase
.from('game_challenges')
.select('*')
.eq('receiver',username)
.eq('status','pending')
.order('created_at',{ascending:false});

if(error)throw error;

res.json({
challenges:data||[]
});

}catch(e){

console.error('Fetch game challenges:',e);

res.status(500).json({
error:'Failed to fetch game challenges.'
});
}
});


app.post('/api/games/challenges/:id/respond',async(req,res)=>{
const id=req.params.id;
const username=clean(req.body.username);
const action=(req.body.action||'').trim().toLowerCase();

if(!id||!username||!['accept','decline'].includes(action)){
return res.status(400).json({
error:'Challenge, username, and valid action are required.'
});
}

try{

const{data:challenge,error:findError}=await supabase
.from('game_challenges')
.select('*')
.eq('id',id)
.eq('receiver',username)
.eq('status','pending')
.maybeSingle();

if(findError)throw findError;

if(!challenge){
return res.status(404).json({
error:'Challenge not found or already handled.'
});
}


/* DECLINE */

if(action==='decline'){

const{data:updated,error:updateError}=await supabase
.from('game_challenges')
.update({status:'declined'})
.eq('id',id)
.eq('receiver',username)
.eq('status','pending')
.select()
.single();

if(updateError)throw updateError;

return res.json({
success:true,
challenge:updated,
game:null
});
}


/* ACCEPT */

const{data:updated,error:updateError}=await supabase
.from('game_challenges')
.update({status:'accepted'})
.eq('id',id)
.eq('receiver',username)
.eq('status','pending')
.select()
.single();

if(updateError)throw updateError;


/* TIC TAC TOE */

if(challenge.game==='tictactoe'){

const gameId=`ttt_${Date.now()}_${Math.random().toString(36).substring(2,8)}`;

const game={
game_id:gameId,
game_type:'tictactoe',
player1:challenge.sender,
player2:challenge.receiver,
board:['','','','','','','','',''],
turn:challenge.sender,
status:'playing',
winner:null,
created_at:new Date().toISOString()
};

const{data:newGame,error:gameError}=await supabase
.from('game_sessions')
.insert([game])
.select()
.single();

if(gameError)throw gameError;


const{error:challengeGameError}=await supabase
.from('game_challenges')
.update({
game_id:newGame.game_id
})
.eq('id',id);

if(challengeGameError){
console.error(
'Could not store game_id:',
challengeGameError.message
);
}


sendPushNotification(challenge.sender,{
title:'🎮 Game Accepted',
body:`${username} accepted your Tic Tac Toe challenge.`,
icon:'/icon.png',
url:`/tictactoe.html?game=${encodeURIComponent(newGame.game_id)}&opponent=${encodeURIComponent(username)}`,
badgeCount:1
});

return res.json({
success:true,
challenge:{
...updated,
game_id:newGame.game_id
},
game:newGame
});
}


/* CHESS */

if(challenge.game==='chess'){

sendPushNotification(challenge.sender,{
title:'🎮 Game Accepted',
body:`${username} accepted your Chess challenge.`,
icon:'/icon.png',
url:`/chess.html?opponent=${encodeURIComponent(username)}`,
badgeCount:1
});

return res.json({
success:true,
challenge:updated,
game:null
});
}


res.json({
success:true,
challenge:updated,
game:null
});

}catch(e){

console.error('Respond to game challenge:',e);

res.status(500).json({
error:'Failed to respond to challenge.'
});
}
});


app.delete('/api/games/challenges/:id',async(req,res)=>{
const id=req.params.id;
const username=clean(req.body.username);

if(!id||!username){
return res.status(400).json({
error:'Challenge and username are required.'
});
}

try{

const{data:challenge,error:findError}=await supabase
.from('game_challenges')
.select('*')
.eq('id',id)
.maybeSingle();

if(findError)throw findError;

if(!challenge){
return res.status(404).json({
error:'Challenge not found.'
});
}

if(
!same(challenge.sender,username)&&
!same(challenge.receiver,username)
){
return res.status(403).json({
error:'You are not part of this challenge.'
});
}

const{error}=await supabase
.from('game_challenges')
.delete()
.eq('id',id);

if(error)throw error;

res.json({
success:true
});

}catch(e){

console.error('Delete game challenge:',e);

res.status(500).json({
error:'Failed to delete game challenge.'
});
}
});


/* =========================================================
   TIC TAC TOE
========================================================= */

app.post('/api/games/tictactoe',async(req,res)=>{
const player1=clean(req.body.player1);
const player2=clean(req.body.player2);

if(!player1||!player2){
return res.status(400).json({
error:'Both players are required.'
});
}

if(same(player1,player2)){
return res.status(400).json({
error:'You cannot play yourself.'
});
}

try{

const gameId=`ttt_${Date.now()}_${Math.random().toString(36).substring(2,8)}`;

const game={
game_id:gameId,
game_type:'tictactoe',
player1,
player2,
board:['','','','','','','','',''],
turn:player1,
status:'playing',
winner:null,
created_at:new Date().toISOString()
};

const{data,error}=await supabase
.from('game_sessions')
.insert([game])
.select()
.single();

if(error)throw error;

res.status(201).json({
success:true,
game:data
});

}catch(e){

console.error('Create Tic Tac Toe game:',e);

res.status(500).json({
error:'Failed to create game.'
});
}
});


app.get('/api/games/tictactoe/:gameId',async(req,res)=>{
try{

const{data,error}=await supabase
.from('game_sessions')
.select('*')
.eq('game_id',req.params.gameId)
.eq('game_type','tictactoe')
.maybeSingle();

if(error)throw error;

if(!data){
return res.status(404).json({
error:'Game not found.'
});
}

res.json({
game:data
});

}catch(e){

console.error('Get Tic Tac Toe game:',e);

res.status(500).json({
error:'Failed to load game.'
});
}
});


app.put('/api/games/tictactoe/:gameId/move',async(req,res)=>{
const gameId=req.params.gameId;
const username=clean(req.body.username);
const index=Number(req.body.index);

if(!username||!Number.isInteger(index)||index<0||index>8){
return res.status(400).json({
error:'Invalid move.'
});
}

try{

const{data:game,error:gameError}=await supabase
.from('game_sessions')
.select('*')
.eq('game_id',gameId)
.eq('game_type','tictactoe')
.maybeSingle();

if(gameError)throw gameError;

if(!game){
return res.status(404).json({
error:'Game not found.'
});
}

const isPlayer1=same(game.player1,username);
const isPlayer2=same(game.player2,username);

if(!isPlayer1&&!isPlayer2){
return res.status(403).json({
error:'You are not part of this game.'
});
}

if(game.status!=='playing'){
return res.status(400).json({
error:'Game is already finished.'
});
}

if(!same(game.turn,username)){
return res.status(400).json({
error:'Not your turn.'
});
}

if(game.board[index]){
return res.status(400).json({
error:'That square is already taken.'
});
}

const symbol=isPlayer1?'X':'O';
const board=[...game.board];

board[index]=symbol;

const wins=[
[0,1,2],
[3,4,5],
[6,7,8],
[0,3,6],
[1,4,7],
[2,5,8],
[0,4,8],
[2,4,6]
];

let winner=null;
let status='playing';

for(const[a,b,c]of wins){

if(
board[a]&&
board[a]===board[b]&&
board[a]===board[c]
){

winner=username;
status='finished';
break;

}

}

if(!winner&&board.every(Boolean)){
status='draw';
}

const nextTurn=
same(username,game.player1)
?game.player2
:game.player1;

const{data:updated,error:updateError}=await supabase
.from('game_sessions')
.update({
board,
turn:status==='playing'?nextTurn:game.turn,
status,
winner
})
.eq('game_id',gameId)
.select()
.single();

if(updateError)throw updateError;


/* Notify next player */

if(status==='playing'){

sendPushNotification(nextTurn,{
title:'🎮 Your Turn',
body:`${username} just played. It's your turn in Tic Tac Toe.`,
icon:'/icon.png',
url:`/tictactoe.html?game=${encodeURIComponent(gameId)}&opponent=${encodeURIComponent(username)}`,
badgeCount:1
});

}


/* Notify opponent when game ends */

if(status==='finished'||status==='draw'){

const opponent=
same(username,game.player1)
?game.player2
:game.player1;

sendPushNotification(opponent,{
title:'🎮 Tic Tac Toe',
body:
status==='draw'
?'The game ended in a draw.'
:`${username} won the game.`,
icon:'/icon.png',
url:`/tictactoe.html?game=${encodeURIComponent(gameId)}&opponent=${encodeURIComponent(username)}`,
badgeCount:1
});

}

res.json({
success:true,
game:updated
});

}catch(e){

console.error('Tic Tac Toe move:',e);

res.status(500).json({
error:'Failed to make move.'
});
}
});
app.delete('/api/games/tictactoe/:gameId',async(req,res)=>{
try{

const{error}=await supabase
.from('game_sessions')
.delete()
.eq('game_id',req.params.gameId)
.eq('game_type','tictactoe');

if(error)throw error;

res.json({
success:true
});

}catch(e){

console.error('Delete Tic Tac Toe game:',e);

res.status(500).json({
error:'Failed to delete game.'
});
}
});
/* =========================================================
   TYPING + ONLINE
========================================================= */

const typingState=new Map(),userHeartbeats=new Map();
app.post('/api/typing',(req,res)=>{
const{sender,receiver,isTyping}=req.body;

if(sender&&receiver){

typingState.set(
`${sender.toLowerCase()}_${receiver.toLowerCase()}`,
{
isTyping:!!isTyping,
timestamp:Date.now()
}
);

}

res.json({success:true});
});
app.get('/api/typing/:sender/:receiver',(req,res)=>{
const key=
`${req.params.sender.toLowerCase()}_${req.params.receiver.toLowerCase()}`;

const s=typingState.get(key);

res.json({
isTyping:!!(
s&&
Date.now()-s.timestamp<4000&&
s.isTyping
)
});
});


app.post('/api/heartbeat',(req,res)=>{
if(req.body.username){
userHeartbeats.set(
clean(req.body.username).toLowerCase(),
Date.now()
);
}

res.json({success:true});
});
app.get('/api/online-status/:username',(req,res)=>{
const t=userHeartbeats.get(
clean(req.params.username).toLowerCase()
);

res.json({
online:!!(
t&&
Date.now()-t<30000
)
});
});

/* =========================================================
   GROUP CHATS
========================================================= */

/* CREATE GROUP */

app.get('/api/groups/available-members/:username',async(req,res)=>{
const username=clean(req.params.username);

try{

const{data:messages,error}=await supabase
.from('direct_messages')
.select('sender_username,receiver_username')
.or(
`sender_username.ilike.${username},receiver_username.ilike.${username}`
);

if(error)throw error;

const people=new Map();

(messages||[]).forEach(m=>{
const sender=clean(m.sender_username);
const receiver=clean(m.receiver_username);

if(!same(sender,username))people.set(sender.toLowerCase(),sender);
if(!same(receiver,username))people.set(receiver.toLowerCase(),receiver);
});

res.json({users:[...people.values()]});

}catch(e){

console.error('Available create-group members:',e);

res.status(500).json({
error:'Failed to fetch available members.'
});
}
});


app.post('/api/groups',async(req,res)=>{
const name=(req.body.name||'').trim();
const description=(req.body.description||'').trim();
const admin=clean(req.body.admin_username||req.body.username);
const selectedMembers=Array.isArray(req.body.members)?req.body.members:[];
const profilePicture=req.body.profile_picture||null;

if(!name||!admin){
return res.status(400).json({
error:'Group name and admin username are required.'
});
}

try{

const{data:user,error:userError}=await supabase
.from('users')
.select('username')
.ilike('username',admin)
.maybeSingle();

if(userError)throw userError;

if(!user){
return res.status(404).json({
error:'User not found.'
});
}

const{data:group,error:groupError}=await supabase
.from('groups')
.insert([{
name,
description,
admin_username:user.username,
profile_picture:profilePicture
}])
.select()
.single();

if(groupError)throw groupError;

const members=[
{
group_id:group.id,
username:user.username
},
...selectedMembers
.filter(m=>m&&!same(m,user.username))
.map(m=>({
group_id:group.id,
username:clean(m)
}))
];

const uniqueMembers=[];
const seen=new Set();

members.forEach(m=>{
const key=m.username.toLowerCase();

if(!seen.has(key)){
seen.add(key);
uniqueMembers.push(m);
}
});

const{error:memberError}=await supabase
.from('group_members')
.insert(uniqueMembers);

if(memberError)throw memberError;

res.status(201).json({
success:true,
group
});

}catch(e){

console.error('Create group:',e);

res.status(500).json({
error:'Failed to create group.'
});
}
});


/* GET USER GROUPS */

app.get('/api/groups/:username',async(req,res)=>{
const username=clean(req.params.username);

if(!username){
return res.status(400).json({
error:'Username is required.'
});
}

try{

const{data:members,error:memberError}=await supabase
.from('group_members')
.select('group_id')
.ilike('username',username);

if(memberError)throw memberError;

if(!members||!members.length){
return res.json({groups:[]});
}

const ids=members.map(m=>m.group_id);

const{data:groups,error:groupError}=await supabase
.from('groups')
.select('*')
.in('id',ids)
.order('created_at',{ascending:false});

if(groupError)throw groupError;

res.json({
groups:groups||[]
});

}catch(e){

console.error('Fetch groups:',e);

res.status(500).json({
error:'Failed to fetch groups.'
});
}
});


/* GET GROUP */

app.get('/api/groups/info/:groupId',async(req,res)=>{
try{

const{data:group,error}=await supabase
.from('groups')
.select('*')
.eq('id',req.params.groupId)
.maybeSingle();

if(error)throw error;

if(!group){
return res.status(404).json({
error:'Group not found.'
});
}

const{data:members,error:memberError}=await supabase
.from('group_members')
.select('*')
.eq('group_id',group.id)
.order('joined_at',{ascending:true});

if(memberError)throw memberError;

res.json({
group,
members:members||[]
});

}catch(e){

console.error('Get group:',e);

res.status(500).json({
error:'Failed to fetch group.'
});
}
});


/* GET PEOPLE FROM USER'S DMS */

app.get('/api/groups/:groupId/available-members/:username',async(req,res)=>{
const username=clean(req.params.username);
const groupId=req.params.groupId;

try{

const{data:messages,error}=await supabase
.from('direct_messages')
.select('sender_username,receiver_username')
.or(
`sender_username.ilike.${username},receiver_username.ilike.${username}`
);

if(error)throw error;

const people=new Map();

(messages||[]).forEach(m=>{

const sender=clean(m.sender_username);
const receiver=clean(m.receiver_username);

if(!same(sender,username)){
people.set(sender.toLowerCase(),sender);
}

if(!same(receiver,username)){
people.set(receiver.toLowerCase(),receiver);
}

});

const{data:members,error:memberError}=await supabase
.from('group_members')
.select('username')
.eq('group_id',groupId);

if(memberError)throw memberError;

const existing=new Set(
(members||[]).map(m=>m.username.toLowerCase())
);

const available=[...people.values()]
.filter(person=>!existing.has(person.toLowerCase()));

res.json({
users:available
});

}catch(e){

console.error('Available group members:',e);

res.status(500).json({
error:'Failed to fetch available members.'
});
}
});


/* ADD MEMBER — ADMIN ONLY */

app.post('/api/groups/:groupId/members',async(req,res)=>{
const groupId=req.params.groupId;
const admin=clean(req.body.admin_username||req.body.username);
const member=clean(req.body.member_username||req.body.member);

if(!admin||!member){
return res.status(400).json({
error:'Admin and member usernames are required.'
});
}

try{

const{data:group,error:groupError}=await supabase
.from('groups')
.select('*')
.eq('id',groupId)
.maybeSingle();

if(groupError)throw groupError;

if(!group){
return res.status(404).json({
error:'Group not found.'
});
}

if(!same(group.admin_username,admin)){
return res.status(403).json({
error:'Only the group admin can add members.'
});
}

const{data:user,error:userError}=await supabase
.from('users')
.select('username')
.ilike('username',member)
.maybeSingle();

if(userError)throw userError;

if(!user){
return res.status(404).json({
error:'User not found.'
});
}

const{data:existing,error:existingError}=await supabase
.from('group_members')
.select('id')
.eq('group_id',groupId)
.ilike('username',user.username)
.maybeSingle();

if(existingError)throw existingError;

if(existing){
return res.status(409).json({
error:'User is already in this group.'
});
}

const{data:newMember,error:memberError}=await supabase
.from('group_members')
.insert([{
group_id:groupId,
username:user.username
}])
.select()
.single();

if(memberError)throw memberError;

res.status(201).json({
success:true,
member:newMember
});

}catch(e){

console.error('Add group member:',e);

res.status(500).json({
error:'Failed to add member.'
});
}
});


/* REMOVE MEMBER — ADMIN ONLY */

app.delete('/api/groups/:groupId/members/:username',async(req,res)=>{
const groupId=req.params.groupId;
const admin=clean(req.body.admin_username||req.body.username);
const member=clean(req.params.username);

if(!admin||!member){
return res.status(400).json({
error:'Admin and member usernames are required.'
});
}

try{

const{data:group,error:groupError}=await supabase
.from('groups')
.select('*')
.eq('id',groupId)
.maybeSingle();

if(groupError)throw groupError;

if(!group){
return res.status(404).json({
error:'Group not found.'
});
}

if(!same(group.admin_username,admin)){
return res.status(403).json({
error:'Only the group admin can remove members.'
});
}

if(same(group.admin_username,member)){
return res.status(400).json({
error:'The group admin cannot be removed.'
});
}

const{error}=await supabase
.from('group_members')
.delete()
.eq('group_id',groupId)
.ilike('username',member);

if(error)throw error;

res.json({success:true});

}catch(e){

console.error('Remove group member:',e);

res.status(500).json({
error:'Failed to remove member.'
});
}
});


/* GROUP MESSAGES */

app.get('/api/groups/:groupId/messages',async(req,res)=>{
const groupId=req.params.groupId;
const username=clean(req.query.username);

try{

if(username){

const{data:member,error:memberError}=await supabase
.from('group_members')
.select('id')
.eq('group_id',groupId)
.ilike('username',username)
.maybeSingle();

if(memberError)throw memberError;

if(!member){
return res.status(403).json({
error:'You are not a member of this group.'
});
}
}

const{data:messages,error}=await supabase
.from('group_messages')
.select('*')
.eq('group_id',groupId)
.order('created_at',{ascending:true});

if(error)throw error;

res.json({
messages:messages||[]
});

}catch(e){

console.error('Group messages:',e);

res.status(500).json({
error:'Failed to fetch group messages.'
});
}
});


app.post('/api/groups/:groupId/messages',async(req,res)=>{
const groupId=req.params.groupId;
const sender=clean(req.body.sender_username||req.body.sender);
const content=req.body.content||'';
const image_url=req.body.image_url||null;

if(!sender||(!content&&!image_url)){
return res.status(400).json({
error:'Sender and content/image are required.'
});
}

try{

const{data:member,error:memberError}=await supabase
.from('group_members')
.select('id')
.eq('group_id',groupId)
.ilike('username',sender)
.maybeSingle();

if(memberError)throw memberError;

if(!member){
return res.status(403).json({
error:'You are not a member of this group.'
});
}

const{data:message,error}=await supabase
.from('group_messages')
.insert([{
group_id:groupId,
sender_username:sender,
content,
image_url
}])
.select()
.single();

if(error)throw error;

res.status(201).json({
success:true,
message
});

}catch(e){

console.error('Send group message:',e);

res.status(500).json({
error:'Failed to send group message.'
});
}
});


/* DELETE GROUP — ADMIN ONLY */

app.delete('/api/groups/:groupId',async(req,res)=>{
const groupId=req.params.groupId;
const username=clean(req.body.username);

if(!username){
return res.status(400).json({
error:'Username is required.'
});
}

try{

const{data:group,error:groupError}=await supabase
.from('groups')
.select('*')
.eq('id',groupId)
.maybeSingle();

if(groupError)throw groupError;

if(!group){
return res.status(404).json({
error:'Group not found.'
});
}

if(!same(group.admin_username,username)){
return res.status(403).json({
error:'Only the group admin can delete the group.'
});
}

const{error}=await supabase
.from('groups')
.delete()
.eq('id',groupId);

if(error)throw error;

res.json({success:true});

}catch(e){

console.error('Delete group:',e);

res.status(500).json({
error:'Failed to delete group.'
});
}
});


/* LEAVE GROUP */

app.delete('/api/groups/:groupId/leave',async(req,res)=>{
const groupId=req.params.groupId;
const username=clean(req.body.username);

if(!username){
return res.status(400).json({
error:'Username is required.'
});
}

try{

const{data:group,error:groupError}=await supabase
.from('groups')
.select('*')
.eq('id',groupId)
.maybeSingle();

if(groupError)throw groupError;

if(!group){
return res.status(404).json({
error:'Group not found.'
});
}

if(same(group.admin_username,username)){
return res.status(400).json({
error:'The admin cannot leave the group. Delete the group instead.'
});
}

const{error}=await supabase
.from('group_members')
.delete()
.eq('group_id',groupId)
.ilike('username',username);

if(error)throw error;

res.json({success:true});

}catch(e){

console.error('Leave group:',e);

res.status(500).json({
error:'Failed to leave group.'
});
}
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err,req,res,next)=>{
console.error(err);
res.status(500).json({
error:'An unexpected server error occurred.'
});
});


const PORT=process.env.PORT||3000;

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
