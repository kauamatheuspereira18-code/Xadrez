/* Servidor do jogo de xadrez: arquivos estáticos + salas online via WebSocket.
   Login = apenas escolher um apelido (sem cadastro/senha).
   Salas: criar sala (gera código + link compartilhável) ou entrar com código/link. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const E = require('./public/js/engine.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.zip') headers['Content-Disposition'] = 'attachment; filename="xadrez-gay.zip"';
    res.writeHead(200, headers);
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

const rooms = new Map(); // code -> room
const clients = new Map(); // ws -> {name, code, color}

function roomList() {
  const list = [];
  for (const r of rooms.values()) {
    const host = r.players[0];
    // Only advertise a genuinely open table with its host still connected.
    if (!r.over && r.players.length === 1 && host && host.connected) {
      list.push({ code: r.code, host: host.name, players: 1 });
    }
  }
  return list;
}

function broadcastRoomList() {
  const msg = JSON.stringify({ type: 'roomList', rooms: roomList() });
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(msg);
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function roomPayload(room) {
  return {
    code: room.code,
    state: room.state,
    history: room.history,
    lastMove: room.lastMove || null,
    players: room.players.map(p => ({ name: p.name, color: p.color, connected: p.connected })),
    over: room.over || null,
    clock: room.clock
  };
}

function broadcast(room, obj, exceptWs) {
  const msg = JSON.stringify(obj);
  for (const p of room.players) {
    if (p.ws && p.ws !== exceptWs && p.ws.readyState === 1) p.ws.send(msg);
  }
}

function newRoom(code, hostWs, name) {
  const room = {
    code,
    state: E.initialState(),
    history: [],
    players: [{ ws: hostWs, name, color: 'w', connected: true }],
    over: null,
    clock: { w: 600, b: 600, lastTick: Date.now() },
    rematch: {}
  };
  rooms.set(code, room);
  return room;
}

function settleClock(room) {
  const now = Date.now();
  const elapsed = (now - room.clock.lastTick) / 1000;
  room.clock[room.state.turn] = Math.max(0, room.clock[room.state.turn] - elapsed);
  room.clock.lastTick = now;
  if (room.clock.w <= 0 || room.clock.b <= 0) {
    const loser = room.clock.w <= 0 ? 'w' : 'b';
    room.over = { result: loser === 'w' ? '0-1' : '1-0', reason: 'timeout', winner: loser === 'w' ? 'b' : 'w' };
    return true;
  }
  return false;
}

wss.on('connection', (ws) => {
  send(ws, { type: 'roomList', rooms: roomList() });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const name = String(msg.name || 'Jogador').slice(0, 20).trim() || 'Jogador';
      const code = genCode();
      const room = newRoom(code, ws, name);
      clients.set(ws, { name, code, color: 'w' });
      send(ws, { type: 'joined', ...roomPayload(room), yourColor: 'w', youAreHost: true });
      broadcastRoomList();
    }

    else if (msg.type === 'join') {
      const name = String(msg.name || 'Jogador').slice(0, 20).trim() || 'Jogador';
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: 'Sala não encontrada. Verifique o código.' });
      // reconexão: mesmo nome já está na sala
      const existing = room.players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing && existing.connected && existing.ws !== ws) {
        return send(ws, { type: 'error', message: 'Esse apelido já está nesta sala. Escolha outro para entrar.' });
      }
      if (existing) {
        existing.ws = ws; existing.connected = true;
        clients.set(ws, { name, code, color: existing.color });
        send(ws, { type: 'joined', ...roomPayload(room), yourColor: existing.color, youAreHost: existing.color === 'w' });
        broadcast(room, { type: 'opponentBack', ...roomPayload(room) }, ws);
        broadcastRoomList();
        return;
      }
      if (room.players.length >= 2) return send(ws, { type: 'error', message: 'Sala cheia (2 jogadores).' });
      const color = room.players.length === 0 ? 'w' : 'b';
      room.players.push({ ws, name, color, connected: true });
      clients.set(ws, { name, code, color });
      send(ws, { type: 'joined', ...roomPayload(room), yourColor: color, youAreHost: color === 'w' });
      broadcast(room, { type: 'opponentJoined', ...roomPayload(room) }, ws);
      broadcastRoomList();
    }

    else if (msg.type === 'move') {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.code);
      if (!room || room.over) return;
      if (room.state.turn !== info.color) return send(ws, { type: 'error', message: 'Não é a sua vez.' });
      const move = E.findMove(room.state, msg.move.from, msg.move.to, msg.move.promotion);
      if (!move) return send(ws, { type: 'error', message: 'Lance ilegal.' });
      if (settleClock(room)) {
        broadcast(room, { type: 'gameOver', ...roomPayload(room) });
        return;
      }
      const san = E.toSAN(room.state, move);
      room.state = E.applyMove(room.state, move);
      room.lastMove = move;
      room.history.push(san);
      const st = E.status(room.state);
      if (st.over) room.over = { result: st.result, reason: st.reason, winner: st.winner };
      broadcast(room, { type: 'move', san, ...roomPayload(room) });
    }

    else if (msg.type === 'chat') {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.code);
      if (!room) return;
      broadcast(room, { type: 'chat', from: info.name, color: info.color, text: String(msg.text || '').slice(0, 200) });
    }

    else if (msg.type === 'resign') {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.code);
      if (!room || room.over) return;
      room.over = { result: info.color === 'w' ? '0-1' : '1-0', reason: 'resign', winner: info.color === 'w' ? 'b' : 'w' };
      broadcast(room, { type: 'gameOver', ...roomPayload(room) });
    }

    else if (msg.type === 'rematch') {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.code);
      if (!room) return;
      room.rematch[info.color] = true;
      const both = room.rematch.w && room.rematch.b;
      if (both) {
        room.state = E.initialState();
        room.history = [];
        room.lastMove = null;
        room.over = null;
        room.rematch = {};
        room.clock = { w: 600, b: 600, lastTick: Date.now() };
        broadcast(room, { type: 'rematchStart', ...roomPayload(room) });
      } else {
        broadcast(room, { type: 'rematchOffer', from: info.name }, ws);
        send(ws, { type: 'rematchOffer', from: info.name, waiting: true });
      }
    }

    else if (msg.type === 'listRooms') {
      send(ws, { type: 'roomList', rooms: roomList() });
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (!info) return;
    clients.delete(ws);
    const room = rooms.get(info.code);
    if (!room) return;
    const player = room.players.find(p => p.ws === ws);
    // Ignore the close event from an old socket after the player has reconnected.
    if (!player) return;
    player.connected = false;
    if (room.players.length < 2 || room.over) {
      // sala vazia ou partida encerrada: remove após desconexão de todos
      if (room.players.every(p => !p.connected)) rooms.delete(info.code);
    }
    broadcast(room, { type: 'opponentLeft', ...roomPayload(room) });
    broadcastRoomList();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`♔ Xadrez online rodando em http://0.0.0.0:${PORT}`);
});
