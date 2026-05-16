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

// Session config (MemoryStore — sessions lost on restart, acceptable for now)
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(cors());
app.use(express.json());
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  },
  name: 'xiaseek.sid'
}));

// Static files (public — no auth)
app.use(express.static(path.join(__dirname)));

// ===== Auth middleware =====
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// ===== Helper =====
function isValidKey(key) {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (lower.includes('your-')) return false;
  if (lower === 'sk-' || lower.length < 10) return false;
  return true;
}

// ===== Model registry (NO API keys — keys are per-user) =====
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
    baseURL: '',
    model: process.env.ERNIE_MODEL || 'ernie-4.0',
    icon: '📘', builtin: true
  },
  glm: {
    id: 'glm', name: '智谱GLM', provider: 'openai',
    baseURL: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.GLM_MODEL || 'glm-4',
    icon: '🏛️', builtin: true
  }
};

// ===== Auth routes (public — no middleware) =====

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
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
    const passwordHash = bcrypt.hashSync(password, 10);
    const user = await db.createUser(name, passwordHash);

    if (!user) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    req.session.userId = user.id;
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: '注册失败，请重试' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = await db.getUserByUsername(username.trim());
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    req.session.userId = user.id;
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: '登录失败，请重试' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('xiaseek.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  const user = await db.getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: '用户不存在' });
  }
  res.json({ user: { id: user.id, username: user.username } });
});

// ===== Key management routes (auth required) =====

// PUT /api/user/keys/:modelId
app.put('/api/user/keys/:modelId', requireAuth, async (req, res) => {
  try {
    const { modelId } = req.params;
    const { apiKey } = req.body || {};

    if (!apiKey || !isValidKey(apiKey)) {
      return res.status(400).json({ error: '无效的API密钥' });
    }

    await db.saveKey(req.session.userId, modelId, apiKey);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '保存密钥失败' });
  }
});

// DELETE /api/user/keys/:modelId
app.delete('/api/user/keys/:modelId', requireAuth, async (req, res) => {
  try {
    const { modelId } = req.params;
    await db.deleteKey(req.session.userId, modelId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '删除密钥失败' });
  }
});

// ===== Models route (auth required) =====

// GET /api/models — returns model list with per-user configured status
app.get('/api/models', requireAuth, async (req, res) => {
  try {
    const userKeys = await db.getUserKeys(req.session.userId);
    const keySet = new Set(userKeys.map(k => k.model_id));

    const models = Object.values(MODEL_REGISTRY)
      .map(({ id, name, provider, model, icon, builtin }) => ({
        id, name, provider, model, icon, builtin,
        configured: keySet.has(id)
      }));
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: '获取模型列表失败' });
  }
});

// ===== SSE helpers =====
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ===== Chat route (auth required) =====

// POST /api/chat/stream
app.post('/api/chat/stream', requireAuth, async (req, res) => {
  const { message, modelIds, customModels, conversationHistory } = req.body;

  if (!message || !modelIds || !modelIds.length) {
    return res.status(400).json({ error: '缺少 message 或 modelIds' });
  }

  // Load user keys
  const userKeys = await db.getUserKeys(req.session.userId);
  const keyMap = {};
  userKeys.forEach(k => { keyMap[k.model_id] = k.api_key; });

  // Merge custom model configs (baseURL, model name overrides from client)
  const customMap = {};
  if (Array.isArray(customModels)) {
    customModels.forEach(m => { customMap[m.id] = m; });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const tasks = modelIds.map(async (modelId) => {
    let config = MODEL_REGISTRY[modelId] ? { ...MODEL_REGISTRY[modelId] } : null;

    if (customMap[modelId]) {
      const override = customMap[modelId];
      if (config) {
        if (override.baseURL) config.baseURL = override.baseURL;
        if (override.model) config.model = override.model;
      } else {
        config = { ...override, provider: 'openai' };
      }
    }

    if (!config) {
      sendSSE(res, 'error', { modelId, error: `未知模型: ${modelId}` });
      return;
    }

    // Set keys from user's saved keys
    if (config.provider === 'ernie') {
      // ERNIE: user enters "apiKey|secretKey" format
      const raw = keyMap[modelId] || '';
      const parts = raw.split('|');
      config.apiKey = parts[0] || '';
      config.secretKey = parts[1] || '';
    } else {
      config.apiKey = keyMap[modelId] || '';
    }

    if (!isValidKey(config.apiKey)) {
      sendSSE(res, 'error', { modelId, error: `${config.name} 未配置有效的API密钥，请在设置中填写` });
      return;
    }
    if (config.provider === 'ernie' && !isValidKey(config.secretKey)) {
      sendSSE(res, 'error', { modelId, error: `${config.name} 未配置有效的Secret Key，请在设置中填写（格式：APIKey|SecretKey）` });
      return;
    }

    try {
      if (config.provider === 'openai') {
        await streamOpenAI(res, config, message, conversationHistory);
      } else if (config.provider === 'ernie') {
        await streamErnie(res, config, message, conversationHistory);
      }
    } catch (err) {
      sendSSE(res, 'error', { modelId, error: err.message });
    }
  });

  await Promise.all(tasks);
  sendSSE(res, 'done', {});
  res.end();
});

// ===== Streaming functions (unchanged from original) =====

async function streamOpenAI(res, config, message, history) {
  const modelId = config.id;

  const messages = [
    { role: 'system', content: '你是一个有帮助的AI助手。请用中文回答。' },
    ...(history || []).filter(h => h.modelId === modelId).map(h => [
      { role: 'user', content: h.user },
      { role: 'assistant', content: h.assistant }
    ]).flat(),
    { role: 'user', content: message }
  ];

  const baseURL = config.baseURL.replace(/\/+$/, '');
  const url = /\/v\d+$/.test(baseURL) ? `${baseURL}/chat/completions` : `${baseURL}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ model: config.model, messages, stream: true })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            sendSSE(res, 'chunk', { modelId, content: delta });
          }
        } catch {}
      }
    }
  }

  sendSSE(res, 'complete', { modelId, content: fullContent });
}

async function streamErnie(res, config, message, history) {
  const modelId = config.id;

  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${config.apiKey}&client_secret=${config.secretKey}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`文心一言鉴权失败: ${JSON.stringify(tokenData)}`);
  }

  const messages = [{ role: 'user', content: message }];

  const modelEndpoint = config.model.includes('ernie-4') || config.model.includes('ernie4')
    ? 'completions_pro'
    : 'chat/completions';

  const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/${modelEndpoint}?access_token=${tokenData.access_token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`文心一言 HTTP ${response.status}: ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          const result = json.result || '';
          if (result) {
            const newPart = result.slice(fullContent.length);
            if (newPart) {
              fullContent = result;
              sendSSE(res, 'chunk', { modelId, content: newPart });
            }
          }
        } catch {}
      }
    }
  }

  sendSSE(res, 'complete', { modelId, content: fullContent });
}

// ===== Start server =====
app.listen(PORT, () => {
  console.log(`🚀 聚合对话API网关已启动: http://localhost:${PORT}`);
  console.log(`📋 内置模型: ${Object.values(MODEL_REGISTRY).map(m => m.name).join(', ')}`);
  console.log(`🔑 密钥由每个用户独立管理`);
});
