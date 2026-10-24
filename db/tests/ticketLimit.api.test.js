// Mit KI erstellt nach unserer Vorgabe (KI-Log Nr. 13), vom Team geprüft: Höchstmenge 5 Tickets pro Event und Kunde.
const request = require('supertest');
const { describeWithDb, resetSchema, bearer } = require('./helpers/testDb');

jest.mock('../src/services/catalogClient');
jest.mock('../src/services/paypalClient');
jest.mock('../src/services/notificationService');

const catalog = require('../src/services/catalogClient');
const paypal = require('../src/services/paypalClient');
const { publishEvent } = require('../src/services/notificationService');

describeWithDb('orders-Service: höchstens 5 Tickets pro Event und Kunde', () => {
  let app;
  let pool;

  const EVENT = { event_id: 1, title: 'Lumen Live', price: 10, event_stock: 100, location: 'Stuttgart', event_date: '2026-11-14T19:00:00.000Z', category: 'Konzerte', logo_url: null };
  const RES_ID = '11111111-2222-3333-4444-555555555555';
  const reservation = (quantity, status = 'RESERVED') => ({
    reservationId: RES_ID, status, expiresAt: '2026-11-01T12:15:00.000Z', totalAmount: quantity * 10,
    items: [{ eventId: 1, quantity, title: 'Lumen Live', unitPrice: 10 }]
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
    catalog.getEvent.mockResolvedValue(EVENT);
    catalog.release.mockResolvedValue(reservation(0, 'RELEASED'));
    let n = 0;
    paypal.createOrder.mockImplementation(async () => ({ paypalOrderId: `PAYPAL-${++n}` }));
    paypal.refundCapture.mockResolvedValue(true);
    publishEvent.mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  const as = (userId) => (req) => req.set('Authorization', bearer(userId));
  const setCart = (userId, quantity) => as(userId)(request(app).put('/api/cart/items/1')).send({ quantity });
  const createOrder = (userId) => as(userId)(request(app).post('/api/orders'));
  const capture = (userId, orderId) => as(userId)(request(app).post(`/api/orders/${orderId}/capture`));
  const status = async (id) => (await pool.query('SELECT status FROM orders.orders WHERE order_id = $1', [id])).rows[0].status;
  const tickets = async () => (await pool.query('SELECT count(*)::int AS n FROM orders.tickets')).rows[0].n;

  /** Kompletter Kauf von `quantity` Tickets für Event 1 */
  async function buy(userId, quantity) {
    await setCart(userId, quantity);
    catalog.reserve.mockResolvedValueOnce(reservation(quantity));
    const { orderId } = (await createOrder(userId)).body;
    catalog.getReservation.mockResolvedValueOnce(reservation(quantity));
    catalog.confirm.mockResolvedValueOnce(reservation(quantity, 'CONFIRMED'));
    paypal.captureOrder.mockResolvedValueOnce({ status: 'COMPLETED', captureId: `CAP-${orderId}`, amount: quantity * 10, currency: 'EUR' });
    expect((await capture(userId, orderId)).status).toBe(200);
  }

  test('genau 5 Tickets gehen, 6 im Warenkorb nicht', async () => {
    expect((await setCart(1, 5)).status).toBe(200);
    expect((await setCart(1, 6)).status).toBe(400);
  });

  test('bereits gekaufte Tickets zählen mit: nach 3 gekauften sind nur noch 2 möglich', async () => {
    await buy(1, 3);

    const tooMany = await setCart(1, 3);
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toMatch(/bereits 3 Tickets gekauft.*noch 2/);

    expect((await setCart(1, 2)).status).toBe(200);
  });

  test('nach 5 gekauften Tickets kein weiteres, andere Kunden sind nicht betroffen', async () => {
    await buy(1, 5);
    expect((await setCart(1, 1)).status).toBe(409);
    expect((await setCart(2, 5)).status).toBe(200);
  });

  test('zwei offene Bestellungen: die zweite scheitert VOR dem Abbuchen', async () => {
    // Beide Bestellungen entstehen, solange noch nichts gekauft ist
    await setCart(1, 3);
    catalog.reserve.mockResolvedValue(reservation(3));
    const first = (await createOrder(1)).body.orderId;
    const second = (await createOrder(1)).body.orderId;

    catalog.getReservation.mockResolvedValue(reservation(3));
    catalog.confirm.mockResolvedValue(reservation(3, 'CONFIRMED'));
    paypal.captureOrder.mockResolvedValue({ status: 'COMPLETED', captureId: 'CAP-1', amount: 30, currency: 'EUR' });
    expect((await capture(1, first)).status).toBe(200);

    const res = await capture(1, second);
    expect(res.status).toBe(409);
    expect(paypal.captureOrder).toHaveBeenCalledTimes(1); // für die zweite wurde nichts abgebucht
    expect(catalog.release).toHaveBeenCalledWith(RES_ID);
    expect(await status(second)).toBe('FAILED');
    expect(await tickets()).toBe(3);
  });

  test('Grenze erst beim Abschluss überschritten: nichts gespeichert, Geld zurück', async () => {
    await buy(1, 4);
    await setCart(1, 1);
    catalog.reserve.mockResolvedValueOnce(reservation(1));
    const { orderId } = (await createOrder(1)).body;

    // Vor dem Abbuchen sah es noch gut aus (4 + 1), bestätigt werden aber 2 Tickets
    catalog.getReservation.mockResolvedValueOnce(reservation(1));
    catalog.confirm.mockResolvedValueOnce(reservation(2, 'CONFIRMED'));
    paypal.captureOrder.mockResolvedValueOnce({ status: 'COMPLETED', captureId: 'CAP-X', amount: 10, currency: 'EUR' });

    const res = await capture(1, orderId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/höchstens 5.*zurückerstattet/);
    expect(paypal.refundCapture).toHaveBeenCalledWith('CAP-X', expect.anything());
    expect(await status(orderId)).toBe('FAILED');
    expect(await tickets()).toBe(4);
  });
});
