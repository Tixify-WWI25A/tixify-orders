// Mit KI erstellt (KI-Log Nr. 7), vom Team geprüft.
// Wird vor jeder Testdatei geladen (jest.setupFiles). Feste Test-Werte, nie echte Geheimnisse.
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.INTERNAL_API_TOKEN = 'test-internal-token';
process.env.CATALOG_URL = 'http://catalog.test';
process.env.NODE_ENV = 'test';
