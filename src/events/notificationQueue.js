// Quelle: docs.bullmq.io – Guide: Queues, Connections, Retrying failing jobs, Job Ids (abgerufen am 18.10.2026).
const { Queue } = require('bullmq');
const { createRedisConnection, QUEUE_NAME } = require('../config/redis');

let connection = null;
let queue = null;

function getQueue() {
  if (!queue) {
    connection = createRedisConnection();
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

async function publishEvent(name, data, jobId) {
  return getQueue().add(name, data, { jobId });
}

async function closeEventBus() {
  if (!queue) return;
  await queue.close();
  await connection.quit();
  queue = null;
  connection = null;
}

module.exports = { publishEvent, closeEventBus };