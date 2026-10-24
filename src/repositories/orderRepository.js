// Basiert auf unserem SQL aus den Order-Handlern (Abfragen auf orders und tickets).
// Mit KI überarbeitet (KI-Log Nr. 7): an einer Stelle gesammelt, Abschluss einer Bestellung in einer Transaktion.
// Erweitert mit KI (KI-Log Nr. 13): gekaufte Tickets zählen, Höchstmenge pro Event und Kunde beim Abschluss prüfen.
const crypto = require('crypto');
const pool = require('../config/db');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Bestellungen und Tickets.
 * Status: PENDING (Tickets reserviert, Zahlung offen) → COMPLETED | CANCELLED | FAILED
 */

function toOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    orderRef: row.order_ref,
    userId: row.user_id,
    email: row.email,
    status: row.status,
    totalAmount: Number(row.total_amount),
    reservationId: row.reservation_id,
    paypalOrderId: row.paypal_order_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function createPending(userId, email) {
  const { rows } = await pool.query(
    'INSERT INTO orders (user_id, email, total_amount) VALUES ($1, $2, 0) RETURNING *',
    [userId, email]
  );
  return toOrder(rows[0]);
}

async function attachPayment(orderId, { reservationId, totalAmount, paypalOrderId }) {
  await pool.query(
    `UPDATE orders SET reservation_id = $2, total_amount = $3, paypal_order_id = $4, updated_at = now()
      WHERE order_id = $1`,
    [orderId, reservationId, totalAmount, paypalOrderId]
  );
}

async function attachReservation(orderId, reservationId) {
  await pool.query('UPDATE orders SET reservation_id = $2, updated_at = now() WHERE order_id = $1', [orderId, reservationId]);
}

/** Nur Bestellungen des angemeldeten Nutzers – fremde Bestellungen sind wie „nicht vorhanden“. */
async function findForUser({ orderId, paypalOrderId }, userId) {
  const { rows } = orderId
    ? await pool.query('SELECT * FROM orders WHERE order_id = $1 AND user_id = $2', [orderId, userId])
    : await pool.query('SELECT * FROM orders WHERE paypal_order_id = $1 AND user_id = $2', [paypalOrderId, userId]);
  return toOrder(rows[0]);
}

/** Wechselt den Status nur, wenn die Bestellung noch PENDING ist (verhindert Überschreiben eines Abschlusses). */
async function setStatusIfPending(orderId, status) {
  const { rowCount } = await pool.query(
    "UPDATE orders SET status = $2, updated_at = now() WHERE order_id = $1 AND status = 'PENDING'",
    [orderId, status]
  );
  return rowCount > 0;
}

/**
 * Wie viele Tickets hat der Kunde für diese Events schon gekauft? Zählt nur abgeschlossene Bestellungen.
 * @returns Map eventId → Anzahl (Events ohne Kauf fehlen in der Map)
 */
async function countBoughtTickets(userId, eventIds, db = pool) {
  const { rows } = await db.query(
    `SELECT t.event_id, COUNT(*)::int AS bought
       FROM tickets t JOIN orders o ON o.order_id = t.order_id
      WHERE o.user_id = $1 AND o.status = 'COMPLETED' AND t.event_id = ANY($2)
      GROUP BY t.event_id`,
    [userId, eventIds]
  );
  return new Map(rows.map((r) => [r.event_id, r.bought]));
}

function newTicketCode() {
  // 12 zufällige Hex-Zeichen: nicht erratbar (anders als die fortlaufende Bestellnummer im alten QR-Code)
  return `TIX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/**
 * Schließt eine bezahlte Bestellung ab – alles in EINER Transaktion:
 * Tickets erzeugen, Status COMPLETED, gekaufte Positionen aus dem Warenkorb entfernen.
 * Höchstmenge: Wird sie überschritten, wird nichts gespeichert (409). Die Sperre pro Kunde sorgt dafür,
 * dass zwei gleichzeitige Abschlüsse desselben Kunden nacheinander zählen und nicht beide durchrutschen.
 * @param items Positionen aus der bestätigten Reservierung: [{ eventId, quantity, title, unitPrice }]
 * @param maxPerEvent Höchstmenge pro Event und Kunde (ohne Angabe keine Prüfung)
 * @returns erzeugte Tickets [{ code, eventId, title, price }]
 */
async function complete(orderId, userId, items, { maxPerEvent } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT status FROM orders WHERE order_id = $1 FOR UPDATE", [orderId]
    );
    if (rows[0]?.status !== 'PENDING') {
      throw new HttpError(409, 'Bestellung ist nicht mehr offen.');
    }

    if (maxPerEvent) {
      // Sperre bis zum Ende der Transaktion, nur für diesen Kunden
      await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);
      const bought = await countBoughtTickets(userId, items.map((i) => i.eventId), client);
      const tooMany = items.find((i) => (bought.get(i.eventId) || 0) + i.quantity > maxPerEvent);
      if (tooMany) {
        throw new HttpError(409, `Pro Kunde sind höchstens ${maxPerEvent} Tickets pro Event erlaubt.`,
          { eventId: tooMany.eventId, maxPerCustomer: maxPerEvent });
      }
    }

    const tickets = [];
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        const code = newTicketCode();
        await client.query(
          'INSERT INTO tickets (order_id, event_id, event_title, ticket_code, price) VALUES ($1, $2, $3, $4, $5)',
          [orderId, item.eventId, item.title, code, item.unitPrice]
        );
        tickets.push({ code, eventId: item.eventId, title: item.title, price: item.unitPrice });
      }
    }

    await client.query("UPDATE orders SET status = 'COMPLETED', updated_at = now() WHERE order_id = $1", [orderId]);
    await client.query(
      `DELETE FROM cart_items ci USING carts c
        WHERE ci.cart_id = c.cart_id AND c.user_id = $1 AND ci.event_id = ANY($2)`,
      [userId, items.map((i) => i.eventId)]
    );

    await client.query('COMMIT');
    return tickets;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Alle abgeschlossenen bzw. beendeten Bestellungen eines Nutzers mit ihren Tickets –
 * in EINER Abfrage (das alte Backend stellte pro Bestellung eine eigene Abfrage, „N+1“).
 */
async function listForUser(userId) {
  const { rows } = await pool.query(
    `SELECT o.order_id, o.status, o.total_amount, o.created_at,
            COALESCE(json_agg(json_build_object(
              'ticket_id', t.ticket_id, 'ticket_code', t.ticket_code, 'event_id', t.event_id,
              'title', t.event_title, 'price', t.price
            ) ORDER BY t.ticket_id) FILTER (WHERE t.ticket_id IS NOT NULL), '[]') AS tickets
       FROM orders o
       LEFT JOIN tickets t ON t.order_id = o.order_id
      WHERE o.user_id = $1 AND o.status <> 'PENDING'
      GROUP BY o.order_id
      ORDER BY o.created_at DESC, o.order_id DESC`,
    [userId]
  );
  return rows.map((r) => ({
    order_id: r.order_id,
    status: r.status,
    total_amount: Number(r.total_amount),
    created_at: r.created_at.toISOString(),
    tickets: r.tickets.map((t) => ({ ...t, price: Number(t.price) }))
  }));
}

/**
 * Offene Bestellungen, deren Reservierung abgelaufen ist, auf CANCELLED setzen.
 * (Den Bestand gibt der catalog bei Ablauf selbst zurück.)
 */
async function cancelStalePending(minutes) {
  const { rowCount } = await pool.query(
    `UPDATE orders SET status = 'CANCELLED', updated_at = now()
      WHERE status = 'PENDING' AND created_at < now() - make_interval(mins => $1)`,
    [minutes]
  );
  return rowCount;
}

module.exports = {
  createPending, attachPayment, attachReservation, findForUser, setStatusIfPending,
  countBoughtTickets, complete, listForUser, cancelStalePending
};
