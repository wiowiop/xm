# 瞎蒙也是赢 - 联机对战服务端

基于 Node.js + Express + WebSocket 的实时联机答题对战服务。

## 目录结构

```
server/
├── server.js      # 服务端主程序（WebSocket房间管理+游戏同步）
├── package.json   # 依赖配置
├── public/        # 前端静态文件（游戏HTML）
│   └── index.html
└── README.md      # 本文件
```

## 本地运行

```bash
cd server
npm install
npm start
```

打开浏览器访问 `http://localhost:3000`

## 联机测试方法

1. 启动服务后，在两个不同的浏览器标签页（或不同设备）打开 `http://localhost:3000`
2. 各自创建/登录不同账号
3. 一个玩家创建房间，另一个玩家输入房间码加入
4. 双方准备后房主开始游戏

## 部署到云端（支持跨设备联机）

### 方案一：Render（推荐，免费额度够用）

1. 将 `server/` 目录推送到 GitHub
2. 在 [render.com](https://render.com) 新建 Web Service
3. 连接你的 GitHub 仓库
4. 配置：
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 部署完成后获得域名，例如 `https://your-app.onrender.com`

### 方案二：Railway / Heroku / 任何支持 Node.js 的平台

类似配置，确保启动命令为 `npm start`，端口使用环境变量 `PORT`。

### 方案三：VPS / 云服务器

```bash
# 安装 Node.js 16+
# 上传 server 目录
cd server
npm install
# 使用 pm2 或 systemd 守护进程
pm2 start server.js --name brain-king
pm2 save
```

## 前端配置（部署到 Netlify 时）

如果前端部署在 Netlify（如 `jazzy-manatee-c4c7a6.netlify.app`），需要修改前端的 WebSocket 地址：

1. 打开 `public/index.html`
2. 找到第 ~582 行的 `const WS_URL = '';`
3. 修改为你的服务端地址，例如：
   ```js
   const WS_URL = 'wss://your-app.onrender.com/ws';
   ```
4. 将修改后的 `index.html` 部署到 Netlify

> 注意：如果前端和服务端在同一个域名下部署，`WS_URL` 留空即可自动连接。

## 消息协议

### 客户端 → 服务端

| 类型 | 数据 | 说明 |
|------|------|------|
| `auth` | `{id, name, avatar}` | 身份认证 |
| `create_room` | `{mode, cat}` | 创建房间 |
| `join_room` | `{code}` | 加入房间 |
| `ready` | - | 准备/取消准备 |
| `start_game` | `{questions}` | 房主开始游戏 |
| `answer` | `{qi, choice, time, correct, score}` | 提交答案 |
| `emoji` | `{emoji, target}` | 发送表情 |
| `next_question` | - | 房主推进下一题 |
| `end_game` | - | 房主结束游戏 |
| `rematch` | - | 房主重开 |
| `leave_room` | - | 离开房间 |
| `ping` | - | 心跳 |

### 服务端 → 客户端

| 类型 | 数据 | 说明 |
|------|------|------|
| `auth_ok` | `{id}` | 认证成功 |
| `room_state` | 房间完整状态 | 房间状态变更广播 |
| `join_error` | `{msg}` | 加入失败 |
| `error` | `{msg}` | 通用错误 |
| `pong` | `{t}` | 心跳响应 |

## 房间状态结构

```js
{
  code: "ABC123",
  mode: "1v1",        // 1v1 / 1v2 / 2v2 / 3v3
  cat: "all",          // 题库分类
  host: "player_id",
  players: [
    {id, name, avatar, team: "a"|"b", ready, isHost}
  ],
  status: "waiting",   // waiting / playing / finished
  questions: [...],    // 12道题（游戏中）
  ci: 0,               // 当前题号
  answers: {           // 每题各玩家答案
    0: {player_id: {choice, time, correct, score}}
  },
  scores: {a: 0, b: 0},
  emojis: []           // 最近表情记录
}
```

## 注意事项

- 房间数据存储在内存中，服务重启后所有房间消失
- 空闲房间5分钟后自动清理
- 支持断线重连（同一账号重新加入同一房间码）
- 前端使用 localStorage 存储账号信息，与服务端无关
