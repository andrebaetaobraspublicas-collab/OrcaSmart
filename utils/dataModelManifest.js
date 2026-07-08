const CATALOG_TABLES = [
  'componentes_bdi',
  'composicoes',
  'composicoes_secao_itens',
  'composicoes_secoes',
  'datas_base',
  'encargos_goinfra_profissionais',
  'encargos_sicro_profissionais',
  'equipamentos_sinapi',
  'estados',
  'familias_equipamentos',
  'fontes_referencia',
  'grupos_composicoes',
  'grupos_encargos',
  'grupos_insumos',
  'insumos',
  'itens_composicao',
  'itens_encargo',
  'municipio_aliquotas_anuais',
  'municipios',
  'pem_equipamentos',
  'pem_servicos',
  'pem_variaveis',
  'perfis_bdi',
  'perfis_encargos',
  'precos_equipamentos',
  'precos_insumos',
  'unidades_medida',
];

const TENANT_TABLES = [
  'encargos_orcamento_aplicacoes',
  'ev_evento_itens',
  'ev_eventos',
  'eventogramas',
  'obras',
  'orcamento_sintetico',
  'orcamentos',
];

const USER_OVERRIDE_DOMAINS = [
  'bdi',
  'composicoes',
  'encargos_sociais',
  'insumos',
  'precos_equipamentos',
];

const PHASE2_MODEL_VERSION = 1;

module.exports = {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_DOMAINS,
  PHASE2_MODEL_VERSION,
};
