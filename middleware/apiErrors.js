function apiNotFound(req, res) {
  res.status(404).json({
    erro: `Rota de API nao implementada no backend Node: ${req.method} ${req.originalUrl}`,
    rota: req.originalUrl,
    metodo: req.method,
  });
}

function apiErrorHandler(err, req, res, next) {
  if (!req.path.startsWith('/api')) return next(err);
  console.error('Erro em rota API:', err);
  res.status(err.status || 500).json({
    erro: err.message || 'Erro interno do servidor.',
    tipo: err.name || 'Error',
    rota: req.originalUrl,
  });
}

module.exports = {
  apiNotFound,
  apiErrorHandler,
};
