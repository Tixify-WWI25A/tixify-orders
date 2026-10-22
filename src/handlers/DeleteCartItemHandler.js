const cart = require('../repositories/cartRepository');
const { parseEventId } = require('../validation/orderValidation');
const { HttpError } = require('../middleware/errorHandler');

class DeleteCartItemHandler {
  async execute(req, res) {
    const removed = await cart.removeItem(req.user.userId, parseEventId(req.params.eventId));
    if (!removed) throw new HttpError(404, 'Artikel nicht im Warenkorb.');
    res.status(204).end();
  }
}

module.exports = DeleteCartItemHandler;
