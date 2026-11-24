/**
 * server.js — Express server entry point for NusantaraTix OLTP
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pingNode, NODES } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Import routes
const { router: authRouter } = require('./routes/auth');
const eventsRouter = require('./routes/events');
const bookingsRouter = require('./routes/bookings');
const analystRouter = require('./routes/analyst');

// API routes
app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/analyst', analystRouter);

/**
 * GET /api/cluster/status — Live 3-node cluster health check
 */
app.get('/api/cluster/status', async (req, res) => {
  try {
    const statusPromises = NODES.map(async (node) => {
      const ping = await pingNode(node.port);
      return {
        name: node.name,
        host: node.host,
        port: node.port,
        status: ping.online ? 'ONLINE' : 'OFFLINE',
        nodeId: ping.nodeId,
        error: ping.error || null,
      };
    });

    const statuses = await Promise.all(statusPromises);
    const onlineCount = statuses.filter(s => s.status === 'ONLINE').length;

    res.json({
      success: true,
      cluster: {
        total_nodes: NODES.length,
        online_nodes: onlineCount,
        nodes: statuses,
      },
    });
  } catch (err) {
    console.error('[CLUSTER] Status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  NusantaraTix OLTP Server`);
    console.log(`  Running on http://localhost:${PORT}`);
    console.log(`  CockroachDB Nodes: 26257, 26258, 26259`);
    console.log(`========================================\n`);
  });
}

module.exports = app;
