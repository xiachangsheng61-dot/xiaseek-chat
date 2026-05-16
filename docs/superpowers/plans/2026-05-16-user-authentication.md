# User Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add registration/login system so each user manages their own API keys, stored server-side in SQLite.

**Architecture:** SQLite database for users and keys, express-session for auth, login.html for register/login, server.js routes protected by requireAuth middleware. chat.html checks auth on load and manages keys via server API.

**Tech Stack:** better-sqlite3, bcryptjs, express-session, better-sqlite3-session-store

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `server/db.js` | Create | SQLite init, table creation |
| `server.js` | Modify | Session, auth routes, key routes, middleware |
| `login.html` | Create | Register/login page |
| `chat.html` | Modify | Auth check, server-side key management, nav |
| `.env` | Modify | Remove API key values, add SESSION_SECRET |
| `package.json` | Modify | Add 4 dependencies |
| `.gitignore` | Modify | Add data/ |

---

### Task 1: Install new dependencies

**Files:** Modify `package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install better-sqlite3 bcryptjs express-session better-sqlite3-session-store
```

Expected: 4 packages added to node_modules and package.json.

---

### Task 2: Create database module

**Files:** Create `server/db.js`

- [ ] **Step 1: Create server/db.js**

```js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'xiaseek.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, model_id)
  );
`);

module.exports = db;
```

- [ ] **Step 2: Verify the file parses**

```bash
node -e "const db = require('./server/db'); console.log('DB OK'); db.close();"
```

Expected: `DB OK`, `data/xiaseek.db` file created.

---

### Task 3: Rewrite server.js — setup, session, model registry

**Files:** Modify `server.js`

- [ ] **Step 1: Replace the top of server.js (lines 1-66) with new imports and config**

Replace everything from line 1 through the end of MODEL_REGISTRY (line 66) with:

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./server/db');

const app = express();
const PORT = process.env.PORT || 3001;

// Session
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SQLiteStore = require('better-sqlite3-session-store')(session);

app.use(cors());
app.use(express.json());
app.use(session({
  store: new SQLiteStore({ db: path.join(__dirname, 'data', 'sessions.db') }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  name: 'xiaseek.sid'
}));

// Static files (public)
app.use(express.static(path.join(__dirname)));

// ===== Auth middleware =====
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// ===== Model registry (no API keys — keys are per-user in SQLite) =====
const MODEL_REGISTRY = {
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', provider: 'openai',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    icon: '🐋', builtin: true
  },
  qwen: {
    id: 'qwen', name: '通义千问', provider: 'openai',
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: process.env.QWEN_MODEL || 'qwen-max',
    icon: '☁️', builtin: true
  },
  doubao: {
    id: 'doubao', name: '豆包', provider: 'openai',
    baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.DOUBAO_MODEL || 'doubao-pro-32k',
    icon: '🫘', builtin: true
  },
  ernie: {
    id: 'ernie', name: '文心一言', provider: 'ernie',
    baseURL: '', model: process.env.ERNIE_MODEL || 'ernie-4.0',
    icon: '📘', builtin: true
  },
  glm: {
    id: 'glm', name: '智谱GLM', provider: 'openai',
    baseURL: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.GLM_MODEL || 'glm-4',
    icon: '🏛️', builtin: true
  }
};

function isValidKey(key) {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (lower.includes('your-')) return false;
  if (lower === 'sk-' || lower.length < 10) return false;
  return true;
}
```

- [ ] **Step 2: Verify the new imports work**

```bash
node -e "require('dotenv').config(); require('express-session'); require('bcryptjs'); require('./server/db'); console.log('imports OK')"
```

Expected: `imports OK`

---

### Task 4: Add auth routes to server.js

**Files:** Modify `server.js`

- [ ] **Step 1: Insert auth routes after the imports/setup section (before the models route)**

Insert these routes:

```js
// ===== Auth routes =====

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (typeof username !== 'string' || username.trim().length < 2) {
    return res.status(400).json({ error: '用户名至少2个字符' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: '密码至少4个字符' });
  }

  const name = username.trim();

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, passwordHash);

  req.session.userId = result.lastInsertRowid;
  res.json({ ok: true, user: { id: result.lastInsertRowid, username: name } });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  req.session.userId = user.id;
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('xiaseek.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: '用户不存在' });
  }
  res.json({ user });
});
```

- [ ] **Step 2: Verify auth routes work (smoke test with curl)**

```bash
node server.js &
sleep 2
# Test register
curl -s -X POST http://localhost:3001/api/auth/register -H "Content-Type: application/json" -d '{"username":"testuser","password":"test1234"}'
```

Expected: `{"ok":true,"user":{"id":1,"username":"testuser"}}`

---

### Task 5: Add user key management routes to server.js

**Files:** Modify `server.js`

- [ ] **Step 1: Insert key routes after auth routes**

```js
// ===== User key management (auth required) =====

// PUT /api/user/keys/:modelId — save or update a key
app.put('/api/user/keys/:modelId', requireAuth, (req, res) => {
  const { modelId } = req.params;
  const { apiKey } = req.body || {};

  if (!apiKey || !isValidKey(apiKey)) {
    return res.status(400).json({ error: '无效的API密钥' });
  }

  db.prepare(`
    INSERT INTO user_keys (user_id, model_id, api_key) VALUES (?, ?, ?)
    ON CONFLICT(user_id, model_id) DO UPDATE SET api_key = excluded.api_key, created_at = datetime('now')
  `).run(req.session.userId, modelId, apiKey);

  res.json({ ok: true });
});

// DELETE /api/user/keys/:modelId — delete a key
app.delete('/api/user/keys/:modelId', requireAuth, (req, res) => {
  const { modelId } = req.params;
  db.prepare('DELETE FROM user_keys WHERE user_id = ? AND model_id = ?').run(req.session.userId, modelId);
  res.json({ ok: true });
});
```

---

### Task 6: Update models route and chat route in server.js

**Files:** Modify `server.js`

- [ ] **Step 1: Rewrite GET /api/models to be auth-protected and return user key status**

Replace the existing `GET /api/models` route with:

```js
// GET /api/models — returns model list with per-user configured status
app.get('/api/models', requireAuth, (req, res) => {
  const userKeys = db.prepare('SELECT model_id FROM user_keys WHERE user_id = ?').all(req.session.userId);
  const keySet = new Set(userKeys.map(k => k.model_id));

  const models = Object.values(MODEL_REGISTRY)
    .map(({ id, name, provider, model, icon, builtin }) => ({
      id, name, provider, model, icon, builtin,
      configured: keySet.has(id)
    }));
  res.json({ models });
});
```

- [ ] **Step 2: Rewrite POST /api/chat/stream to be auth-protected and use user keys**

Replace the existing `POST /api/chat/stream` route (the entire handler, but keep `sendSSE`, `streamOpenAI`, `streamErnie` as-is) with:

```js
// POST /api/chat/stream — streaming chat (auth required, uses user's keys)
app.post('/api/chat/stream', requireAuth, async (req, res) => {
  const { message, modelIds, conversationHistory } = req.body;

  if (!message || !modelIds || !modelIds.length) {
    return res.status(400).json({ error: '缺少 message 或 modelIds' });
  }

  // Load user's keys
  const userKeys = db.prepare('SELECT model_id, api_key FROM user_keys WHERE user_id = ?').all(req.session.userId);
  const keyMap = {};
  userKeys.forEach(k => { keyMap[k.model_id] = k.api_key; });

  // Build configs for each requested model
  const configs = [];
  for (const modelId of modelIds) {
    let config = MODEL_REGISTRY[modelId] ? { ...MODEL_REGISTRY[modelId] } : null;
    if (!config) {
      sendSSE(res, 'error', { modelId, error: `未知模型: ${modelId}` });
      continue;
    }
    config.apiKey = keyMap[modelId] || '';
    if (config.provider === 'ernie') {
      // ERNIE uses two keys: user enters "apiKey|secretKey" in the key field
      const parts = (keyMap[modelId] || '').split('|');
      config.apiKey = parts[0] || '';
      config.secretKey = parts[1] || '';
    }
    if (!isValidKey(config.apiKey)) {
      sendSSE(res, 'error', { modelId, error: `${config.name} 未配置API密钥，请在设置中填写` });
      continue;
    }
    configs.push(config);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const tasks = configs.map(async (config) => {
    try {
      if (config.provider === 'openai') {
        await streamOpenAI(res, config, message, conversationHistory);
      } else if (config.provider === 'ernie') {
        await streamErnie(res, config, message, conversationHistory);
      }
    } catch (err) {
      sendSSE(res, 'error', { modelId: config.id, error: err.message });
    }
  });

  await Promise.all(tasks);
  sendSSE(res, 'done', {});
  res.end();
});
```

**Important:** Keep the existing `sendSSE`, `streamOpenAI`, and `streamErnie` functions exactly as they are (they don't change).

- [ ] **Step 3: Update the startup log message**

Replace the `app.listen` block (lines 278-282) with:

```js
app.listen(PORT, () => {
  console.log(`🚀 聚合对话API网关已启动: http://localhost:${PORT}`);
  console.log(`📋 内置模型: ${Object.values(MODEL_REGISTRY).map(m => m.name).join(', ')}`);
  console.log(`🔑 密钥由每个用户独立管理`);
});
```

---

### Task 7: Create login.html

**Files:** Create `login.html`

- [ ] **Step 1: Create login.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 - 虾SeekAI 聚合对话</title>
<style>
:root {
  --bg: #f8f9fa; --card-bg: #ffffff; --text: #1a1a2e;
  --text-secondary: #6b7280; --border: #e5e7eb; --primary: #FF6B6B;
}
.dark { --bg: #121212; --card-bg: #1e1e2e; --text: #e0e0e0; --text-secondary: #9ca3af; --border: #333; }
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg); color: var(--text); min-height: 100vh; display: flex;
  align-items: center; justify-content: center; transition: background 0.2s, color 0.2s;
}
.card {
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px;
  padding: 32px; width: 100%; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);
}
.logo { text-align: center; font-size: 24px; font-weight: 800; margin-bottom: 24px; color: var(--primary); }
.logo a { color: var(--primary); text-decoration: none; }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary); }
.field input {
  width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px;
  font-size: 14px; background: var(--bg); color: var(--text); outline: none; transition: border 0.2s;
}
.field input:focus { border-color: var(--primary); }
.btn {
  width: 100%; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 700;
  cursor: pointer; border: none; transition: all 0.2s; margin-top: 8px;
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-secondary); }
.btn-ghost:hover { border-color: var(--primary); color: var(--primary); }
.error { color: #ef4444; font-size: 13px; margin-top: 8px; text-align: center; min-height: 20px; }
.switch { text-align: center; margin-top: 16px; font-size: 13px; color: var(--text-secondary); }
.switch a { color: var(--primary); cursor: pointer; font-weight: 600; }
.back { text-align: center; margin-top: 12px; }
.back a { color: var(--text-secondary); font-size: 13px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo"><a href="/">🦐 虾SeekAI</a></div>
  <div class="logo" style="font-size:16px;font-weight:600;margin-bottom:20px;" id="formTitle">登录聚合对话</div>

  <div class="field">
    <label>用户名</label>
    <input type="text" id="username" placeholder="输入用户名" autocomplete="username">
  </div>
  <div class="field">
    <label>密码</label>
    <input type="password" id="password" placeholder="输入密码" autocomplete="current-password">
  </div>
  <div id="confirmField" class="field" style="display:none;">
    <label>确认密码</label>
    <input type="password" id="confirmPassword" placeholder="再次输入密码" autocomplete="new-password">
  </div>

  <div class="error" id="error"></div>

  <button class="btn btn-primary" id="submitBtn" onclick="handleSubmit()">登 录</button>

  <div class="switch">
    <span id="switchText">没有账号？</span> <a id="switchLink" onclick="toggleMode()">去注册</a>
  </div>
  <div class="back"><a href="/">← 返回导航首页</a></div>
</div>

<script>
let mode = 'login';

async function checkAlreadyLoggedIn() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) { window.location.href = '/chat.html'; }
  } catch {}
}

function toggleMode() {
  mode = mode === 'login' ? 'register' : 'login';
  document.getElementById('formTitle').textContent = mode === 'login' ? '登录聚合对话' : '注册新账号';
  document.getElementById('submitBtn').textContent = mode === 'login' ? '登 录' : '注 册';
  document.getElementById('switchText').textContent = mode === 'login' ? '没有账号？' : '已有账号？';
  document.getElementById('switchLink').textContent = mode === 'login' ? '去注册' : '去登录';
  document.getElementById('confirmField').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('error').textContent = '';
}

async function handleSubmit() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error');

  if (!username || !password) {
    errorEl.textContent = '请填写用户名和密码';
    return;
  }

  if (mode === 'register') {
    const confirm = document.getElementById('confirmPassword').value;
    if (password !== confirm) {
      errorEl.textContent = '两次密码不一致';
      return;
    }
    if (password.length < 4) {
      errorEl.textContent = '密码至少4个字符';
      return;
    }
  }

  const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || '操作失败';
      return;
    }
    window.location.href = '/chat.html';
  } catch (err) {
    errorEl.textContent = '网络错误，请重试';
  }
}

document.getElementById('password').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') handleSubmit();
});

checkAlreadyLoggedIn();
</script>
</body>
</html>
```

---

### Task 8: Update chat.html for auth and server-side keys

**Files:** Modify `chat.html`

- [ ] **Step 1: Add auth check and logout to chat.html JS**

After `const API_BASE = window.location.origin;` (around line 103), add:

```js
// ===== Auth check =====
async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`);
    if (!res.ok) { window.location.href = '/login.html'; return null; }
    return await res.json();
  } catch { window.location.href = '/login.html'; return null; }
}

async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  window.location.href = '/login.html';
}
```

- [ ] **Step 2: Update init() to check auth first, and remove model keys from localStorage**

```js
async function init() {
  initTheme();
  const auth = await checkAuth();
  if (!auth) return;
  loadCustomModels();
  // modelKeys removed — keys are now server-side
  await loadModels();
  loadActiveModels();
  loadPanelWidths();
  renderCards();
  setupKeyboardShortcut();
  
  // Show username in nav
  const navUser = document.getElementById('navUser');
  if (navUser) navUser.textContent = auth.user.username;
}
```

- [ ] **Step 3: Remove loadModelKeys/saveModelKeys and update isModelUsable**

Delete the `let modelKeys = {};` line. Delete the `loadModelKeys()` and `saveModelKeys()` functions. Replace `isModelUsable` with:

```js
function isModelUsable(m) {
  return m.configured === true;
}
```

- [ ] **Step 4: Update loadModels to handle custom model keys**

Replace the `loadModels` function:

```js
async function loadModels() {
  try {
    const res = await fetch(`${API_BASE}/api/models`);
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login.html'; return; }
      availableModels = [...customModels];
      return;
    }
    const data = await res.json();
    availableModels = [
      ...(data.models || []),
      ...customModels.map(cm => ({
        ...cm,
        apiKey: undefined,        // key is server-side, not in localStorage
        configured: false          // will be updated if user saved a key
      }))
    ];
  } catch (err) {
    console.error('加载模型列表失败:', err);
    availableModels = [...customModels];
  }
}
```

- [ ] **Step 5: Update sendMessage to not send apiKey in customConfigs**

Replace the `customConfigs` building section (lines 330-339) with:

```js
const customConfigs = configuredModels
  .filter(m => !m.builtin)
  .map(m => {
    const c = { id: m.id, name: m.name };
    if (m.baseURL) c.baseURL = m.baseURL;
    if (m.model) c.model = m.model;
    return c;
  });
```

- [ ] **Step 6: Rewrite saveModelKey to call server API**

```js
async function saveModelKey(modelId) {
  const input = document.getElementById('keyinput-' + modelId);
  const btn = document.getElementById('savebtn-' + modelId);
  if (!input || !btn) return;
  const value = input.value.trim();

  const method = value ? 'PUT' : 'DELETE';
  const url = `${API_BASE}/api/user/keys/${modelId}`;

  try {
    if (value) {
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: value })
      });
    } else {
      await fetch(url, { method: 'DELETE' });
    }

    btn.textContent = '✓ 已保存';
    btn.style.background = '#22c55e';
    btn.style.borderColor = '#22c55e';
    setTimeout(() => {
      btn.textContent = '保存';
      btn.style.background = 'var(--primary)';
      btn.style.borderColor = 'var(--primary)';
    }, 1500);

    await loadModels();
    loadActiveModels();
    renderCards();
  } catch (err) {
    btn.textContent = '❌ 失败';
    setTimeout(() => {
      btn.textContent = '保存';
    }, 1500);
  }
}
```

- [ ] **Step 7: Update openSettings to not reference modelKeys or env keys**

Replace the `modelRow` function inside `openSettings` (lines 446-465):

```js
function modelRow(m) {
  const isChecked = activeModels.includes(m.id);
  const hasServerKey = m.configured === true;
  const ph = hasServerKey ? '已配置(已保存) 可在此覆盖' : '在此输入API Key';
  return `
  <div class="flex items-center gap-2 p-2.5 rounded-lg" style="background:var(--bg);">
    <input type="checkbox" ${isChecked ? 'checked' : ''}
      onchange="toggleModel('${m.id}', this.checked)" class="w-4 h-4 flex-shrink-0">
    <span class="text-lg flex-shrink-0">${m.icon || '🤖'}</span>
    <span class="text-sm font-medium flex-shrink-0" style="width:70px;">${m.name}</span>
    <input type="password" value=""
      placeholder="${ph}" id="keyinput-${m.id}"
      class="flex-1 p-1.5 rounded text-xs"
      style="background:var(--card-bg); border:1px solid var(--border); color:var(--text); min-width:0;">
    <button onclick="saveModelKey('${m.id}')" id="savebtn-${m.id}"
      class="px-2 py-1 rounded text-xs font-semibold flex-shrink-0 cursor-pointer border"
      style="background:var(--primary); color:#fff; border-color:var(--primary);">保存</button>
  </div>`;
}
```

- [ ] **Step 8: Update custom model row template in openSettings**

Replace the custom model row template (lines 469-487) with:

```js
userCustomModels.map(m => {
  const isChecked = activeModels.includes(m.id);
  const ph = '已保存(设置时输入)';  // custom models always have key from creation
  return `
  <div class="flex items-center gap-2 p-2.5 rounded-lg" style="background:var(--bg);">
    <input type="checkbox" ${isChecked ? 'checked' : ''}
      onchange="toggleModel('${m.id}', this.checked)" class="w-4 h-4 flex-shrink-0">
    <span class="text-lg flex-shrink-0">${m.icon || '🤖'}</span>
    <span class="text-sm font-medium flex-shrink-0" style="width:70px;">${m.name}</span>
    <input type="password" value=""
      placeholder="${escapeAttr(ph)}" id="keyinput-${m.id}"
      class="flex-1 p-1.5 rounded text-xs"
      style="background:var(--card-bg); border:1px solid var(--border); color:var(--text); min-width:0;">
    <button onclick="saveModelKey('${m.id}')" id="savebtn-${m.id}"
      class="px-2 py-1 rounded text-xs font-semibold flex-shrink-0 cursor-pointer border"
      style="background:var(--primary); color:#fff; border-color:var(--primary);">覆盖</button>
    <button onclick="event.preventDefault(); removeCustomModel('${m.id}')" class="text-xs cursor-pointer flex-shrink-0" style="color:#ef4444;" title="删除">✕</button>
  </div>`;
}).join('')
```

- [ ] **Step 9: Update addCustomModel to save key to server**

Replace `addCustomModel` (lines 553-583):

```js
async function addCustomModel() {
  const name = document.getElementById('customName').value.trim();
  const model = document.getElementById('customModel').value.trim();
  const baseURL = document.getElementById('customBaseURL').value.trim();
  const apiKey = document.getElementById('customApiKey').value.trim();
  const icon = document.getElementById('customIcon').value.trim() || '🤖';

  if (!name || !model || !baseURL || !apiKey) {
    return alert('请填写所有必填字段（名称、Model ID、Base URL、API Key）');
  }

  const id = 'custom_' + Date.now();
  const customModel = {
    id, name, model, baseURL, icon,
    provider: 'openai',
    builtin: false,
    configured: false  // will be true after key save
  };

  customModels.push(customModel);
  saveCustomModels();  // metadata only, no apiKey in localStorage

  // Save apiKey to server
  try {
    await fetch(`${API_BASE}/api/user/keys/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
  } catch (err) {
    customModels.pop();
    saveCustomModels();
    return alert('保存密钥失败，请重试');
  }

  availableModels = [...availableModels.filter(m => m.builtin), ...customModels];
  activeModels.push(id);
  saveActiveModels();

  toggleAddForm();
  openSettings();
  renderCards();
}
```

- [ ] **Step 10: Update nav bar HTML to show user and logout**

Replace the nav bar (lines 40-50) with:

```html
<nav class="flex items-center justify-between px-4 md:px-6 py-3 border-b flex-shrink-0" style="background:var(--card-bg); border-color:var(--border);">
  <div class="flex items-center gap-3">
    <a href="/" class="text-lg font-bold no-underline" style="color:var(--primary);">🦐 虾SeekAI</a>
    <span class="text-sm hidden sm:inline" style="color:var(--text-secondary);">| 聚合对话</span>
  </div>
  <div class="flex items-center gap-2">
    <span id="navUser" class="text-sm" style="color:var(--text-secondary);"></span>
    <button id="themeToggle" class="text-xl cursor-pointer px-1">🌓</button>
    <button id="settingsBtn" class="px-3 py-1.5 rounded-lg text-sm border cursor-pointer" style="border-color:var(--border);">⚙️ 模型设置</button>
    <button onclick="logout()" class="px-3 py-1.5 rounded-lg text-sm border cursor-pointer" style="border-color:var(--border); color:var(--text);">登出</button>
    <a href="/" class="px-3 py-1.5 rounded-lg text-sm border cursor-pointer no-underline" style="border-color:var(--border); color:var(--text);">← 返回导航</a>
  </div>
</nav>
```

---

### Task 9: Update .env, .gitignore

**Files:** Modify `.env`, `.gitignore`

- [ ] **Step 1: Update .env — remove all API key values, add SESSION_SECRET**

Write the new `.env`:

```
# ===== 服务器 =====
PORT=3001
# SESSION_SECRET 留空则每次启动自动生成（重启后所有人需重新登录）
SESSION_SECRET=

# ===== DeepSeek 模型配置 =====
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# ===== 通义千问 (Qwen) =====
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-max

# ===== 豆包 (Doubao) =====
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_MODEL=doubao-pro-32k

# ===== 文心一言 (ERNIE) =====
ERNIE_MODEL=ernie-4.0

# ===== 智谱 GLM =====
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4
```

- [ ] **Step 2: Update .gitignore**

Add `data/` to `.gitignore`:

```
node_modules/
.env
.claude/
data/
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Start server and verify all flows**

```bash
# Kill any existing node processes first
# Start fresh
node server.js
```

Then manually verify in browser:

1. Open `http://localhost:3001` — should see index.html normally (no auth)
2. Click "聚合对话" — should redirect to `login.html`
3. Register a new account — should redirect to `chat.html`
4. chat.html shows empty model cards with "未配置API密钥"
5. Open settings, enter a DeepSeek API key, click save
6. Send a message — should get a response from DeepSeek
7. Click logout — should redirect to login page
8. Re-login with the same account — keys should persist
