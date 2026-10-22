// Basiert auf unserem handlers/GetCartHandler.js (Warenkorb mit Event-Daten).
// Mit KI überarbeitet (KI-Log Nr. 7): Event-Daten kommen vom catalog statt per JOIN, gelöschte Events werden entfernt, Summe in Cent gerechnet.
const cart = require('../repositories/cartRepository');
const catalog = require('../services/catalogClient');

/** GET /api/cart – Positionen mit aktuellen Event-Daten aus dem catalog */
class GetCartHandler {
  async execute(req, res) {
    const rows = await cart.getItems(req.user.userId);
    const events = await Promise.all(rows.map((r) => catalog.getEvent(r.event_id)));

    const items = [];
    for (const [i, row] of rows.entries()) {
      const event = events[i];
      if (!event) {
        // Event wurde inzwischen gelöscht → Position stillschweigend entfernen
        await cart.removeItem(req.user.userId, row.event_id);
        continue;
      }
      items.push({
        event_id: row.event_id,
        quantity: row.quantity,
        title: event.title,
        price: event.price,
        event_stock: event.event_stock,
        location: event.location,
        event_date: event.event_date,
        category: event.category,
        logo_url: event.logo_url
      });
    }

    const totalCents = items.reduce((sum, i) => sum + Math.round(i.price * 100) * i.quantity, 0);
    res.json({ items, totalAmount: totalCents / 100 });
  }
}

module.exports = GetCartHandler;
