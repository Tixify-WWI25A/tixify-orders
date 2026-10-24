// Basiert auf unserem handlers/AddToCartHandler.js (Menge setzen oder um delta ändern).
// Mit KI überarbeitet (KI-Log Nr. 7): Bestandsprüfung über den catalog, Mengengrenzen.
const cart = require('../repositories/cartRepository');
const { setCartQuantity } = require('../services/cartService');
const { parseEventId, parseQuantity } = require('../validation/orderValidation');
const { HttpError } = require('../middleware/errorHandler');

/**
 * POST /api/cart/items  { eventId, quantity } oder { eventId, delta }  – Pfad des bisherigen Frontends.
 * quantity setzt die Menge, delta ändert sie um +/-. Neuer Weg: PUT /api/cart/items/:eventId.
 */
class AddToCartHandler {
  async execute(req, res) {
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
    await setCartQuantity(req.user.userId, eventId, quantity);
    res.json({ eventId, quantity });
  }
}

module.exports = AddToCartHandler;
