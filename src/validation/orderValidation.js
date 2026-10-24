// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft. Höchstmenge ergänzt mit KI (KI-Log Nr. 13).
const { HttpError } = require('../middleware/errorHandler');
const { MAX_TICKETS_PER_EVENT } = require('../config/limits');

/** Eingabeprüfungen für Warenkorb und Bestellungen – von mehreren Handlern gebraucht. */

function parseEventId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'eventId muss eine positive ganze Zahl sein.');
  return id;
}

function parseQuantity(raw, { allowZero }) {
  const q = Number(raw);
  if (!Number.isInteger(q) || q < (allowZero ? 0 : 1) || q > MAX_TICKETS_PER_EVENT) {
    throw new HttpError(400, `quantity muss eine ganze Zahl zwischen ${allowZero ? 0 : 1} und ${MAX_TICKETS_PER_EVENT} sein.`);
  }
  return q;
}

function parseOrderId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bestell-ID muss eine positive ganze Zahl sein.');
  return id;
}

module.exports = { parseEventId, parseQuantity, parseOrderId };
