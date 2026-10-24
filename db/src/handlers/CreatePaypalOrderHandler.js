// Basiert auf unserem handlers/CreatePaypalOrderHandler.js (PayPal-Order aus dem Warenkorb anlegen).
// Mit KI überarbeitet (KI-Log Nr. 7): Tickets werden VOR der Zahlung beim catalog reserviert (F-05), Betrag kommt vom catalog statt aus dem Browser, Freigabe bei Fehlern.
// Erweitert mit KI (KI-Log Nr. 13): Höchstmenge pro Event und Kunde vor der Reservierung.
const orders = require('../repositories/orderRepository');
const cart = require('../repositories/cartRepository');
const catalog = require('../services/catalogClient');
const paypal = require('../services/paypalClient');
const { releaseQuietly } = require('../services/checkoutService');
const { assertWithinLimit } = require('../services/ticketLimit');
const { HttpError } = require('../middleware/errorHandler');

/**
 * POST /api/orders (auch alter Pfad /api/orders/create-paypal-order) – Use-Case 1, Schritt 4–5:
 *   0. Höchstmenge pro Event und Kunde prüfen (409, inkl. bereits gekaufter Tickets)
 *   1. Tickets beim catalog reservieren   (kein Bestand → 409, VOR der Zahlung)
 *   2. PayPal-Order über den catalog-Betrag anlegen
 * Früher wurde erst nach der Zahlung geprüft, ob genug Tickets da sind (Fehler F-05).
 */
class CreatePaypalOrderHandler {
  async execute(req, res) {
    const { userId, email } = req.user;
    const items = (await cart.getItems(userId)).map((r) => ({ eventId: r.event_id, quantity: r.quantity }));
    if (items.length === 0) throw new HttpError(400, 'Der Warenkorb ist leer.');
    await assertWithinLimit(userId, items);

    const order = await orders.createPending(userId, email);

    let reservation;
    try {
      // Synchroner Aufruf (begründete Ausnahme): Ohne sofortige Zusage keine Zahlung
      reservation = await catalog.reserve(order.orderRef, items);
    } catch (err) {
      await orders.setStatusIfPending(order.orderId, 'FAILED');
      throw err; // z. B. 409 „Nicht genug Tickets“ mit verfügbarer Menge
    }
    await orders.attachReservation(order.orderId, reservation.reservationId);

    let payment;
    try {
      // Der Betrag kommt aus dem catalog (aktuelle Preise), nicht aus dem Browser
      payment = await paypal.createOrder({ amount: reservation.totalAmount, orderRef: order.orderRef });
    } catch (err) {
      await releaseQuietly(reservation.reservationId);
      await orders.setStatusIfPending(order.orderId, 'FAILED');
      throw err;
    }

    await orders.attachPayment(order.orderId, {
      reservationId: reservation.reservationId,
      totalAmount: reservation.totalAmount,
      paypalOrderId: payment.paypalOrderId
    });

    res.status(201).location(`/api/orders/${order.orderId}`).json({
      orderId: order.orderId,
      paypalOrderId: payment.paypalOrderId,
      totalAmount: reservation.totalAmount,
      expiresAt: reservation.expiresAt,
      items: reservation.items
    });
  }
}

module.exports = CreatePaypalOrderHandler;
