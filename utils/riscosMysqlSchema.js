const { createMysqlConnection } = require('./mysqlRuntime');

const RISK_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS riscos_analises (
    tenant_id BIGINT UNSIGNED NOT NULL,
    id_analise BIGINT UNSIGNED NOT NULL,
    id_orcamento BIGINT UNSIGNED NOT NULL,
    nome VARCHAR(255) NOT NULL,
    regime_execucao VARCHAR(40) NOT NULL DEFAULT 'preco_unitario',
    criterio_alocacao VARCHAR(40) NOT NULL DEFAULT 'nao_definido',
    justificativa_variacao_quantidade TEXT NULL,
    justificativa_percentil TEXT NULL,
    metodo_escopo VARCHAR(20) NOT NULL DEFAULT 'abc_a',
    extrapolar TINYINT NOT NULL DEFAULT 0,
    iteracoes INT NOT NULL DEFAULT 10000,
    percentil_alvo DECIMAL(8,4) NOT NULL DEFAULT 80,
    semente BIGINT NOT NULL DEFAULT 20260715,
    incluir_eventos TINYINT NOT NULL DEFAULT 1,
    incluir_quantitativos TINYINT NOT NULL DEFAULT 1,
    observacoes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Em elaboracao',
    resultado_json LONGTEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NULL,
    PRIMARY KEY (tenant_id, id_analise),
    KEY idx_riscos_analises_orcamento (tenant_id, id_orcamento),
    KEY idx_riscos_analises_status (tenant_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS riscos_servicos (
    tenant_id BIGINT UNSIGNED NOT NULL,
    id_risco_servico BIGINT UNSIGNED NOT NULL,
    id_analise BIGINT UNSIGNED NOT NULL,
    id_item_orcamento BIGINT UNSIGNED NULL,
    item_num VARCHAR(80) NULL,
    codigo VARCHAR(120) NULL,
    fonte VARCHAR(80) NULL,
    descricao TEXT NOT NULL,
    unidade VARCHAR(40) NULL,
    quantidade DECIMAL(20,8) NOT NULL DEFAULT 0,
    custo_unitario DECIMAL(20,8) NOT NULL DEFAULT 0,
    valor_base DECIMAL(20,4) NOT NULL DEFAULT 0,
    classificacao_abc CHAR(1) NULL,
    percentual_abc DECIMAL(12,6) NOT NULL DEFAULT 0,
    percentual_acumulado DECIMAL(12,6) NOT NULL DEFAULT 0,
    selecionado TINYINT NOT NULL DEFAULT 0,
    tipo_risco VARCHAR(60) NOT NULL DEFAULT 'variacao_custo_unitario',
    responsavel VARCHAR(30) NOT NULL DEFAULT 'contratado',
    incluir_contingencia TINYINT NOT NULL DEFAULT 1,
    distribuicao VARCHAR(40) NOT NULL DEFAULT 'triangular',
    nivel_qualitativo VARCHAR(30) NULL DEFAULT 'medio',
    minimo DECIMAL(20,8) NOT NULL DEFAULT -5,
    mais_provavel DECIMAL(20,8) NOT NULL DEFAULT 5,
    maximo DECIMAL(20,8) NOT NULL DEFAULT 10,
    media DECIMAL(20,8) NULL,
    desvio_padrao DECIMAL(20,8) NULL,
    probabilidade DECIMAL(12,6) NOT NULL DEFAULT 100,
    grupo_correlacao VARCHAR(120) NULL,
    composicao_json LONGTEXT NULL,
    justificativa TEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NULL,
    PRIMARY KEY (tenant_id, id_risco_servico),
    KEY idx_riscos_servicos_analise (tenant_id, id_analise),
    KEY idx_riscos_servicos_abc (tenant_id, id_analise, classificacao_abc)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS riscos_eventos (
    tenant_id BIGINT UNSIGNED NOT NULL,
    id_evento_risco BIGINT UNSIGNED NOT NULL,
    id_analise BIGINT UNSIGNED NOT NULL,
    descricao TEXT NOT NULL,
    categoria VARCHAR(100) NULL,
    probabilidade DECIMAL(12,6) NOT NULL DEFAULT 0,
    impacto_minimo DECIMAL(20,4) NOT NULL DEFAULT 0,
    impacto_mais_provavel DECIMAL(20,4) NOT NULL DEFAULT 0,
    impacto_maximo DECIMAL(20,4) NOT NULL DEFAULT 0,
    distribuicao_impacto VARCHAR(40) NOT NULL DEFAULT 'triangular',
    responsavel VARCHAR(30) NOT NULL DEFAULT 'contratado',
    incluir_contingencia TINYINT NOT NULL DEFAULT 1,
    estrategia_mitigacao TEXT NULL,
    observacao TEXT NULL,
    grupo_correlacao VARCHAR(120) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NULL,
    PRIMARY KEY (tenant_id, id_evento_risco),
    KEY idx_riscos_eventos_analise (tenant_id, id_analise)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS riscos_simulacoes (
    tenant_id BIGINT UNSIGNED NOT NULL,
    id_simulacao BIGINT UNSIGNED NOT NULL,
    id_analise BIGINT UNSIGNED NOT NULL,
    metodo VARCHAR(40) NOT NULL DEFAULT 'monte_carlo',
    parametros_json LONGTEXT NULL,
    resumo_json LONGTEXT NOT NULL,
    amostras_json LONGTEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id_simulacao),
    KEY idx_riscos_simulacoes_analise (tenant_id, id_analise, criado_em)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS riscos_bdi_aplicacoes (
    tenant_id BIGINT UNSIGNED NOT NULL,
    id_aplicacao_risco BIGINT UNSIGNED NOT NULL,
    id_analise BIGINT UNSIGNED NOT NULL,
    id_perfil_bdi VARCHAR(80) NULL,
    modo VARCHAR(30) NOT NULL,
    taxa_contingencia DECIMAL(20,8) NOT NULL DEFAULT 0,
    risco_anterior DECIMAL(20,8) NOT NULL DEFAULT 0,
    risco_novo DECIMAL(20,8) NOT NULL DEFAULT 0,
    observacao TEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id_aplicacao_risco),
    KEY idx_riscos_bdi_analise (tenant_id, id_analise)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function ensureMysqlRiscosSchema(config) {
  const connection = await createMysqlConnection(config);
  try {
    for (const sql of RISK_TABLES_SQL) await connection.query(sql);
    return { tabelas: RISK_TABLES_SQL.length };
  } finally {
    await connection.end().catch(() => {});
  }
}

module.exports = { RISK_TABLES_SQL, ensureMysqlRiscosSchema };
