// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const catalog = require('./catalogClient');

/** Kleine Hilfen für den Checkout, gebraucht von mehreren Handlern. */

const toCents = (n) => Math.round(Number(n) * 100);

/** Reservierung freigeben, ohne dass ein Fehler dabei den eigentlichen Fehler überdeckt */
async function releaseQuietly(reservationId) {
  if (!reservationId) return;
  try {
    await catalog.release(reservationId);
  } catch (err) {
    // Nicht schlimm: Der catalog gibt die Reservierung spätestens nach 15 Minuten selbst frei
    console.error(`[orders] Freigabe von Reservierung ${reservationId} fehlgeschlagen:`, err.message);
  }
}

module.exports = { toCents, releaseQuietly };
