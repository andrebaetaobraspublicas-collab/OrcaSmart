-- OrcaSmart2 - Fase 4 - Schema MySQL/MariaDB
-- Dominio: Dados privados dos tenants
-- Gerado em: 2026-07-09T23:58:00.491Z
-- Inventario base: 2026-07-09T22:40:43.616Z
-- Revisar antes de executar em producao.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `encargos_orcamento_aplicacoes` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_aplicacao` BIGINT UNSIGNED NOT NULL,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `id_perfil` BIGINT UNSIGNED NOT NULL,
  `encargo_novo_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `itens_atualizados` BIGINT NOT NULL DEFAULT 0,
  `custo_antes` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `custo_depois` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `data_aplicacao` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `observacoes` TEXT NULL,
  PRIMARY KEY (`tenant_id`, `id_aplicacao`),
  KEY `idx_encargos_orcamento_aplicacoes_id_perfil` (`id_perfil`),
  KEY `idx_encargos_orcamento_aplicacoes_id_orcamento` (`id_orcamento`),
  KEY `idx_encargos_orcamento_aplicacoes_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ev_evento_itens` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id` BIGINT UNSIGNED NOT NULL,
  `id_evento` BIGINT UNSIGNED NOT NULL,
  `id_item` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`tenant_id`, `id`),
  KEY `idx_ev_evento_itens_id_item` (`id_item`),
  KEY `idx_ev_evento_itens_id_evento` (`id_evento`),
  KEY `idx_ev_evento_itens_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ev_eventos` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_evento` BIGINT UNSIGNED NOT NULL,
  `id_eventograma` BIGINT UNSIGNED NOT NULL,
  `id_evento_pai` BIGINT UNSIGNED NULL,
  `numero_evento` TEXT NOT NULL,
  `descricao` TEXT NOT NULL,
  `grupo` VARCHAR(120) NULL,
  `criterio_medicao` TEXT NULL,
  `condicao_pagamento` TEXT NULL,
  `prazo_marco` TEXT NULL,
  `docs_comprobatorios` TEXT NULL,
  `observacoes` TEXT NULL,
  `valor_calculado` DECIMAL(20,8) NULL DEFAULT 0,
  `ordem` BIGINT NULL DEFAULT 0,
  PRIMARY KEY (`tenant_id`, `id_evento`),
  KEY `idx_ev_eventos_id_evento_pai` (`id_evento_pai`),
  KEY `idx_ev_eventos_id_eventograma` (`id_eventograma`),
  KEY `idx_ev_eventos_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `eventogramas` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_eventograma` BIGINT UNSIGNED NOT NULL,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `nome` VARCHAR(255) NOT NULL,
  `descricao` TEXT NULL,
  `modo_geracao` VARCHAR(255) NULL DEFAULT 'manual',
  `status` VARCHAR(255) NULL DEFAULT 'Rascunho',
  `valor_total_ref` DECIMAL(20,8) NULL DEFAULT 0,
  `observacoes` TEXT NULL,
  `data_criacao` TEXT NULL,
  `data_atualizacao` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`, `id_eventograma`),
  KEY `idx_eventogramas_id_orcamento` (`id_orcamento`),
  KEY `idx_eventogramas_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `obras` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_obra` BIGINT UNSIGNED NOT NULL,
  `codigo_obra` VARCHAR(120) NULL,
  `nome_obra` VARCHAR(255) NOT NULL,
  `descricao` TEXT NULL,
  `tipo_obra` VARCHAR(120) NULL,
  `contratante` TEXT NULL,
  `municipio` TEXT NULL,
  `uf` VARCHAR(2) NULL,
  `endereco` TEXT NULL,
  `area_construida_m2` DECIMAL(20,8) NULL,
  `data_cadastro` TEXT NULL,
  `situacao` VARCHAR(255) NULL DEFAULT 'Ativa',
  `cib` TEXT NULL,
  `id_municipio` BIGINT UNSIGNED NULL,
  `ano_realizacao` BIGINT NULL,
  `fator_setorial` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `redutor_compras_governamentais` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  PRIMARY KEY (`tenant_id`, `id_obra`),
  KEY `idx_obras_id_municipio` (`id_municipio`),
  KEY `idx_obras_tenant_situacao` (`tenant_id`, `situacao`),
  KEY `idx_obras_tenant_uf` (`tenant_id`, `uf`),
  KEY `idx_obras_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orcamento_sintetico` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_item` BIGINT UNSIGNED NOT NULL,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `item_num` TEXT NULL,
  `tipo_linha` VARCHAR(255) NOT NULL DEFAULT 'item',
  `profundidade` BIGINT NULL DEFAULT 1,
  `ordem` DECIMAL(20,8) NULL DEFAULT 0,
  `tipo_item` VARCHAR(120) NULL,
  `id_composicao` VARCHAR(191) NULL,
  `id_insumo` VARCHAR(191) NULL,
  `codigo` VARCHAR(255) NULL DEFAULT '',
  `fonte` VARCHAR(255) NULL DEFAULT '',
  `descricao` TEXT NOT NULL,
  `unidade` VARCHAR(255) NULL DEFAULT '',
  `quantidade` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_unitario` DECIMAL(20,8) NULL DEFAULT 0,
  `data_criacao` TEXT NULL,
  `bdi_percentual_linha` DECIMAL(20,8) NULL,
  PRIMARY KEY (`tenant_id`, `id_item`),
  KEY `idx_orcamento_sintetico_id_insumo` (`id_insumo`),
  KEY `idx_orcamento_sintetico_id_composicao` (`id_composicao`),
  KEY `idx_orcamento_sintetico_id_orcamento` (`id_orcamento`),
  KEY `idx_orcamento_sintetico_tenant_orcamento` (`tenant_id`, `id_orcamento`),
  KEY `idx_orcamento_sintetico_composicao` (`tenant_id`, `id_composicao`),
  KEY `idx_orcamento_sintetico_insumo` (`tenant_id`, `id_insumo`),
  KEY `idx_orcamento_sintetico_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orcamentos` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `id_obra` BIGINT UNSIGNED NOT NULL,
  `nome_orcamento` VARCHAR(255) NOT NULL,
  `descricao` TEXT NULL,
  `id_data_base` BIGINT UNSIGNED NULL,
  `uf_referencia` VARCHAR(32) NULL,
  `versao` VARCHAR(255) NULL DEFAULT '1.0',
  `status` VARCHAR(255) NULL DEFAULT 'Em elaboração',
  `valor_custo_direto` DECIMAL(20,8) NULL DEFAULT 0,
  `valor_bdi` DECIMAL(20,8) NULL DEFAULT 0,
  `valor_total` DECIMAL(20,8) NULL DEFAULT 0,
  `data_criacao` TEXT NULL,
  `observacoes` TEXT NULL,
  `id_bdi_perfil` BIGINT UNSIGNED NULL,
  `bdi_percentual` DECIMAL(20,8) NULL DEFAULT 0,
  `regime_previdenciario` VARCHAR(255) NOT NULL DEFAULT 'Onerado',
  PRIMARY KEY (`tenant_id`, `id_orcamento`),
  KEY `idx_orcamentos_id_data_base` (`id_data_base`),
  KEY `idx_orcamentos_id_obra` (`id_obra`),
  KEY `idx_orcamentos_tenant_status` (`tenant_id`, `status`),
  KEY `idx_orcamentos_tenant_obra` (`tenant_id`, `id_obra`),
  KEY `idx_orcamentos_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `riscos_analises` (
  `tenant_id` BIGINT UNSIGNED NOT NULL, `id_analise` BIGINT UNSIGNED NOT NULL,
  `id_orcamento` BIGINT UNSIGNED NOT NULL, `nome` VARCHAR(255) NOT NULL,
  `regime_execucao` VARCHAR(40) NOT NULL DEFAULT 'preco_unitario',
  `criterio_alocacao` VARCHAR(40) NOT NULL DEFAULT 'nao_definido',
  `justificativa_variacao_quantidade` TEXT NULL, `justificativa_percentil` TEXT NULL,
  `metodo_escopo` VARCHAR(20) NOT NULL DEFAULT 'abc_a', `extrapolar` TINYINT NOT NULL DEFAULT 0,
  `iteracoes` INT NOT NULL DEFAULT 10000, `percentil_alvo` DECIMAL(8,4) NOT NULL DEFAULT 80,
  `semente` BIGINT NOT NULL DEFAULT 20260715, `incluir_eventos` TINYINT NOT NULL DEFAULT 1,
  `incluir_quantitativos` TINYINT NOT NULL DEFAULT 1, `observacoes` TEXT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'Em elaboracao', `resultado_json` LONGTEXT NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `atualizado_em` DATETIME NULL,
  PRIMARY KEY (`tenant_id`,`id_analise`),
  KEY `idx_riscos_analises_orcamento` (`tenant_id`,`id_orcamento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `riscos_servicos` (
  `tenant_id` BIGINT UNSIGNED NOT NULL, `id_risco_servico` BIGINT UNSIGNED NOT NULL,
  `id_analise` BIGINT UNSIGNED NOT NULL, `id_item_orcamento` BIGINT UNSIGNED NULL,
  `item_num` VARCHAR(80) NULL, `codigo` VARCHAR(120) NULL, `fonte` VARCHAR(80) NULL,
  `descricao` TEXT NOT NULL, `unidade` VARCHAR(40) NULL,
  `quantidade` DECIMAL(20,8) NOT NULL DEFAULT 0, `custo_unitario` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `valor_base` DECIMAL(20,4) NOT NULL DEFAULT 0, `classificacao_abc` CHAR(1) NULL,
  `percentual_abc` DECIMAL(12,6) NOT NULL DEFAULT 0, `percentual_acumulado` DECIMAL(12,6) NOT NULL DEFAULT 0,
  `selecionado` TINYINT NOT NULL DEFAULT 0, `tipo_risco` VARCHAR(60) NOT NULL DEFAULT 'variacao_custo_unitario',
  `responsavel` VARCHAR(30) NOT NULL DEFAULT 'contratado', `incluir_contingencia` TINYINT NOT NULL DEFAULT 1,
  `distribuicao` VARCHAR(40) NOT NULL DEFAULT 'triangular', `nivel_qualitativo` VARCHAR(30) NULL DEFAULT 'medio',
  `minimo` DECIMAL(20,8) NOT NULL DEFAULT -5, `mais_provavel` DECIMAL(20,8) NOT NULL DEFAULT 5,
  `maximo` DECIMAL(20,8) NOT NULL DEFAULT 10, `media` DECIMAL(20,8) NULL, `desvio_padrao` DECIMAL(20,8) NULL,
  `probabilidade` DECIMAL(12,6) NOT NULL DEFAULT 100, `grupo_correlacao` VARCHAR(120) NULL,
  `composicao_json` LONGTEXT NULL, `justificativa` TEXT NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `atualizado_em` DATETIME NULL,
  PRIMARY KEY (`tenant_id`,`id_risco_servico`),
  KEY `idx_riscos_servicos_analise` (`tenant_id`,`id_analise`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `riscos_eventos` (
  `tenant_id` BIGINT UNSIGNED NOT NULL, `id_evento_risco` BIGINT UNSIGNED NOT NULL,
  `id_analise` BIGINT UNSIGNED NOT NULL, `descricao` TEXT NOT NULL, `categoria` VARCHAR(100) NULL,
  `probabilidade` DECIMAL(12,6) NOT NULL DEFAULT 0, `impacto_minimo` DECIMAL(20,4) NOT NULL DEFAULT 0,
  `impacto_mais_provavel` DECIMAL(20,4) NOT NULL DEFAULT 0, `impacto_maximo` DECIMAL(20,4) NOT NULL DEFAULT 0,
  `distribuicao_impacto` VARCHAR(40) NOT NULL DEFAULT 'triangular',
  `responsavel` VARCHAR(30) NOT NULL DEFAULT 'contratado', `incluir_contingencia` TINYINT NOT NULL DEFAULT 1,
  `estrategia_mitigacao` TEXT NULL, `observacao` TEXT NULL, `grupo_correlacao` VARCHAR(120) NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `atualizado_em` DATETIME NULL,
  PRIMARY KEY (`tenant_id`,`id_evento_risco`),
  KEY `idx_riscos_eventos_analise` (`tenant_id`,`id_analise`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `riscos_simulacoes` (
  `tenant_id` BIGINT UNSIGNED NOT NULL, `id_simulacao` BIGINT UNSIGNED NOT NULL,
  `id_analise` BIGINT UNSIGNED NOT NULL, `metodo` VARCHAR(40) NOT NULL DEFAULT 'monte_carlo',
  `parametros_json` LONGTEXT NULL, `resumo_json` LONGTEXT NOT NULL, `amostras_json` LONGTEXT NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`,`id_simulacao`),
  KEY `idx_riscos_simulacoes_analise` (`tenant_id`,`id_analise`,`criado_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `riscos_bdi_aplicacoes` (
  `tenant_id` BIGINT UNSIGNED NOT NULL, `id_aplicacao_risco` BIGINT UNSIGNED NOT NULL,
  `id_analise` BIGINT UNSIGNED NOT NULL, `id_perfil_bdi` VARCHAR(80) NULL, `modo` VARCHAR(30) NOT NULL,
  `taxa_contingencia` DECIMAL(20,8) NOT NULL DEFAULT 0, `risco_anterior` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `risco_novo` DECIMAL(20,8) NOT NULL DEFAULT 0, `observacao` TEXT NULL,
  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`,`id_aplicacao_risco`),
  KEY `idx_riscos_bdi_analise` (`tenant_id`,`id_analise`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
