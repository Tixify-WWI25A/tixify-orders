# Event-Vertrag der Queue `notifications`

Diese Datei liegt im Repo **tixify-orders**, weil hier der Konsument (notifications-Worker) lebt.
Sie ist der verbindliche Vertrag zwischen den Services, die Events **veröffentlichen**
(identity, orders) und dem Service, der sie **verarbeitet** (notifications).
Sie wird vor einer Änderung am Code angepasst (API-first).

- **Transport:** Redis, Bibliothek BullMQ, Queue-Name `notifications`
- **Zustellung:** at-least-once. Fehlgeschlagene Jobs werden bis zu 5-mal mit exponentiellem
  Backoff (5 s, 10 s, 20 s, …) wiederholt.
- **Idempotenz:** Jedes Event hat eine eindeutige `jobId`. Wird dasselbe Event doppelt
  veröffentlicht, legt BullMQ keinen zweiten Job an.
- **Ungültige Payloads** werden ohne Wiederholung als `failed` markiert.

---

## `user.registered`

Veröffentlicht von: **identity** im Repo tixify-gateway (nach erfolgreicher Registrierung)
Wirkung: Willkommensmail

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `userId` | number | ja | ID des neuen Nutzers |
| `email` | string | ja | Empfängeradresse |
| `username` | string | ja | Anzeigename in der Mail |

`jobId`: `user-registered-<userId>`

```json
{ "userId": 12, "email": "max@example.com", "username": "max_mustermann" }
```

---

## `order.completed`

Veröffentlicht von: **orders** (nach erfolgreichem PayPal-Capture, bestätigter Reservierung und COMMIT)
Wirkung: Bestellbestätigung mit einem QR-Code pro Ticket

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `orderId` | number | ja | Bestellnummer |
| `email` | string | ja | Empfängeradresse |
| `totalAmount` | string | ja | Gesamtbetrag, zwei Nachkommastellen (`"199.98"`) |
| `items` | array | ja | Positionen: `{ title, quantity, unitPrice }` |
| `tickets` | array | ja | Einzeltickets: `{ code, title }` – `code` wird als QR-Code kodiert |

`jobId`: `order-completed-<orderId>`

```json
{
  "orderId": 99,
  "email": "kunde@example.com",
  "totalAmount": "99.98",
  "items": [{ "title": "Lumen – Live", "quantity": 2, "unitPrice": 49.99 }],
  "tickets": [
    { "code": "TIX-1A2B3C4D5E6F", "title": "Lumen – Live" },
    { "code": "TIX-5E6F7A8B9C0D", "title": "Lumen – Live" }
  ]
}
```
