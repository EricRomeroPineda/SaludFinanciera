# Salud Financiera

## Ejecutar en Windows junto a MySQL

1. Instala Node.js y asegúrate de que MySQL esté iniciado y que exista la base `salud_financiera` con el esquema actual.
2. En PowerShell, desde la raíz del proyecto, ejecuta `Copy-Item .env.example .env`.
3. En `.env`, configura `DB_PASSWORD` con la contraseña local de MySQL. Para generar `SESSION_SECRET`, ejecuta `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y copia el resultado. No compartas ni subas `.env`.
4. Ejecuta `npm ci`.
5. Si necesitas normalizar los temas existentes, ejecuta `server/migrations/001-user-profile.sql` desde MySQL Workbench u otro cliente MySQL. No agrega columnas ni modifica `foto_perfil VARCHAR(500)`. Haz un respaldo antes de aplicar la migración.
6. En una terminal, ejecuta `npm run server`.
7. En otra terminal, ejecuta `npm run dev`. Abre la dirección local que indique Vite.

El backend verifica la conexión al arrancar. También puedes comprobarla en `http://127.0.0.1:3001/api/health/db`. El endpoint no devuelve las credenciales de conexión.

## Perfil, temas y recuperación

Al iniciar sesión o restaurar una sesión se muestra un **Menú principal** con la opción **Salud financiera**, que abre el panel existente (Panorama, Tarjetas y las demás pestañas). Desde el panel se puede volver al menú. La barra superior agrupa la foto y el nombre del usuario autenticado junto a **Cerrar sesión** en ambas pantallas; al pulsar el perfil se abre **Mi perfil**. Si falta la URL o no carga, se muestra una imagen de perfil genérica, no una inicial.

Al registrarse se solicita la URL HTTPS de una foto (máximo 500 caracteres) y una palabra clave de recuperación. Solo se guarda la URL en `foto_perfil VARCHAR(500)`, no se suben archivos ni se admiten imágenes base64. La URL debe seguir disponible públicamente. La foto aparece junto al nombre al iniciar sesión y al restaurar la sesión. No es necesario ampliar el campo de foto; si ya lo ampliaste, puede conservarse sin cambios.

En **Mi perfil** se puede actualizar la foto y seleccionar **Verde, Azul, Violeta u Oscuro**. Cada cambio de tema se guarda automáticamente en `usuario.tema` y se recupera al volver a entrar, incluido el calendario. Los usuarios existentes pueden configurar su palabra clave desde esta sección, confirmando su contraseña actual.

La tabla `usuario` utiliza los campos existentes `id`, `nombre`, `password_hash`, `recuperacion_token_hash`, `recuperacion_expira`, `foto_perfil` y `tema`. Las solicitudes JSON tienen un límite de 16 KB; el login solo envía usuario y contraseña, sin reenviar la foto.

El registro y **Guardar perfil** leen la URL directamente del formulario y la guardan en `usuario.foto_perfil`. `npm run server` recarga el backend cuando cambia su código. Si aparece «Ruta no encontrada» en una operación de perfil, detén el proceso anterior y vuelve a ejecutar `npm run server` desde este proyecto.

**Olvidé mi contraseña** solicita usuario, palabra clave y una contraseña nueva. La palabra clave no distingue mayúsculas y se guarda con bcrypt en `recuperacion_token_hash`, nunca en texto claro; `recuperacion_expira` queda en `NULL` al configurarla porque es una clave permanente, no un enlace temporal. Los valores con expiración vencida o hashes de tokens antiguos no sirven como palabra clave; configura una desde **Mi perfil**. Usa una frase difícil de adivinar y distinta de tu contraseña. Las sesiones están vinculadas mediante HMAC al hash de contraseña, por lo que un restablecimiento invalida las sesiones anteriores sin requerir otra columna; las sesiones del formato anterior deberán iniciar sesión de nuevo. La recuperación limita los intentos por usuario e IP durante 15 minutos; estos contadores viven en el proceso del backend y requieren un almacén compartido si se despliega más de una instancia.

## Carpetas principales

- `src/inicio`: registro/inicio de sesión y panel web.
- `src/api.js`: cliente HTTP del frontend.
- `server/auth.js`: registro, autenticación y sesiones.
- `server/dashboard.js`: lecturas privadas por usuario y gestión de cuentas.
- `server/movements.js`: registro, edición y eliminación transaccional de movimientos.
- `server/modules.js`: gestión de suscripciones y planes futuros.
- `server/db.js`: pool MySQL configurado con variables de entorno.

Las contraseñas de usuarios nuevos se guardan con bcrypt. Cada consulta financiera usa el `id` del usuario autenticado. El panel muestra cuentas, tarjetas, suscripciones, planes, movimientos y un calendario mensual con sus reportes. Las tarjetas usan cuentas cuyo tipo contiene “tarjeta” o “crédito”; desde su sección se consultan límite, saldo disponible y fechas de pago, y se puede iniciar un registro de pago como transferencia. Las cuentas se pueden editar y eliminar si no tienen movimientos asociados; su saldo disponible se cambia únicamente mediante movimientos para preservar el historial. El esquema actual no incluye tablas para deudas ni configuración de sugerencias, por lo que esas funciones no se representan como datos persistidos.
