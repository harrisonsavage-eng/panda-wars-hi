const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const io = new Server(httpServer, { cors: { origin: '*' } });

const TICK_RATE = 20;
const rooms = {};

const WEAPON_IDS = ['butter_knife','cleaver','rolling_pin','frying_pan','chef_knife',
                    'salt_shaker','soup_pot','egg','pepper_spray','spatula','wok','knife_storm'];
const RARITY_W   = [5,2,4,2,3,4,1,2,4,1,1,1];
const DROP_POOL  = [];
WEAPON_IDS.forEach((id,i)=>{ for(let j=0;j<RARITY_W[i];j++) DROP_POOL.push(id); });
function randWpn(){ return DROP_POOL[Math.floor(Math.random()*DROP_POOL.length)]; }

const PW = 100*32, PH = 80*32;
const SCX = PW/2, SCY = PH/2;

function makeChests(){
  const out=[];
  for(let i=0;i<80;i++) out.push({id:i,x:300+Math.random()*(PW-600),y:300+Math.random()*(PH-600),alive:true,wpnId:randWpn()});
  return out;
}

function makeLoot(n){
  const out=[];
  for(let i=0;i<n;i++) out.push({id:i,x:200+Math.random()*(PW-400),y:200+Math.random()*(PH-400),wpnId:randWpn(),alive:true});
  return out;
}

function getOrCreateRoom(){
  for(const rid in rooms){
    const r=rooms[rid];
    if(!r.started && Object.keys(r.players).length < 100) return rid;
  }
  const rid='room_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  rooms[rid]={
    players:{},started:false,startCountdown:null,
    stormRadius:Math.max(PW,PH)*.65,stormTimer:40,
    chests:makeChests(),loot:makeLoot(60),kills:[]
  };
  return rid;
}

function getRoomId(socket){ return [...socket.rooms].find(r=>r!==socket.id); }

function spawnPlayer(username,emoji){
  return {id:username,x:400+Math.random()*(PW-800),y:400+Math.random()*(PH-800),
    hp:100,shield:80,maxHp:100,maxShield:80,face:1,dead:false,emoji,kills:0,
    inv:['butter_knife',null,null],activeSlot:0,weapon:'butter_knife',ammo:30};
}

// Server tick
setInterval(()=>{
  for(const rid in rooms){
    const room=rooms[rid];
    if(!room.started) continue;
    const dt=TICK_RATE/1000;
    room.stormTimer-=dt;
    if(room.stormTimer<=0){ room.stormRadius=Math.max(110,room.stormRadius-55*dt); room.stormTimer=38; }

    // Storm damage
    for(const sid in room.players){
      const p=room.players[sid];
      if(p.dead) continue;
      if(Math.hypot(p.x-SCX,p.y-SCY)>room.stormRadius){
        p.hp=Math.max(0,p.hp-8*dt);
        if(p.hp<=0&&!p.dead){ p.dead=true; io.to(rid).emit('playerDied',{id:p.id,killer:'storm',killerEmoji:'🌀'}); }
      }
    }

    const alive=Object.values(room.players).filter(p=>!p.dead);
    io.to(rid).emit('worldState',{players:room.players,stormRadius:room.stormRadius,stormTimer:room.stormTimer,aliveCount:alive.length});

    // Win condition
    if(alive.length<=1 && Object.keys(room.players).length>1){
      io.to(rid).emit('gameOver',{winnerId:alive[0]?alive[0].id:null,winnerEmoji:alive[0]?alive[0].emoji:'🐼'});
      room.started=false;
      setTimeout(()=>{ delete rooms[rid]; },15000);
    }
  }
},TICK_RATE);

io.on('connection',(socket)=>{
  console.log('Connected:',socket.id);

  socket.on('joinGame',({username,emoji})=>{
    const rid=getOrCreateRoom();
    const room=rooms[rid];
    socket.join(rid);
    const player=spawnPlayer(username,emoji);
    room.players[socket.id]=player;

    socket.emit('joinedRoom',{roomId:rid,socketId:socket.id,player,chests:room.chests,loot:room.loot,allPlayers:room.players});
    socket.to(rid).emit('playerJoined',{socketId:socket.id,player});
    io.to(rid).emit('lobbyUpdate',{count:Object.keys(room.players).length});

    console.log('Room',rid,'players:',Object.keys(room.players).length);

    if(Object.keys(room.players).length>=2 && !room.started && !room.startCountdown){
      let secs=5;
      io.to(rid).emit('countdown',{seconds:secs});
      const iv=setInterval(()=>{
        secs--;
        io.to(rid).emit('countdown',{seconds:secs});
        if(secs<=0){
          clearInterval(iv);
          room.started=true;
          io.to(rid).emit('gameStart',{chests:room.chests,loot:room.loot,players:room.players});
          console.log('Game started:',rid);
        }
      },1000);
      room.startCountdown=iv;
    }
  });

  socket.on('playerUpdate',(data)=>{
    const rid=getRoomId(socket);
    if(!rid||!rooms[rid]||!rooms[rid].players[socket.id]) return;
    Object.assign(rooms[rid].players[socket.id],{x:data.x,y:data.y,hp:data.hp,shield:data.shield,face:data.face,dead:data.dead,weapon:data.weapon,ammo:data.ammo,activeSlot:data.activeSlot});
  });

  socket.on('shoot',(data)=>{
    const rid=getRoomId(socket);
    if(!rid) return;
    socket.to(rid).emit('bulletFired',{...data,shooterSocketId:socket.id});
  });

  socket.on('hitPlayer',({targetSocketId,damage})=>{
    const rid=getRoomId(socket);
    if(!rid||!rooms[rid]) return;
    const room=rooms[rid];
    const target=room.players[targetSocketId];
    if(!target||target.dead) return;
    if(target.shield>0){ target.shield=Math.max(0,target.shield-damage*.55); target.hp=Math.max(0,target.hp-damage*.45); }
    else target.hp=Math.max(0,target.hp-damage);
    if(target.hp<=0&&!target.dead){
      target.dead=true;
      const attacker=room.players[socket.id];
      if(attacker) attacker.kills++;
      io.to(rid).emit('playerDied',{id:target.id,socketId:targetSocketId,killer:attacker?attacker.id:'unknown',killerEmoji:attacker?attacker.emoji:'💀'});
    }
    io.to(targetSocketId).emit('youGotHit',{damage,hp:target.hp,shield:target.shield});
  });

  socket.on('openChest',({chestId})=>{
    const rid=getRoomId(socket);
    if(!rid||!rooms[rid]) return;
    const chest=rooms[rid].chests.find(c=>c.id===chestId&&c.alive);
    if(!chest) return;
    chest.alive=false;
    io.to(rid).emit('chestOpened',{chestId});
  });

  socket.on('pickupLoot',({lootId})=>{
    const rid=getRoomId(socket);
    if(!rid||!rooms[rid]) return;
    rooms[rid].loot=rooms[rid].loot.filter(l=>l.id!==lootId);
    socket.to(rid).emit('lootPickedUp',{lootId});
  });

  socket.on('disconnect',()=>{
    console.log('Disconnected:',socket.id);
    for(const rid in rooms){
      const room=rooms[rid];
      if(room.players[socket.id]){
        const p=room.players[socket.id];
        delete room.players[socket.id];
        io.to(rid).emit('playerLeft',{socketId:socket.id,id:p.id});
        io.to(rid).emit('lobbyUpdate',{count:Object.keys(room.players).length});
        if(Object.keys(room.players).length===0){ if(room.startCountdown)clearInterval(room.startCountdown); delete rooms[rid]; }
        break;
      }
    }
  });
});

httpServer.listen(PORT,()=>console.log('🐼 Panda Wars running on port '+PORT));
