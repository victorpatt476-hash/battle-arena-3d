import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.use(express.static('.'));

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`Battle Arena running on port ${port}`));
const wss = new WebSocketServer({ server, path: '/game' });
const players = new Map();

function clean(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function snapshot() {
  return { type: 'snapshot', players: [...players.values()] };
}

wss.on('connection', socket => {
  const id = crypto.randomUUID();
  socket.id = id;
  players.set(id, { id, x: 0, y: 0, z: 8, yaw: 0, health: 100, ammo: 30, kills: 0, moving: false, timestamp: Date.now() });
  socket.send(JSON.stringify({ type: 'welcome', id }));
  socket.send(JSON.stringify(snapshot()));

  socket.on('message', data => {
    try {
      const message = JSON.parse(data.toString());
      const player = players.get(id);
      if (!player) return;

      if (message.type === 'state') {
        player.x = clean(message.x, -32, 32);
        player.y = clean(message.y, 0, 12);
        player.z = clean(message.z, -32, 32);
        player.yaw = clean(message.yaw, -Math.PI * 2, Math.PI * 2);
        player.moving = Boolean(message.moving);
        player.timestamp = Date.now();
      }

      if (message.type === 'shot') {
        if (player.ammo <= 0) return;
        player.ammo--;
        const shot = { type: 'shot', id, origin: message.origin, direction: message.direction };
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(shot));
        }
      }

      if (message.type === 'hit') {
        const target = players.get(message.targetId);
        if (!target) return;
        target.health = Math.max(0, target.health - clean(message.damage, 1, 100, 20));
        if (target.health === 0) {
          player.kills++;
          const result = { type: 'elimination', killerId: id, victimId: target.id };
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(result));
          }
          target.health = 100;
          target.x = 0;
          target.y = 0;
          target.z = 8;
        }
      }
    } catch (error) {
      console.warn('Invalid multiplayer message:', error.message);
    }
  });

  socket.on('close', () => players.delete(id));
  socket.on('error', () => players.delete(id));
});

setInterval(() => {
  const now = Date.now();
  for (const [id, player] of players) {
    if (now - player.timestamp > 15000) players.delete(id);
  }
  const packet = JSON.stringify(snapshot());
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(packet);
  }
}, 50);
