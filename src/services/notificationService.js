// Mit KI erstellt nach dem Vorbild der BullMQ-Dokumentation (KI-Log Nr. 10).
// Quellen: docs.bullmq.io – Guide: Queues, Connections, Retrying failing jobs, Job Ids (abgerufen am 18.10.2026).
const { Queue } = require('bullmq');
const { createRedisConnection, QUEUE_NAME } = require('../config/redis');

/**
 * Veröffentlicht fachliche Events (z. B. order.completed) in die Queue "notifications".
 * Abgeholt und verarbeitet werden sie vom notifications-Worker (src/notifications/worker.js).
 */

let connection = null;
let queue = null;

/**
 * Queue erst beim ersten Veröffentlichen anlegen (nicht schon beim Laden der Datei).
 * Abweichung von den Doku-Beispielen, weil sonst jeder require dieser Datei – auch in Tests,
 * die gar keine Queue brauchen – sofort eine Redis-Verbindung öffnet, die nie geschlossen wird.
 */
function getQueue() {
  if (!queue) {
    // Docs „Connections“: eine Redis-Verbindung, die an die Queue übergeben wird
    connection = createRedisConnection();
    // Docs „Queues“: new Queue(name, { connection })
    // Docs „Retrying failing jobs“: attempts + backoff als Standard für jeden Auftrag
    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 }
      }
    });
  }
  return queue;
}

/**
 * Docs „Queues“: queue.add(name, data, opts)
 * Docs „Job Ids“: dieselbe jobId zweimal ergibt nur EINEN Auftrag
 */
async function publishEvent(name, data, jobId) {
  return getQueue().add(name, data, { jobId });
}

// Docs „Connections“ (Herunterfahren): erst die Queue schließen, dann die übergebene Verbindung selbst
async function closeEventBus() {
  if (!queue) return;
  await queue.close();
  await connection.quit();
  queue = null;
  connection = null;
}

module.exports = { publishEvent, closeEventBus };
