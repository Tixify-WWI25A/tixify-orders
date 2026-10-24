# Tixify orders-Service

**Warenkorb, Bezahlung über PayPal, Bestellungen und Tickets.** Enthält außerdem den **notifications-Worker**, der Bestätigungsmails mit QR-Codes asynchron über eine Redis-Queue verschickt.

| Repo | Aufgabe | Heroku-App |
|---|---|---|
| tixify-gateway | Eingangstür, Login, Benutzer | `tixify` |
| tixify-catalog | Events, GraphQL, Reservierungen | `tixify-catalog` |
| **tixify-orders** | **Warenkorb, PayPal, Bestellungen, Mails** | `tixify-orders` (`web` + `worker`) |

## Ein Kauf, Schritt für Schritt

| # | Wer | Was | Wenn etwas schiefgeht |
|---|---|---|---|
| 1 | Kunde → orders | `POST /api/orders` | Warenkorb leer → 400 |
| 2 | orders → catalog | Tickets reservieren (synchron) | Zu wenig Tickets → 409, **bevor** bezahlt wird |
| 3 | orders → PayPal | PayPal-Order über den **catalog-Betrag** | PayPal weg → Reservierung sofort freigeben |
| 4 | Kunde | Zahlung im PayPal-Fenster bestätigen | Abbruch → `POST /api/orders/{id}/cancel` |
| 5 | orders → PayPal | Zahlung einziehen, **Betrag prüfen** | Abgelehnt → 402; falscher Betrag → Rückerstattung |
| 6 | orders → catalog | Reservierung bestätigen | Abgelaufen → **Rückerstattung**, keine Tickets |
| 7 | orders | Tickets erzeugen, Warenkorb leeren (eine Transaktion) | – |
| 8 | orders → Queue → Worker | `order.completed` → Mail mit einem QR-Code pro Ticket | Mailserver weg → bis zu 5 Wiederholungen |

Grundsatz: **Geld wird nur behalten, wenn die Tickets sicher sind.**

## Endpunkte

Vollständig in [`docs/openapi.yaml`](docs/openapi.yaml), Queue-Vertrag in [`docs/events.md`](docs/events.md). Alle Endpunkte verlangen einen Login.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/cart` | Warenkorb mit aktuellen Event-Daten |
| PUT | `/api/cart/items/:eventId` | Menge setzen (0 = entfernen) |
| DELETE | `/api/cart/items/:eventId` | Position entfernen |
| POST | `/api/orders` | Bestellen: reservieren + PayPal vorbereiten |
| POST | `/api/orders/:id/capture` | Bezahlen und abschließen |
| POST | `/api/orders/:id/cancel` | Abbrechen |
| GET | `/api/orders` | Meine Buchungen mit Tickets |

Veraltete Pfade des bisherigen Frontends (`POST /api/cart/items`, `/api/orders/my-bookings`, `/create-paypal-order`, `/capture-paypal-order`) funktionieren weiter, bis das Frontend umgestellt ist.

## Aufbau

Gleiche Grundstruktur wie unser ursprüngliches Backend – **ein Handler pro Anwendungsfall**, Routen als Tabelle –
und in allen drei Backend-Repos gleich aufgebaut:

```
src/
  app.js                        Express-App: Routen-Dateien einhängen
  server.js                     Start (web), Aufräumen unbezahlter Bestellungen
  config/db.js                  Datenbankverbindung (Schema orders)
  config/redis.js               Redis-Verbindung für die Queue
  middleware/auth.js            checkLogin, requireAdmin, requireInternal (identisch in allen drei Repos)
  middleware/errorHandler.js    HttpError und einheitliche Fehlerantwort
  routes/cartRoutes.js          /api/cart   → GetCart-, UpdateCartItem-, AddToCart-, DeleteCartItemHandler
  routes/orderRoutes.js         /api/orders → CreatePaypalOrder-, CapturePaypalOrder-, CancelOrder-, GetBookingsHandler
  routes/*Routes.js             Routen-Tabelle + eigene Schleife (übergibt die Middlewares)
  handlers/                     ein Handler pro Anwendungsfall (Namen wie im ursprünglichen Backend)
  repositories/                 einzige Stelle mit SQL
  validation/                   Eingaberegeln
  services/catalogClient.js     Aufrufe an den catalog (Zeitlimit, interner Schlüssel)
  services/paypalClient.js      PayPal: Token-Cache, Zeitlimit, Idempotenz, Rückerstattung
  services/notificationService.js Veröffentlichen in die Queue (order.completed)
  services/cartService.js       Menge setzen mit Bestandsprüfung (von zwei Handlern genutzt)
  services/checkoutService.js   Hilfen für den Checkout (Reservierung freigeben)
  notifications/                Worker (eigener Prozess): Mails mit QR-Codes
db/schema.sql                   Schema "orders"
db/migrations/                  Umzug der bestehenden Heroku-Daten
```

Neu gegenüber dem ursprünglichen Backend:
- **`repositories/`**: SQL steht an einer Stelle statt in jedem Handler.
- **`middleware/errorHandler.js`**: Handler werfen `HttpError`, die Antwort hat immer das Format `{ error, details? }`.
- **Routen-Schleife** (in jeder `routes/*Routes.js`): übergibt die Middlewares
  wirklich (im alten `eventRoutes.js` fehlte das, Admin-Routen waren ohne Login erreichbar).
- `config/auth.js` und `config/requireAdmin.js` heißen jetzt `middleware/auth.js` (`checkLogin`, `requireAdmin`, `requireInternal`).

## Lokal starten

```bash
npm install
cp .env.example .env              # Werte eintragen; catalog muss unter CATALOG_URL laufen
psql "$DATABASE_URL" -f db/schema.sql
node --env-file=.env src/server.js                  # API
node --env-file=.env src/notifications/worker.js    # Worker (zweites Terminal)
```

## Tests

```bash
npm test     # ohne Datenbank/Redis laufen nur die Tests, die keine brauchen
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tixify_test REDIS_URL=redis://localhost:6379 npm test
```

Die Datenbank-Tests setzen das Schema `orders` der angegebenen Datenbank **komplett zurück**. Niemals mit der Produktionsdatenbank ausführen. Die CI startet bei jedem Push eigene PostgreSQL- und Redis-Instanzen.

## Deployment (Heroku)

1. Voraussetzung: tixify-catalog ist deployt und Migration 001 ist gelaufen.
2. Backup und Migration: `heroku pg:backups:capture -a tixify`, dann `heroku pg:psql -a tixify < db/migrations/002_move_orders_tables.sql`
3. Add-ons teilen:
   ```bash
   heroku addons:attach tixify::DATABASE --as DATABASE -a tixify-orders
   heroku addons:attach tixify::REDIS --as REDIS -a tixify-orders
   ```
4. Variablen setzen (siehe `.env.example`): `JWT_SECRET`, `INTERNAL_API_TOKEN`, `CATALOG_URL`, `PAYPAL_*`, `EMAIL_*`, `SENDER_EMAIL`
5. Im Heroku-Dashboard unter *Deploy* dieses GitHub-Repo verbinden, *Automatic deploys* aktivieren.
6. Beide Prozesse einschalten: `heroku ps:scale web=1 worker=1 -a tixify-orders`

## KI-Einsatz

Architektur-Grundlage und Grundstruktur (ein Handler pro Anwendungsfall, Routen als Tabelle) stammen aus unserem
ursprünglichen Backend. Die Aufteilung in drei Services, die Sicherheitskorrekturen, die Tests und die neuen Bausteine
wurden mit KI-Unterstützung (Claude) erstellt und vom Team geprüft. Jede Datei sagt im Kopfkommentar, worauf sie
basiert und was mit KI geändert oder neu erstellt wurde, und verweist auf die Nummer im KI-Log.
