// Basiert auf unserem config/db.js (pg-Pool mit DATABASE_URL, SSL für Heroku).
// Mit KI überarbeitet (KI-Log Nr. 7): eigenes Schema pro Service über search_path, SSL nur außerhalb von localhost (lokale Tests, CI), Testverbindung beim Start entfernt.
const { Pool } = require('pg');

/**
 * Verbindungspool zur Datenbank.
 * search_path = orders: Unqualifizierte Tabellennamen ("orders", "tickets" …) zeigen immer auf das
 * Schema dieses Service. Andere Schemata (catalog, identity) liegen bewusst NICHT im Pfad –
 * der orders-Service soll fremde Tabellen gar nicht erst finden.
 */
// Fehlt DATABASE_URL, bricht server.js schon beim Start mit einer klaren Meldung ab.
const connectionString = process.env.DATABASE_URL || '';

// Heroku Postgres erzwingt SSL mit einem Zertifikat, das Node nicht kennt; lokal (z. B. CI) ohne SSL.
const useSsl = !/localhost|127\.0\.0\.1|host=\/|@\/|%2F/.test(connectionString) && process.env.PGSSL !== 'false';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  options: '-c search_path=orders',
  max: Number(process.env.PG_POOL_MAX) || 10
});

pool.on('error', (err) => {
  console.error('[db] Unerwarteter Fehler einer Leerlauf-Verbindung:', err.message);
});

module.exports = pool;
