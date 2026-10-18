const express = require('express');
const { loggedIn } = require('../middleware/auth');

const routes = [
  ['get', '/', 'GetBookingsHandler', loggedIn],
  ['post', '/', 'CreatePaypalOrderHandler', loggedIn],
  ['post', '/:id/capture', 'CapturePaypalOrderHandler', loggedIn],
  ['post', '/:id/cancel', 'CancelOrderHandler', loggedIn]
];

const router = express.Router();

routes.forEach(([method, path, handlerName, middlewares = []]) => {
  const HandlerClass = require(`../handlers/${handlerName}`);
  const handlerInstance = new HandlerClass();
  router[method](path, ...middlewares, (req, res) => handlerInstance.execute(req, res));
});

module.exports = { routes, router };