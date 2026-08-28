// 瞎蒙也是赢 - 联机对战服务端
// Node.js + Express + ws (WebSocket)
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;

// 静态文件服务（游戏前端）
app.use(express.static(path.join(__dirname, 'public')));

// ==================== 房间管理 ====================
const rooms = new Map();
const clients = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function createRoom(mode, cat, host) {
  let code = genCode();
  while (rooms.has(code)) code = genCode();
  const room = {
    code, mode, cat: cat || 'all', host: host.id,
    players: [{ id: host.id, name: host.name, avatar: host.avatar || '', team: 'a', ready: true, isHost: true }],
    status: 'waiting', questions: [], ci: 0, answers: {}, scores: { a: 0, b: 0 }, emojis: [], createdAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function getRoomState(room) {
  return {
    code: room.code, mode: room.mode, cat: room.cat, host: room.host,
    players: room.players, status: room.status,
    questions: room.status === 'playing' ? room.questions : [],
    ci: room.ci, answers: room.answers, scores: room.scores, emojis: room.emojis.slice(-20)
  };
}

function broadcastRoom(room) {
  if (!room) return;
  const state = getRoomState(room);
  const msg = JSON.stringify({ type: 'room_state', data: state });
  room.players.forEach(p => {
    const ws = [...clients.keys()].find(c => clients.get(c)?.id === p.id);
    if (ws && ws.readyState === 1) ws.send(msg);
  });
}

function sendTo(ws, type, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, data }));
}

function leaveRoom(ws, client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (!room) { client.roomCode = null; return; }
  room.players = room.players.filter(p => p.id !== client.id);
  if (room.players.length === 0) {
    rooms.delete(room.code);
  } else {
    if (room.host === client.id) {
      room.host = room.players[0].id;
      room.players[0].isHost = true;
      room.players[0].ready = true;
    }
    broadcastRoom(room);
  }
  client.roomCode = null;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.length === 0 && now - room.createdAt > 300000) rooms.delete(code);
  }
}, 300000);

// ==================== WebSocket ====================
wss.on('connection', (ws) => {
  const client = { id: null, name: null, avatar: null, roomCode: null };
  clients.set(ws, client);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    const { type, data } = msg;
    if (!type) return;

    switch (type) {
      case 'auth': {
        client.id = data.id; client.name = data.name; client.avatar = data.avatar || '';
        sendTo(ws, 'auth_ok', { id: client.id });
        break;
      }
      case 'create_room': {
        if (!client.id) { sendTo(ws, 'error', { msg: '未登录' }); break; }
        if (client.roomCode) { sendTo(ws, 'error', { msg: '已在房间中' }); break; }
        const room = createRoom(data.mode, data.cat, client);
        client.roomCode = room.code;
        sendTo(ws, 'room_created', { code: room.code });
        broadcastRoom(room);
        break;
      }
      case 'join_room': {
        if (!client.id) { sendTo(ws, 'error', { msg: '未登录' }); break; }
        const code = (data.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) { sendTo(ws, 'join_error', { msg: '房间不存在或已解散' }); break; }
        if (room.status !== 'waiting') { sendTo(ws, 'join_error', { msg: '游戏已开始' }); break; }
        if (room.players.find(p => p.id === client.id)) {
          client.roomCode = code;
          sendTo(ws, 'room_joined', { code });
          broadcastRoom(room);
          break;
        }
        const [a, b] = room.mode.split('v').map(Number);
        const ac = room.players.filter(p => p.team === 'a').length;
        const bc = room.players.filter(p => p.team === 'b').length;
        let team = null;
        if (ac < a) team = 'a';
        else if (bc < b) team = 'b';
        else { sendTo(ws, 'join_error', { msg: '房间已满' }); break; }
        room.players.push({ id: client.id, name: client.name, avatar: client.avatar || '', team, ready: false, isHost: false });
        client.roomCode = code;
        sendTo(ws, 'room_joined', { code });
        broadcastRoom(room);
        break;
      }
      case 'ready': {
        const room = rooms.get(client.roomCode);
        if (!room || room.status !== 'waiting') break;
        const player = room.players.find(p => p.id === client.id);
        if (player && !player.isHost) { player.ready = !player.ready; broadcastRoom(room); }
        break;
      }
      case 'start_game': {
        const room = rooms.get(client.roomCode);
        if (!room || room.host !== client.id || room.status !== 'waiting') break;
        if (room.players.length < 2) { sendTo(ws, 'error', { msg: '至少需要2名玩家' }); break; }
        if (!room.players.every(p => p.ready)) { sendTo(ws, 'error', { msg: '请等待所有玩家准备' }); break; }
        if (data.questions && Array.isArray(data.questions)) room.questions = data.questions;
        room.status = 'playing'; room.ci = 0; room.answers = {}; room.scores = { a: 0, b: 0 }; room.emojis = [];
        broadcastRoom(room);
        break;
      }
      case 'answer': {
        const room = rooms.get(client.roomCode);
        if (!room || room.status !== 'playing') break;
        const qi = data.qi;
        if (qi !== room.ci) break;
        if (!room.answers[qi]) room.answers[qi] = {};
        if (room.answers[qi][client.id]) break;
        const answer = { choice: data.choice, time: data.time, correct: data.correct, score: data.score || 0 };
        room.answers[qi][client.id] = answer;
        const player = room.players.find(p => p.id === client.id);
        if (player && answer.score) {
          if (player.team === 'a') room.scores.a += answer.score;
          else room.scores.b += answer.score;
        }
        broadcastRoom(room);
        break;
      }
      case 'emoji': {
        const room = rooms.get(client.roomCode);
        if (!room || room.status !== 'playing') break;
        room.emojis.push({ from: client.id, emoji: data.emoji, target: data.target, ts: Date.now() });
        if (room.emojis.length > 50) room.emojis = room.emojis.slice(-50);
        broadcastRoom(room);
        break;
      }
      case 'next_question': {
        const room = rooms.get(client.roomCode);
        if (!room || room.host !== client.id || room.status !== 'playing') break;
        room.ci += 1;
        if (room.ci >= 12) room.status = 'finished';
        broadcastRoom(room);
        break;
      }
      case 'end_game': {
        const room = rooms.get(client.roomCode);
        if (!room || room.host !== client.id) break;
        room.status = 'finished';
        broadcastRoom(room);
        break;
      }
      case 'rematch': {
        const room = rooms.get(client.roomCode);
        if (!room || room.host !== client.id) break;
        room.status = 'waiting'; room.questions = []; room.ci = 0; room.answers = {}; room.scores = { a: 0, b: 0 }; room.emojis = [];
        room.players.forEach(p => { p.ready = p.isHost; });
        broadcastRoom(room);
        break;
      }
      case 'leave_room': {
        leaveRoom(ws, client);
        break;
      }
      case 'ping': {
        sendTo(ws, 'pong', { t: Date.now() });
        break;
      }
    }
  });

  ws.on('close', () => { leaveRoom(ws, client); clients.delete(ws); });
  ws.on('error', () => { leaveRoom(ws, client); clients.delete(ws); });
});

server.listen(PORT, () => {
  console.log(`瞎蒙也是赢 联机服务已启动: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
