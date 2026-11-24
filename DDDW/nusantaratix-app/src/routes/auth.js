/**
 * auth.js — Login & role session handling
 */

const express = require('express');
const router = express.Router();
const { queryWithFailover } = require('../db');

// In-memory sessions (for demo purposes; production would use JWT or express-session)
const sessions = {};

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { success, user: { user_id, username, role, region }, sessionId }
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
    }

    // Query users table using admin_role (can read all)
    const result = await queryWithFailover(
      'admin_role',
      'SELECT user_id, username, email, password_hash, role, region FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Username tidak ditemukan.' });
    }

    const user = result.rows[0];

    // Simple password check (demo: plaintext comparison with password_hash)
    if (user.password_hash !== password) {
      return res.status(401).json({ success: false, message: 'Password salah.' });
    }

    // Create session
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessions[sessionId] = {
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      role: user.role,
      region: user.region,
    };

    res.json({
      success: true,
      sessionId,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
        region: user.region,
      },
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/auth/session
 * Header: x-session-id
 */
router.get('/session', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({ success: false, message: 'Session tidak valid.' });
  }
  res.json({ success: true, user: sessions[sessionId] });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) delete sessions[sessionId];
  res.json({ success: true, message: 'Logged out.' });
});

/**
 * Middleware: attach user session to req
 */
function authMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
  }
  req.user = sessions[sessionId];
  req.sessionId = sessionId;
  next();
}

/**
 * Middleware: require specific roles
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: `Akses ditolak. Role '${req.user.role}' tidak diizinkan.` });
    }
    next();
  };
}

/**
 * Map app role to CockroachDB SQL role
 */
function mapToDbRole(appRole) {
  switch (appRole) {
    case 'ADMIN': return 'admin_role';
    case 'OPERATOR': return 'operator_role';
    case 'CUSTOMER': return 'operator_role'; // Customers use operator_role scoped to own user_id
    case 'ANALYST': return 'analyst_role';
    default: return 'operator_role';
  }
}

module.exports = { router, authMiddleware, requireRole, mapToDbRole, sessions };
