const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./errorHandler');

function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const [scheme, token] = authHeader.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET ist nicht gesetzt.');
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

function checkLogin(req, _res, next) {
  const token = extractToken(req.headers.authorization);
  if (!token) return next(new HttpError(401, 'Nicht angemeldet. Bitte einloggen.'));
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return next(new HttpError(401, 'Sitzung abgelaufen oder ungültig.'));
  }
}

function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') {
    return next(new HttpError(403, 'Zugriff verweigert: Administratorrechte erforderlich.'));
  }
  return next();
}

function requireInternal(req, _res, next) {
  const expected = process.env.INTERNAL_API_TOKEN;
  const given = req.headers['x-internal-token'];
  if (!expected) return next(new Error('INTERNAL_API_TOKEN ist nicht gesetzt.'));
  const ok = typeof given === 'string'
    && given.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  return ok ? next() : next(new HttpError(401, 'Interner Zugriff verweigert.'));
}

const admin = [checkLogin, requireAdmin];
const loggedIn = [checkLogin];
const internal = [requireInternal];

module.exports = { extractToken, verifyToken, checkLogin, requireAdmin, requireInternal, admin, loggedIn, internal };
