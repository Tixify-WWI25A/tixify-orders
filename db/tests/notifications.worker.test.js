// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
/**
 * Integrationstest mit einer ECHTEN Redis-Instanz.
 * Lokal: `redis-server` starten und `REDIS_URL=redis://localhost:6379 npm test`.
 * Ohne REDIS_URL wird der Test übersprungen (z. B. auf Rechnern ohne Redis).
 */
const { Queue } = require('bullmq');
const { createRedisConnection } = require('../src/config/redis');
const { startWorker } = require('../src/notifications/worker');

const REDIS_URL = process.env.REDIS_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('notifications-Worker mit echtem Redis', () => {
  const QUEUE = 'notifications';
  let queue;
  let worker;
  let transporter;
  let connections;

  // BullMQ schließt von außen übergebene Verbindungen nicht selbst
  const connect = () => {
    const c = createRedisConnection(REDIS_URL);
    connections.push(c);
    return c;
  };

  beforeEach(async () => {
    connections = [];
    transporter = { sendMail: jest.fn().mockResolvedValue({}) };
    queue = new Queue(QUEUE, { connection: connect() });
    await queue.obliterate({ force: true });
    worker = startWorker({
      connection: connect(),
      transporter,
      from: 'test@tixify.test'
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all(connections.map((c) => c.quit()));
    jest.restoreAllMocks();
  });

  const waitFor = (event, predicate = () => true) =>
    new Promise((resolve) => {
      worker.on(event, (job, arg) => { if (predicate(job, arg)) resolve(job); });
    });

  test('Event aus der Queue wird verarbeitet und die Mail verschickt', async () => {
    const done = waitFor('completed');
    await queue.add('user.registered', { userId: 1, email: 'a@b.de', username: 'anna' }, { jobId: 'user-registered-1' });

    const job = await done;
    expect(job.returnvalue).toEqual({ sentTo: 'a@b.de' });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });

  test('SMTP fällt aus → Job wird automatisch wiederholt und gelingt beim 3. Versuch', async () => {
    transporter.sendMail
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValueOnce({});

    const done = waitFor('completed');
    await queue.add(
      'user.registered',
      { userId: 2, email: 'a@b.de', username: 'anna' },
      { jobId: 'user-registered-2', attempts: 5, backoff: { type: 'fixed', delay: 50 } }
    );

    const job = await done;
    expect(job.attemptsMade).toBe(3);
    expect(transporter.sendMail).toHaveBeenCalledTimes(3);
  });

  test('Ungültiger Auftrag wird NICHT wiederholt', async () => {
    const failed = waitFor('failed');
    await queue.add(
      'user.registered',
      { userId: 3, email: 'kaputt', username: 'anna' },
      { jobId: 'user-registered-3', attempts: 5, backoff: { type: 'fixed', delay: 50 } }
    );

    const job = await failed;
    expect(job.attemptsMade).toBe(1);
    expect(await job.getState()).toBe('failed');
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  test('Gleiche jobId zweimal veröffentlicht → nur EINE Mail (Idempotenz)', async () => {
    const done = waitFor('completed');
    const payload = { userId: 4, email: 'a@b.de', username: 'anna' };
    await queue.add('user.registered', payload, { jobId: 'user-registered-4' });
    await queue.add('user.registered', payload, { jobId: 'user-registered-4' });

    await done;
    await new Promise((r) => setTimeout(r, 300));
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });
});
