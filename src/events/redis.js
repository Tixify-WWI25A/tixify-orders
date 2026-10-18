const { Redis } = require('ioredis');

/** Name der Queue. Muss bei Produzenten (identity, orders) und Konsument (notifications) identisch sein. */
const QUEUE_NAME = 'notifications';

/**
 * Baut die Redis-Verbindung für BullMQ.
 * - maxRetriesPerRequest: null ist für BullMQ-Worker Pflicht (sonst Fehler beim Start).
 * - Heroku Key-Value Store liefert eine rediss://-URL mit selbstsigniertem Zertifikat,
 *   deshalb muss dort rejectUnauthorized: false gesetzt werden (so in der Heroku-Doku beschrieben).
 */
function createRedisConnection(url = process.env.REDIS_URL) {
  if (!url) {
    throw new Error('REDIS_URL ist nicht gesetzt.');
  }
  const useTls = url.startsWith('rediss://');
  return new Redis(url, {
    maxRetriesPerRequest: null,
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {})
  });
}

module.exports = { QUEUE_NAME, createRedisConnection };
