//Mit KI erstellt und vom Team geprüft (KI-Log Nr. 7):
const orders = require('../repositories/orderRepository');
const cart = require('../repositories/cartRepository');
const catalog = require('../clients/catalogClient');
const paypal = require('../clients/paypalClient');
const { publishEvent } = require('../events/eventBus');
const { HttpError } = require('../http/errors');

/**
 * Controller (GRASP) für den Checkout – Use-Case 1, Schritte 4 bis 8.
 *
 *   POST /api/orders              1. Tickets beim catalog reservieren   (kein Bestand → 409, VOR der Zahlung)
 *                                 2. PayPal-Order über den catalog-Betrag anlegen
 *   POST /api/orders/:id/capture  3. Zahlung einziehen und Betrag prüfen
 *                                 4. Reservierung beim catalog bestätigen
 *                                 5. Tickets erzeugen, Warenkorb leeren   (eine Transaktion)
 *                                 6. order.completed in die Queue        (Mail, asynchron)
 *   POST /api/orders/:id/cancel   Reservierung freigeben
 *
 * Grundsatz: Geld wird nur behalten, wenn die Tickets sicher sind. Geht nach dem Abbuchen
 * etwas schief (Reservierung abgelaufen, Betrag falsch), wird automatisch zurückerstattet.
 */

const toCents = (n) => Math.round(Number(n) * 100);

function parseOrderId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bestell-ID muss eine positive ganze Zahl sein.');
  return id;
}

/** Freigeben, ohne dass ein Fehler dabei den eigentlichen Fehler überdeckt */
async function releaseQuietly(reservationId) {
  if (!reservationId) return;
  try {
    await catalog.release(reservationId);
  } catch (err) {
    // Nicht schlimm: Der catalog gibt die Reservierung spätestens nach 15 Minuten selbst frei
    console.error(`[orders] Freigabe von Reservierung ${reservationId} fehlgeschlagen:`, err.message);
  }
}

/** POST /api/orders – Bestellung aus dem Warenkorb anlegen, Tickets reservieren, PayPal vorbereiten */
async function createOrder(req, res) {
  const { userId, email } = req.user;
  const items = (await cart.getItems(userId)).map((r) => ({ eventId: r.event_id, quantity: r.quantity }));
  if (items.length === 0) throw new HttpError(400, 'Der Warenkorb ist leer.');

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

/** Gemeinsamer Ablauf für POST /api/orders/:id/capture und den alten Pfad /capture-paypal-order */
async function captureFor(order, req, res) {
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
  const refundAndFail = async (status, message) => {
    const refunded = await paypal.refundCapture(capture.captureId, { orderRef: order.orderRef });
    await releaseQuietly(order.reservationId);
    await orders.setStatusIfPending(order.orderId, 'FAILED');
    throw new HttpError(status, refunded
      ? `${message} Der Betrag wurde zurückerstattet.`
      : `${message} Bitte kontaktiere den Support, die Rückerstattung wird manuell veranlasst.`);
  };

  if (capture.currency !== 'EUR' || toCents(capture.amount) !== toCents(order.totalAmount)) {
    console.error(`[orders] Betrag passt nicht: Bestellung ${order.orderId} ${order.totalAmount} EUR, bezahlt ${capture.amount} ${capture.currency}`);
    await refundAndFail(409, 'Der bezahlte Betrag passt nicht zur Bestellung.');
  }

  let reservation;
  try {
    reservation = await catalog.confirm(order.reservationId);
  } catch (err) {
    await refundAndFail(409, err.status === 409
      ? 'Die Reservierung ist abgelaufen, die Tickets sind nicht mehr gesichert.'
      : 'Die Tickets konnten wegen eines technischen Fehlers nicht bestätigt werden.');
  }

  const tickets = await orders.complete(order.orderId, req.user.userId, reservation.items);

  // Erst NACH dem Commit veröffentlichen: nie eine Mail für eine zurückgerollte Bestellung
  if (order.email) {
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

  return res.json({ message: 'Kauf erfolgreich abgeschlossen!', orderId: order.orderId, tickets: tickets.length });
}

/** POST /api/orders/:id/capture */
async function captureOrder(req, res) {
  const order = await orders.findForUser({ orderId: parseOrderId(req.params.id) }, req.user.userId);
  return captureFor(order, req, res);
}

/** POST /api/orders/capture-paypal-order  { paypalOrderId }  – Pfad des bisherigen Frontends */
async function captureByPaypalId(req, res) {
  const paypalOrderId = req.body?.paypalOrderId;
  if (typeof paypalOrderId !== 'string' || !paypalOrderId) throw new HttpError(400, 'PayPal Order ID fehlt.');
  const order = await orders.findForUser({ paypalOrderId }, req.user.userId);
  return captureFor(order, req, res);
}

/** POST /api/orders/:id/cancel – Kunde bricht im PayPal-Fenster ab */
async function cancelOrder(req, res) {
  const order = await orders.findForUser({ orderId: parseOrderId(req.params.id) }, req.user.userId);
  if (!order) throw new HttpError(404, 'Bestellung nicht gefunden.');
  if (order.status === 'CANCELLED') return res.json({ orderId: order.orderId, status: 'CANCELLED' });
  if (order.status !== 'PENDING') throw new HttpError(409, 'Nur offene Bestellungen können abgebrochen werden.');

  await releaseQuietly(order.reservationId);
  await orders.setStatusIfPending(order.orderId, 'CANCELLED');
  return res.json({ orderId: order.orderId, status: 'CANCELLED' });
}

/** GET /api/orders (auch /api/orders/my-bookings) – eigene Buchungen mit Tickets */
async function listOrders(req, res) {
  res.json(await orders.listForUser(req.user.userId));
}

module.exports = { createOrder, captureOrder, captureByPaypalId, cancelOrder, listOrders };
