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
  'riscos_analises',
  'riscos_servicos',
  'riscos_eventos',
  'riscos_simulacoes',
  'riscos_bdi_aplicacoes',
];

const USER_OVERRIDE_DOMAINS = [
  'bdi',
  'composicoes',
  'encargos_sociais',
  'insumos',
  'precos_equipamentos',
  'datas_base',
  'unidades_medida',
];

const USER_OVERRIDE_TABLES = [
  'tenant_componentes_bdi',
  'tenant_composicoes',
  'tenant_composicoes_secao_itens',
  'tenant_composicoes_secoes',
  'tenant_grupos_encargos',
  'tenant_insumos',
  'tenant_itens_composicao',
  'tenant_itens_encargo',
  'tenant_perfis_bdi',
  'tenant_perfis_encargos',
  'tenant_precos_equipamentos',
  'tenant_precos_insumos',
  'tenant_datas_base',
  'tenant_unidades_medida',
  'tenant_referential_overrides',
];

const PHASE2_MODEL_VERSION = 1;

module.exports = {
  CATALOG_TABLES,
  TENANT_TABLES,
  USER_OVERRIDE_DOMAINS,
  USER_OVERRIDE_TABLES,
  PHASE2_MODEL_VERSION,
};
