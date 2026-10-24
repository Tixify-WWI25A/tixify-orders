// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft. Höchstmenge pro Kunde ergänzt mit KI (KI-Log Nr. 13).
const cart = require('../repositories/cartRepository');
const catalog = require('./catalogClient');
const { assertWithinLimit } = require('./ticketLimit');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Setzt die Menge einer Warenkorb-Position nach einer Prüfung beim catalog.
 * Gebraucht von AddToCartHandler (alter Pfad) und UpdateCartItemHandler.
 * Die Prüfung ist nur ein Hinweis für den Kunden – verbindlich gesichert werden die Tickets
 * erst bei der Reservierung im Checkout.
 */
async function setCartQuantity(userId, eventId, quantity) {
  if (quantity > 0) {
    // Zuerst die Höchstmenge: bereits gekaufte Tickets zählen mit
    await assertWithinLimit(userId, [{ eventId, quantity }]);
    const event = await catalog.getEvent(eventId);
    if (!event) throw new HttpError(404, `Event ${eventId} existiert nicht.`);
    if (quantity > event.event_stock) {
      throw new HttpError(409, event.event_stock === 0
        ? `„${event.title}“ ist ausverkauft.`
        : `Für „${event.title}“ sind nur noch ${event.event_stock} Tickets verfügbar.`,
      { eventId, requested: quantity, available: event.event_stock });
    }
  }
  await cart.setQuantity(userId, eventId, quantity);
}

module.exports = { setCartQuantity };
