/**
 * Database connection and query helpers
 * 
 * Auto-detects database backend:
 * - If DATABASE_URL is set → use PostgreSQL (pg)
 * - If DATABASE_URL is not set → use SQLite (better-sqlite3) for local dev
 */

const config = require('./index');

// Auto-select backend
if (!config.database.url) {
  console.log('DATABASE_URL not set → using SQLite for local development');
  module.exports = require('./database-sqlite');
} else {
  console.log('DATABASE_URL found → using PostgreSQL');

  const { Pool } = require('pg');

  let pool = null;

  function initializePool() {
    if (pool) return pool;

    pool = new Pool({
      connectionString: config.database.url,
      ssl: config.database.ssl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });

    return pool;
  }

  async function query(text, params) {
    const db = initializePool();
    const start = Date.now();
    const result = await db.query(text, params);
    const duration = Date.now() - start;

    if (config.nodeEnv === 'development') {
      console.log('Query executed', { text: text.substring(0, 50), duration, rows: result.rowCount });
    }

    return result;
  }

  async function queryOne(text, params) {
    const result = await query(text, params);
    return result.rows[0] || null;
  }

  async function queryAll(text, params) {
    const result = await query(text, params);
    return result.rows;
  }

  async function transaction(callback) {
    const db = initializePool();
    const client = await db.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function healthCheck() {
    try {
      const db = initializePool();
      if (!db) return false;
      await db.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async function close() {
    if (pool) {
      await pool.end();
      pool = null;
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
    getPool: () => pool
  };
}
