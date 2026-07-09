-- OrcaSmart2 - Fase 4 - Schema MySQL/MariaDB
-- Dominio: Master SaaS
-- Gerado em: 2026-07-09T23:01:29.055Z
-- Inventario base: 2026-07-09T22:40:43.616Z
-- Revisar antes de executar em producao.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `admin_audit_log` (
  `id_audit_log` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_admin_user` BIGINT UNSIGNED NULL,
  `id_tenant` BIGINT UNSIGNED NULL,
  `action` VARCHAR(120) NOT NULL,
  `entity_type` VARCHAR(120) NULL,
  `entity_id` VARCHAR(191) NULL,
  `details_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_audit_log`),
  KEY `idx_admin_audit_log_admin` (`id_admin_user`),
  KEY `idx_admin_audit_log_tenant` (`id_tenant`),
  KEY `idx_admin_audit_log_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id_subscription` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_user` BIGINT NOT NULL,
  `stripe_subscription_id` TEXT NULL,
  `stripe_customer_id` TEXT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'trial',
  `current_period_end` BIGINT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_subscription`),
  KEY `idx_subscriptions_id_user` (`id_user`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenants` (
  `id_tenant` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome` TEXT NOT NULL,
  `slug` TEXT NOT NULL,
  `db_path` TEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ativo',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_tenant`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id_user` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_tenant` BIGINT NOT NULL,
  `nome` TEXT NOT NULL,
  `email` TEXT NOT NULL,
  `password_hash` TEXT NOT NULL,
  `role` VARCHAR(255) NOT NULL DEFAULT 'owner',
  `status` VARCHAR(255) NOT NULL DEFAULT 'ativo',
  `stripe_customer_id` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_user`),
  KEY `idx_users_id_tenant` (`id_tenant`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 1;
