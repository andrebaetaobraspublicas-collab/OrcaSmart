function normalizarFonte(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw.includes('SINAPI')) return 'SINAPI';
  if (raw.includes('SICRO')) return 'SICRO';
  return raw;
}

function regimePrevidenciarioComposicao(comp = {}) {
  const raw = String(comp.regime_previdenciario || comp.situacao_ref || '').trim().toLowerCase();
  if (raw.includes('sem desoner') || raw.includes('nao desoner')
      || raw.includes('não desoner') || raw === 'onerado' || raw === 'normal') {
    return 'Onerado';
  }
  if (raw.includes('desoner')) return 'Desonerado';
  const fonte = normalizarFonte(comp.fonte);
  if (fonte === 'SINAPI' && (!raw || raw === 'com custo' || raw === 'sem custo')) {
    return 'Desonerado';
  }
  if (fonte === 'SICRO' && !raw) return 'Onerado';
  return null;
}

module.exports = {
  regimePrevidenciarioComposicao,
};
