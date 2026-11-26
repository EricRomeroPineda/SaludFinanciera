ALTER TABLE usuario
  ADD COLUMN apariencia ENUM('day', 'night') NOT NULL DEFAULT 'day';

UPDATE usuario SET apariencia = 'night' WHERE tema = 'oscuro';
