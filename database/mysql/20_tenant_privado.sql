-- OrcaSmart2 - Fase 4 - Schema MySQL/MariaDB
-- Dominio: Dados privados dos tenants
-- Gerado em: 2026-07-09T23:15:12.256Z
-- Inventario base: 2026-07-09T22:40:43.616Z
-- Revisar antes de executar em producao.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `encargos_orcamento_aplicacoes` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_aplicacao` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `id_perfil` BIGINT UNSIGNED NOT NULL,
  `encargo_novo_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `itens_atualizados` BIGINT NOT NULL DEFAULT 0,
  `custo_antes` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `custo_depois` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `data_aplicacao` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `observacoes` TEXT NULL,
  PRIMARY KEY (`id_aplicacao`),
  KEY `idx_encargos_orcamento_aplicacoes_id_perfil` (`id_perfil`),
  KEY `idx_encargos_orcamento_aplicacoes_id_orcamento` (`id_orcamento`),
  KEY `idx_encargos_orcamento_aplicacoes_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ev_evento_itens` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_evento` BIGINT UNSIGNED NOT NULL,
  `id_item` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ev_evento_itens_id_item` (`id_item`),
  KEY `idx_ev_evento_itens_id_evento` (`id_evento`),
  KEY `idx_ev_evento_itens_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ev_eventos` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_evento` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
  PRIMARY KEY (`id_evento`),
  KEY `idx_ev_eventos_id_evento_pai` (`id_evento_pai`),
  KEY `idx_ev_eventos_id_eventograma` (`id_eventograma`),
  KEY `idx_ev_eventos_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `eventogramas` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_eventograma` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `nome` VARCHAR(255) NOT NULL,
  `descricao` TEXT NULL,
  `modo_geracao` VARCHAR(255) NULL DEFAULT 'manual',
  `status` VARCHAR(255) NULL DEFAULT 'Rascunho',
  `valor_total_ref` DECIMAL(20,8) NULL DEFAULT 0,
  `observacoes` TEXT NULL,
  `data_criacao` TEXT NULL,
  `data_atualizacao` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_eventograma`),
  KEY `idx_eventogramas_id_orcamento` (`id_orcamento`),
  KEY `idx_eventogramas_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `obras` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_obra` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
  PRIMARY KEY (`id_obra`),
  KEY `idx_obras_id_municipio` (`id_municipio`),
  KEY `idx_obras_tenant_situacao` (`tenant_id`, `situacao`),
  KEY `idx_obras_tenant_uf` (`tenant_id`, `uf`),
  KEY `idx_obras_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orcamento_sintetico` (
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `id_item` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_orcamento` BIGINT UNSIGNED NOT NULL,
  `item_num` TEXT NULL,
  `tipo_linha` VARCHAR(255) NOT NULL DEFAULT 'item',
  `profundidade` BIGINT NULL DEFAULT 1,
  `ordem` DECIMAL(20,8) NULL DEFAULT 0,
  `tipo_item` VARCHAR(120) NULL,
  `id_composicao` BIGINT UNSIGNED NULL,
  `id_insumo` BIGINT UNSIGNED NULL,
  `codigo` VARCHAR(255) NULL DEFAULT '',
  `fonte` VARCHAR(255) NULL DEFAULT '',
  `descricao` VARCHAR(255) NOT NULL DEFAULT '',
  `unidade` VARCHAR(255) NULL DEFAULT '',
  `quantidade` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_unitario` DECIMAL(20,8) NULL DEFAULT 0,
  `data_criacao` TEXT NULL,
  `bdi_percentual_linha` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_item`),
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
  `id_orcamento` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
  PRIMARY KEY (`id_orcamento`),
  KEY `idx_orcamentos_id_data_base` (`id_data_base`),
  KEY `idx_orcamentos_id_obra` (`id_obra`),
  KEY `idx_orcamentos_tenant_status` (`tenant_id`, `status`),
  KEY `idx_orcamentos_tenant_obra` (`tenant_id`, `id_obra`),
  KEY `idx_orcamentos_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 1;
