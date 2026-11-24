/**
 * bookings.js — ACID ticket purchase, War Tiket simulator, paginated table viewers
 */

const express = require('express');
const router = express.Router();
const { queryWithFailover, getTransactionClient, NODES } = require('../db');
const { authMiddleware, requireRole, mapToDbRole } = require('./auth');

/**
 * POST /api/bookings/purchase — ACID Ticket Purchase
 * Body: { tier_id, qty (1-4), payment_method, attendee_names[] }
 */
router.post('/purchase', authMiddleware, async (req, res) => {
  const { tier_id, qty = 1, payment_method = 'QRIS', attendee_names = [] } = req.body;

  if (!tier_id || qty < 1 || qty > 4) {
    return res.status(400).json({ success: false, message: 'tier_id wajib dan qty 1-4.' });
  }

  const dbRole = mapToDbRole(req.user.role);
  const targetPort = req.headers['x-target-node'] ? parseInt(req.headers['x-target-node']) : null;

  let client;
  try {
    client = await getTransactionClient(dbRole, targetPort);
    await client.query('BEGIN');

    // 1. Atomically decrement quota
    const quotaResult = await client.query(
      `UPDATE ticket_tiers
       SET available_quota = available_quota - $1
       WHERE tier_id = $2 AND available_quota >= $1
       RETURNING event_id, tier_name, price, available_quota`,
      [qty, tier_id]
    );

    if (quotaResult.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        success: false,
        message: 'Sold Out / Kuota Tidak Cukup!',
        code: 'SOLD_OUT',
      });
    }

    const tier = quotaResult.rows[0];
    const totalAmount = parseFloat(tier.price) * qty;

    // 2. Insert booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (user_id, event_id, region, booking_status, total_amount, created_at)
       VALUES ($1, $2, $3, 'PAID', $4, NOW())
       RETURNING booking_id`,
      [req.user.user_id, tier.event_id, req.user.region || 'Jakarta', totalAmount]
    );
    const bookingId = bookingResult.rows[0].booking_id;

    // 3. Insert booking_tickets
    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const ticketCode = `TIX-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      const attendeeName = attendee_names[i] || `${req.user.username}_Guest${i + 1}`;
      const ticketResult = await client.query(
        `INSERT INTO booking_tickets (booking_id, tier_id, attendee_name, ticket_code, is_checked_in, created_at)
         VALUES ($1, $2, $3, $4, false, NOW())
         RETURNING ticket_id, ticket_code, attendee_name`,
        [bookingId, tier_id, attendeeName, ticketCode]
      );
      tickets.push(ticketResult.rows[0]);
    }

    // 4. Insert payment_transaction
    const payResult = await client.query(
      `INSERT INTO payment_transactions (booking_id, payment_method, amount_paid, payment_status, paid_at)
       VALUES ($1, $2, $3, 'SUCCESS', NOW())
       RETURNING payment_id`,
      [bookingId, payment_method, totalAmount]
    );

    // 5. Get node_id before COMMIT
    let handledByNodeId = null;
    try {
      const nodeResult = await client.query('SELECT crdb_internal.node_id() AS node_id');
      handledByNodeId = nodeResult.rows[0].node_id;
    } catch (e) {
      // Some roles may not have access to crdb_internal
    }

    await client.query('COMMIT');
    client.release();

    res.json({
      success: true,
      data: {
        booking_id: bookingId,
        event_id: tier.event_id,
        tier_name: tier.tier_name,
        qty,
        total_amount: totalAmount,
        payment_id: payResult.rows[0].payment_id,
        payment_method,
        tickets,
        remaining_quota: tier.available_quota,
      },
      handledByNode: client._nodeInfo?.name,
      handledByPort: client._nodeInfo?.port,
      cockroachNodeId: handledByNodeId,
    });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      client.release();
    }
    console.error('[BOOKING] Purchase error:', err.message);

    if (err.message.includes('permission denied')) {
      return res.status(403).json({ success: false, message: `RBAC Error: ${err.message}` });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/war-ticket/simulate — Parallel War Tiket Stress Simulator
 * Body: { tier_id, concurrent_requests (20-100), region_mode ('RANDOM'|'JAKARTA'|'SURABAYA'|'BALI') }
 */
router.post('/war-ticket/simulate', authMiddleware, requireRole('ADMIN', 'OPERATOR'), async (req, res) => {
  try {
    const { tier_id, concurrent_requests = 20, region_mode = 'RANDOM' } = req.body;

    if (!tier_id || concurrent_requests < 1 || concurrent_requests > 200) {
      return res.status(400).json({ success: false, message: 'tier_id wajib, concurrent_requests 1-200.' });
    }

    // Get target port based on region_mode
    const getTargetPort = () => {
      switch (region_mode) {
        case 'JAKARTA': return 26257;
        case 'SURABAYA': return 26258;
        case 'BALI': return 26259;
        case 'RANDOM':
        default:
          return NODES[Math.floor(Math.random() * NODES.length)].port;
      }
    };

    const dbRole = mapToDbRole(req.user.role);
    const startTime = Date.now();

    // Fire all concurrent purchase attempts
    const promises = Array.from({ length: concurrent_requests }, (_, i) => {
      return (async () => {
        const targetPort = getTargetPort();
        let client;
        try {
          client = await getTransactionClient(dbRole, targetPort);
          await client.query('BEGIN');

          const quotaResult = await client.query(
            `UPDATE ticket_tiers
             SET available_quota = available_quota - 1
             WHERE tier_id = $1 AND available_quota >= 1
             RETURNING event_id, price, available_quota`,
            [tier_id]
          );

          if (quotaResult.rowCount === 0) {
            await client.query('ROLLBACK');
            client.release();
            return { success: false, reason: 'SOLD_OUT', node: client._nodeInfo?.name, port: client._nodeInfo?.port };
          }

          const tier = quotaResult.rows[0];
          const ticketCode = `WAR-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

          const bookingResult = await client.query(
            `INSERT INTO bookings (user_id, event_id, region, booking_status, total_amount, created_at)
             VALUES ($1, $2, $3, 'PAID', $4, NOW())
             RETURNING booking_id`,
            [req.user.user_id, tier.event_id, region_mode, tier.price]
          );

          await client.query(
            `INSERT INTO booking_tickets (booking_id, tier_id, attendee_name, ticket_code, is_checked_in, created_at)
             VALUES ($1, $2, $3, $4, false, NOW())`,
            [bookingResult.rows[0].booking_id, tier_id, `WarBot_${i}`, ticketCode]
          );

          await client.query(
            `INSERT INTO payment_transactions (booking_id, payment_method, amount_paid, payment_status, paid_at)
             VALUES ($1, 'QRIS', $2, 'SUCCESS', NOW())`,
            [bookingResult.rows[0].booking_id, tier.price]
          );

          await client.query('COMMIT');
          client.release();
          return { success: true, booking_id: bookingResult.rows[0].booking_id, node: client._nodeInfo?.name, port: client._nodeInfo?.port };
        } catch (err) {
          if (client) {
            try { await client.query('ROLLBACK'); } catch (e) { /* */ }
            client.release();
          }
          return { success: false, reason: err.message, node: client?._nodeInfo?.name, port: client?._nodeInfo?.port };
        }
      })();
    });

    const results = await Promise.allSettled(promises);
    const endTime = Date.now();

    // Compile battle report
    let succeeded = 0, soldOut = 0, errors = 0;
    const nodeDistribution = {};
    NODES.forEach(n => { nodeDistribution[n.name] = 0; });

    results.forEach(r => {
      const val = r.status === 'fulfilled' ? r.value : { success: false, reason: 'PROMISE_REJECTED' };
      if (val.success) {
        succeeded++;
        if (val.node && nodeDistribution[val.node] !== undefined) nodeDistribution[val.node]++;
      } else if (val.reason === 'SOLD_OUT') {
        soldOut++;
      } else {
        errors++;
      }
    });

    // Get final quota
    const finalQuota = await queryWithFailover(
      dbRole,
      'SELECT available_quota FROM ticket_tiers WHERE tier_id = $1',
      [tier_id]
    );

    res.json({
      success: true,
      battleReport: {
        total_requests: concurrent_requests,
        total_succeeded: succeeded,
        total_sold_out: soldOut,
        total_errors: errors,
        execution_time_ms: endTime - startTime,
        final_available_quota: finalQuota.rows[0]?.available_quota,
        quota_never_negative: (finalQuota.rows[0]?.available_quota ?? 0) >= 0,
        node_distribution: nodeDistribution,
        region_mode,
      },
    });
  } catch (err) {
    console.error('[WAR-TICKET] Simulate error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/bookings — Paginated bookings list
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const searchId = req.query.booking_id;
    const dbRole = mapToDbRole(req.user.role);

    let sql, params;
    if (searchId) {
      sql = 'SELECT * FROM bookings WHERE booking_id = $1';
      params = [parseInt(searchId)];
    } else if (req.user.role === 'CUSTOMER') {
      sql = 'SELECT * FROM bookings WHERE user_id = $1 ORDER BY booking_id DESC LIMIT $2 OFFSET $3';
      params = [req.user.user_id, limit, offset];
    } else {
      sql = 'SELECT * FROM bookings ORDER BY booking_id DESC LIMIT $1 OFFSET $2';
      params = [limit, offset];
    }

    const result = await queryWithFailover(dbRole, sql, params);

    // Approximate count
    let total = result.rows.length;
    if (!searchId) {
      try {
        const countSql = req.user.role === 'CUSTOMER'
          ? 'SELECT count(*) AS total FROM bookings WHERE user_id = $1'
          : 'SELECT count(*) AS total FROM bookings';
        const countParams = req.user.role === 'CUSTOMER' ? [req.user.user_id] : [];
        const countResult = await queryWithFailover(dbRole, countSql, countParams);
        total = parseInt(countResult.rows[0].total);
      } catch (e) { /* use rows length as fallback */ }
    }

    res.json({
      success: true,
      data: result.rows,
      total,
      limit,
      offset,
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/bookings/tickets — Paginated booking_tickets
 */
router.get('/tickets', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const searchId = req.query.ticket_id;
    const dbRole = mapToDbRole(req.user.role);

    let sql, params;
    if (searchId) {
      sql = 'SELECT * FROM booking_tickets WHERE ticket_id = $1';
      params = [parseInt(searchId)];
    } else {
      sql = 'SELECT * FROM booking_tickets ORDER BY ticket_id DESC LIMIT $1 OFFSET $2';
      params = [limit, offset];
    }

    const result = await queryWithFailover(dbRole, sql, params);

    let total = result.rows.length;
    if (!searchId) {
      try {
        const countResult = await queryWithFailover(dbRole, 'SELECT count(*) AS total FROM booking_tickets');
        total = parseInt(countResult.rows[0].total);
      } catch (e) { /* fallback */ }
    }

    res.json({ success: true, data: result.rows, total, limit, offset, handledByNode: result.handledByNode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/bookings/my-tickets — Customer's own tickets & codes
 */
router.get('/my-tickets', authMiddleware, async (req, res) => {
  try {
    const dbRole = mapToDbRole(req.user.role);
    const result = await queryWithFailover(
      dbRole,
      `SELECT bt.ticket_id, bt.ticket_code, bt.attendee_name, bt.is_checked_in, bt.created_at,
              b.booking_id, b.total_amount, e.event_name, tt.tier_name
       FROM booking_tickets bt
       JOIN bookings b ON bt.booking_id = b.booking_id
       JOIN events e ON b.event_id = e.event_id
       JOIN ticket_tiers tt ON bt.tier_id = tt.tier_id
       WHERE b.user_id = $1
       ORDER BY bt.ticket_id DESC
       LIMIT 50`,
      [req.user.user_id]
    );
    res.json({ success: true, data: result.rows, handledByNode: result.handledByNode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/bookings/payments — Paginated payment_transactions
 */
router.get('/payments', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const searchId = req.query.payment_id;
    const dbRole = mapToDbRole(req.user.role);

    let sql, params;
    if (searchId) {
      sql = 'SELECT * FROM payment_transactions WHERE payment_id = $1';
      params = [parseInt(searchId)];
    } else {
      sql = 'SELECT * FROM payment_transactions ORDER BY payment_id DESC LIMIT $1 OFFSET $2';
      params = [limit, offset];
    }

    const result = await queryWithFailover(dbRole, sql, params);

    let total = result.rows.length;
    if (!searchId) {
      try {
        const countResult = await queryWithFailover(dbRole, 'SELECT count(*) AS total FROM payment_transactions');
        total = parseInt(countResult.rows[0].total);
      } catch (e) { /* fallback */ }
    }

    res.json({ success: true, data: result.rows, total, limit, offset, handledByNode: result.handledByNode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/bookings/tickets/:ticketId/checkin — Check-in a ticket (OPERATOR/ADMIN)
 */
router.put('/tickets/:ticketId/checkin', authMiddleware, requireRole('ADMIN', 'OPERATOR'), async (req, res) => {
  try {
    const ticketId = parseInt(req.params.ticketId);
    const dbRole = mapToDbRole(req.user.role);
    const result = await queryWithFailover(
      dbRole,
      'UPDATE booking_tickets SET is_checked_in = true WHERE ticket_id = $1 RETURNING *',
      [ticketId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Ticket tidak ditemukan.' });
    }

    res.json({ success: true, data: result.rows[0], handledByNode: result.handledByNode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
