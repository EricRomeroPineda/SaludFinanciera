-- Ejecutar una sola vez sobre la base existente antes de iniciar el backend.
ALTER TABLE usuario
  MODIFY COLUMN foto_perfil MEDIUMTEXT NULL,
  MODIFY COLUMN tema VARCHAR(20) NULL DEFAULT 'verde',
  ADD COLUMN recovery_key_hash VARCHAR(60) NULL,
  ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0;

UPDATE usuario SET tema = 'verde' WHERE tema IS NULL OR tema NOT IN ('verde', 'azul', 'violeta', 'oscuro');

ALTER TABLE usuario MODIFY COLUMN tema VARCHAR(20) NOT NULL DEFAULT 'verde';
