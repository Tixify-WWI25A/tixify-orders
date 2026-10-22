-- Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
-- Migration 002: Warenkorb-, Bestell- und Ticket-Tabellen aus "public" in das Schema "orders" verschieben
--
-- VORAUSSETZUNG: Migration 001 aus tixify-catalog ist bereits gelaufen (Events liegen in catalog.events).
-- VORHER (Owner der Heroku-App):
--   heroku pg:backups:capture -a tixify
-- AUSFÜHREN:
--   heroku pg:psql -a tixify < db/migrations/002_move_orders_tables.sql
--
-- Läuft komplett in einer Transaktion: Schlägt ein Schritt fehl, bleibt alles wie vorher.

BEGIN;

CREATE SCHEMA IF NOT EXISTS orders;

ALTER TABLE public.carts      SET SCHEMA orders;
ALTER TABLE public.cart_items SET SCHEMA orders;
ALTER TABLE public.orders     SET SCHEMA orders;
ALTER TABLE public.tickets    SET SCHEMA orders;

-- 1. Fremdschlüssel über Service-Grenzen entfernen (auf catalog.events und public.users).
--    Fremdschlüssel INNERHALB von orders (cart_items → carts, tickets → orders) bleiben.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname, rel.relname
      FROM pg_constraint con
      JOIN pg_class rel  ON rel.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid = rel.relnamespace
      JOIN pg_class ref  ON ref.oid = con.confrelid
      JOIN pg_namespace rns ON rns.oid = ref.relnamespace
     WHERE con.contype = 'f' AND ns.nspname = 'orders' AND rns.nspname <> 'orders'
  LOOP
    EXECUTE format('ALTER TABLE orders.%I DROP CONSTRAINT %I', c.relname, c.conname);
  END LOOP;
END $$;

-- 2. Neue Spalten
ALTER TABLE orders.orders  ADD COLUMN IF NOT EXISTS order_ref      UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE orders.orders  ADD COLUMN IF NOT EXISTS email          VARCHAR(255);
ALTER TABLE orders.orders  ADD COLUMN IF NOT EXISTS reservation_id UUID;
ALTER TABLE orders.orders  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE orders.orders  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE orders.tickets ADD COLUMN IF NOT EXISTS event_title    VARCHAR(200) NOT NULL DEFAULT '';

-- 3. Titel bestehender Tickets EINMALIG aus dem catalog übernehmen.
--    (Einzige Stelle, an der orders den catalog direkt liest – nur während dieser Migration.)
UPDATE orders.tickets t SET event_title = e.title FROM catalog.events e WHERE e.event_id = t.event_id;

-- 4. Status vereinheitlichen (altes Backend schrieb 'completed')
UPDATE orders.orders SET status = upper(status);
ALTER TABLE orders.orders ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE orders.orders ADD CONSTRAINT orders_status_valid CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'));

-- 5. Regeln in der Datenbank absichern
--    Mehrere Warenkörbe pro Nutzer (konnte im alten Backend bei gleichzeitigen Klicks entstehen)
--    auf den ältesten zusammenführen
UPDATE orders.cart_items ci SET cart_id = k.keep_id
  FROM orders.carts c, (SELECT user_id, min(cart_id) AS keep_id FROM orders.carts GROUP BY user_id) k
 WHERE ci.cart_id = c.cart_id AND c.user_id = k.user_id AND c.cart_id <> k.keep_id;
DELETE FROM orders.carts c
 USING (SELECT user_id, min(cart_id) AS keep_id FROM orders.carts GROUP BY user_id) k
 WHERE c.user_id = k.user_id AND c.cart_id <> k.keep_id;
ALTER TABLE orders.carts ADD CONSTRAINT carts_user_unique UNIQUE (user_id);

--    Doppelte Warenkorb-Positionen (gleiches Event zweimal) zusammenführen
WITH dupes AS (
  SELECT cart_id, event_id, sum(quantity) AS qty, min(cart_item_id) AS keep_id
    FROM orders.cart_items GROUP BY cart_id, event_id HAVING count(*) > 1
)
UPDATE orders.cart_items ci SET quantity = d.qty FROM dupes d WHERE ci.cart_item_id = d.keep_id;
DELETE FROM orders.cart_items ci
 USING (SELECT cart_id, event_id, min(cart_item_id) AS keep_id FROM orders.cart_items GROUP BY cart_id, event_id) k
 WHERE ci.cart_id = k.cart_id AND ci.event_id = k.event_id AND ci.cart_item_id <> k.keep_id;
DELETE FROM orders.cart_items WHERE quantity < 1;
UPDATE orders.cart_items SET quantity = 100 WHERE quantity > 100;

ALTER TABLE orders.cart_items ADD CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 1 AND 100);
ALTER TABLE orders.cart_items ADD CONSTRAINT cart_items_unique_event UNIQUE (cart_id, event_id);
ALTER TABLE orders.orders     ADD CONSTRAINT orders_order_ref_unique UNIQUE (order_ref);
ALTER TABLE orders.tickets    ADD CONSTRAINT tickets_code_unique UNIQUE (ticket_code);
CREATE INDEX IF NOT EXISTS orders_by_user ON orders.orders (user_id, created_at DESC);

COMMIT;
