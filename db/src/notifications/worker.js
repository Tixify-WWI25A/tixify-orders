// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const { Worker } = require('bullmq');
const nodemailer = require('nodemailer');
const { QUEUE_NAME, createRedisConnection } = require('../config/redis');
const { processJob } = require('./jobHandlers');

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
}

/**
 * Startet den Worker. Abhängigkeiten (Redis, Mailversand) werden hereingereicht,
 * damit Tests einen Fake-Transporter und eine lokale Redis-Instanz nutzen können.
 */
function startWorker({
  connection = createRedisConnection(),
  transporter = createTransporter(),
  from = `"Tixify" <${process.env.SENDER_EMAIL}>`,
  concurrency = 5
} = {}) {
  const worker = new Worker(
    QUEUE_NAME,
    (job) => processJob(job, { transporter, from }),
    { connection, concurrency }
  );

  worker.on('completed', (job) => {
    console.log(`[notifications] ${job.name} #${job.id} erledigt`);
  });
  worker.on('failed', (job, err) => {
    const attempt = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : '?';
    console.error(`[notifications] ${job?.name} #${job?.id} fehlgeschlagen (Versuch ${attempt}): ${err.message}`);
  });

  return worker;
}

module.exports = { startWorker };

// Direkt gestartet (Heroku: "worker: node src/notifications/worker.js")
if (require.main === module) {
  const connection = createRedisConnection();
  const worker = startWorker({ connection });
  console.log(`[notifications] Worker hört auf Queue "${QUEUE_NAME}"`);

  // Heroku schickt beim Neustart SIGTERM: laufende Mails noch fertig senden, dann beenden.
  const shutdown = async () => {
    console.log('[notifications] Fahre herunter …');
    await worker.close();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
