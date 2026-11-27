ALTER TABLE movimiento
  ADD COLUMN archivo_familiar ENUM('enviada', 'recibida') NULL DEFAULT NULL;

CREATE TABLE archivo_borrado_pendiente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo ENUM('evidencia', 'perfil') NOT NULL,
  referencia VARCHAR(500) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4;

DELIMITER //
CREATE TRIGGER impedir_eliminar_admin_principal
BEFORE DELETE ON usuario
FOR EACH ROW
BEGIN
  IF OLD.id = 2 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El administrador ID 2 no se puede eliminar.';
  END IF;
END//
DELIMITER ;
