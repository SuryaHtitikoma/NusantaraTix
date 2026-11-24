/**
 * events.js — Master events & ticket tiers management (Admin/Public)
 */

const express = require('express');
const router = express.Router();
const { queryWithFailover } = require('../db');
const { authMiddleware, requireRole, mapToDbRole } = require('./auth');

/**
 * GET /api/events — List all events with their tiers (public, paginated)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    // Use admin_role for public read since everyone can view events
    const result = await queryWithFailover(
      'admin_role',
      `SELECT e.event_id, e.event_name, e.venue, e.city, e.region, e.event_date, e.created_at
       FROM events e
       ORDER BY e.event_date DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get tiers for each event
    const events = [];
    for (const event of result.rows) {
      const tiersResult = await queryWithFailover(
        'admin_role',
        `SELECT tier_id, tier_name, price, total_quota, available_quota
         FROM ticket_tiers
         WHERE event_id = $1
         ORDER BY price ASC`,
        [event.event_id]
      );
      events.push({ ...event, tiers: tiersResult.rows });
    }

    // Approximate count
    const countResult = await queryWithFailover(
      'admin_role',
      `SELECT count(*) AS total FROM events`
    );

    res.json({
      success: true,
      data: events,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    console.error('[EVENTS] List error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/events/:id — Single event detail
 */
router.get('/:id', async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const result = await queryWithFailover(
      'admin_role',
      'SELECT * FROM events WHERE event_id = $1',
      [eventId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Event tidak ditemukan.' });
    }

    const tiersResult = await queryWithFailover(
      'admin_role',
      'SELECT * FROM ticket_tiers WHERE event_id = $1 ORDER BY price ASC',
      [eventId]
    );

    res.json({
      success: true,
      data: { ...result.rows[0], tiers: tiersResult.rows },
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/events — Create new event (ADMIN only)
 */
router.post('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { event_name, venue, city, region, event_date } = req.body;
    if (!event_name || !venue || !city || !region || !event_date) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi.' });
    }

    const dbRole = mapToDbRole(req.user.role);
    const result = await queryWithFailover(
      dbRole,
      `INSERT INTO events (event_name, venue, city, region, event_date, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING event_id, event_name, venue, city, region, event_date, created_at`,
      [event_name, venue, city, region, event_date]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    console.error('[EVENTS] Create error:', err.message);
    // RBAC Demo: permission denied
    if (err.message.includes('permission denied')) {
      return res.status(403).json({ success: false, message: `RBAC Error: ${err.message}` });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/events/:id/tiers — Create ticket tier (ADMIN only)
 */
router.post('/:id/tiers', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const { tier_name, price, total_quota } = req.body;
    if (!tier_name || !price || !total_quota) {
      return res.status(400).json({ success: false, message: 'Tier name, price, dan total quota wajib diisi.' });
    }

    const dbRole = mapToDbRole(req.user.role);
    const result = await queryWithFailover(
      dbRole,
      `INSERT INTO ticket_tiers (event_id, tier_name, price, total_quota, available_quota)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING *`,
      [eventId, tier_name, price, total_quota]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    if (err.message.includes('permission denied')) {
      return res.status(403).json({ success: false, message: `RBAC Error: ${err.message}` });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/events/tiers/:tierId/quota — Reset/adjust available_quota (ADMIN only)
 */
router.put('/tiers/:tierId/quota', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const tierId = parseInt(req.params.tierId);
    const { available_quota } = req.body;
    if (available_quota === undefined || available_quota < 0) {
      return res.status(400).json({ success: false, message: 'available_quota wajib >= 0.' });
    }

    const dbRole = mapToDbRole(req.user.role);
    const result = await queryWithFailover(
      dbRole,
      `UPDATE ticket_tiers SET available_quota = $1 WHERE tier_id = $2 RETURNING *`,
      [available_quota, tierId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Tier tidak ditemukan.' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      handledByNode: result.handledByNode,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/events/rbac-test — RBAC Permission test: attempt INSERT as current role
 */
router.post('/rbac-test', authMiddleware, async (req, res) => {
  try {
    const dbRole = mapToDbRole(req.user.role);
    // Attempt to insert a dummy event — if role lacks INSERT on events, it will fail
    await queryWithFailover(
      dbRole,
      `INSERT INTO events (event_name, venue, city, region, event_date, created_at)
       VALUES ('__RBAC_TEST__', 'test', 'test', 'test', NOW(), NOW())
       RETURNING event_id`
    );

    // If it succeeded, clean up
    await queryWithFailover(dbRole, `DELETE FROM events WHERE event_name = '__RBAC_TEST__'`);

    res.json({
      success: true,
      message: `Role '${req.user.role}' (DB: ${dbRole}) BERHASIL INSERT ke tabel events.`,
      permitted: true,
    });
  } catch (err) {
    if (err.message.includes('permission denied')) {
      return res.json({
        success: true,
        message: `Role '${req.user.role}' (DB: ${dbRole}) DITOLAK: ${err.message}`,
        permitted: false,
        dbError: err.message,
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
