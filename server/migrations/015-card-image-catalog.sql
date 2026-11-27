ALTER TABLE usuario
  ADD COLUMN rol ENUM('usuario', 'admin') NOT NULL DEFAULT 'usuario';

CREATE TABLE catalogo_tarjeta_imagen (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  palabra VARCHAR(150) NOT NULL,
  normalizada VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (LOWER(TRIM(palabra))) STORED,
  ambito VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clase ENUM('general', 'producto') NOT NULL DEFAULT 'general',
  archivo VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalogo_regla_ambito (ambito, normalizada)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE catalogo_tarjeta_alias (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_regla INT UNSIGNED NOT NULL,
  ambito VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  palabra VARCHAR(150) NOT NULL,
  normalizada VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalogo_alias_ambito (ambito, normalizada),
  CONSTRAINT chk_catalogo_alias_normalizada CHECK (
    BINARY normalizada = BINARY LOWER(TRIM(normalizada))
    AND normalizada <> '' AND normalizada NOT LIKE '%  %'
    AND normalizada NOT REGEXP '[^[:alnum:] ]'
  ),
  CONSTRAINT fk_catalogo_alias_regla FOREIGN KEY (id_regla)
    REFERENCES catalogo_tarjeta_imagen(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
