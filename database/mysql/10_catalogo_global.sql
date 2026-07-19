-- OrcaSmart2 - Fase 4 - Schema MySQL/MariaDB
-- Dominio: Catalogo global compartilhado
-- Gerado em: 2026-07-09T23:58:00.490Z
-- Inventario base: 2026-07-09T22:40:43.616Z
-- Revisar antes de executar em producao.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `componentes_bdi` (
  `id_componente` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_perfil_bdi` BIGINT UNSIGNED NOT NULL,
  `grupo` VARCHAR(120) NOT NULL,
  `codigo` VARCHAR(120) NULL,
  `descricao` TEXT NOT NULL,
  `base_legal` TEXT NULL,
  `percentual` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `incide_sobre` VARCHAR(255) NULL DEFAULT 'CD',
  `ativo` BIGINT NULL DEFAULT 1,
  `ordem` BIGINT NULL DEFAULT 0,
  `observacoes` TEXT NULL,
  PRIMARY KEY (`id_componente`),
  KEY `idx_componentes_bdi_id_perfil_bdi` (`id_perfil_bdi`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `composicoes` (
  `id_composicao` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(120) NULL,
  `fonte` VARCHAR(255) NOT NULL DEFAULT 'USUARIO',
  `formato` VARCHAR(255) NOT NULL DEFAULT 'UNITARIO',
  `descricao` TEXT NOT NULL,
  `unidade` VARCHAR(120) NULL,
  `id_grupo_comp` BIGINT UNSIGNED NULL,
  `mes_referencia` VARCHAR(32) NULL,
  `uf_referencia` VARCHAR(255) NULL DEFAULT 'DF',
  `situacao_ref` VARCHAR(80) NULL,
  `custo_unitario` DECIMAL(20,8) NULL,
  `fic` DECIMAL(20,8) NULL,
  `producao_equipe` DECIMAL(20,8) NULL,
  `unidade_producao` VARCHAR(120) NULL,
  `situacao` VARCHAR(255) NULL DEFAULT 'Ativo',
  `observacoes` TEXT NULL,
  `custo_horario_execucao` DECIMAL(20,8) NULL,
  `custo_unitario_execucao` DECIMAL(20,8) NULL,
  `custo_fic` DECIMAL(20,8) NULL,
  `subtotal_sicro` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_composicao`),
  KEY `idx_composicoes_id_grupo_comp` (`id_grupo_comp`),
  KEY `idx_composicoes_fonte_ref` (`fonte`, `uf_referencia`, `mes_referencia`),
  KEY `idx_composicoes_codigo` (`codigo`),
  KEY `idx_composicoes_formato` (`formato`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `composicoes_secao_itens` (
  `id_item_secao` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_composicao` BIGINT UNSIGNED NOT NULL,
  `id_secao` BIGINT UNSIGNED NULL,
  `letra_secao` TEXT NOT NULL,
  `codigo_item` VARCHAR(120) NULL,
  `descricao` TEXT NULL,
  `quantidade` DECIMAL(20,8) NULL,
  `unidade` VARCHAR(120) NULL,
  `util_operativa` DECIMAL(20,8) NULL,
  `util_improdutiva` DECIMAL(20,8) NULL,
  `custo_hp` DECIMAL(20,8) NULL,
  `custo_hi` DECIMAL(20,8) NULL,
  `preco_unitario` DECIMAL(20,8) NULL,
  `custo_total` DECIMAL(20,8) NULL,
  `cod_transporte` TEXT NULL,
  `cod_transp_ln` TEXT NULL,
  `cod_transp_rp` TEXT NULL,
  `cod_transp_p` TEXT NULL,
  `fit` DECIMAL(20,8) NULL,
  `dmt` DECIMAL(20,8) NULL,
  `ordem` BIGINT NULL DEFAULT 0,
  PRIMARY KEY (`id_item_secao`),
  KEY `idx_composicoes_secao_itens_id_secao` (`id_secao`),
  KEY `idx_composicoes_secao_itens_id_composicao` (`id_composicao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `composicoes_secoes` (
  `id_secao` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_composicao` BIGINT UNSIGNED NOT NULL,
  `letra_secao` TEXT NOT NULL,
  `nome_secao` VARCHAR(255) NULL,
  `custo_total_secao` DECIMAL(20,8) NULL DEFAULT 0,
  `ordem` BIGINT NULL DEFAULT 0,
  PRIMARY KEY (`id_secao`),
  KEY `idx_composicoes_secoes_id_composicao` (`id_composicao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `datas_base` (
  `id_data_base` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mes` BIGINT NOT NULL,
  `ano` BIGINT NOT NULL,
  `data_referencia` VARCHAR(32) NULL,
  `descricao` TEXT NULL,
  PRIMARY KEY (`id_data_base`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `encargos_goinfra_profissionais` (
  `id_profissional_enc` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_perfil` BIGINT UNSIGNED NOT NULL,
  `codigo_profissional` VARCHAR(120) NOT NULL,
  `descricao` TEXT NOT NULL,
  `unidade` VARCHAR(120) NULL,
  `total_grupo_a` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `total_grupo_b` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `total_grupo_c` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `total_grupo_d` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `encargo_total` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `parcelas_json` JSON NULL,
  PRIMARY KEY (`id_profissional_enc`),
  KEY `idx_encargos_goinfra_profissionais_id_perfil` (`id_perfil`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `encargos_sicro_profissionais` (
  `id_profissional_enc` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_perfil` BIGINT UNSIGNED NOT NULL,
  `codigo_profissional` VARCHAR(120) NOT NULL,
  `descricao` TEXT NOT NULL,
  `unidade` VARCHAR(120) NULL,
  `total_grupo_a` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `total_grupo_b` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `total_grupo_c` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `total_grupo_d` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `encargo_total` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `parcelas_json` JSON NULL,
  PRIMARY KEY (`id_profissional_enc`),
  KEY `idx_encargos_sicro_profissionais_id_perfil` (`id_perfil`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `equipamentos_sinapi` (
  `id_equip` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_chp` VARCHAR(120) NULL,
  `codigo_chi` VARCHAR(120) NULL,
  `codigo_insumo_equip` VARCHAR(120) NULL,
  `codigo_insumo_comb` VARCHAR(120) NULL,
  `codigo_operador` VARCHAR(120) NULL,
  `descricao` TEXT NOT NULL,
  `id_familia` BIGINT UNSIGNED NULL,
  `coef_depreciacao` DECIMAL(20,8) NULL,
  `coef_juros` DECIMAL(20,8) NULL,
  `coef_manutencao` DECIMAL(20,8) NULL,
  `consumo_combustivel_hora` DECIMAL(20,8) NULL,
  `unidade_combustivel` VARCHAR(255) NULL DEFAULT 'L',
  `tem_impostos_seguros` BIGINT NULL DEFAULT 0,
  `coef_impostos_seguros` DECIMAL(20,8) NULL,
  `situacao` VARCHAR(255) NULL DEFAULT 'Ativo',
  `fonte` VARCHAR(255) NULL DEFAULT 'SINAPI 03/2026',
  `sistema` VARCHAR(255) NULL DEFAULT 'SINAPI',
  `custo_produtivo` DECIMAL(20,8) NULL,
  `custo_improdutivo` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_equip`),
  KEY `idx_equipamentos_sinapi_id_familia` (`id_familia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `estados` (
  `id_estado` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_ibge` BIGINT NOT NULL,
  `uf` VARCHAR(2) NOT NULL,
  `nome_estado` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id_estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `familias_equipamentos` (
  `id_familia` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome_familia` VARCHAR(255) NOT NULL,
  `descricao` TEXT NULL,
  PRIMARY KEY (`id_familia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fontes_referencia` (
  `id_fonte` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome_fonte` VARCHAR(255) NOT NULL,
  `tipo_fonte` VARCHAR(120) NULL,
  `orgao_responsavel` TEXT NULL,
  `abrangencia` TEXT NULL,
  `observacoes` TEXT NULL,
  PRIMARY KEY (`id_fonte`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grupos_composicoes` (
  `id_grupo_comp` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome_grupo` VARCHAR(120) NOT NULL,
  `fonte` VARCHAR(255) NULL DEFAULT 'SINAPI',
  PRIMARY KEY (`id_grupo_comp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grupos_encargos` (
  `id_grupo_enc` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_perfil` BIGINT UNSIGNED NOT NULL,
  `letra` TEXT NOT NULL,
  `descricao` TEXT NULL,
  `total_grupo` DECIMAL(20,8) NULL DEFAULT 0,
  PRIMARY KEY (`id_grupo_enc`),
  KEY `idx_grupos_encargos_id_perfil` (`id_perfil`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `grupos_insumos` (
  `id_grupo` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome_grupo` VARCHAR(120) NOT NULL,
  `descricao` TEXT NULL,
  PRIMARY KEY (`id_grupo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `insumos` (
  `id_insumo` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_insumo` VARCHAR(120) NULL,
  `descricao` TEXT NOT NULL,
  `tipo_insumo` VARCHAR(120) NULL,
  `id_unidade` BIGINT UNSIGNED NULL,
  `id_grupo` BIGINT UNSIGNED NULL,
  `origem` VARCHAR(120) NULL,
  `encargos_aplicaveis` VARCHAR(255) NULL DEFAULT 'Sim',
  `situacao` VARCHAR(255) NULL DEFAULT 'Ativo',
  `observacoes` TEXT NULL,
  `encargos_sociais_percentual` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_insumo`),
  KEY `idx_insumos_id_grupo` (`id_grupo`),
  KEY `idx_insumos_id_unidade` (`id_unidade`),
  KEY `idx_insumos_origem_tipo` (`origem`, `tipo_insumo`),
  KEY `idx_insumos_codigo` (`codigo_insumo`),
  KEY `idx_insumos_situacao` (`situacao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `itens_composicao` (
  `id_item` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_composicao` BIGINT UNSIGNED NOT NULL,
  `tipo_item` VARCHAR(120) NOT NULL,
  `codigo_item` VARCHAR(120) NULL,
  `descricao` TEXT NULL,
  `unidade` VARCHAR(120) NULL,
  `coeficiente` DECIMAL(20,8) NULL DEFAULT 0,
  `situacao_item` VARCHAR(80) NULL,
  `preco_unitario` DECIMAL(20,8) NULL,
  `custo_parcial` DECIMAL(20,8) NULL,
  `ordem` BIGINT NULL DEFAULT 0,
  PRIMARY KEY (`id_item`),
  KEY `idx_itens_composicao_id_composicao` (`id_composicao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `itens_encargo` (
  `id_item` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_grupo_enc` BIGINT UNSIGNED NOT NULL,
  `descricao` TEXT NOT NULL,
  `base_legal` TEXT NULL,
  `percentual` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `observacoes` TEXT NULL,
  `ordem` BIGINT NULL DEFAULT 0,
  PRIMARY KEY (`id_item`),
  KEY `idx_itens_encargo_id_grupo_enc` (`id_grupo_enc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `municipio_aliquotas_anuais` (
  `id_aliquota` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_municipio` BIGINT UNSIGNED NOT NULL,
  `ano` BIGINT NOT NULL,
  `iva_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `aliquota_cbs` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `aliquota_ibs` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `aliquota_iss` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `data_atualizacao` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_aliquota`),
  KEY `idx_municipio_aliquotas_anuais_id_municipio` (`id_municipio`),
  UNIQUE KEY `uq_municipio_ano` (`id_municipio`, `ano`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `municipios` (
  `id_municipio` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_ibge_municipio` BIGINT NOT NULL,
  `nome_municipio` VARCHAR(255) NOT NULL,
  `uf` VARCHAR(2) NOT NULL,
  `id_estado` BIGINT UNSIGNED NULL,
  `aliquota_ibs` DECIMAL(20,8) NULL DEFAULT 0.0,
  `aliquota_iss` DECIMAL(20,8) NULL DEFAULT 0.0,
  `aliquota_cbs` DECIMAL(20,8) NULL DEFAULT 0.0,
  `ano_aliquota` BIGINT NULL DEFAULT NULL,
  PRIMARY KEY (`id_municipio`),
  KEY `idx_municipios_id_estado` (`id_estado`),
  KEY `idx_municipios_uf_nome` (`uf`, `nome_municipio`),
  KEY `idx_municipios_codigo_ibge` (`codigo_ibge_municipio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pem_equipamentos` (
  `id_pem_equip` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_pem` BIGINT UNSIGNED NOT NULL,
  `codigo_equip` VARCHAR(120) NULL,
  `descricao_equip` TEXT NULL,
  `formula` TEXT NULL,
  `producao_horaria` DECIMAL(20,8) NULL,
  `num_unidades` DECIMAL(20,8) NULL DEFAULT 1.0,
  `utilizacao_operativa` DECIMAL(20,8) NULL DEFAULT 1.0,
  `utilizacao_improdutiva` DECIMAL(20,8) NULL DEFAULT 0.0,
  `ordem` BIGINT NULL DEFAULT 0,
  PRIMARY KEY (`id_pem_equip`),
  KEY `idx_pem_equipamentos_id_pem` (`id_pem`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pem_servicos` (
  `id_pem` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(120) NOT NULL,
  `servico` TEXT NOT NULL,
  `producao_equipe` DECIMAL(20,8) NULL,
  `unidade` VARCHAR(120) NULL,
  `observacoes` TEXT NULL,
  PRIMARY KEY (`id_pem`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pem_variaveis` (
  `id_var` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_pem_equip` BIGINT UNSIGNED NOT NULL,
  `letra` TEXT NOT NULL,
  `nome_variavel` VARCHAR(255) NOT NULL,
  `unidade` VARCHAR(120) NULL,
  `valor` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_var`),
  KEY `idx_pem_variaveis_id_pem_equip` (`id_pem_equip`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `perfis_bdi` (
  `id_perfil_bdi` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome_perfil` VARCHAR(255) NOT NULL,
  `tipo_obra` VARCHAR(120) NULL,
  `regime_tributario` VARCHAR(255) NULL DEFAULT 'Normal',
  `descricao` TEXT NULL,
  `bdi_percentual` DECIMAL(20,8) NULL DEFAULT 0,
  `situacao` VARCHAR(255) NULL DEFAULT 'Ativo',
  `usa_reforma_tributaria` BIGINT NULL DEFAULT 0,
  `vigencia` VARCHAR(32) NULL,
  `observacoes` TEXT NULL,
  `ano_orcamento` BIGINT NULL,
  `ivaeq_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `iss_percentual_manual` DECIMAL(20,8) NULL,
  `id_orcamento_ivaeq` BIGINT UNSIGNED NULL,
  `quartil` VARCHAR(120) NULL,
  `cbs_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `ibs_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `fator_efetivo_ivaeq` DECIMAL(20,8) NOT NULL DEFAULT 0.5,
  `percentual_mat_ivaeq` DECIMAL(20,8) NOT NULL DEFAULT 0.4,
  `credito_bdi_ivaeq` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `regime_previdenciario` VARCHAR(255) NOT NULL DEFAULT 'Onerado',
  `simples_faixa` BIGINT NULL,
  `simples_faixa_label` TEXT NULL,
  `simples_receita_limite` DECIMAL(20,8) NULL,
  `simples_aliquota_efetiva` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `simples_irpj_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `simples_csll_percentual` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `redutor_setorial_ivaeq` DECIMAL(20,8) NOT NULL DEFAULT 0.5,
  `redutor_governamental_ivaeq` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `usa_iva_manual` BIGINT NOT NULL DEFAULT 0,
  `simples_rbt12` DECIMAL(20,8) NOT NULL DEFAULT 0.0,
  `usa_simples_efetiva_manual` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id_perfil_bdi`),
  KEY `idx_perfis_bdi_filtros` (`ano_orcamento`, `tipo_obra`, `regime_previdenciario`, `quartil`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `perfis_encargos` (
  `id_perfil` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome_perfil` VARCHAR(255) NOT NULL,
  `categoria` VARCHAR(80) NOT NULL,
  `regime` VARCHAR(255) NOT NULL DEFAULT 'Normal',
  `uf_referencia` VARCHAR(32) NULL,
  `id_data_base` BIGINT UNSIGNED NULL,
  `descricao` TEXT NULL,
  `total_grupo_a` DECIMAL(20,8) NULL DEFAULT 0,
  `total_grupo_b` DECIMAL(20,8) NULL DEFAULT 0,
  `total_grupo_c` DECIMAL(20,8) NULL DEFAULT 0,
  `total_grupo_d` DECIMAL(20,8) NULL DEFAULT 0,
  `encargo_total` DECIMAL(20,8) NULL DEFAULT 0,
  `observacoes` TEXT NULL,
  `situacao` VARCHAR(255) NULL DEFAULT 'Ativo',
  `vigencia` VARCHAR(255) NULL DEFAULT '01/2026',
  `fonte_referencia` VARCHAR(255) NOT NULL DEFAULT 'SINAPI',
  `vigencia_inicio` VARCHAR(32) NULL,
  `vigencia_fim` VARCHAR(32) NULL,
  `encargo_original_percentual` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_perfil`),
  KEY `idx_perfis_encargos_id_data_base` (`id_data_base`),
  KEY `idx_perfis_encargos_filtros` (`fonte_referencia`, `uf_referencia`, `categoria`, `regime`, `vigencia_inicio`, `vigencia_fim`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `precos_equipamentos` (
  `id_preco_eq` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_equip` BIGINT UNSIGNED NOT NULL,
  `id_data_base` BIGINT UNSIGNED NULL,
  `id_fonte` BIGINT UNSIGNED NULL,
  `uf_referencia` VARCHAR(32) NULL,
  `preco_aquisicao` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `preco_combustivel` DECIMAL(20,8) NULL DEFAULT 0,
  `preco_operador_hora` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_depreciacao` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_juros` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_manutencao` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_materiais` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_mao_obra` DECIMAL(20,8) NULL DEFAULT 0,
  `custo_imp_seguros` DECIMAL(20,8) NULL DEFAULT 0,
  `chp_calculado` DECIMAL(20,8) NULL DEFAULT 0,
  `chi_calculado` DECIMAL(20,8) NULL DEFAULT 0,
  `data_calculo` TEXT NULL,
  `observacoes` TEXT NULL,
  PRIMARY KEY (`id_preco_eq`),
  KEY `idx_precos_equipamentos_id_fonte` (`id_fonte`),
  KEY `idx_precos_equipamentos_id_data_base` (`id_data_base`),
  KEY `idx_precos_equipamentos_id_equip` (`id_equip`),
  KEY `idx_precos_equipamentos_ref` (`id_equip`, `id_data_base`, `uf_referencia`, `id_fonte`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `precos_insumos` (
  `id_preco` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_insumo` BIGINT UNSIGNED NOT NULL,
  `id_data_base` BIGINT UNSIGNED NULL,
  `id_fonte` BIGINT UNSIGNED NULL,
  `uf_referencia` VARCHAR(32) NULL,
  `preco_desonerado` DECIMAL(20,8) NULL DEFAULT 0,
  `preco_nao_desonerado` DECIMAL(20,8) NULL DEFAULT 0,
  `preco_referencia` DECIMAL(20,8) NOT NULL DEFAULT 0,
  `cbs_percentual` DECIMAL(20,8) NULL DEFAULT 0,
  `ibs_percentual` DECIMAL(20,8) NULL DEFAULT 0,
  `is_percentual` DECIMAL(20,8) NULL DEFAULT 0,
  `iva_equivalente` DECIMAL(20,8) NULL DEFAULT 0,
  `preco_sem_tributos` DECIMAL(20,8) NULL DEFAULT 0,
  `data_coleta` TEXT NULL,
  `observacoes` TEXT NULL,
  `encargos_sociais_percentual` DECIMAL(20,8) NULL,
  PRIMARY KEY (`id_preco`),
  KEY `idx_precos_insumos_id_fonte` (`id_fonte`),
  KEY `idx_precos_insumos_id_data_base` (`id_data_base`),
  KEY `idx_precos_insumos_id_insumo` (`id_insumo`),
  KEY `idx_precos_insumos_latest` (`id_insumo`, `id_preco`),
  KEY `idx_precos_insumos_ref` (`id_insumo`, `id_data_base`, `uf_referencia`),
  KEY `idx_precos_insumos_fonte` (`id_fonte`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `unidades_medida` (
  `id_unidade` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sigla` TEXT NOT NULL,
  `descricao` TEXT NULL,
  `tipo_unidade` VARCHAR(120) NULL,
  PRIMARY KEY (`id_unidade`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 1;
