const { HttpError } = require('../http/errorHandler');
const TIMEOUT_MS = 10000;
let cachedToken = null;

function base() {
  return process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function request(path, { method = 'GET', body, headers = {}, auth } = {}) {
  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: { Authorization: auth, ...headers },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'antwortet nicht' : 'ist nicht erreichbar';
    throw new HttpError(503, `PayPal ${reason}. Es wurde nichts abgebucht, bitte später erneut versuchen.`);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID oder PAYPAL_CLIENT_SECRET fehlt.');

  const { ok, data } = await request('/v1/oauth2/token', {
    method: 'POST',
    auth: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!ok) {
    console.error('[orders] PayPal-Anmeldung fehlgeschlagen:', data.error_description);
    throw new HttpError(502, 'Anmeldung bei PayPal fehlgeschlagen.');
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function authed(path, { method, body, requestId }) {
  return request(path, {
    method,
    auth: `Bearer ${await getAccessToken()}`,
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function createOrder({ amount, orderRef }) {
  const { ok, data } = await authed('/v2/checkout/orders', {
    method: 'POST',
    requestId: `create-${orderRef}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: orderRef,
        description: 'Tixify Tickets',
        amount: { currency_code: 'EUR', value: amount.toFixed(2) }
      }]
    }
  });
  if (!ok) {
    console.error('[orders] PayPal createOrder fehlgeschlagen:', JSON.stringify(data));
    throw new HttpError(502, 'PayPal-Zahlung konnte nicht vorbereitet werden.');
  }
  return { paypalOrderId: data.id };
}

async function captureOrder(paypalOrderId, { orderRef }) {
  const { ok, status, data } = await authed(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    requestId: `capture-${orderRef}`
  });

  if (!ok) {
    // 422 = Zahlung abgelehnt / Order nicht genehmigt 
    if (status === 422) return { status: 'DECLINED', reason: data.details?.[0]?.issue || data.name };
    console.error('[orders] PayPal capture fehlgeschlagen:', JSON.stringify(data));
    throw new HttpError(502, 'PayPal hat einen Fehler gemeldet. Es wurde nichts abgebucht.');
  }

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: data.status,
    captureId: capture?.id,
    amount: capture ? Number(capture.amount.value) : null,
    currency: capture?.amount?.currency_code
  };
}

/** Erstattet eine Zahlung vollständig zurück (z. B. wenn die Reservierung inzwischen abgelaufen ist). */
async function refundCapture(captureId, { orderRef }) {
  const { ok, data } = await authed(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    requestId: `refund-${orderRef}`,
    body: {}
  });
  if (!ok) {
    // Kann nicht automatisch behoben werden → laut loggen, damit jemand manuell erstattet
    console.error(`[orders] ACHTUNG: Rückerstattung für ${orderRef} (Capture ${captureId}) fehlgeschlagen:`, JSON.stringify(data));
    return false;
  }
  return true;
}

function resetTokenCache() {
  cachedToken = null;
}

module.exports = { createOrder, captureOrder, refundCapture, resetTokenCache };
