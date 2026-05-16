# User Authentication System Design

## Overview

Add registration/login to xiaseek-chat so each user has their own account
and manages their own API keys. No shared/default keys — every user brings
their own.

## Architecture

```
login.html ──(unauthenticated)──> register/login ──> server-side session
    │                                    │
    └──(authenticated)──> chat.html ──> POST /api/chat/stream ──> LLM providers
                              │                     │
                              │           uses current user's keys
                              │
                    settings panel ──> POST /api/user/keys ──> stored in SQLite
```

## Tech Stack

- **SQLite** via `better-sqlite3` — single file, zero config
- **bcryptjs** — password hashing (pure JS, no native deps)
- **express-session** with `better-sqlite3-session-store` — server-side sessions
- New dependencies added to package.json

## Database Schema

### users

| Column        | Type    | Notes              |
|---------------|---------|--------------------|
| id            | INTEGER | PRIMARY KEY AUTOINCREMENT |
| username      | TEXT    | UNIQUE NOT NULL    |
| password_hash | TEXT    | bcrypt hash        |
| created_at    | TEXT    | ISO timestamp      |

### user_keys

| Column     | Type    | Notes                        |
|------------|---------|------------------------------|
| id         | INTEGER | PRIMARY KEY AUTOINCREMENT    |
| user_id    | INTEGER | FK -> users(id) ON DELETE CASCADE |
| model_id   | TEXT    | e.g. deepseek, qwen, custom_* |
| api_key    | TEXT    | plaintext API key            |
| created_at | TEXT    | ISO timestamp                |

UNIQUE constraint on (user_id, model_id).

## API Routes

### Auth (no middleware)

| Method | Path              | Body                    | Response          |
|--------|-------------------|-------------------------|-------------------|
| POST   | /api/auth/register | {username, password}   | {ok:true, user}   |
| POST   | /api/auth/login    | {username, password}   | {ok:true, user}   |
| POST   | /api/auth/logout   | —                       | {ok:true}         |
| GET    | /api/auth/me       | —                       | {user} or 401     |

### Models & Keys (auth required)

| Method | Path                       | Body              | Response        |
|--------|----------------------------|-------------------|-----------------|
| GET    | /api/models                 | —                 | {models} with per-model configured status |
| PUT    | /api/user/keys/:modelId     | {apiKey}          | {ok:true}       |
| DELETE | /api/user/keys/:modelId     | —                 | {ok:true}       |

### Chat (auth required)

| Method | Path              | Body                                    | Response    |
|--------|-------------------|-----------------------------------------|-------------|
| POST   | /api/chat/stream  | {message, modelIds, conversationHistory}| SSE stream  |

## Session Config

- Cookie name: `xiaseek.sid`
- HttpOnly + SameSite: Lax
- 24-hour expiry
- Secret from `SESSION_SECRET` env var (auto-generated if missing)

## Frontend Pages

### index.html (public)

- No auth required — landing page with navigation links
- Links to `/chat.html` (requires login) and other pages

### login.html (public)

- Clean centered card layout matching the existing design system (CSS variables)
- Toggle between Login and Register mode
- Fields: username + password (password min 4 chars)
- Error display for duplicate username / wrong password / etc
- On success: redirect to `/chat.html`
- If already logged in (GET /api/auth/me returns 200), redirect to `/chat.html`

### chat.html (auth required)

- Only page that requires login
- Auth middleware only applies to /api/* routes used by this page
- `index.html` and `login.html` are served as static files, no auth check

### chat.html changes

- On init: call GET /api/auth/me. If 401, redirect to `/login.html`
- Settings panel: "Save" button calls PUT /api/user/keys/:modelId
- Settings panel: show per-model key status from server (not localStorage)
- Settings panel: add "Clear key" button for models with existing keys
- Remove all localStorage-based key storage (`xiaseek_model_keys`, API keys in `xiaseek_custom_models`)
- Custom models: apiKey stored server-side like built-in models
- Nav bar: show current username + logout link

## Server Changes

### New middleware

- `requireAuth(req, res, next)` — checks `req.session.userId`, returns 401 if missing
- Applied to all /api/models, /api/user/keys, /api/chat routes

### Key resolution for chat requests

1. Load user's keys from `user_keys` table
2. Merge with any custom model configs sent in request body (baseURL, model name)
3. If no key found for a model → send error event for that model
4. `.env` keys are NOT used as fallback (no shared keys)

### Startup

- Auto-create `data/` directory and SQLite database
- Run CREATE TABLE IF NOT EXISTS
- Generate SESSION_SECRET if not set

## Error Handling

- Duplicate username → 409
- Invalid credentials → 401
- Missing fields → 400
- Server errors → 500 with generic message
- All API errors return JSON `{error: "message"}`

## Migration

- Existing localStorage keys AND `.env` keys are NOT migrated
- Users must re-enter their API keys after registering
- This is intentional — clean break to the new model

## Security Notes

- Passwords hashed with bcrypt (10 rounds)
- Session cookie HttpOnly + SameSite Lax
- API keys stored as plaintext in SQLite (same as current `.env` approach)
- No rate limiting in v1 (add later if needed)
- HTTPS required in production for session cookie security
