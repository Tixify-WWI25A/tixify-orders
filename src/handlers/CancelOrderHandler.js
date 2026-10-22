const orders = require('../repositories/orderRepository');
const { releaseQuietly } = require('../services/checkoutService');
const { parseOrderId } = require('../validation/orderValidation');
const { HttpError } = require('../middleware/errorHandler');

class CancelOrderHandler {
  async execute(req, res) {
    const order = await orders.findForUser({ orderId: parseOrderId(req.params.id) }, req.user.userId);
    if (!order) throw new HttpError(404, 'Bestellung nicht gefunden.');
    if (order.status === 'CANCELLED') return res.json({ orderId: order.orderId, status: 'CANCELLED' });
    if (order.status !== 'PENDING') throw new HttpError(409, 'Nur offene Bestellungen können abgebrochen werden.');

    await releaseQuietly(order.reservationId);
    await orders.setStatusIfPending(order.orderId, 'CANCELLED');
    return res.json({ orderId: order.orderId, status: 'CANCELLED' });
  }
}

module.exports = CancelOrderHandler;
