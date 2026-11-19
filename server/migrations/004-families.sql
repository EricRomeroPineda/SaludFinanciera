CREATE TABLE familia (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  id_creador INT UNSIGNED NOT NULL,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_familia_creador FOREIGN KEY (id_creador) REFERENCES usuario(id)
) ENGINE=InnoDB;

CREATE TABLE familia_integrante (
  id_familia INT UNSIGNED NOT NULL,
  id_usuario INT UNSIGNED NOT NULL,
  fecha_union TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_familia, id_usuario),
  UNIQUE KEY uq_integrante_usuario (id_usuario),
  CONSTRAINT fk_integrante_familia FOREIGN KEY (id_familia) REFERENCES familia(id) ON DELETE CASCADE,
  CONSTRAINT fk_integrante_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id)
) ENGINE=InnoDB;

CREATE TABLE familia_invitacion (
  codigo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id_familia INT UNSIGNED NOT NULL,
  vence_en DATETIME NOT NULL,
  PRIMARY KEY (codigo_hash),
  KEY ix_invitacion_familia (id_familia),
  CONSTRAINT fk_invitacion_familia FOREIGN KEY (id_familia) REFERENCES familia(id) ON DELETE CASCADE
) ENGINE=InnoDB;
