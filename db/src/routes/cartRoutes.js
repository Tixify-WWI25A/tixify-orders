// Basiert auf unserem routes/cartRoutes.js (Routen-Tabelle für den Warenkorb).
// Mit KI überarbeitet (KI-Log Nr. 7): eigene Routen-Schleife des Teams, neue PUT-Route, alter Pfad bleibt.
const express = require('express');
const { loggedIn } = require('../middleware/auth');

/** /api/cart – jede Route verlangt einen Login */
const routes = [
  ['get',    '/',               'GetCartHandler',        loggedIn],
  ['put',    '/items/:eventId', 'UpdateCartItemHandler', loggedIn],
  ['post',   '/items',          'AddToCartHandler',      loggedIn],   // alt: quantity oder delta
  ['delete', '/items/:eventId', 'DeleteCartItemHandler', loggedIn]
];

const router = express.Router();

routes.forEach(([method, path, handlerName, middlewares = []]) => {
  const HandlerClass = require(`../handlers/${handlerName}`);
  const handlerInstance = new HandlerClass();
  router[method](path, ...middlewares, (req, res) => handlerInstance.execute(req, res));
});

module.exports = { routes, router };
