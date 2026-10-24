const { UnrecoverableError } = require('bullmq');
const { processJob } = require('../src/notifications/handlers');

const FROM = '"Tixify" <noreply@tixify.test>';

const orderPayload = () => ({
  orderId: 99,
  email: 'kunde@test.de',
  totalAmount: '99.98',
  items: [{ title: 'Lumen – Live', quantity: 2, unitPrice: 49.99 }],
  tickets: [
    { code: 'TIX-AAAA1111', title: 'Lumen – Live' },
    { code: 'TIX-BBBB2222', title: 'Lumen – Live' }
  ]
});

describe('notifications: Job-Verarbeitung', () => {
  let transporter;

  beforeEach(() => {
    transporter = { sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) };
  });

  const run = (name, data) => processJob({ name, data }, { transporter, from: FROM });

  describe('user.registered', () => {
    test('verschickt die Willkommensmail an den neuen Nutzer', async () => {
      await run('user.registered', { userId: 1, email: 'max@web.de', username: 'max' });

      const mail = transporter.sendMail.mock.calls[0][0];
      expect(mail.from).toBe(FROM);
      expect(mail.to).toBe('max@web.de');
      expect(mail.subject).toMatch(/Willkommen/);
      expect(mail.html).toContain('max');
    });

    test('maskiert HTML im Benutzernamen', async () => {
      await run('user.registered', { userId: 1, email: 'max@web.de', username: '<script>alert(1)</script>' });

      const { html } = transporter.sendMail.mock.calls[0][0];
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    test('ungültige E-Mail → UnrecoverableError (kein sinnloses Wiederholen)', async () => {
      await expect(run('user.registered', { userId: 1, email: 'kaputt', username: 'max' }))
        .rejects.toBeInstanceOf(UnrecoverableError);
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('order.completed', () => {
    test('verschickt Bestätigung mit einem QR-Code pro Ticket', async () => {
      await run('order.completed', orderPayload());

      const mail = transporter.sendMail.mock.calls[0][0];
      expect(mail.to).toBe('kunde@test.de');
      expect(mail.subject).toBe('Bestätigung für deine Bestellung #99');
      expect(mail.html).toContain('99,98 €');
      expect(mail.html).toContain('TIX-AAAA1111');
      expect(mail.html).toContain('TIX-BBBB2222');

      expect(mail.attachments).toHaveLength(2);
      expect(mail.attachments.map((a) => a.cid)).toEqual(['ticket-0', 'ticket-1']);
      expect(mail.html).toContain('cid:ticket-0');
      expect(mail.html).toContain('cid:ticket-1');
      // Echte PNG-Dateien (Signatur 89 50 4E 47)
      for (const a of mail.attachments) {
        expect(a.content.subarray(0, 4).toString('hex')).toBe('89504e47');
      }
    });

    test('maskiert HTML im Event-Titel', async () => {
      const payload = orderPayload();
      payload.items[0].title = '<img src=x onerror=alert(1)>';
      await run('order.completed', payload);

      const { html } = transporter.sendMail.mock.calls[0][0];
      expect(html).not.toContain('<img src=x');
    });

    test.each([
      ['ohne tickets', (p) => { delete p.tickets; }],
      ['mit leeren items', (p) => { p.items = []; }],
      ['ohne orderId', (p) => { delete p.orderId; }],
      ['ohne email', (p) => { delete p.email; }]
    ])('Payload %s → UnrecoverableError', async (_, mutate) => {
      const payload = orderPayload();
      mutate(payload);
      await expect(run('order.completed', payload)).rejects.toBeInstanceOf(UnrecoverableError);
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });

    test('SMTP-Fehler wird als normaler Fehler weitergereicht (→ BullMQ wiederholt)', async () => {
      transporter.sendMail.mockRejectedValueOnce(new Error('SMTP timeout'));

      const err = await run('order.completed', orderPayload()).catch((e) => e);
      expect(err.message).toBe('SMTP timeout');
      expect(err).not.toBeInstanceOf(UnrecoverableError);
    });
  });

  test('unbekannter Event-Typ → UnrecoverableError', async () => {
    await expect(run('ticket.scanned', {})).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
