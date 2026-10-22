// Basiert auf unserem handlers/CapturePaypalOrderHandler.js (Zahlung einziehen, Tickets erzeugen, Bestätigung).
// Mit KI überarbeitet (KI-Log Nr. 7): Betragsprüfung, Reservierung bestätigen, automatische Rückerstattung bei Problemen, Tickets in einer Transaktion, Mail über die Queue (F-05).
const orders = require('../repositories/orderRepository');
const catalog = require('../services/catalogClient');
const paypal = require('../services/paypalClient');
const { publishEvent } = require('../services/eventBus');
const { toCents, releaseQuietly } = require('../services/checkoutService');
const { parseOrderId } = require('../validation/orderValidation');
const { HttpError } = require('../middleware/errorHandler');

class CapturePaypalOrderHandler {
  async execute(req, res) {
    const order = await this.findOrder(req);
    if (!order) throw new HttpError(404, 'Bestellung nicht gefunden.');
    // Erneuter Aufruf nach Erfolg (z. B. Doppelklick, Netzwerk-Wiederholung): einfach Erfolg melden
    if (order.status === 'COMPLETED') return res.json({ message: 'Kauf erfolgreich abgeschlossen!', orderId: order.orderId });
    if (order.status !== 'PENDING') throw new HttpError(409, 'Diese Bestellung ist nicht mehr offen. Bitte erneut bestellen.');
    if (!order.paypalOrderId) throw new HttpError(409, 'Für diese Bestellung wurde keine Zahlung angelegt.');

    const capture = await paypal.captureOrder(order.paypalOrderId, { orderRef: order.orderRef });

    if (capture.status !== 'COMPLETED') {
      await releaseQuietly(order.reservationId);
      await orders.setStatusIfPending(order.orderId, 'FAILED');
      throw new HttpError(402, 'Die Zahlung wurde von PayPal abgelehnt. Es wurde nichts abgebucht.');
    }

    // Abgebucht. Ab hier gilt: Ist etwas nicht in Ordnung, Geld zurück.
    if (capture.currency !== 'EUR' || toCents(capture.amount) !== toCents(order.totalAmount)) {
      console.error(`[orders] Betrag passt nicht: Bestellung ${order.orderId} ${order.totalAmount} EUR, bezahlt ${capture.amount} ${capture.currency}`);
      await this.refundAndFail(order, capture, 409, 'Der bezahlte Betrag passt nicht zur Bestellung.');
    }

    let reservation;
    try {
      reservation = await catalog.confirm(order.reservationId);
    } catch (err) {
      await this.refundAndFail(order, capture, 409, err.status === 409
        ? 'Die Reservierung ist abgelaufen, die Tickets sind nicht mehr gesichert.'
        : 'Die Tickets konnten wegen eines technischen Fehlers nicht bestätigt werden.');
    }

    const tickets = await orders.complete(order.orderId, req.user.userId, reservation.items);
    await this.announce(order, reservation, tickets);

    return res.json({ message: 'Kauf erfolgreich abgeschlossen!', orderId: order.orderId, tickets: tickets.length });
  }

  /** Neuer Pfad: Bestell-ID in der URL. Alter Pfad: PayPal-Order-ID im Body. */
  async findOrder(req) {
    if (req.params.id !== undefined) {
      return orders.findForUser({ orderId: parseOrderId(req.params.id) }, req.user.userId);
    }
    const paypalOrderId = req.body?.paypalOrderId;
    if (typeof paypalOrderId !== 'string' || !paypalOrderId) throw new HttpError(400, 'PayPal Order ID fehlt.');
    return orders.findForUser({ paypalOrderId }, req.user.userId);
  }

  async refundAndFail(order, capture, status, message) {
    const refunded = await paypal.refundCapture(capture.captureId, { orderRef: order.orderRef });
    await releaseQuietly(order.reservationId);
    await orders.setStatusIfPending(order.orderId, 'FAILED');
    throw new HttpError(status, refunded
      ? `${message} Der Betrag wurde zurückerstattet.`
      : `${message} Bitte kontaktiere den Support, die Rückerstattung wird manuell veranlasst.`);
  }

  /** Erst NACH dem Commit veröffentlichen: nie eine Mail für eine zurückgerollte Bestellung */
  async announce(order, reservation, tickets) {
    if (!order.email) return;
    try {
      await publishEvent('order.completed', {
        orderId: order.orderId,
        email: order.email,
        totalAmount: order.totalAmount.toFixed(2),
        items: reservation.items.map((i) => ({ title: i.title, quantity: i.quantity, unitPrice: i.unitPrice })),
        tickets: tickets.map((t) => ({ code: t.code, title: t.title }))
      }, `order-completed-${order.orderId}`);
    } catch (err) {
      // Bestellung ist bezahlt und gespeichert – sie darf an der Mail nicht scheitern
      console.error(`[orders] order.completed für Bestellung ${order.orderId} nicht veröffentlicht:`, err.message);
    }
  }
}

module.exports = CapturePaypalOrderHandler;
