// Basiert auf unserem handlers/CapturePaypalOrderHandler.js (Zahlung einziehen, Tickets erzeugen, Bestätigung).
// Mit KI überarbeitet (KI-Log Nr. 7): Betragsprüfung, Reservierung bestätigen, automatische Rückerstattung bei Problemen, Tickets in einer Transaktion, Mail über die Queue (F-05).
// Erweitert mit KI (KI-Log Nr. 13): Höchstmenge pro Event und Kunde vor dem Abbuchen und beim Abschluss.
const orders = require('../repositories/orderRepository');
const catalog = require('../services/catalogClient');
const paypal = require('../services/paypalClient');
const { publishEvent } = require('../services/notificationService');
const { assertWithinLimit } = require('../services/ticketLimit');
const { MAX_TICKETS_PER_EVENT } = require('../config/limits');
const { toCents, releaseQuietly } = require('../services/checkoutService');
const { parseOrderId } = require('../validation/orderValidation');
const { HttpError } = require('../middleware/errorHandler');

/**
 * POST /api/orders/:id/capture  bzw. alter Pfad  POST /api/orders/capture-paypal-order { paypalOrderId }
 * Use-Case 1, Schritt 6–8:
 *   0. Höchstmenge prüfen, solange noch nichts abgebucht ist
 *   1. Zahlung einziehen und Betrag prüfen
 *   2. Reservierung beim catalog bestätigen
 *   3. Tickets erzeugen, Warenkorb leeren   (eine Transaktion)
 *   4. order.completed in die Queue        (Mail, asynchron)
 *
 * Grundsatz: Geld wird nur behalten, wenn die Tickets sicher sind. Geht nach dem Abbuchen
 * etwas schief (Reservierung abgelaufen, Betrag falsch), wird automatisch zurückerstattet.
 */
class CapturePaypalOrderHandler {
  async execute(req, res) {
    const order = await this.findOrder(req);
    if (!order) throw new HttpError(404, 'Bestellung nicht gefunden.');
    // Erneuter Aufruf nach Erfolg (z. B. Doppelklick, Netzwerk-Wiederholung): einfach Erfolg melden
    if (order.status === 'COMPLETED') return res.json({ message: 'Kauf erfolgreich abgeschlossen!', orderId: order.orderId });
    if (order.status !== 'PENDING') throw new HttpError(409, 'Diese Bestellung ist nicht mehr offen. Bitte erneut bestellen.');
    if (!order.paypalOrderId) throw new HttpError(409, 'Für diese Bestellung wurde keine Zahlung angelegt.');

    // Zwei offene Bestellungen desselben Kunden für dasselbe Event: Die zweite scheitert hier, bevor Geld fließt
    try {
      const reserved = await catalog.getReservation(order.reservationId);
      await assertWithinLimit(req.user.userId, reserved.items);
    } catch (err) {
      await releaseQuietly(order.reservationId);
      await orders.setStatusIfPending(order.orderId, 'FAILED');
      throw err;
    }

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

    let tickets;
    try {
      tickets = await orders.complete(order.orderId, req.user.userId, reservation.items, { maxPerEvent: MAX_TICKETS_PER_EVENT });
    } catch (err) {
      // Sehr selten: zwei Zahlungen desselben Kunden gleichzeitig. Geld zurück, nichts gespeichert.
      await this.refundAndFail(order, capture, 409, err.status === 409
        ? err.message
        : 'Die Tickets konnten wegen eines technischen Fehlers nicht gespeichert werden.');
    }
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
