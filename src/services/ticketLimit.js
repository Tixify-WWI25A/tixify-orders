// Mit KI erstellt nach unserer Vorgabe (KI-Log Nr. 13): Höchstmenge pro Event und Kunde.
const orders = require('../repositories/orderRepository');
const { MAX_TICKETS_PER_EVENT } = require('../config/limits');
const { HttpError } = require('../middleware/errorHandler');

/** Fehlermeldung für den Kunden, je nachdem ob er schon Tickets für das Event hat */
function limitError(eventId, alreadyBought, requested) {
  const allowed = Math.max(0, MAX_TICKETS_PER_EVENT - alreadyBought);
  const message = alreadyBought === 0
    ? `Pro Kunde sind höchstens ${MAX_TICKETS_PER_EVENT} Tickets pro Event erlaubt.`
    : `Du hast für dieses Event bereits ${alreadyBought} Tickets gekauft. Pro Kunde sind höchstens ${MAX_TICKETS_PER_EVENT} erlaubt` +
      (allowed > 0 ? `, du kannst noch ${allowed} kaufen.` : '.');
  return new HttpError(409, message, { eventId, maxPerCustomer: MAX_TICKETS_PER_EVENT, alreadyBought, requested, allowed });
}

/**
 * Prüft für jede Position: bereits gekaufte Tickets + gewünschte Menge ≤ Höchstmenge.
 * Gebraucht beim Befüllen des Warenkorbs, beim Anlegen der Bestellung und vor dem Bezahlen.
 * @param items [{ eventId, quantity }]
 */
async function assertWithinLimit(userId, items) {
  const bought = await orders.countBoughtTickets(userId, items.map((i) => i.eventId));
  for (const item of items) {
    const alreadyBought = bought.get(item.eventId) || 0;
    if (alreadyBought + item.quantity > MAX_TICKETS_PER_EVENT) {
      throw limitError(item.eventId, alreadyBought, item.quantity);
    }
  }
}

module.exports = { assertWithinLimit, limitError };
