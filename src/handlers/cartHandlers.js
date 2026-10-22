const cart = require('../repositories/cartRepository');
const catalog = require('../clients/catalogClient');
const { HttpError } = require('../http/errors');

/** Controller (GRASP) für den Warenkorb. Alle Routen verlangen einen Login (req.user). */

function parseEventId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'eventId muss eine positive ganze Zahl sein.');
  return id;
}

function parseQuantity(raw, { allowZero }) {
  const q = Number(raw);
  if (!Number.isInteger(q) || q < (allowZero ? 0 : 1) || q > 100) {
    throw new HttpError(400, `quantity muss eine ganze Zahl zwischen ${allowZero ? 0 : 1} und 100 sein.`);
  }
  return q;
}

/**
 * Setzt die Menge nach einer Prüfung beim catalog. Die Prüfung ist nur ein Hinweis für den Kunden –
 * verbindlich gesichert werden die Tickets erst bei der Reservierung im Checkout.
 */
async function applyQuantity(userId, eventId, quantity) {
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

/** GET /api/cart – Positionen mit aktuellen Event-Daten aus dem catalog */
async function getCart(req, res) {
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

/** PUT /api/cart/items/:eventId  { quantity }  – setzt die Menge (0 = entfernen) */
async function putItem(req, res) {
  const eventId = parseEventId(req.params.eventId);
  const quantity = parseQuantity(req.body?.quantity, { allowZero: true });
  await applyQuantity(req.user.userId, eventId, quantity);
  res.json({ eventId, quantity });
}

/**
 * POST /api/cart/items  { eventId, quantity } oder { eventId, delta }
 * Kompatibel zum bisherigen Frontend: quantity setzt die Menge, delta ändert sie um +/-.
 */
async function postItem(req, res) {
  const eventId = parseEventId(req.body?.eventId);
  let quantity;
  if (req.body?.delta !== undefined) {
    const delta = Number(req.body.delta);
    if (!Number.isInteger(delta)) throw new HttpError(400, 'delta muss eine ganze Zahl sein.');
    quantity = Math.max(0, (await cart.getQuantity(req.user.userId, eventId)) + delta);
    parseQuantity(quantity, { allowZero: true });
  } else {
    quantity = parseQuantity(req.body?.quantity, { allowZero: false });
  }
  await applyQuantity(req.user.userId, eventId, quantity);
  res.json({ eventId, quantity });
}

/** DELETE /api/cart/items/:eventId */
async function deleteItem(req, res) {
  const removed = await cart.removeItem(req.user.userId, parseEventId(req.params.eventId));
  if (!removed) throw new HttpError(404, 'Artikel nicht im Warenkorb.');
  res.status(204).end();
}

module.exports = { getCart, putItem, postItem, deleteItem };
