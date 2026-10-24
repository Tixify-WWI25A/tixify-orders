// Basiert auf unserem handlers/GetBookingsHandler.js (eigene Buchungen mit Tickets).
// Mit KI überarbeitet (KI-Log Nr. 7): eine Abfrage für Bestellungen samt Tickets, SQL ins Repository.
const orders = require('../repositories/orderRepository');

/** GET /api/orders (auch /api/orders/my-bookings) – eigene Buchungen mit Tickets */
class GetBookingsHandler {
  async execute(req, res) {
    res.json(await orders.listForUser(req.user.userId));
  }
}

module.exports = GetBookingsHandler;
