// server/db.js — JSON-file-based database module
// Uses E:\xiaseek\data\db.json for persistent storage
// Simple mutex for basic concurrent-write safety

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const DATA_DIR = path.dirname(DB_PATH);

// ---------------------------------------------------------------------------
// Simple promise-chain mutex — serialises all reads and writes so concurrent
// requests never see partially-written state.
// ---------------------------------------------------------------------------
let lock = Promise.resolve();

function withLock(fn) {
  const prev = lock;
  let release;
  lock = new Promise((resolve) => { release = resolve; });
  return prev.then(() => {
    try {
      return fn();
    } finally {
      release();
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readDB() {
  // Ensure the data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Create the file with default schema if missing
  if (!fs.existsSync(DB_PATH)) {
    const defaults = { users: [], keys: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const data = JSON.parse(raw);
    // Tolerate missing top-level keys — fill in defaults
    if (!Array.isArray(data.users)) data.users = [];
    if (!Array.isArray(data.keys))  data.keys = [];
    return data;
  } catch (_err) {
    // Corrupt file → re-initialise
    const defaults = { users: [], keys: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

/**
 * Create a new user.
 * @param {string} username
 * @param {string} passwordHash — bcrypt hash of the password
 * @returns {{ id: number, username: string } | null}
 *   The created user (without passwordHash), or null if the username is taken.
 */
function createUser(username, passwordHash) {
  return withLock(() => {
    const db = readDB();

    // Reject duplicate usernames
    const exists = db.users.some((u) => u.username === username);
    if (exists) return null;

    const maxId = db.users.reduce((max, u) => Math.max(max, u.id || 0), 0);
    const newUser = { id: maxId + 1, username, passwordHash };
    db.users.push(newUser);
    writeDB(db);

    return { id: newUser.id, username: newUser.username };
  });
}

/**
 * Look up a user by username (case-sensitive).
 * @param {string} username
 * @returns {object | undefined}
 */
function getUserByUsername(username) {
  return withLock(() => {
    const db = readDB();
    return db.users.find((u) => u.username === username);
  });
}

/**
 * Look up a user by numeric id.
 * @param {number} id
 * @returns {object | undefined}
 */
function getUserById(id) {
  return withLock(() => {
    const db = readDB();
    return db.users.find((u) => u.id === id);
  });
}

// ---------------------------------------------------------------------------
// Key operations (per-user, per-model API keys)
// ---------------------------------------------------------------------------

/**
 * Save (insert or update) an API key for a user-model pair.
 * @param {number} userId
 * @param {string} modelId
 * @param {string} apiKey
 * @returns {void}
 */
function saveKey(userId, modelId, apiKey) {
  return withLock(() => {
    const db = readDB();
    const existing = db.keys.find(
      (k) => k.user_id === userId && k.model_id === modelId
    );
    if (existing) {
      existing.api_key = apiKey;
    } else {
      db.keys.push({ user_id: userId, model_id: modelId, api_key: apiKey });
    }
    writeDB(db);
  });
}

/**
 * Delete an API key for a user-model pair.
 * @param {number} userId
 * @param {string} modelId
 * @returns {void}
 */
function deleteKey(userId, modelId) {
  return withLock(() => {
    const db = readDB();
    db.keys = db.keys.filter(
      (k) => !(k.user_id === userId && k.model_id === modelId)
    );
    writeDB(db);
  });
}

/**
 * Get all saved keys for a user.
 * @param {number} userId
 * @returns {{ model_id: string, api_key: string }[]}
 */
function getUserKeys(userId) {
  return withLock(() => {
    const db = readDB();
    return db.keys
      .filter((k) => k.user_id === userId)
      .map(({ model_id, api_key }) => ({ model_id, api_key }));
  });
}

/**
 * Check whether a user has saved a key for a model.
 * @param {number} userId
 * @param {string} modelId
 * @returns {boolean}
 */
function hasKey(userId, modelId) {
  return withLock(() => {
    const db = readDB();
    return db.keys.some(
      (k) => k.user_id === userId && k.model_id === modelId
    );
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createUser,
  getUserByUsername,
  getUserById,
  saveKey,
  deleteKey,
  getUserKeys,
  hasKey,
};
