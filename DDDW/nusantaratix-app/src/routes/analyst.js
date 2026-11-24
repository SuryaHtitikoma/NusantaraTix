/**
 * analyst.js — Read-only analytics & CSV/JSON export endpoint for DuckDB (UAS)
 */

const express = require('express');
const router = express.Router();
const { queryWithFailover } = require('../db');
const { authMiddleware, requireRole, mapToDbRole } = require('./auth');

/**
 * GET /api/analyst/summary — Regional summary stats (ANALYST/ADMIN)
 */
router.get('/summary', authMiddleware, requireRole('ADMIN', 'ANALYST'), async (req, res) => {
  try {
    const dbRole = mapToDbRole(req.user.role);

    const bookingStats = await queryWithFailover(
      dbRole,
      `SELECT
         region,
         booking_status,
         COUNT(*) AS count,
         SUM(total_amount) AS total_revenue
       FROM bookings
       GROUP BY region, booking_status
       ORDER BY region, booking_status`
    );

    const paymentStats = await queryWithFailover(
      dbRole,
      `SELECT
         payment_method,
         payment_status,
         COUNT(*) AS count,
         SUM(amount_paid) AS total_amount
       FROM payment_transactions
       GROUP BY payment_method, payment_status
       ORDER BY payment_method, payment_status`
    );

    const tableCounts = {};
    for (const table of ['bookings', 'booking_tickets', 'payment_transactions']) {
      const countResult = await queryWithFailover(dbRole, `SELECT count(*) AS total FROM ${table}`);
      tableCounts[table] = parseInt(countResult.rows[0].total);
    }

    res.json({
      success: true,
      data: {
        booking_by_region: bookingStats.rows,
        payment_by_method: paymentStats.rows,
        table_counts: tableCounts,
      },
      handledByNode: bookingStats.handledByNode,
    });
  } catch (err) {
    console.error('[ANALYST] Summary error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/analyst/export — Export batch for DuckDB (CSV or JSON)
 * Query: table (bookings|booking_tickets|payment_transactions), format (csv|json), limit (max 50000)
 */
router.get('/export', authMiddleware, requireRole('ADMIN', 'ANALYST'), async (req, res) => {
  try {
    const table = req.query.table;
    const format = req.query.format || 'json';
    const limit = Math.min(parseInt(req.query.limit) || 10000, 50000);
    const offset = parseInt(req.query.offset) || 0;

    const allowedTables = ['bookings', 'booking_tickets', 'payment_transactions'];
    if (!allowedTables.includes(table)) {
      return res.status(400).json({ success: false, message: `Table harus salah satu: ${allowedTables.join(', ')}` });
    }

    const dbRole = mapToDbRole(req.user.role);
    const pkColumn = table === 'bookings' ? 'booking_id'
      : table === 'booking_tickets' ? 'ticket_id'
      : 'payment_id';

    const result = await queryWithFailover(
      dbRole,
      `SELECT * FROM ${table} ORDER BY ${pkColumn} ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    if (format === 'csv') {
      // Convert to CSV
      if (result.rows.length === 0) {
        return res.status(200).type('text/csv').send('');
      }
      const headers = Object.keys(result.rows[0]);
      const csvLines = [headers.join(',')];
      for (const row of result.rows) {
        const values = headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"` : str;
        });
        csvLines.push(values.join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${table}_export.csv"`);
      return res.send(csvLines.join('\n'));
    }

    // JSON format
    res.json({
      success: true,
      table,
      count: result.rows.length,
      limit,
      offset,
      data: result.rows,
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    console.error('[ANALYST] Export error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/analyst/preview/:table — Quick preview (ANALYST/ADMIN)
 */
router.get('/preview/:table', authMiddleware, requireRole('ADMIN', 'ANALYST'), async (req, res) => {
  try {
    const table = req.params.table;
    const allowedTables = ['bookings', 'booking_tickets', 'payment_transactions'];
    if (!allowedTables.includes(table)) {
      return res.status(400).json({ success: false, message: 'Table tidak valid.' });
    }

    const dbRole = mapToDbRole(req.user.role);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const pkColumn = table === 'bookings' ? 'booking_id'
      : table === 'booking_tickets' ? 'ticket_id'
      : 'payment_id';

    const result = await queryWithFailover(
      dbRole,
      `SELECT * FROM ${table} ORDER BY ${pkColumn} DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await queryWithFailover(dbRole, `SELECT count(*) AS total FROM ${table}`);

    res.json({
      success: true,
      table,
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
