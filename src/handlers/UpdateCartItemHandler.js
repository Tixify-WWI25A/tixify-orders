// Mit KI erstellt nach unserem Handler-Muster (KI-Log Nr. 7): Menge per PUT setzen.
const { setCartQuantity } = require('../services/cartService');
const { parseEventId, parseQuantity } = require('../validation/orderValidation');

/** PUT /api/cart/items/:eventId  { quantity }  – setzt die Menge (0 = entfernen) */
class UpdateCartItemHandler {
  async execute(req, res) {
    const eventId = parseEventId(req.params.eventId);
    const quantity = parseQuantity(req.body?.quantity, { allowZero: true });
    await setCartQuantity(req.user.userId, eventId, quantity);
    res.json({ eventId, quantity });
  }
}

module.exports = UpdateCartItemHandler;
