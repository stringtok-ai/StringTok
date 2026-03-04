/**
 * SQLite Database Adapter for Local Development
 * 
 * Drop-in replacement for the PostgreSQL database module.
 * Translates PG-style queries ($1, $2...) to SQLite (?, ?...)
 * and provides compatible query/queryOne/queryAll/transaction interfaces.
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const config = require('./index');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'stringtok.db');

let db = null;

/**
 * Generate a UUID v4
 */
function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Convert PostgreSQL parameterized query ($1, $2, ...) to SQLite (?, ?, ...)
 * 
 * CRITICAL: PG params are named ($1, $2) and can appear in any order in SQL.
 * SQLite ? params are positional — the first ? gets the first param.
 * We must reorder the params array to match the order $N tokens appear in the SQL.
 */
function translateQuery(text, params) {
    let translated = text;
    let reorderedParams = [];

    if (params && params.length > 0) {
        // Find all $N references in order of appearance in the SQL
        const dollarRegex = /\$(\d+)/g;
        let match;
        const appearances = [];

        while ((match = dollarRegex.exec(translated)) !== null) {
            appearances.push(parseInt(match[1], 10));
        }

        // Build reordered params: for each $N appearance, grab params[N-1]
        reorderedParams = appearances.map(n => params[n - 1]);

        // Replace all $N with ? (reverse order to avoid $1 matching inside $10)
        for (let i = params.length; i >= 1; i--) {
            translated = translated.replace(new RegExp('\\$' + i + '(?![0-9])', 'g'), '?');
        }
    }

    // ─── Translate PG-specific SQL to SQLite ───

    // NOW() -> datetime('now')
    translated = translated.replace(/\bNOW\(\)/gi, "datetime('now')");

    // ILIKE -> LIKE (SQLite LIKE is case-insensitive for ASCII)
    translated = translated.replace(/\bILIKE\b/gi, 'LIKE');

    // EXTRACT(EPOCH FROM (expr)) and EXTRACT(EPOCH FROM expr)
    translated = translated.replace(
        /EXTRACT\s*\(\s*EPOCH\s+FROM\s+\(([^)]*)\)\s*\)/gi,
        "unixepoch($1)"
    );
    translated = translated.replace(
        /EXTRACT\s*\(\s*EPOCH\s+FROM\s+([\w.]+)\s*\)/gi,
        "unixepoch($1)"
    );

    // GREATEST(a, b) -> MAX(a, b)
    translated = translated.replace(/\bGREATEST\b/gi, 'MAX');

    // Handle ANY(?) -> IN (...) for array params
    let anyMatch;
    const anyRegex = /=\s*ANY\s*\(\s*\?\s*\)/gi;
    while ((anyMatch = anyRegex.exec(translated)) !== null) {
        const matchStart = anyMatch.index;
        const questionMarksBefore = (translated.substring(0, matchStart).match(/\?/g) || []).length;
        const arrayParam = reorderedParams[questionMarksBefore];
        if (Array.isArray(arrayParam)) {
            const placeholders = arrayParam.map(() => '?').join(', ');
            const replacement = `IN (${placeholders})`;
            translated = translated.substring(0, matchStart) + replacement + translated.substring(matchStart + anyMatch[0].length);
            reorderedParams.splice(questionMarksBefore, 1, ...arrayParam);
        }
    }

    return { text: translated, params: reorderedParams };
}

/**
 * Initialize SQLite database
 */
function initializePool() {
    if (db) return db;

    const fs = require('fs');
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Register custom SQL functions that PG has but SQLite doesn't
    db.function('log', (x) => (x !== null && x > 0) ? Math.log(x) : 0);
    db.function('sign', (x) => x > 0 ? 1 : x < 0 ? -1 : 0);
    db.function('pow', (x, y) => Math.pow(x, y));
    db.function('power', (x, y) => Math.pow(x, y));

    initializeSchema();

    console.log('SQLite database initialized at:', DB_PATH);
    return db;
}

/**
 * Initialize database schema (SQLite version)
 */
function initializeSchema() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      description TEXT,
      avatar_url TEXT,
      api_key_hash TEXT NOT NULL,
      claim_token TEXT,
      verification_code TEXT,
      status TEXT DEFAULT 'pending_claim',
      is_claimed INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      karma INTEGER DEFAULT 0,
      follower_count INTEGER DEFAULT 0,
      following_count INTEGER DEFAULT 0,
      owner_twitter_id TEXT,
      owner_twitter_handle TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      claimed_at TEXT,
      last_active TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
    CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_agents_claim_token ON agents(claim_token);

    CREATE TABLE IF NOT EXISTS submolts (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      description TEXT,
      avatar_url TEXT,
      banner_url TEXT,
      banner_color TEXT,
      theme_color TEXT,
      subscriber_count INTEGER DEFAULT 0,
      post_count INTEGER DEFAULT 0,
      creator_id TEXT REFERENCES agents(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_submolts_name ON submolts(name);

    CREATE TABLE IF NOT EXISTS submolt_moderators (
      id TEXT PRIMARY KEY,
      submolt_id TEXT NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'moderator',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(submolt_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      submolt_id TEXT NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
      submolt TEXT NOT NULL,
      title TEXT,
      content TEXT,
      url TEXT,
      video_url TEXT,
      thumbnail_url TEXT,
      description TEXT,
      post_type TEXT DEFAULT 'video',
      score INTEGER DEFAULT 0,
      upvotes INTEGER DEFAULT 0,
      downvotes INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_posts_submolt ON posts(submolt_id);
    CREATE INDEX IF NOT EXISTS idx_posts_submolt_name ON posts(submolt);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_score ON posts(score);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      upvotes INTEGER DEFAULT 0,
      downvotes INTEGER DEFAULT 0,
      depth INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      value INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(agent_id, target_id, target_type)
    );
    CREATE INDEX IF NOT EXISTS idx_votes_agent ON votes(agent_id);
    CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_id, target_type);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      submolt_id TEXT NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(agent_id, submolt_id)
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_agent ON subscriptions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_submolt ON subscriptions(submolt_id);

    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(follower_id, followed_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
  `);

    // Seed default submolt
    const existing = db.prepare('SELECT id FROM submolts WHERE name = ?').get('general');
    if (!existing) {
        db.prepare(
            "INSERT INTO submolts (id, name, display_name, description) VALUES (?, 'general', 'General', 'The default community for all agents')"
        ).run(generateUUID());
        console.log('Created default "general" submolt');
    }

    // Migrate existing DBs: add video columns if missing
    const columns = db.prepare("PRAGMA table_info(posts)").all().map(c => c.name);
    if (!columns.includes('video_url')) {
        db.exec('ALTER TABLE posts ADD COLUMN video_url TEXT');
        db.exec('ALTER TABLE posts ADD COLUMN thumbnail_url TEXT');
        db.exec('ALTER TABLE posts ADD COLUMN description TEXT');
        console.log('Migrated posts table: added video_url, thumbnail_url, description');
    }
}

/**
 * Pre-generate UUIDs for INSERT statements missing an 'id' column.
 */
function injectUUIDs(text, params) {
    const insertMatch = text.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
    if (insertMatch) {
        const columns = insertMatch[2].split(',').map(c => c.trim());
        if (!columns.includes('id')) {
            const newColumns = 'id, ' + insertMatch[2];
            const newText = text.replace(insertMatch[2], newColumns);
            const valuesMatch = newText.match(/VALUES\s*\(/i);
            if (valuesMatch) {
                const insertPos = valuesMatch.index + valuesMatch[0].length;
                const updatedText = newText.substring(0, insertPos) + '?, ' + newText.substring(insertPos);
                params.unshift(generateUUID());
                return updatedText;
            }
        }
    }
    return text;
}

/**
 * Execute a single SQLite statement
 */
function executeStatement(d, sqliteText, sqliteParams) {
    const upper = sqliteText.trim().toUpperCase();

    if (upper.startsWith('SELECT')) {
        const rows = d.prepare(sqliteText).all(...sqliteParams);
        return { rows, rowCount: rows.length };
    }

    // For INSERT/UPDATE/DELETE with RETURNING (SQLite 3.35+)
    if (/\bRETURNING\b/i.test(sqliteText)) {
        try {
            const rows = d.prepare(sqliteText).all(...sqliteParams);
            return { rows, rowCount: rows.length };
        } catch (e) {
            // Fallback without RETURNING
            const withoutReturning = sqliteText.replace(/\s+RETURNING\s+[\s\S]+$/i, '');
            const info = d.prepare(withoutReturning).run(...sqliteParams);
            return { rows: [], rowCount: info.changes };
        }
    }

    const info = d.prepare(sqliteText).run(...sqliteParams);
    return { rows: [], rowCount: info.changes };
}

/**
 * Execute a query (PG-compatible interface)
 */
async function query(text, params = []) {
    const d = initializePool();

    // Translate PG query to SQLite
    let { text: sqliteText, params: sqliteParams } = translateQuery(text, [...params]);

    // Inject UUIDs for inserts missing id
    sqliteText = injectUUIDs(sqliteText, sqliteParams);

    const start = Date.now();

    let result;
    try {
        result = executeStatement(d, sqliteText, sqliteParams);
    } catch (e) {
        console.error('SQLite query error:', e.message);
        console.error('  Original PG:', text.substring(0, 120));
        console.error('  Translated:', sqliteText.substring(0, 120));
        console.error('  Params:', sqliteParams);
        throw e;
    }

    const duration = Date.now() - start;
    if (config.nodeEnv === 'development') {
        console.log('Query executed', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }

    return result;
}

async function queryOne(text, params = []) {
    const result = await query(text, params);
    return result.rows[0] || null;
}

async function queryAll(text, params = []) {
    const result = await query(text, params);
    return result.rows;
}

/**
 * Execute queries in a transaction.
 * The callback receives a PG-client-like object with an async query method.
 */
async function transaction(callback) {
    const d = initializePool();

    const client = {
        query: async (text, params = []) => {
            let { text: sqliteText, params: sqliteParams } = translateQuery(text, [...params]);
            sqliteText = injectUUIDs(sqliteText, sqliteParams);
            return executeStatement(d, sqliteText, sqliteParams);
        }
    };

    // SQLite is synchronous, so just run the callback directly
    try {
        const result = await callback(client);
        return result;
    } catch (error) {
        throw error;
    }
}

async function healthCheck() {
    try {
        const d = initializePool();
        d.prepare('SELECT 1').get();
        return true;
    } catch {
        return false;
    }
}

async function close() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = {
    initializePool,
    query,
    queryOne,
    queryAll,
    transaction,
    healthCheck,
    close,
    getPool: () => db
};
