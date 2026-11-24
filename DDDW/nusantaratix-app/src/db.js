/**
 * db.js — Multi-node CockroachDB SSL connection pools & failover router
 * 
 * Maintains separate connection pools per SQL role (admin_role, operator_role, analyst_role)
 * across 3 CockroachDB nodes with automatic failover.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// TLS Certificate
const caPath = path.join(__dirname, '../certs/ca.crt');
let CA_CERT = null;
if (fs.existsSync(caPath)) {
  try {
    CA_CERT = fs.readFileSync(caPath).toString();
    console.log('[DB] ca.crt successfully loaded for TLS Secure Mode.');
  } catch (e) {
    console.warn('[DB] Failed to read certs/ca.crt:', e.message);
  }
} else {
  console.warn('[DB] certs/ca.crt not found. Please ensure certs/ca.crt is in place for TLS Secure Mode.');
}

// CockroachDB Node Topology
const NODES = [
  { name: 'Jakarta (Node 1)', host: 'localhost', port: 26257 },
  { name: 'Surabaya (Node 2)', host: 'localhost', port: 26258 },
  { name: 'Bali (Node 3)', host: 'localhost', port: 26259 },
];

// SQL Role credentials
const ROLE_CREDENTIALS = {
  admin_role: { user: 'admin_role', password: 'AdminPassword123!' },
  operator_role: { user: 'operator_role', password: 'OperatorPassword123!' },
  analyst_role: { user: 'analyst_role', password: 'AnalystPassword123!' },
};

// Pool cache: keyed by `${role}@${port}`
const pools = {};

/**
 * Get or create a pg.Pool for a given role + node port
 */
function getPool(role, port) {
  const key = `${role}@${port}`;
  if (!pools[key]) {
    const creds = ROLE_CREDENTIALS[role];
    if (!creds) throw new Error(`Unknown role: ${role}`);
    pools[key] = new Pool({
      host: 'localhost',
      port,
      database: 'nusantaratix',
      user: creds.user,
      password: creds.password,
      ssl: CA_CERT ? {
        rejectUnauthorized: true,
        ca: CA_CERT,
      } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pools[key];
}

// Round-robin index
let rrIndex = 0;

/**
 * queryWithFailover — routes queries across active nodes with automatic retry on failure
 * 
 * @param {string} role - 'admin_role' | 'operator_role' | 'analyst_role'
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @param {number|null} targetPort - Pin to a specific node port, or null for round-robin
 * @returns {Promise<{rows, rowCount, handledByNode, handledByPort}>}
 */
async function queryWithFailover(role, sql, params = [], targetPort = null) {
  const orderedNodes = [];

  if (targetPort) {
    // Start with the pinned node, then fallback to others
    const pinned = NODES.find(n => n.port === targetPort);
    if (pinned) orderedNodes.push(pinned);
    NODES.filter(n => n.port !== targetPort).forEach(n => orderedNodes.push(n));
  } else {
    // Round-robin starting node
    for (let i = 0; i < NODES.length; i++) {
      orderedNodes.push(NODES[(rrIndex + i) % NODES.length]);
    }
    rrIndex = (rrIndex + 1) % NODES.length;
  }

  let lastError;
  for (const node of orderedNodes) {
    try {
      const pool = getPool(role, node.port);
      const result = await pool.query(sql, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        handledByNode: node.name,
        handledByPort: node.port,
      };
    } catch (err) {
      lastError = err;
      // Retry on connection errors (node down)
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        console.warn(`[FAILOVER] Node ${node.name} (:${node.port}) unreachable, trying next...`);
        continue;
      }
      // For non-connection errors (SQL errors, permission denied), throw immediately
      throw err;
    }
  }
  throw new Error(`All CockroachDB nodes unreachable. Last error: ${lastError?.message}`);
}

/**
 * getTransactionClient — get a client from a specific node's pool for multi-statement transactions
 */
async function getTransactionClient(role, targetPort = null) {
  const orderedNodes = [];

  if (targetPort) {
    const pinned = NODES.find(n => n.port === targetPort);
    if (pinned) orderedNodes.push(pinned);
    NODES.filter(n => n.port !== targetPort).forEach(n => orderedNodes.push(n));
  } else {
    for (let i = 0; i < NODES.length; i++) {
      orderedNodes.push(NODES[(rrIndex + i) % NODES.length]);
    }
    rrIndex = (rrIndex + 1) % NODES.length;
  }

  let lastError;
  for (const node of orderedNodes) {
    try {
      const pool = getPool(role, node.port);
      const client = await pool.connect();
      client._nodeInfo = { name: node.name, port: node.port };
      return client;
    } catch (err) {
      lastError = err;
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        console.warn(`[FAILOVER-TX] Node ${node.name} (:${node.port}) unreachable, trying next...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`All CockroachDB nodes unreachable for transaction. Last error: ${lastError?.message}`);
}

/**
 * Ping a specific node — for cluster status endpoint
 */
async function pingNode(port) {
  try {
    const pool = getPool('admin_role', port);
    const result = await pool.query('SELECT crdb_internal.node_id() AS node_id');
    return { online: true, nodeId: result.rows[0]?.node_id };
  } catch (err) {
    // Try a simpler query as fallback
    try {
      const pool = getPool('admin_role', port);
      const result = await pool.query('SELECT 1 AS ok');
      return { online: true, nodeId: null };
    } catch (err2) {
      return { online: false, nodeId: null, error: err2.message };
    }
  }
}

module.exports = {
  NODES,
  ROLE_CREDENTIALS,
  queryWithFailover,
  getTransactionClient,
  pingNode,
  getPool,
};
