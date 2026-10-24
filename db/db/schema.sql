-- Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
-- Tixify orders-Service: vollständiges Schema
-- Baut den Datenbereich des orders-Service von Grund auf (lokal / CI).
-- Für die bestehende Heroku-Datenbank stattdessen db/migrations/002_move_orders_tables.sql ausführen.
--
-- Regel: Nur der orders-Service liest und schreibt in diesem Schema.
-- event_id und user_id sind bewusst KEINE Fremdschlüssel: Events gehören dem catalog,
-- Nutzer dem identity-Service. Ein Fremdschlüssel über Service-Grenzen würde die
-- Services wieder fest aneinander koppeln.

CREATE SCHEMA IF NOT EXISTS orders;

CREATE TABLE IF NOT EXISTS orders.carts (
  cart_id    SERIAL  PRIMARY KEY,
  user_id    INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS orders.cart_items (
  cart_item_id SERIAL  PRIMARY KEY,
  cart_id      INTEGER NOT NULL REFERENCES orders.carts (cart_id) ON DELETE CASCADE,
  event_id     INTEGER NOT NULL,
  quantity     INTEGER NOT NULL,
  CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 1 AND 100),
  CONSTRAINT cart_items_unique_event UNIQUE (cart_id, event_id)
);

CREATE TABLE IF NOT EXISTS orders.orders (
  order_id        SERIAL         PRIMARY KEY,
  order_ref       UUID           NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- Referenz für catalog und PayPal
  user_id         INTEGER        NOT NULL,
  email           VARCHAR(255),                                             -- für die Bestätigungsmail
  status          VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
  total_amount    NUMERIC(10, 2) NOT NULL,
  reservation_id  UUID,
  paypal_order_id VARCHAR(64)    UNIQUE,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_valid CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED')),
  CONSTRAINT orders_total_not_negative CHECK (total_amount >= 0)
);

CREATE INDEX IF NOT EXISTS orders_by_user ON orders.orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders.tickets (
  ticket_id   SERIAL         PRIMARY KEY,
  order_id    INTEGER        NOT NULL REFERENCES orders.orders (order_id) ON DELETE CASCADE,
  event_id    INTEGER        NOT NULL,
  event_title VARCHAR(200)   NOT NULL DEFAULT '', -- Kopie zum Kaufzeitpunkt: Buchungen brauchen den catalog nicht
  ticket_code VARCHAR(40)    NOT NULL UNIQUE,
  price       NUMERIC(10, 2) NOT NULL
);
