// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft. getReservation ergänzt mit KI (KI-Log Nr. 13).
const { HttpError } = require('../middleware/errorHandler');

/**
 * Spricht mit dem catalog-Service. Synchron per REST – bewusst nur dort, wo der Kunde
 * sofort eine Antwort braucht (Event-Daten für den Warenkorb, Reservierung vor der Zahlung).
 *
 * Interne Aufrufe tragen den gemeinsamen Schlüssel INTERNAL_API_TOKEN.
 * Jeder Aufruf hat ein Zeitlimit: Ist der catalog langsam oder weg, bekommt der Kunde
 * nach wenigen Sekunden eine verständliche Meldung statt einer hängenden Seite.
 */

const TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS) || 5000;

function baseUrl() {
  const url = process.env.CATALOG_URL;
  if (!url) throw new Error('CATALOG_URL ist nicht gesetzt.');
  return url.replace(/\/$/, '');
}

async function call(path, { method = 'GET', body, internal = false } = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(internal ? { 'X-Internal-Token': process.env.INTERNAL_API_TOKEN } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'antwortet nicht' : 'ist nicht erreichbar';
    throw new HttpError(503, `Der Eventkatalog ${reason}. Bitte später erneut versuchen.`);
  }

  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  // Fachliche Fehler des catalog an den Kunden weiterreichen (z. B. "Nicht genug Tickets")
  if ([400, 404, 409].includes(res.status)) throw new HttpError(res.status, data.error || 'Anfrage abgelehnt.', data.details);
  // Alles andere (401 = falscher interner Schlüssel, 5xx) ist ein Problem zwischen den Services
  console.error(`[orders] catalog ${method} ${path} → ${res.status}:`, data.error);
  throw new HttpError(502, 'Der Eventkatalog hat einen Fehler gemeldet.');
}

/** Öffentliche Event-Daten; null, wenn es das Event nicht (mehr) gibt */
async function getEvent(eventId) {
  try {
    return await call(`/api/events/${eventId}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

const reserve = (orderRef, items) => call('/internal/reservations', { method: 'POST', body: { orderRef, items }, internal: true });
const getReservation = (reservationId) => call(`/internal/reservations/${reservationId}`, { internal: true });
const confirm = (reservationId) => call(`/internal/reservations/${reservationId}/confirm`, { method: 'POST', internal: true });
const release = (reservationId) => call(`/internal/reservations/${reservationId}/release`, { method: 'POST', internal: true });

module.exports = { getEvent, reserve, getReservation, confirm, release };
