class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Ungültiges JSON im Request-Body.' });
  }
  console.error(`[gateway] ${req.method} ${req.originalUrl} fehlgeschlagen:`, err);
  return res.status(500).json({ error: 'Interner Serverfehler.' });
}

function notFound(req, res) {
  res.status(404).json({ error: `Endpunkt ${req.method} ${req.path} existiert nicht.` });
}

module.exports = { HttpError, errorHandler, notFound };
