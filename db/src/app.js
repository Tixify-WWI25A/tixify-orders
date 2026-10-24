// Basiert auf unserem app.js / config/server.js (Express-App, Routen mit app.use('/api/…') einhängen).
// Mit KI überarbeitet (KI-Log Nr. 7): nur noch Warenkorb und Bestellungen.
const express = require('express');
const helmet = require('helmet');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');

/**
 * Alle Routen-Dateien und wo sie eingehängt werden – wie im ursprünglichen Backend (app.use('/api/…')).
 * Wird auch von den Tests genutzt, die JEDE Route auf den Login prüfen.
 */
const mounted = [
  ['/api/cart',   cartRoutes],
  ['/api/orders', orderRoutes]
];

/** Baut die Express-App ohne sie zu starten – so können Tests sie direkt mit supertest aufrufen. */
function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'orders' }));
  for (const [path, routeFile] of mounted) app.use(path, routeFile.router);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, mounted };
