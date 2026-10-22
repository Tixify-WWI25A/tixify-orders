const { UnrecoverableError } = require('bullmq');
const QRCode = require('qrcode');
const { buildWelcomeMail } = require('./templates/welcome');
const { buildOrderConfirmationMail } = require('./templates/orderConfirmation');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ungültige Payloads werden mit UnrecoverableError abgelehnt: Ein kaputter Auftrag wird
 * auch beim fünften Versuch nicht besser, also kein Retry, sondern direkt in "failed".
 * Netzwerk-/SMTP-Fehler dagegen sind normale Errors und werden von BullMQ wiederholt.
 */
function invalid(message) {
  throw new UnrecoverableError(`Ungültiger Auftrag: ${message}`);
}

async function handleUserRegistered(data, { transporter, from }) {
  if (!data || !EMAIL_PATTERN.test(data.email || '')) invalid('email fehlt oder ist ungültig');
  if (!data.username) invalid('username fehlt');

  const mail = buildWelcomeMail(data);
  await transporter.sendMail({ from, ...mail });
  return { sentTo: data.email };
}

async function handleOrderCompleted(data, { transporter, from }) {
  if (!data || !EMAIL_PATTERN.test(data.email || '')) invalid('email fehlt oder ist ungültig');
  if (!Number.isInteger(Number(data.orderId))) invalid('orderId fehlt');
  if (!Array.isArray(data.items) || data.items.length === 0) invalid('items fehlen');
  if (!Array.isArray(data.tickets) || data.tickets.length === 0) invalid('tickets fehlen');

  const qrImages = await Promise.all(
    data.tickets.map((t) => QRCode.toBuffer(t.code, { width: 300, margin: 1 }))
  );

  const mail = buildOrderConfirmationMail(data, qrImages);
  await transporter.sendMail({ from, ...mail });
  return { sentTo: data.email, tickets: data.tickets.length };
}

/** Zuordnung Event-Name -> Handler. Neue Benachrichtigungen werden nur hier ergänzt. */
const handlers = {
  'user.registered': handleUserRegistered,
  'order.completed': handleOrderCompleted
};

async function processJob(job, deps) {
  const handler = handlers[job.name];
  if (!handler) {
    throw new UnrecoverableError(`Unbekannter Event-Typ: ${job.name}`);
  }
  return handler(job.data, deps);
}

module.exports = { processJob, handlers };
