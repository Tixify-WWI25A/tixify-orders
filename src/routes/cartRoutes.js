const express = require('express');
const { loggedIn } = require('../middleware/auth');

const routes = [
  ['get', '/', 'GetCartHandler', loggedIn],
  ['put', '/items/:eventId', 'UpdateCartItemHandler', loggedIn],
  ['post', '/items', 'AddToCartHandler', loggedIn],
  ['delete', '/items/:eventId', 'DeleteCartItemHandler', loggedIn]
];

const router = express.Router();

routes.forEach(([method, path, handlerName, middlewares = []]) => {
  const HandlerClass = require(`../handlers/${handlerName}`);
  const handlerInstance = new HandlerClass();
  router[method](path, ...middlewares, (req, res) => handlerInstance.execute(req, res));
});

module.exports = { routes, router };