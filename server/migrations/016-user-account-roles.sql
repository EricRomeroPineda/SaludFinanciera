ALTER TABLE usuario
  MODIFY COLUMN rol ENUM('usuario', 'admin', 'free', 'vip') NOT NULL DEFAULT 'free';

UPDATE usuario SET rol = 'free' WHERE rol = 'usuario' AND id <> 2;
UPDATE usuario SET rol = 'admin' WHERE id = 2;

ALTER TABLE usuario
  MODIFY COLUMN rol ENUM('admin', 'free', 'vip') NOT NULL DEFAULT 'free';

DELIMITER //
CREATE TRIGGER proteger_admin_principal
BEFORE UPDATE ON usuario
FOR EACH ROW
BEGIN
  IF (OLD.id = 2 AND (NEW.id <> 2 OR NEW.rol <> 'admin'))
     OR (NEW.id = 2 AND NEW.rol <> 'admin') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El usuario ID 2 debe conservar el rol Admin.';
  END IF;
END//
DELIMITER ;
