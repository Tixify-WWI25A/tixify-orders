// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
const request = require('supertest');
const { describeWithDb, resetSchema, bearer, token } = require('./helpers/testDb');

// Andere Services und PayPal werden ersetzt – getestet wird die Logik von orders gegen eine echte Datenbank.
jest.mock('../src/services/catalogClient');
jest.mock('../src/services/paypalClient');
jest.mock('../src/services/notificationService');

const catalog = require('../src/services/catalogClient');
const paypal = require('../src/services/paypalClient');
const { publishEvent } = require('../src/services/notificationService');
const { HttpError } = require('../src/middleware/errorHandler');

describeWithDb('orders-Service: Warenkorb und Checkout (Use-Case 1)', () => {
  let app;
  let pool;
  // Alle Routen mit vollem Pfad, z. B. ['post', '/api/orders/:id/capture', 'CapturePaypalOrderHandler', [...]]
  const routes = require('../src/app').mounted
    .flatMap(([base, file]) => file.routes.map(([m, p, ...rest]) => [m, p === '/' ? base : base + p, ...rest]));

  const EVENTS = {
    1: { event_id: 1, title: 'Lumen Live', price: 49.99, event_stock: 10, location: 'Stuttgart', event_date: '2026-11-14T19:00:00.000Z', category: 'Konzerte', logo_url: null },
    2: { event_id: 2, title: 'Stand-up', price: 20, event_stock: 0, location: 'Karlsruhe', event_date: '2026-11-28T20:00:00.000Z', category: 'Comedy', logo_url: null },
    3: { event_id: 3, title: 'Restkarten', price: 30, event_stock: 3, location: 'Mannheim', event_date: '2026-12-05T19:00:00.000Z', category: 'Theater', logo_url: null }
  };
  const RES_ID = '11111111-2222-3333-4444-555555555555';
  const reservation = (status = 'RESERVED') => ({
    reservationId: RES_ID, status, expiresAt: '2026-11-01T12:15:00.000Z', totalAmount: 99.98,
    items: [{ eventId: 1, quantity: 2, title: 'Lumen Live', unitPrice: 49.99 }]
  });

  beforeAll(async () => {
    pool = require('../src/config/db');
    await resetSchema(pool);
    app = require('../src/app').createApp();
  });

  afterAll(() => pool.end());

  beforeEach(async () => {
    await pool.query('TRUNCATE orders.tickets, orders.orders, orders.cart_items, orders.carts RESTART IDENTITY CASCADE');
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    catalog.getEvent.mockImplementation(async (id) => EVENTS[id] || null);
    catalog.reserve.mockResolvedValue(reservation());
    catalog.getReservation.mockResolvedValue(reservation());
    catalog.confirm.mockResolvedValue(reservation('CONFIRMED'));
    catalog.release.mockResolvedValue(reservation('RELEASED'));
    let paypalCounter = 0;
    paypal.createOrder.mockImplementation(async () => ({ paypalOrderId: `PAYPAL-${++paypalCounter}` }));
    paypal.captureOrder.mockResolvedValue({ status: 'COMPLETED', captureId: 'CAP-1', amount: 99.98, currency: 'EUR' });
    paypal.refundCapture.mockResolvedValue(true);
    publishEvent.mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  const as = (userId) => (req) => req.set('Authorization', bearer(userId));
  const addToCart = (userId, eventId, quantity) =>
    as(userId)(request(app).put(`/api/cart/items/${eventId}`)).send({ quantity });
  const createOrder = (userId) => as(userId)(request(app).post('/api/orders'));
  const capture = (userId, orderId) => as(userId)(request(app).post(`/api/orders/${orderId}/capture`));
  const orderRow = async (id) => (await pool.query('SELECT status FROM orders.orders WHERE order_id = $1', [id])).rows[0];
  const ticketCount = async () => (await pool.query('SELECT count(*)::int AS n FROM orders.tickets')).rows[0].n;

  describe('Absicherung', () => {
    test.each(routes.map(([m, p]) => [m.toUpperCase(), p, m]))('%s %s ohne Token → 401', async (_, path, method) => {
      const res = await request(app)[method](path.replace(/:\w+/, '1')).send({});
      expect(res.status).toBe(401);
    });

    test('abgelaufenes Token → 401', async () => {
      const res = await request(app).get('/api/cart').set('Authorization', `Bearer ${token(1, 'customer', { expiresIn: -5 })}`);
      expect(res.status).toBe(401);
    });

    test('fremde Bestellung ist „nicht vorhanden“ (404), nicht nur verboten', async () => {
      await addToCart(1, 1, 2);
      const { orderId } = (await createOrder(1)).body;
      expect((await capture(2, orderId)).status).toBe(404);
      expect(paypal.captureOrder).not.toHaveBeenCalled();
    });
  });

  describe('Warenkorb', () => {
    test('Menge setzen, mit aktuellen Daten aus dem catalog anzeigen, ändern, entfernen', async () => {
      expect((await addToCart(1, 1, 2)).status).toBe(200);
      const cart = await as(1)(request(app).get('/api/cart'));
      expect(cart.body).toEqual({
        items: [expect.objectContaining({ event_id: 1, quantity: 2, title: 'Lumen Live', price: 49.99, event_stock: 10 })],
        totalAmount: 99.98
      });

      await addToCart(1, 1, 3);
      expect((await as(1)(request(app).get('/api/cart'))).body.items[0].quantity).toBe(3);

      expect((await as(1)(request(app).delete('/api/cart/items/1'))).status).toBe(204);
      expect((await as(1)(request(app).get('/api/cart'))).body.items).toEqual([]);
    });

    test('alter Pfad POST /api/cart/items mit delta (+1 / -1 bis 0) funktioniert weiter', async () => {
      const post = (body) => as(1)(request(app).post('/api/cart/items')).send(body);
      await post({ eventId: 1, quantity: 1 });
      await post({ eventId: 1, delta: 1 });
      expect((await as(1)(request(app).get('/api/cart'))).body.items[0].quantity).toBe(2);
      await post({ eventId: 1, delta: -2 });
      expect((await as(1)(request(app).get('/api/cart'))).body.items).toEqual([]);
    });

    test.each([
      ['mehr als vorhanden', 3, 4, 409],
      ['ausverkauftes Event', 2, 1, 409],
      ['unbekanntes Event', 99, 1, 404],
      ['negative Menge', 1, -1, 400],
      ['Menge 6 (über der Höchstmenge)', 1, 6, 400],
      ['Kommazahl', 1, 1.5, 400]
    ])('%s → %i', async (_, eventId, quantity, status) => {
      expect((await addToCart(1, eventId, quantity)).status).toBe(status);
    });

    test('Warenkörbe verschiedener Nutzer sind getrennt', async () => {
      await addToCart(1, 1, 2);
      expect((await as(2)(request(app).get('/api/cart'))).body.items).toEqual([]);
    });

    test('catalog nicht erreichbar → 503 mit verständlicher Meldung', async () => {
      catalog.getEvent.mockRejectedValue(new HttpError(503, 'Der Eventkatalog ist nicht erreichbar.'));
      const res = await addToCart(1, 1, 1);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Eventkatalog/);
    });
  });

  describe('Bestellung anlegen', () => {
    test('reserviert beim catalog und legt PayPal-Order über den catalog-Betrag an', async () => {
      await addToCart(1, 1, 2);
      const res = await createOrder(1);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ orderId: 1, paypalOrderId: 'PAYPAL-1', totalAmount: 99.98 });
      expect(catalog.reserve).toHaveBeenCalledWith(expect.any(String), [{ eventId: 1, quantity: 2 }]);
      const orderRef = catalog.reserve.mock.calls[0][0];
      expect(paypal.createOrder).toHaveBeenCalledWith({ amount: 99.98, orderRef });
      expect(await orderRow(1)).toEqual({ status: 'PENDING' });
    });

    test('leerer Warenkorb → 400, nichts reserviert', async () => {
      expect((await createOrder(1)).status).toBe(400);
      expect(catalog.reserve).not.toHaveBeenCalled();
    });

    test('nicht genug Tickets → 409 VOR der Zahlung, PayPal wird gar nicht aufgerufen', async () => {
      await addToCart(1, 1, 2);
      catalog.reserve.mockRejectedValue(new HttpError(409, 'Nicht genug Tickets für „Lumen Live“.', { available: 1 }));

      const res = await createOrder(1);
      expect(res.status).toBe(409);
      expect(res.body.details).toEqual({ available: 1 });
      expect(paypal.createOrder).not.toHaveBeenCalled();
      expect(await orderRow(1)).toEqual({ status: 'FAILED' });
    });

    test('PayPal nicht erreichbar → Reservierung wird sofort freigegeben', async () => {
      await addToCart(1, 1, 2);
      paypal.createOrder.mockRejectedValue(new HttpError(503, 'PayPal ist nicht erreichbar.'));

      expect((await createOrder(1)).status).toBe(503);
      expect(catalog.release).toHaveBeenCalledWith(RES_ID);
      expect(await orderRow(1)).toEqual({ status: 'FAILED' });
    });
  });

  describe('Bezahlen (Capture)', () => {
    beforeEach(async () => {
      await addToCart(1, 1, 2);
      await createOrder(1);
    });

    test('Standardablauf: Tickets, Warenkorb leer, Event order.completed nach dem Speichern', async () => {
      const res = await capture(1, 1);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ orderId: 1, tickets: 2 });
      expect(catalog.confirm).toHaveBeenCalledWith(RES_ID);
      expect(await orderRow(1)).toEqual({ status: 'COMPLETED' });
      expect((await as(1)(request(app).get('/api/cart'))).body.items).toEqual([]);

      const codes = (await pool.query('SELECT ticket_code, event_title, price FROM orders.tickets ORDER BY ticket_id')).rows;
      expect(codes).toHaveLength(2);
      expect(codes[0]).toMatchObject({ event_title: 'Lumen Live', price: '49.99' });
      expect(codes[0].ticket_code).toMatch(/^TIX-[0-9A-F]{12}$/);

      expect(publishEvent).toHaveBeenCalledWith('order.completed', {
        orderId: 1,
        email: 'kunde1@tixify.test',
        totalAmount: '99.98',
        items: [{ title: 'Lumen Live', quantity: 2, unitPrice: 49.99 }],
        tickets: codes.map((c) => ({ code: c.ticket_code, title: 'Lumen Live' }))
      }, 'order-completed-1');
    });

    test('zweiter Capture-Aufruf (Doppelklick) bucht nicht erneut ab und erzeugt keine weiteren Tickets', async () => {
      await capture(1, 1);
      const again = await capture(1, 1);
      expect(again.status).toBe(200);
      expect(paypal.captureOrder).toHaveBeenCalledTimes(1);
      expect(await ticketCount()).toBe(2);
    });

    test('alter Pfad /capture-paypal-order mit paypalOrderId funktioniert weiter', async () => {
      const res = await as(1)(request(app).post('/api/orders/capture-paypal-order')).send({ paypalOrderId: 'PAYPAL-1' });
      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe(1);
    });

    test('PayPal lehnt ab → 402, Reservierung freigegeben, keine Tickets', async () => {
      paypal.captureOrder.mockResolvedValue({ status: 'DECLINED' });
      expect((await capture(1, 1)).status).toBe(402);
      expect(catalog.release).toHaveBeenCalledWith(RES_ID);
      expect(await orderRow(1)).toEqual({ status: 'FAILED' });
      expect(await ticketCount()).toBe(0);
    });

    test('bezahlter Betrag passt nicht → Rückerstattung, keine Tickets', async () => {
      paypal.captureOrder.mockResolvedValue({ status: 'COMPLETED', captureId: 'CAP-1', amount: 1.0, currency: 'EUR' });
      const res = await capture(1, 1);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/zurückerstattet/);
      expect(paypal.refundCapture).toHaveBeenCalledWith('CAP-1', expect.any(Object));
      expect(catalog.confirm).not.toHaveBeenCalled();
      expect(await ticketCount()).toBe(0);
    });

    test('Reservierung inzwischen abgelaufen → Geld zurück statt Tickets ohne Deckung', async () => {
      catalog.confirm.mockRejectedValue(new HttpError(409, 'Reservierung ist abgelaufen.'));
      const res = await capture(1, 1);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/abgelaufen.*zurückerstattet/);
      expect(paypal.refundCapture).toHaveBeenCalled();
      expect(await orderRow(1)).toEqual({ status: 'FAILED' });
      expect(await ticketCount()).toBe(0);
    });

    test('Rückerstattung schlägt fehl → Kunde bekommt Support-Hinweis', async () => {
      catalog.confirm.mockRejectedValue(new HttpError(409, 'abgelaufen'));
      paypal.refundCapture.mockResolvedValue(false);
      expect((await capture(1, 1)).body.error).toMatch(/Support/);
    });

    test('Queue nicht erreichbar → Kauf gelingt trotzdem', async () => {
      publishEvent.mockRejectedValue(new Error('Redis weg'));
      expect((await capture(1, 1)).status).toBe(200);
      expect(await orderRow(1)).toEqual({ status: 'COMPLETED' });
    });

    test('abgebrochene Bestellung kann nicht mehr bezahlt werden', async () => {
      expect((await as(1)(request(app).post('/api/orders/1/cancel'))).body.status).toBe('CANCELLED');
      expect(catalog.release).toHaveBeenCalledWith(RES_ID);
      expect((await capture(1, 1)).status).toBe(409);
      expect(paypal.captureOrder).not.toHaveBeenCalled();
    });
  });

  describe('Meine Buchungen', () => {
    test('liefert abgeschlossene Bestellungen mit Tickets, keine offenen, keine fremden', async () => {
      await addToCart(1, 1, 2);
      await createOrder(1);
      await capture(1, 1);
      await createOrder(1); // zweite, offene Bestellung (Warenkorb leer → 400, also keine)
      await addToCart(2, 1, 1);
      await createOrder(2);

      const res = await as(1)(request(app).get('/api/orders'));
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ order_id: 1, status: 'COMPLETED', total_amount: 99.98 });
      expect(res.body[0].tickets).toHaveLength(2);
      expect(res.body[0].tickets[0]).toMatchObject({ title: 'Lumen Live', price: 49.99 });

      const legacy = await as(1)(request(app).get('/api/orders/my-bookings'));
      expect(legacy.body).toEqual(res.body);
    });
  });

  describe('Aufräumen', () => {
    test('unbezahlte Bestellungen werden nach Ablauf abgebrochen, bezahlte nicht', async () => {
      const { cancelStalePending } = require('../src/repositories/orderRepository');
      await addToCart(1, 1, 2);
      await createOrder(1);
      await createOrder(1);
      await capture(1, 2);
      await pool.query("UPDATE orders.orders SET created_at = now() - interval '30 minutes'");

      expect(await cancelStalePending(20)).toBe(1);
      expect(await orderRow(1)).toEqual({ status: 'CANCELLED' });
      expect(await orderRow(2)).toEqual({ status: 'COMPLETED' });
    });
  });
});
