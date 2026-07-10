-- OrcaSmart2 - Fase 4 - Schema MySQL/MariaDB
-- Dominio: Master SaaS
-- Gerado em: 2026-07-09T23:58:00.487Z
-- Inventario base: 2026-07-09T22:40:43.616Z
-- Revisar antes de executar em producao.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `admin_audit_log` (
  `id_log` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_admin` BIGINT UNSIGNED NULL,
  `admin_email` VARCHAR(191) NULL,
  `acao` VARCHAR(191) NOT NULL,
  `entidade_tipo` VARCHAR(120) NOT NULL,
  `entidade_id` VARCHAR(191) NOT NULL,
  `antes` LONGTEXT NULL,
  `depois` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_log`),
  KEY `idx_admin_audit_log_admin` (`id_admin`),
  KEY `idx_admin_audit_log_entidade` (`entidade_tipo`, `entidade_id`),
  KEY `idx_admin_audit_log_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id_subscription` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_user` BIGINT UNSIGNED NOT NULL,
  `stripe_subscription_id` VARCHAR(191) NULL,
  `stripe_customer_id` VARCHAR(191) NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'trial',
  `current_period_end` BIGINT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_subscription`),
  KEY `idx_subscriptions_id_user` (`id_user`),
  KEY `idx_subscriptions_status` (`status`),
  KEY `idx_subscriptions_stripe_subscription` (`stripe_subscription_id`),
  KEY `idx_subscriptions_stripe_customer` (`stripe_customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenants` (
  `id_tenant` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `db_path` VARCHAR(500) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ativo',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_tenant`),
  UNIQUE KEY `uq_tenants_slug` (`slug`),
  KEY `idx_tenants_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id_user` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_tenant` BIGINT UNSIGNED NOT NULL,
  `nome` VARCHAR(255) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(255) NOT NULL DEFAULT 'owner',
  `status` VARCHAR(255) NOT NULL DEFAULT 'ativo',
  `stripe_customer_id` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_user`),
  KEY `idx_users_id_tenant` (`id_tenant`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_tenant_status` (`id_tenant`, `status`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 1;
