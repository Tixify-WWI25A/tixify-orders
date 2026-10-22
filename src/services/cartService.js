const cart = require('../repositories/cartRepository');
const catalog = require('./catalogClient');
const { HttpError } = require('../middleware/errorHandler');

async function setCartQuantity(userId, eventId, quantity) {
  if (quantity > 0) {
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
