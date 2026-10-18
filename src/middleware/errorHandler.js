// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
/**
 * Einheitliche Fehlerbehandlung. Früher baute jeder Handler seine Fehlerantwort selbst
 * (mal { message }, mal { error }, mal 403 statt 401). Jetzt werfen Handler einen HttpError,
 * und nur diese Datei macht daraus die Antwort: { error, details? }.
 */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  // Ungültiges JSON im Request-Body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Ungültiges JSON im Request-Body.' });
  }
  console.error(`[orders] ${req.method} ${req.originalUrl} fehlgeschlagen:`, err);
  return res.status(500).json({ error: 'Interner Serverfehler.' });
}

function notFound(req, res) {
  res.status(404).json({ error: `Endpunkt ${req.method} ${req.path} existiert nicht.` });
}

module.exports = { HttpError, errorHandler, notFound };
