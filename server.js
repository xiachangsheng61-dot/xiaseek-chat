// server.js — 多模型API聚合网关
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 模型配置注册表（密钥从环境变量读取）
const MODEL_REGISTRY = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'openai',
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    icon: '🐋',
    builtin: true
  },
  qwen: {
    id: 'qwen',
    name: '通义千问',
    provider: 'openai',
    apiKey: process.env.QWEN_API_KEY,
    baseURL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: process.env.QWEN_MODEL || 'qwen-max',
    icon: '☁️',
    builtin: true
  },
  doubao: {
    id: 'doubao',
    name: '豆包',
    provider: 'openai',
    apiKey: process.env.DOUBAO_API_KEY,
    baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.DOUBAO_MODEL || 'doubao-pro-32k',
    icon: '🫘',
    builtin: true
  },
  ernie: {
    id: 'ernie',
    name: '文心一言',
    provider: 'ernie',
    apiKey: process.env.ERNIE_API_KEY,
    secretKey: process.env.ERNIE_SECRET_KEY,
    model: process.env.ERNIE_MODEL || 'ernie-4.0',
    icon: '📘',
    builtin: true
  },
  glm: {
    id: 'glm',
    name: '智谱GLM',
    provider: 'openai',
    apiKey: process.env.GLM_API_KEY,
    baseURL: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.GLM_MODEL || 'glm-4',
    icon: '🏛️',
    builtin: true
  }
};

function isValidKey(key) {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (lower.includes('your-')) return false;
  if (lower === 'sk-' || lower.length < 10) return false;
  return true;
}

function isModelConfigured(m) {
  if (m.provider === 'ernie') return isValidKey(m.apiKey) && isValidKey(m.secretKey);
  return isValidKey(m.apiKey);
}

// GET /api/models — 返回所有模型列表（含 configured 状态，不含密钥）
app.get('/api/models', (req, res) => {
  const models = Object.values(MODEL_REGISTRY)
    .map(({ id, name, provider, model, icon, builtin }) => ({
      id, name, provider, model, icon, builtin,
      configured: isModelConfigured(MODEL_REGISTRY[id])
    }));
  res.json({ models });
});

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// POST /api/chat/stream — 流式对话接口
app.post('/api/chat/stream', async (req, res) => {
  const { message, modelIds, customModels, conversationHistory } = req.body;

  if (!message || !modelIds || !modelIds.length) {
    return res.status(400).json({ error: '缺少 message 或 modelIds' });
  }

  // 合并自定义模型（前端传来的临时配置，含apiKey）
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
    // 1. 查注册表获取内置配置（含 .env 密钥）
    let config = MODEL_REGISTRY[modelId] ? { ...MODEL_REGISTRY[modelId] } : null;
    // 2. 合并前端传来的自定义覆盖（localStorage 优先于 .env）
    if (customMap[modelId]) {
      const override = customMap[modelId];
      if (config) {
        if (override.apiKey) config.apiKey = override.apiKey;
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
    if (!isModelConfigured(config)) {
      sendSSE(res, 'error', { modelId, error: `${config.name} 未配置有效的API密钥，请在设置中填写` });
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
  const url = baseURL.endsWith('/v1') ? `${baseURL}/chat/completions` : `${baseURL}/v1/chat/completions`;

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

app.listen(PORT, () => {
  const configured = Object.values(MODEL_REGISTRY).filter(isModelConfigured).map(m => m.name);
  console.log(`🚀 聚合对话API网关已启动: http://localhost:${PORT}`);
  console.log(`📋 内置模型(${Object.keys(MODEL_REGISTRY).length}) 已配置(${configured.length}): ${configured.join(', ') || '无'}`);
});
