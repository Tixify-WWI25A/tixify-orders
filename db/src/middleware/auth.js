// Basiert auf unserem config/auth.js (checkLogin) und config/requireAdmin.js (Bearer-Token, jwt.verify mit HS256, req.user, Admin-Prüfung über role, Fehlertexte).
// Mit KI überarbeitet (KI-Log Nr. 7): beide Dateien zusammengeführt; abgelaufenes Token liefert 401 statt 403 (F-12); Fehler über den zentralen errorHandler; neu: requireInternal für Service-zu-Service-Aufrufe.
/**
 * Middlewares für Login und Rechte. Diese Datei ist in allen drei Backend-Repos identisch
 * (tixify-gateway, tixify-catalog, tixify-orders). Bewusste Entscheidung (siehe ADR):
 * Rund 60 Zeilen zu kopieren ist bei drei Repos einfacher als ein eigenes npm-Paket.
 * Wer hier etwas ändert, ändert es in allen drei Repos.
 *
 * Früher: config/auth.js (checkLogin) und config/requireAdmin.js.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./errorHandler');

function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const [scheme, token] = authHeader.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/** Prüft ein JWT und liefert den Payload { userId, email, role }. Wirft bei ungültigem Token. */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET ist nicht gesetzt.');
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

/** Login erforderlich. Setzt req.user = { userId, email, role }. */
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

/** Nur Administratoren. Immer NACH checkLogin verwenden. */
function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') {
    return next(new HttpError(403, 'Zugriff verweigert: Administratorrechte erforderlich.'));
  }
  return next();
}

/**
 * Für Service-zu-Service-Aufrufe (orders → catalog).
 * Erwartet den gemeinsamen Schlüssel INTERNAL_API_TOKEN im Header X-Internal-Token.
 * Das gateway leitet /internal NIE weiter, von außen sind diese Endpunkte also nicht erreichbar.
 */
function requireInternal(req, _res, next) {
  const expected = process.env.INTERNAL_API_TOKEN;
  const given = req.headers['x-internal-token'];
  if (!expected) return next(new Error('INTERNAL_API_TOKEN ist nicht gesetzt.'));
  const ok = typeof given === 'string'
    && given.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  return ok ? next() : next(new HttpError(401, 'Interner Zugriff verweigert.'));
}

/** Kurzform für Routen-Tabellen */
const admin = [checkLogin, requireAdmin];
const loggedIn = [checkLogin];
const internal = [requireInternal];

module.exports = { extractToken, verifyToken, checkLogin, requireAdmin, requireInternal, admin, loggedIn, internal };
