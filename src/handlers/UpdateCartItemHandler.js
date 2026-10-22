const { setCartQuantity } = require('../services/cartService');
const { parseEventId, parseQuantity } = require('../validation/orderValidation');

class UpdateCartItemHandler {
  async execute(req, res) {
    const eventId = parseEventId(req.params.eventId);
    const quantity = parseQuantity(req.body?.quantity, { allowZero: true });
    await setCartQuantity(req.user.userId, eventId, quantity);
    res.json({ eventId, quantity });
  }
}

module.exports = UpdateCartItemHandler;
