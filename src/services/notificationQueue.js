// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const { Queue } = require('bullmq');
const { createRedisConnection, QUEUE_NAME } = require('../config/redis');

/**
 * Veröffentlicht fachliche Events in die Queue "notifications" (Vertrag: docs/events.md).
 * Der Handler wartet nur, bis Redis den Auftrag angenommen hat (wenige ms), nicht auf den Mailversand.
 */

// Ist Redis weg, würde BullMQ endlos warten – der Kunde hinge dann im Checkout fest.
const PUBLISH_TIMEOUT_MS = Number(process.env.EVENT_PUBLISH_TIMEOUT_MS) || 2000;

let queue = null;
let connection = null;

function getQueue() {
  if (!queue) {
    connection = createRedisConnection();
    let lastError = null;
    connection.on('error', (err) => {
      if (err.message !== lastError) console.error('[orders] Redis-Fehler:', err.message);
      lastError = err.message;
    });
    connection.on('ready', () => { lastError = null; });

    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000
      }
    });
  }
  return queue;
}

/** @param jobId eindeutige ID – dasselbe Event zweimal veröffentlicht ergibt nur EINEN Auftrag */
async function publishEvent(name, data, jobId) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Queue nicht erreichbar (Timeout nach ${PUBLISH_TIMEOUT_MS} ms)`)), PUBLISH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([getQueue().add(name, data, { jobId }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeEventBus() {
  if (queue) {
    await queue.close();
    await connection.quit(); // BullMQ schließt übergebene Verbindungen nicht selbst
    queue = null;
    connection = null;
  }
}

module.exports = { publishEvent, closeEventBus };
