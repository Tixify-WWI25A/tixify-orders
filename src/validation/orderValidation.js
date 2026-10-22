const { HttpError } = require('../middleware/errorHandler');

function parseEventId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'eventId muss eine positive ganze Zahl sein.');
  return id;
}

function parseQuantity(raw, { allowZero }) {
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < (allowZero ? 0 : 1) || quantity > 100) {
    throw new HttpError(400, `quantity muss eine ganze Zahl zwischen ${allowZero ? 0 : 1} und 100 sein.`);
  }
  return quantity;
}

function parseOrderId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bestell-ID muss eine positive ganze Zahl sein.');
  return id;
}

module.exports = { parseEventId, parseQuantity, parseOrderId };
