// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.

/** Tests der Anbindungen an catalog und PayPal – mit nachgebautem fetch, ohne Netzwerk. */

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('catalogClient', () => {
  const catalog = require('../src/services/catalogClient');
  afterEach(() => jest.restoreAllMocks());

  test('interne Aufrufe tragen den Service-Schlüssel, öffentliche nicht', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(json(201, { reservationId: 'r' }));
    await catalog.reserve('ref-1', [{ eventId: 1, quantity: 2 }]);
    await catalog.getEvent(1);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://catalog.test/internal/reservations');
    expect(options.headers['X-Internal-Token']).toBe('test-internal-token');
    expect(JSON.parse(options.body)).toEqual({ orderRef: 'ref-1', items: [{ eventId: 1, quantity: 2 }] });
    expect(fetch.mock.calls[1][1].headers['X-Internal-Token']).toBeUndefined();
  });

  test('409 „Nicht genug Tickets“ wird mit Details an den Kunden weitergereicht', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(409, { error: 'Nicht genug Tickets', details: { available: 1 } }));
    await expect(catalog.reserve('r', [])).rejects.toMatchObject({ status: 409, message: 'Nicht genug Tickets', details: { available: 1 } });
  });

  test('getEvent: unbekanntes Event → null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json(404, { error: 'Event nicht gefunden.' }));
    expect(await catalog.getEvent(99)).toBeNull();
  });

  test('falscher interner Schlüssel (401) wird NICHT als Login-Problem an den Kunden gemeldet → 502', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockResolvedValue(json(401, { error: 'Interner Zugriff verweigert.' }));
    await expect(catalog.confirm('x')).rejects.toMatchObject({ status: 502 });
  });

  test('catalog antwortet nicht → 503', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(catalog.getEvent(1)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/antwortet nicht/) });
  });
});

describe('paypalClient', () => {
  let paypal;
  let fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = 'secret';
    paypal = require('../src/services/paypalClient');
    fetch = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  const token = json(200, { access_token: 'TOKEN', expires_in: 32400 });

  test('Access-Token wird zwischengespeichert: zwei Aufrufe, nur EINE Anmeldung', async () => {
    fetch.mockResolvedValueOnce(token)
      .mockResolvedValueOnce(json(201, { id: 'P1' }))
      .mockResolvedValueOnce(json(201, { id: 'P2' }));

    await paypal.createOrder({ amount: 10, orderRef: 'a' });
    await paypal.createOrder({ amount: 20, orderRef: 'b' });

    const tokenCalls = fetch.mock.calls.filter(([url]) => url.endsWith('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  test('createOrder: Betrag mit 2 Nachkommastellen in EUR, PayPal-Request-Id für Idempotenz', async () => {
    fetch.mockResolvedValueOnce(token).mockResolvedValueOnce(json(201, { id: 'P1' }));
    expect(await paypal.createOrder({ amount: 99.9, orderRef: 'ref-9' })).toEqual({ paypalOrderId: 'P1' });

    const [url, options] = fetch.mock.calls[1];
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(options.headers['PayPal-Request-Id']).toBe('create-ref-9');
    expect(JSON.parse(options.body).purchase_units[0]).toMatchObject({
      custom_id: 'ref-9', amount: { currency_code: 'EUR', value: '99.90' }
    });
  });

  test('captureOrder liefert Status, Betrag und Capture-ID', async () => {
    fetch.mockResolvedValueOnce(token).mockResolvedValueOnce(json(201, {
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-7', amount: { value: '99.98', currency_code: 'EUR' } }] } }]
    }));
    expect(await paypal.captureOrder('P1', { orderRef: 'r' }))
      .toEqual({ status: 'COMPLETED', captureId: 'CAP-7', amount: 99.98, currency: 'EUR' });
  });

  test('abgelehnte Zahlung (422) ist eine fachliche Ablehnung, kein Absturz', async () => {
    fetch.mockResolvedValueOnce(token).mockResolvedValueOnce(json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }));
    expect(await paypal.captureOrder('P1', { orderRef: 'r' })).toEqual({ status: 'DECLINED', reason: 'INSTRUMENT_DECLINED' });
  });

  test('PayPal nicht erreichbar → 503 mit dem Hinweis, dass nichts abgebucht wurde', async () => {
    fetch.mockResolvedValueOnce(token).mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(paypal.captureOrder('P1', { orderRef: 'r' })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/nichts abgebucht/) });
  });

  test('fehlgeschlagene Rückerstattung → false und lauter Log statt Absturz', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    fetch.mockResolvedValueOnce(token).mockResolvedValueOnce(json(500, {}));
    expect(await paypal.refundCapture('CAP-1', { orderRef: 'r' })).toBe(false);
    expect(log.mock.calls[0][0]).toMatch(/ACHTUNG/);
  });

  test('falsche Zugangsdaten → 502', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fetch.mockResolvedValueOnce(json(401, { error_description: 'Client Authentication failed' }));
    await expect(paypal.createOrder({ amount: 1, orderRef: 'r' })).rejects.toMatchObject({ status: 502 });
  });
});
