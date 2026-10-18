// Basiert auf unserem config/server.js (Express-Server starten).
// Mit KI überarbeitet (KI-Log Nr. 7): Prüfung der Umgebungsvariablen beim Start, sauberes Herunterfahren bei Neustart durch Heroku.
const REQUIRED_ENV = [
  'DATABASE_URL', 'JWT_SECRET', 'INTERNAL_API_TOKEN', 'CATALOG_URL', 'REDIS_URL',
  'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'
];
const SWEEP_INTERVAL_MS = 60 * 1000;
// Etwas länger als die Reservierung im catalog (15 Min.), damit keine Bestellung vor ihrer Reservierung endet
const STALE_PENDING_MINUTES = Number(process.env.STALE_PENDING_MINUTES) || 20;

async function main() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`[orders] Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
    process.exit(1);
  }

  const { createApp } = require('./app');
  const pool = require('./config/db');
  const { cancelStalePending } = require('./repositories/orderRepository');
  const { closeEventBus } = require('./services/eventBus');

  const app = createApp();
  const port = Number(process.env.PORT) || 3002;
  const server = app.listen(port, () => console.log(`[orders] läuft auf Port ${port}`));

  // Nicht bezahlte Bestellungen aufräumen (die Reservierung hat der catalog dann schon freigegeben)
  const sweeper = setInterval(async () => {
    try {
      const n = await cancelStalePending(STALE_PENDING_MINUTES);
      if (n > 0) console.log(`[orders] ${n} unbezahlte Bestellung(en) abgebrochen`);
    } catch (err) {
      console.error('[orders] Aufräumen offener Bestellungen fehlgeschlagen:', err.message);
    }
  }, SWEEP_INTERVAL_MS);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('[orders] Fahre herunter …');
    clearInterval(sweeper);
    server.close(async () => {
      await closeEventBus();
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[orders] Start fehlgeschlagen:', err);
  process.exit(1);
});
