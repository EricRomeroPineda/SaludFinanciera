CREATE TABLE movimiento_evidencia (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_movimiento INT UNSIGNED NOT NULL,
  archivo CHAR(41) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_evidencia_archivo (archivo),
  KEY ix_evidencia_movimiento (id_movimiento),
  CONSTRAINT fk_evidencia_movimiento FOREIGN KEY (id_movimiento)
    REFERENCES movimiento(id) ON DELETE CASCADE
) ENGINE=InnoDB;
