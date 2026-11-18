-- Conserva los campos existentes de recuperacion; no agrega columnas.
-- Puede volver a ejecutarse si ya se aplico una version anterior.
-- foto_perfil conserva su tipo actual: solo se guardan URL de hasta 500 caracteres.
ALTER TABLE usuario
  MODIFY COLUMN tema VARCHAR(20) NULL DEFAULT 'verde';

UPDATE usuario SET tema = 'verde' WHERE tema IS NULL OR tema NOT IN ('verde', 'azul', 'violeta', 'oscuro');

ALTER TABLE usuario MODIFY COLUMN tema VARCHAR(20) NOT NULL DEFAULT 'verde';
