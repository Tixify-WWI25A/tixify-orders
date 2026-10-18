const pool = require('../config/db');

async function getItems(userId) {
  const { rows } = await pool.query(
    `SELECT ci.event_id, ci.quantity
       FROM cart_items ci JOIN carts c ON c.cart_id = ci.cart_id
      WHERE c.user_id = $1
      ORDER BY ci.cart_item_id`,
    [userId]
  );
  return rows;
}

async function getQuantity(userId, eventId) {
  const { rows } = await pool.query(
    `SELECT ci.quantity FROM cart_items ci JOIN carts c ON c.cart_id = ci.cart_id
      WHERE c.user_id = $1 AND ci.event_id = $2`,
    [userId, eventId]
  );
  return rows[0]?.quantity ?? 0;
}

async function setQuantity(userId, eventId, quantity) {
  if (quantity === 0) {
    await removeItem(userId, eventId);
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO carts (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING cart_id`,
    [userId]
  );
  await pool.query(
    `INSERT INTO cart_items (cart_id, event_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, event_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [rows[0].cart_id, eventId, quantity]
  );
}

async function removeItem(userId, eventId) {
  const { rowCount } = await pool.query(
    `DELETE FROM cart_items ci USING carts c
      WHERE ci.cart_id = c.cart_id AND c.user_id = $1 AND ci.event_id = $2`,
    [userId, eventId]
  );
  return rowCount > 0;
}

module.exports = { getItems, getQuantity, setQuantity, removeItem };
