// Basiert auf unserem routes/orderRoutes.js (Routen-Tabelle für Bestellungen).
// Mit KI überarbeitet (KI-Log Nr. 7): eigene Routen-Schleife des Teams, neue Pfade, alte Pfade bleiben für das Frontend.
const express = require('express');
const { loggedIn } = require('../middleware/auth');

/**
 * /api/orders – jede Route verlangt einen Login.
 * Die mit „alt“ markierten Pfade halten das bisherige Frontend lauffähig, bis es umgestellt ist.
 */
const routes = [
  ['get',  '/',                     'GetBookingsHandler',        loggedIn],
  ['post', '/',                     'CreatePaypalOrderHandler',  loggedIn],
  ['post', '/:id/capture',          'CapturePaypalOrderHandler', loggedIn],
  ['post', '/:id/cancel',           'CancelOrderHandler',        loggedIn],

  ['get',  '/my-bookings',          'GetBookingsHandler',        loggedIn],   // alt
  ['post', '/create-paypal-order',  'CreatePaypalOrderHandler',  loggedIn],   // alt
  ['post', '/capture-paypal-order', 'CapturePaypalOrderHandler', loggedIn]    // alt
];

const router = express.Router();

routes.forEach(([method, path, handlerName, middlewares = []]) => {
  const HandlerClass = require(`../handlers/${handlerName}`);
  const handlerInstance = new HandlerClass();
  router[method](path, ...middlewares, (req, res) => handlerInstance.execute(req, res));
});

module.exports = { routes, router };
