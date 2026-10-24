// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { describeWithDb } = require('./helpers/testDb');

/**
 * Prüft Migration 002 an einer Nachbildung der Heroku-Datenbank, wie sie nach Migration 001
 * aussieht: Events schon in catalog, Warenkorb/Bestellungen/Tickets noch in public,
 * mit Fremdschlüsseln auf users und events – und mit Altlasten (doppelte Warenkörbe, 'completed').
 */
describeWithDb('Migration 002: Bestelltabellen von public nach orders', () => {
  let pool;
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/002_move_orders_tables.sql'), 'utf8');

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DROP SCHEMA IF EXISTS orders CASCADE; DROP SCHEMA IF EXISTS catalog CASCADE');
    await pool.query('DROP TABLE IF EXISTS public.tickets, public.orders, public.cart_items, public.carts, public.users CASCADE');
    await pool.query(`
      CREATE SCHEMA catalog;
      CREATE TABLE catalog.events (event_id SERIAL PRIMARY KEY, title VARCHAR(200));
      INSERT INTO catalog.events (title) VALUES ('Rock am Ring'), ('Stand-up');

      CREATE TABLE public.users (user_id SERIAL PRIMARY KEY, email VARCHAR(255));
      INSERT INTO public.users (email) VALUES ('a@test.de'), ('b@test.de');

      CREATE TABLE public.carts (cart_id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES public.users(user_id));
      CREATE TABLE public.cart_items (cart_item_id SERIAL PRIMARY KEY, cart_id INTEGER REFERENCES public.carts(cart_id),
        event_id INTEGER REFERENCES catalog.events(event_id), quantity INTEGER);
      CREATE TABLE public.orders (order_id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES public.users(user_id),
        total_amount NUMERIC(10,2), status VARCHAR(20), paypal_order_id VARCHAR(64), created_at TIMESTAMP DEFAULT now());
      CREATE TABLE public.tickets (ticket_id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES public.orders(order_id),
        event_id INTEGER REFERENCES catalog.events(event_id), ticket_code VARCHAR(50), price NUMERIC(10,2));

      -- Altlasten: Nutzer 1 hat zwei Warenkörbe, Event 1 steht doppelt drin
      INSERT INTO public.carts (user_id) VALUES (1), (1), (2);
      INSERT INTO public.cart_items (cart_id, event_id, quantity) VALUES (1, 1, 2), (2, 1, 3), (2, 2, 1), (3, 2, 1);
      INSERT INTO public.orders (user_id, total_amount, status, paypal_order_id) VALUES (1, 399.98, 'completed', 'PAY-1');
      INSERT INTO public.tickets (order_id, event_id, ticket_code, price) VALUES (1, 1, 'TIX-AAAA', 199.99), (1, 1, 'TIX-BBBB', 199.99);
    `);
    await pool.query(migration);
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS orders CASCADE; DROP SCHEMA IF EXISTS catalog CASCADE');
    await pool.query('DROP TABLE IF EXISTS public.users');
    await pool.end();
  });

  test('Tabellen liegen in orders, nicht mehr in public', async () => {
    const { rows } = await pool.query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN ('carts','cart_items','orders','tickets') ORDER BY 2"
    );
    expect(rows.every((r) => r.table_schema === 'orders')).toBe(true);
    expect(rows).toHaveLength(4);
  });

  test('keine Fremdschlüssel mehr über Service-Grenzen, interne bleiben', async () => {
    const { rows } = await pool.query(`
      SELECT rel.relname AS tbl, rns.nspname AS ref_schema
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        JOIN pg_class ref ON ref.oid = con.confrelid JOIN pg_namespace rns ON rns.oid = ref.relnamespace
       WHERE con.contype = 'f' AND ns.nspname = 'orders' ORDER BY 1`);
    expect(rows).toEqual([{ tbl: 'cart_items', ref_schema: 'orders' }, { tbl: 'tickets', ref_schema: 'orders' }]);
  });

  test('bestehende Bestellung: Status vereinheitlicht, Tickets mit Event-Titel', async () => {
    expect((await pool.query('SELECT status FROM orders.orders')).rows).toEqual([{ status: 'COMPLETED' }]);
    expect((await pool.query('SELECT event_title FROM orders.tickets ORDER BY ticket_id')).rows)
      .toEqual([{ event_title: 'Rock am Ring' }, { event_title: 'Rock am Ring' }]);
  });

  test('doppelte Warenkörbe und Positionen zusammengeführt, ohne Mengen zu verlieren', async () => {
    const { rows } = await pool.query(`
      SELECT c.user_id, ci.event_id, ci.quantity FROM orders.cart_items ci JOIN orders.carts c USING (cart_id)
       ORDER BY 1, 2`);
    expect(rows).toEqual([
      { user_id: 1, event_id: 1, quantity: 5 },
      { user_id: 1, event_id: 2, quantity: 1 },
      { user_id: 2, event_id: 2, quantity: 1 }
    ]);
  });

  test('neue Regeln greifen: zweiter Warenkorb pro Nutzer und Menge 0 werden abgewiesen', async () => {
    await expect(pool.query('INSERT INTO orders.carts (user_id) VALUES (1)')).rejects.toThrow(/carts_user_unique/);
    await expect(pool.query('UPDATE orders.cart_items SET quantity = 0')).rejects.toThrow(/cart_items_quantity_range/);
  });

  test('neue Bestellung bekommt automatisch eine order_ref', async () => {
    const { rows } = await pool.query("INSERT INTO orders.orders (user_id, total_amount) VALUES (2, 10) RETURNING order_ref, status");
    expect(rows[0].order_ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].status).toBe('PENDING');
  });
});
