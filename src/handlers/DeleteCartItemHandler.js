// Basiert auf unserem handlers/DeleteCartItemHandler.js (Position entfernen).
// Mit KI überarbeitet (KI-Log Nr. 7): SQL ins Repository, 404 wenn nicht im Warenkorb.
const cart = require('../repositories/cartRepository');
const { parseEventId } = require('../validation/orderValidation');
const { HttpError } = require('../middleware/errorHandler');

/** DELETE /api/cart/items/:eventId */
class DeleteCartItemHandler {
  async execute(req, res) {
    const removed = await cart.removeItem(req.user.userId, parseEventId(req.params.eventId));
    if (!removed) throw new HttpError(404, 'Artikel nicht im Warenkorb.');
    res.status(204).end();
  }
}

module.exports = DeleteCartItemHandler;
