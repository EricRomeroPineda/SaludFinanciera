# Salud Financiera

## Ejecutar en Windows junto a MySQL

1. Instala Node.js y asegúrate de que MySQL esté iniciado y que exista la base `salud_financiera` con el esquema actual.
2. Conserva tu `.env` existente. Solo si no existe, en PowerShell, desde la raíz del proyecto, ejecuta `Copy-Item .env.example .env`.
3. En `.env`, configura `DB_PASSWORD` con la contraseña local de MySQL. Para generar `SESSION_SECRET`, ejecuta `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y copia el resultado. No compartas ni subas `.env`.
4. Ejecuta `npm ci`.
5. Si necesitas normalizar los temas existentes, ejecuta `server/migrations/001-user-profile.sql` desde MySQL Workbench u otro cliente MySQL. No agrega columnas ni modifica `foto_perfil VARCHAR(500)`. Haz un respaldo antes de aplicar la migración.
6. Ejecuta `npm run serve` y abre `http://127.0.0.1:3001` (o el puerto configurado en `.env`). Primero compila; solo si el build termina correctamente inicia Node sin modo watch. El mismo servidor entrega `dist/index.html`, sus archivos compilados y `/api`, sin necesidad de Vite en ejecución.

Para desarrollo se conservan los dos comandos en terminales separadas: `npm run server` y `npm run dev`. Vite reenvía `/api` al backend local. El navegador usa rutas relativas del mismo origen en ambos modos. Los cambios al frontend requieren volver a ejecutar `npm run serve` para recompilar; no sobrescribas `.env` ni cambies la configuración de MySQL o `SESSION_SECRET` para usar este comando.

El backend verifica la conexión al arrancar. También puedes comprobarla en `http://127.0.0.1:3001/api/health/db`. El endpoint no devuelve las credenciales de conexión.

## Correo verificado y palabra clave de recuperación

En **Olvidé mi contraseña** primero se valida que el correo esté registrado y verificado. Si existe, se bloquea el campo y aparecen debajo tres acciones compactas con iconos: recuperar contraseña por correo, recuperarla con palabra clave y cambiar la palabra clave por correo. Seleccionar un icono cambia la explicación y resalta la opción, pero no envía correos: para las opciones por correo aparece un botón de envío específico. El lápiz permite editar el correo, descarta la autorización y oculta las opciones hasta volver a validarlo. El campo de palabra clave solo se crea al elegir esa opción, empieza vacío y solicita al navegador no reutilizar credenciales guardadas (`autocomplete="new-password"`); los gestores de contraseñas externos pueden ignorar esta indicación.

Solo después de que el servidor valide **correo y palabra clave** aparece **Nueva contraseña**; la autorización es de un solo uso y caduca en 10 minutos. También se puede solicitar, sin iniciar sesión ni conocer la palabra clave, un enlace al correo verificado para **recuperar contraseña** o **cambiar la palabra clave**. Estos enlaces caducan en 30 minutos, reemplazan los anteriores del mismo tipo y solo sirven una vez. El chequeo inicial confirma la existencia de un correo verificado por decisión de producto, con límites por IP y correo para reducir enumeración; no demuestra propiedad ni autoriza cambios. El envío conserva respuesta genérica y nunca se envía nada a correos inexistentes o sin verificar. Los fallos de SMTP se muestran explícitamente.

Antes de usar estos flujos ejecuta una sola vez `server/migrations/012-email-password-recovery.sql`. Se añade el propósito `reset-password` a la tabla de enlaces existente; los enlaces ya emitidos se conservan. Se aplican límites de intentos por correo/IP y la espera de 30 segundos entre envíos. Al guardar una contraseña nueva se invalidan las sesiones anteriores por su versión de contraseña. El endpoint antiguo de recuperación por usuario y palabra clave se mantiene por compatibilidad, pero también exige correo verificado. La opción con palabra clave aparece primero y queda seleccionada al validar el correo.

Ejecuta `server/migrations/010-user-email.sql` una sola vez. En **Mi perfil → Correo electrónico y recuperación**, registra un correo único y confirma tu contraseña actual. Se enviará un enlace para verificar la dirección; si ya está registrada en otra cuenta se mostrará el error. Hasta verificarla no se puede solicitar el enlace para cambiar la palabra clave. Una vez verificado, el correo no se puede cambiar desde la aplicación (se bloquea tanto en pantalla como en la API). Puedes iniciar sesión con tu usuario o tu correo verificado y tu contraseña; los correos sin verificar no permiten acceso por correo.

Después de enviar un correo se muestra una confirmación y una cuenta regresiva de 30 segundos para reenviar. El servidor aplica también esta espera, incluso al recargar la página. El ojo solo muestra la contraseña que escribes, nunca recupera una contraseña guardada.

Configura en el `.env` privado `APP_BASE_URL=https://lifekit.work`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD` (contraseña de aplicación de Gmail con verificación en dos pasos) y `SMTP_FROM` (misma cuenta o alias autorizado). No compartas estas credenciales. Gmail y sus límites de envío aplican; revisa también spam. Cloudflare debe dirigir el dominio a esta aplicación y no almacenar en caché `/api/*`. No se requiere abrir MySQL a Internet.

Los enlaces usan tokens aleatorios guardados solo como hash, caducan a los 30 minutos y se consumen una sola vez al confirmar la acción; reenviar invalida el enlace anterior del mismo tipo. La URL se construye con `APP_BASE_URL`, no con la cabecera Host. El token viaja en el fragmento del enlace y se retira de la barra de direcciones al abrir la pantalla. No se envían correos al arrancar: únicamente por una acción explícita. Los envíos y canjes están limitados a cinco intentos por 15 minutos (usuario o dirección de conexión, respectivamente; detrás del túnel algunas conexiones pueden compartir límite).

**Generar y enviarme una palabra clave** crea una clave aleatoria de 24 caracteres, reemplaza la anterior y la envía al correo verificado. Solo se almacena su hash bcrypt, nunca el texto; no se muestra en pantalla ni se devuelve en la API. Invalida los enlaces de cambio anteriores y comparte la espera de 30 segundos con los demás envíos. No cambia la contraseña de acceso. Si SMTP falla, se revierte la sustitución.

**Enviar enlace para cambiar mi palabra clave** permite elegir tu propia clave desde un enlace temporal, sin iniciar sesión; después podrás usarla en «Olvidé mi contraseña» junto con tu correo verificado. Su edición directa ya no está disponible en el perfil ni en su API. La contraseña y palabra clave existentes no se pueden consultar porque se guardan como hashes; el ojo solo revela los valores nuevos que escribes. El servidor debe disponer de acceso saliente a Gmail SMTP.

## Color y modo día/noche

Aplica `server/migrations/009-user-appearance.sql` antes de iniciar esta versión. El icono de paleta, junto a Día/Noche en el encabezado, abre un cuadro para seleccionar Verde, Azul, Violeta, Turquesa, Rosa, Naranja, Rojo, Dorado u Oscuro. El selector ya no aparece en el formulario del perfil. El color tiñe el fondo, paneles, bordes y controles; el modo nocturno conserva la misma paleta en tonos más oscuros. Los colores de ingresos, gastos y transferencias mantienen su significado. Los nuevos colores usan la columna `tema VARCHAR(20)` existente; no requieren una migración adicional.

Ambas preferencias se guardan por usuario en MySQL (`tema` y `apariencia`) y se recuperan al iniciar sesión o recargar. Cambiar color no cambia el modo día/noche y viceversa. Si falla el guardado se muestra el error y se conserva la apariencia anterior. En la pantalla de acceso, sin usuario, Día/Noche solo cambia esa vista temporalmente. La migración conserva el modo nocturno de los usuarios que ya tenían el tema Oscuro. Los botones de editar usan un lápiz con descripción y nombre accesible.

## Vistas y orden de los registros

El icono superior del área financiera alterna entre **Individual** (una persona) y **Familiar** (grupo de personas). Solo aparece después de confirmar que el usuario pertenece a una familia; si falla esa consulta se informa el error y se permite reintentar sin bloquear los datos individuales. Familiar permite consultar y, desde las tarjetas de otros integrantes, **Registrar movimiento especial** para pagar o transferir desde cuentas propias. Para otros registros o editar hay que regresar a Individual. El botón indica la vista actual y la acción disponible al pasar el cursor o usar un lector de pantalla.

En **Suscripciones, Planes futuros, Deudores y Tarjetas**, el botón con icono de **lista / cuadrícula** cambia la presentación sin modificar los datos ni la selección del historial; su descripción indica «Ver lista» o «Ver tarjetas» al pasar el cursor y para lectores de pantalla. El área financiera y su encabezado usan `calc(100% - 150px)` en PC, con márgenes laterales de 75 px; en móvil conservan sus márgenes reducidos. Los botones para agregar muestran un icono junto al texto. La lista usa filas compactas con información y acciones en columnas en pantallas amplias, y se adapta a móvil sin ocultar datos. Las dos vistas mantienen la información, acciones y consulta de movimientos, también en la vista familiar de solo lectura.

El orden es por menor tiempo para el próximo pago, aportación o compromiso; los vencidos aparecen primero. Los planes usan su próxima aportación calculada y las suscripciones su próximo cobro programado. Los registros liquidados, cancelados o sin fecha calculable quedan al final; los empates se ordenan por nombre. Deudores se divide en **Me deben** y **Yo debo**, ordenados por fecha compromiso dentro de cada grupo. Tarjetas conserva sus grupos **Nómina / Débito / Efectivo** y **Crédito**, ordenando el crédito por fecha límite pendiente dentro de su grupo. Débito y efectivo, sin vencimiento, se ordenan por nombre. Cada sección mantiene su modo de vista mientras permanece abierta; Tarjetas y Planes tienen controles independientes.

## Panorama: actividad y pagos de tarjetas

Los iconos de calendario de Panorama abren un selector de meses o años, sin desplegables de texto. Usa las flechas para navegar y elige un mes para consultar ese mes o un año para consultar el año completo. Escape cierra el selector y «Mes actual» restablece la consulta. En el tema Oscuro, el modo día usa fondo y paneles blancos; el modo noche conserva sus tonos oscuros.

Aplica `server/migrations/008-card-payment-confirmation.sql` antes de iniciar esta versión. Los ingresos y gastos del mes/año se suman desde todos los movimientos del periodo, sin el límite de 250 registros recientes. Se excluyen transferencias entre cuentas y operaciones de préstamos, igual que en Movimiento. La vista familiar suma la actividad de sus integrantes.

Los pagos con vencimiento del día **1 al 14** se presupuestan en el mes anterior; los del 15 en adelante en su propio mes. El importe pendiente se arrastra al mes actual hasta cubrirlo. Por ejemplo, el pago del 10 de enero se muestra en diciembre y, si queda pendiente, pasa a enero. Dos días antes y el día límite se marca como urgente; después del vencimiento aparece una advertencia para revisar con el banco el nuevo importe para no generar intereses. La aplicación no calcula intereses ni cambia por sí sola el importe o la fecha del banco.

Se suman las transferencias registradas hacia la tarjeta desde el día siguiente a su fecha límite anterior (la fecha límite capturada menos un mes) hasta hoy. Así se admiten abonos parciales y anticipados al corte, sin contar pagos del ciclo anterior, préstamos ni movimientos futuros. El saldo pendiente es el importe requerido menos estos abonos, nunca negativo. Editar o eliminar un movimiento recalcula el resultado. Registra como transferencia los pagos hechos desde efectivo u otra cuenta; una compra o un ingreso no se considera abono de tarjeta.

Al registrar un movimiento, los checks excluyentes permiten elegir **Registro normal** (predeterminado, con operación Gasto/Ingreso/Transferencia editable), **Abono a préstamo**, **Suscripción relacionada**, **Aportación a plan · Inversión** o, si perteneces a una familia, **Movimiento familiar**. Los modos relacionados fijan la operación: suscripciones e inversiones son gastos que salen de la cuenta; abonos «Yo debo» son salidas y «Me deben» son entradas; el movimiento familiar es una transferencia a otro integrante. Cada modo muestra únicamente su relación obligatoria y no combina plan, suscripción o categoría. El dinero invertido sigue descontándose de la cuenta y acumulándose en el plan, pero Panorama lo muestra por separado en **Inversión del periodo**, sin sumarlo también a **Gastos del periodo**; incluye las aportaciones de movimientos anteriores y funciona en vista individual y familiar.

Desde una suscripción, **Registrar movimiento** abre un gasto con la suscripción, su costo por cobro y la fecha actual precargados; el monto se puede ajustar antes de guardar. Desde una tarjeta de crédito, **Registrar pago** abre una transferencia hacia la tarjeta y propone como monto el pago para no generar intereses si está capturado. En la vista familiar estas acciones de registro no están disponibles.

**Confirmar pago manualmente**, en Panorama o Tarjetas, cubre el importe del vencimiento capturado sin crear movimientos ni modificar saldos; requiere confirmación y puede deshacerse. Se guarda para esa fecha e importe: al cambiar cualquiera de ellos se deja de considerar confirmado. Una confirmación manual tampoco modifica los eventos ya exportados a Google. La vista familiar es de solo consulta. Se conserva únicamente el último corte de cada tarjeta, no un historial de estados de cuenta; actualiza sus datos al recibir el siguiente corte.

## Recordatorios en Google Calendar

En **Movimiento**, junto a los marcadores del calendario, **Sincronizar con Google Calendar** abre una vista previa del **mes seleccionado**. Consulta nuevamente los datos de tu usuario antes de mostrar pagos de tarjetas, suscripciones, aportaciones y compromisos de deudas. No exporta los movimientos realizados, archivos de evidencia, contraseñas ni datos bancarios de conexión. Está disponible únicamente en vista Individual; cada usuario autoriza la cuenta Google de su elección.

Selecciona los marcadores, revisa los nombres, fechas, montos y datos de depósito opcionales, marca el consentimiento y pulsa **Autorizar y enviar**. Por cada compromiso se crean **tres eventos privados** de 15 minutos en el **calendario principal**, todos el **día límite**, a las **09:00, 14:00 y 21:00**. Cada evento tiene un aviso un día antes a su misma hora y otro al comenzar (seis avisos en total). Se utiliza la zona horaria del navegador al sincronizar, no una hora editable. Activa los permisos y notificaciones de Google Calendar en el móvil/navegador; la aplicación no garantiza la entrega si Google o el dispositivo los bloquean. Los avisos ya vencidos no se envían retroactivamente. Los marcadores de días anteriores aparecen desmarcados; las referencias de suscripciones sin fecha exacta de inicio no se pueden enviar.

### Datos de depósito opcionales

El icono **Copiar datos de depósito** copia el texto completo, conservando ceros iniciales, desde tarjetas, planes, suscripciones, deudas y la vista previa de Google Calendar. También está en los formularios y copia lo escrito en ese momento. Muestra confirmación o un error explícito si el navegador no permite acceder al portapapeles; requiere HTTPS o localhost.

Antes de ejecutar esta versión, respalda la base y aplica una sola vez `server/migrations/007-deposit-details.sql` en la base configurada en `.env`. Agrega `datos_deposito VARCHAR(500) NULL` a `cuenta`, `plan_futuro`, `suscripciones` y `prestamo`; no modifica registros ni saldos existentes.

Al crear una tarjeta o cuenta, primero eliges Crédito, Débito o Efectivo; después aparecen el nombre, el número de cuenta o CLABE opcional y los campos correspondientes al tipo. Al editar se conserva el tipo y se muestran sus datos. En tarjetas y cuentas, planes, suscripciones y deudas **Yo debo**, puedes capturar datos de depósito opcionales: banco, titular, cuenta, CLABE o referencia, en un texto de hasta 500 caracteres. Se guarda como texto para conservar ceros iniciales. No ingreses NIP, CVV ni contraseñas. En **Me deben** no se captura ni se incluye ese dato en los eventos. Cada registro conserva su propio destino de depósito, separado de la cuenta de origen/sugerida para movimientos: no se deduce automáticamente de dónde sale tu dinero.

El dato aparece en la tarjeta de detalle y en la vista previa; al consentir el envío se incluye en la descripción de **los tres eventos de Google** junto con el concepto, tipo, fecha límite y monto previsto. Si no existe se omite, sin impedir guardar o sincronizar. También puede verlo tu familia autorizada en la consulta conjunta, como los demás datos del registro. Los eventos son privados, pero revisa los permisos de tu calendario y los avisos en dispositivos compartidos antes de enviar información de depósito.

### Configuración inicial gratuita para uso personal

1. En [Google Cloud Console](https://console.cloud.google.com/), crea o elige un proyecto y habilita **Google Calendar API** en **APIs y servicios → Biblioteca**. Este uso de Calendar API no requiere un proveedor de mensajería ni tiene un costo adicional por evento, pero está sujeto a las cuotas y políticas de Google.
2. En **Google Auth Platform**, configura nombre de la aplicación, correo de soporte y audiencia. Para uso personal con cuentas Gmail, usa **Externo**, estado **Prueba**, y agrega los correos Google que usarás en **Usuarios de prueba**. Si Google muestra “access_denied”, comprueba primero esa lista. Publicarla para más usuarios puede requerir verificación de Google.
3. En **Acceso a los datos**, agrega el alcance `https://www.googleapis.com/auth/calendar.events.owned`. Google permite con ese permiso administrar eventos de los calendarios que posees; esta implementación solo accede a los identificadores de eventos de Salud Financiera en tu calendario principal y verifica su marca antes de modificarlos. No lee tu agenda completa ni toca eventos ajenos a la integración.
4. En **Clientes**, crea un cliente OAuth de tipo **Aplicación web**. En **Orígenes autorizados de JavaScript**, agrega `http://localhost` y `http://localhost:3001`. Para desarrollo agrega también `http://localhost:5173`, o el puerto real de Vite. El origen debe coincidir exactamente con el navegador (esquema, host y puerto), sin rutas. No hace falta configurar una URI de redirección: se usa una ventana emergente de Google Identity Services.
5. Copia únicamente el **ID del cliente**, terminado en `.apps.googleusercontent.com`, y agrega a tu `.env` existente:

   ```dotenv
   GOOGLE_CALENDAR_CLIENT_ID=TU_ID.apps.googleusercontent.com
   ```

   El ID es público y se entrega al navegador. **No agregues el secreto del cliente**: no se utiliza en este flujo. No cambies MySQL, `SESSION_SECRET` ni `API_HOST`.
6. Detén el servidor anterior y ejecuta `npm run serve`. Para esta integración abre **`http://localhost:3001`** (o el puerto configurado), aunque Node siga escuchando en `127.0.0.1`. Si antes usabas `127.0.0.1` en el navegador, inicia sesión de nuevo en `localhost`: las cookies no se comparten entre esos hosts. En desarrollo usa `http://localhost:5173` y el proxy existente. Permite ventanas emergentes y acceso a `accounts.google.com` y `www.googleapis.com`.

La conexión a Google no requiere otra tabla, una API pública de MySQL, un servicio programado ni una PC encendida después del envío: Google conserva los eventos y maneja los avisos. Solo los nuevos campos opcionales de depósito requieren la migración indicada arriba. La sincronización es manual y requiere internet y la aplicación abierta al enviar. El permiso de acceso se mantiene solo en memoria durante cada envío; no se guarda en MySQL, archivos, cookies ni almacenamiento del navegador. Se descarta al terminar. Puedes revocar el permiso en [las conexiones de tu cuenta Google](https://myaccount.google.com/connections).

### Actualizaciones, reintentos y límites

Los identificadores son deterministas por usuario, origen y periodo: reenviar el mismo marcador a la misma cuenta Google actualiza fecha, hora y monto, en lugar de duplicarlo. Los compromisos de deudas conservan su identidad si cambian de mes; las aportaciones, suscripciones y tarjetas se identifican por mes y ocurrencia. Cambiar el número de ocurrencias de una programación puede reasignar los recordatorios de ese mes. No cambies `SESSION_SECRET` para configurar Google: además de invalidar sesiones, cambia la identidad de sincronización de los usuarios y los eventos anteriores dejarían de reconocerse.

Cada compromiso muestra su resultado solo cuando se guardaron sus tres eventos. Ante un fallo parcial, se indican los horarios guardados y desde cuál falta completar; se permite reintentar sin duplicarlos. Si una respuesta se pierde tras crear un evento, repetir usa el mismo identificador. **Vuelve a sincronizar los meses ya enviados para aplicar el formato de tres eventos**: el evento original conserva su ID a las 21:00; el antiguo evento del día anterior se mueve a las 09:00 del día límite conservando su ID; solo se añade el de las 14:00. No es necesario borrar previamente los eventos ni ejecutar SQL para este cambio de horarios.

Un evento borrado en Google debe restaurarse de la papelera antes de reenviarlo. Los eventos desmarcados no se actualizan ni borran. **No hay eliminación automática**: al liquidar una deuda, cancelar una suscripción o reducir aportaciones, revisa y borra manualmente los tres eventos anteriores en Google. Tampoco se registran pagos ni se modifican saldos al sincronizar. Los cambios manuales de título, fecha, monto u hora en los eventos de la integración se sobrescriben al reenviarlos.

## Evidencia opcional en movimientos

Antes de usar esta versión, respalda la base y ejecuta una sola vez `server/migrations/006-movement-evidence.sql` en la base configurada en `.env`; crea `movimiento_evidencia`, relacionada con `movimiento.id`. Ejecuta `npm ci` para instalar las dependencias actualizadas y reinicia el servidor (`npm run serve` recompila también el frontend). No hay cambios en las credenciales ni en la configuración de MySQL.

Al crear o editar un movimiento puedes adjuntar hasta **5 imágenes JPG, PNG o WebP**, de **5 MB como máximo cada una**, sin animación. Las imágenes de más de **20 megapíxeles se reducen automáticamente**, conservando su proporción; se rechazan las que superen 100 megapíxeles para limitar el uso de memoria. Ninguna imagen es obligatoria. Se validan decodificándolas y se convierten a WebP de calidad 90, corrigiendo orientación y eliminando metadatos (incluida ubicación); no son una copia idéntica del archivo original.

Ejecuta una sola vez `server/migrations/011-evidence-user-storage.sql` antes de actualizar el backend; amplía `movimiento_evidencia.archivo` para guardar referencias relativas. Las nuevas imágenes se guardan en `<PROFILE_PHOTO_DIR>/<correo-verificado>/movimientos/<uuid>.webp`, al lado de `perfil/`. Sin correo verificado se usa `usuario-<id>/movimientos/`; al verificarlo se trasladan las imágenes a su carpeta de correo y se actualizan las referencias en la misma transacción de verificación. Si falla, se conservan los originales. Las imágenes antiguas en `storage/evidence/` siguen disponibles sin moverlas manualmente; conserva y respalda también esa carpeta. Sin `PROFILE_PHOTO_DIR`, la raíz compartida es `storage/profile-photos/`.

Al guardar la primera imagen se crea una sola carpeta del usuario con las dos subcarpetas `perfil/` y `movimientos/`, aunque una todavía esté vacía. El usuario que ejecuta Node debe poder escribir en ellas. **Respalda las carpetas junto con MySQL**; copiar solo la base no conserva las imágenes. El acceso es mediante `/api/movements/:id/evidence`, con sesión y comprobación de propiedad o membresía familiar actual en cada lectura. No son enlaces públicos ni se permiten modificaciones de las imágenes de otros usuarios.

El icono de ojo abre un modal de evidencia en el registro general, el detalle diario del calendario y los historiales de tarjetas, planes, suscripciones y préstamos; aparece verde cuando el movimiento tiene imágenes adjuntas. Al pulsar una miniatura se ve la imagen completa dentro del modal y se puede volver a la galería o abrirla en otra pestaña. Permite actualizar la lista y, en vista individual, agregar o eliminar las imágenes propias, incluso de desembolsos cuyo monto es fijo. La familia solo puede consultarlas. Al registrar un movimiento, la carga opcional sigue disponible en el formulario. Adjuntar/quitar evidencia no altera montos ni saldos; eliminar el movimiento elimina sus referencias y después sus archivos. Un error de limpieza en disco se registra explícitamente en la consola como `[EVIDENCIA]`.

En el registro general, el modal de evidencia no ensancha las columnas ni desplaza los botones Editar y Eliminar.

El movimiento se guarda antes de subir sus imágenes. Si falla una subida, el formulario avisa que el movimiento ya está guardado, conserva las imágenes pendientes y permite reintentar sin crear otro movimiento ni volver a subir las imágenes que sí finalizaron. No cierres el formulario mientras haya archivos pendientes; si lo cierras, puedes adjuntarlos después desde el registro ya guardado. Las imágenes seleccionadas solo en el navegador aún no son un respaldo.

## Perfil, temas y recuperación

La barra de secciones no muestra Calendario ni Mi perfil para ahorrar espacio. El perfil sigue disponible al pulsar el nombre o la foto del usuario en la barra superior.

Al iniciar sesión o restaurar una sesión se muestra un **Menú principal** con la opción **Salud financiera**, que abre el panel existente (Panorama, Tarjetas y las demás pestañas). Desde el panel se puede volver al menú. La barra superior agrupa la foto y el nombre del usuario autenticado junto a **Cerrar sesión** en ambas pantallas; al pulsar el perfil se abre **Mi perfil**. Si falta la URL o no carga, se muestra una imagen de perfil genérica, no una inicial.

Al registrarse se solicitan usuario, **correo obligatorio y único**, contraseña y palabra clave de recuperación. El correo se guarda sin verificar y no se envía verificación durante el registro. Se avisa que sin verificarlo no se podrá recuperar el acceso; tras crear la cuenta se abre **Mi perfil** para verificarlo cuando el usuario lo decida. La foto es **opcional** y usa el mismo lápiz/editor del perfil, sin URL. Si se seleccionó, se sube después de crear la cuenta, usando la sesión recién emitida, a `usuario-<id>/perfil/`. Si falla la subida, la cuenta permanece creada y se muestra el error para reintentar desde el perfil. Sin foto se guarda `NULL` y se muestra el avatar predeterminado.

En **Mi perfil** se puede cambiar el nombre de usuario (obligatorio, hasta 100 caracteres). Se rechazan nombres ocupados o que coincidan con el correo verificado de otra cuenta. El cambio conserva el ID, los datos financieros, la sesión, la contraseña y el correo; para los próximos accesos y la recuperación se usa el nuevo usuario.

El lápiz sobre la foto abre un editor con vista circular, selección de archivo JPG, PNG o WebP (hasta 5 MB), zoom de 1× a 4×, giro de 90°, inversión horizontal/vertical y ajustes de posición. Las imágenes mayores de 20 megapíxeles se reducen automáticamente antes de editarlas, con un límite de seguridad de 100 megapíxeles. **Restablecer** deshace los ajustes del editor y **Cancelar** conserva la foto anterior. **Aplicar foto** prepara un recorte cuadrado de 600 × 600, mostrado como círculo; solo se sube al pulsar **Guardar perfil** o al crear la cuenta. El servidor vuelve a validar el contenido, elimina metadatos y optimiza a WebP de hasta 800 × 800; no guarda el nombre original. Las fotos anteriores por URL siguen funcionando; para editarlas, el servidor externo debe permitir CORS. Si no, selecciona el archivo del equipo.

Configura en el `.env` del **equipo que ejecuta Node**:

```dotenv
PROFILE_PHOTO_DIR=/run/media/lenovoserver/discoDuro/Servidor
```

Los archivos se guardan en `<PROFILE_PHOTO_DIR>/<correo-verificado>/perfil/<uuid>.webp`. Sin correo verificado se usa `usuario-<id>/perfil/`; al verificarlo, la foto actual se traslada a la carpeta del correo. Los caracteres especiales del correo se codifican para evitar rutas inseguras. La carpeta se crea automáticamente si el usuario del proceso tiene permisos; sin la variable se utiliza `storage/profile-photos` dentro del proyecto. No se debe publicar esta carpeta mediante un servidor de archivos: la API exige sesión y solo sirve la foto actual de su propietario. No se comparte con la vista familiar.

La carpeta es independiente de `dist`; respáldala junto con la base de datos y conserva permisos de lectura/escritura para el servicio Node. Al reemplazar una foto, se elimina la anterior después de guardar la nueva referencia. Un error de permisos se muestra explícitamente. Reinicia el backend tras configurar la variable. El perfil reutiliza `foto_perfil VARCHAR(500)`; la organización de imágenes de movimientos requiere la migración 011 descrita arriba.

El color se selecciona desde el icono de paleta del encabezado; cada cambio se guarda automáticamente en `usuario.tema` y se recupera al volver a entrar, incluido el calendario. Los usuarios existentes pueden solicitar una nueva palabra clave por correo verificado o un enlace para elegirla.

El botón con sol/luna alterna la **vista Día/Noche** sin cambiar `usuario.tema` ni hacer solicitudes a la base de datos. Cada tema tiene una paleta clara y otra nocturna: verde, azul y violeta conservan sus matices con fondos oscuros; Oscuro usa negro casi puro de noche y grises claros de día. Se aplica a menús, formularios, paneles, mensajes y calendario mediante variables CSS compartidas que también pueden utilizar las nuevas secciones. La vista se mantiene durante la sesión de navegación; al entrar de nuevo o seleccionar un tema, Oscuro comienza en Noche y los demás en Día.

La tabla `usuario` utiliza los campos existentes `id`, `nombre`, `password_hash`, `recuperacion_token_hash`, `recuperacion_expira`, `foto_perfil` y `tema`. Las solicitudes JSON tienen un límite de 16 KB; el login solo envía usuario y contraseña, sin reenviar la foto.

La subida por archivo guarda una referencia privada en `usuario.foto_perfil`. La edición llama a `PUT /api/users/:id/profile` con el ID del usuario conectado; el backend comprueba que coincida con la sesión y ejecuta el `UPDATE usuario ... WHERE id = ?`. Después consulta ese mismo registro para devolver la foto guardada. La ruta anterior `PUT /api/auth/profile` sigue disponible. `npm run server` recarga el backend cuando cambia su código. Si aparece «Ruta no encontrada» en una operación de perfil, detén el proceso anterior y vuelve a ejecutar `npm run server` desde este proyecto.

**Olvidé mi contraseña** valida correo verificado y palabra clave antes de mostrar la nueva contraseña, o permite solicitar enlaces por correo para recuperar contraseña/palabra clave. La palabra clave no distingue mayúsculas y se guarda con bcrypt en `recuperacion_token_hash`, nunca en texto claro; `recuperacion_expira` queda en `NULL` al configurarla porque es una clave permanente, no un enlace temporal. Los valores con expiración vencida o hashes de tokens antiguos no sirven como palabra clave. Usa una frase difícil de adivinar y distinta de tu contraseña. Las sesiones están vinculadas mediante HMAC al hash de contraseña, por lo que un restablecimiento invalida las sesiones anteriores sin requerir otra columna. Los límites de intentos por cuenta e IP viven en el proceso del backend y requieren un almacén compartido si se despliega más de una instancia.

## Carpetas principales

- `saludFinanciera/`: módulo financiero completo, separado del login y del orquestador.
- `saludFinanciera/frontend/`: componente `salud-financiera`, flujo financiero, estilos propios y calendario integrado en Movimiento.
- `saludFinanciera/server/`: rutas y consultas de panorama/cuentas, movimientos, suscripciones, planes y calendario. Conserva las URL `/api/dashboard`, `/api/accounts`, `/api/movements`, `/api/subscriptions`, `/api/plans` y `/api/calendar`.
- `saludFinanciera/suscripciones/`: formulario y tarjetas de suscripciones, estilos, rutas y servicio MySQL de este flujo.
- `src/inicio/inicio.js`: orquestador de menú, login/registro, perfil y barra de usuario; monta el módulo financiero.
- `src/inicio/appearance.css`: paletas compartidas y vista Día/Noche; sus variables se heredan en los módulos.
- `src/api.js`: cliente HTTP del frontend.
- `server/index.js`: orquestador HTTP; autentica y delega las rutas financieras al módulo.
- `server/auth.js`: registro, autenticación y sesiones.
- `server/db.js`: pool MySQL configurado con variables de entorno.

La barra financiera muestra **Panorama, Movimiento, Tarjetas, Planes futuros, Suscripciones y Deudores**. Cuentas ya no ocupa una pestaña; su gestión se conserva desde **Panorama → Cuentas → Ver todas** y desde la creación de tarjetas.

### Deudores: préstamos y abonos

Antes de ejecutar esta versión, respalda la base y aplica una sola vez `server/migrations/005-loans.sql` en la base configurada en el servidor. Crea `prestamo`, relacionado con usuario y cuenta, y añade `movimiento.id_prestamo` y `movimiento.clase_prestamo` (`desembolso` / `abono`). Reinicia el backend. La relación es de un préstamo a muchos movimientos: cada desembolso o abono conserva su propio `movimiento.id`, visible en el historial, sin duplicar transacciones.

Deudores permite registrar persona, **Me deben / Yo debo**, monto, fecha de inicio, fecha compromiso, tarjeta/efectivo y notas. En un préstamo **Nuevo**, Me deben descuenta el monto de la cuenta y lo registra como dinero por cobrar; Yo debo agrega el monto a la cuenta elegida y registra la obligación. Ambas operaciones crean automáticamente el desembolso y el préstamo en una misma transacción; si falla el saldo o la cuenta no pertenece al usuario, se revierte todo. En un préstamo **Anterior** no hay movimiento inicial ni cambios de saldo: se captura lo pendiente al comenzar el seguimiento, sin recrear abonos históricos.

Las tarjetas muestran el monto registrado fijo, abonado, pendiente, fechas y cuenta sugerida. Registrar abono abre el modal de movimientos: Me deben recibe dinero en una cuenta propia; Yo debo lo descuenta de una cuenta propia. También se puede elegir un préstamo al registrar o editar un ingreso/salida desde Movimiento. Los abonos se suman desde todos los movimientos del préstamo y usuario, excluyendo el desembolso; no se permite exceder el pendiente ni usar una fecha anterior al inicio. Las cuentas se actualizan transaccionalmente y editar, reasignar o eliminar un abono revierte su efecto anterior antes de aplicar el nuevo; eliminarlo reabre el pendiente correspondiente.

Los préstamos y abonos son traslados entre una cuenta y el saldo por cobrar/pagar, no ingresos o gastos ordinarios: se identifican por nombre y clase en el registro, el detalle diario y los historiales, cuentan como actividad pero no inflan los totales ordinarios de ingresos/gastos del calendario. No pueden compartir movimiento con categoría, plan o suscripción. El desembolso inicial, tipo, monto original y fecha de inicio son fijos; se pueden editar persona, compromiso, cuenta sugerida y notas. La papelera solo elimina préstamos sin movimientos, para conservar el historial; una cuenta sugerida en un préstamo debe desvincularse antes de eliminarla. El resumen de deuda de Panorama conserva su definición de crédito utilizado; los préstamos por pagar/cobrar se consultan en Deudores.

El calendario incluye un marcador naranja **Deudas · Fecha compromiso** para cada préstamo pendiente en su fecha compromiso exacta, tanto Me deben como Yo debo, con su saldo por cobrar/pagar. No se repite en otros meses ni incrementa el contador de movimientos reales; desaparece al liquidarse. En el detalle del día, Registrar abre un abono con fecha, préstamo y cuenta sugerida preseleccionados. La vista familiar conserva estos marcadores como solo consulta.

Al pulsar una tarjeta de préstamo o usar Enter/Espacio aparece su tabla completa de movimientos. La vista familiar combina los préstamos de los integrantes identificando al propietario y conserva la restricción de solo consulta. Registrar, abonar, editar y eliminar sigue requiriendo la vista individual y la propiedad en el servidor.

### Familia y consulta conjunta

Antes de usar Mi perfil → **Mi familia**, respalda la base y ejecuta una sola vez `server/migrations/004-families.sql` en la misma base que usa el servidor, y reinicia el backend. Crea tres tablas relacionadas con `usuario.id` (INT UNSIGNED): `familia` (nombre y creador), `familia_integrante` (una familia por usuario) y `familia_invitacion` (solo hash del código y vencimiento). No modifica ni mezcla los propietarios de los registros financieros existentes.

Un usuario crea y nombra la familia desde su perfil, genera un código y lo comparte de forma privada con su pareja. El otro usuario abre su propio perfil, introduce el código y acepta explícitamente compartir la consulta de sus finanzas. Cada código vence en 24 horas, es de un solo uso y se invalida al generar otro. La tarjeta del perfil muestra el nombre y los integrantes; el creador puede renombrar, retirar integrantes o disolver la familia, y los otros integrantes pueden salir. Estas acciones no borran cuentas, movimientos, planes ni suscripciones.

En Salud financiera, **Vista → Individual / Familiar** alterna entre los datos propios (opción inicial, no persistida) y la consulta combinada de los integrantes actuales. La familiar incluye Panorama y sus totales, tarjetas/efectivo, cuentas, planes, suscripciones, calendario y registro de movimientos; identifica al propietario en los nombres. Es de consulta, con la excepción de **Registrar movimiento especial** desde las tarjetas de otros integrantes para enviar desde cuentas propias; los demás registros, ediciones y eliminaciones requieren la vista individual. Las consultas conjuntas vuelven a comprobar la membresía en el servidor; los usuarios retirados ya no pueden hacer nuevas consultas familiares. Las cuentas familiares y el selector de transferencias usan el color y apariencia de su propietario, sin cambiar tu tema. Solo se comparten estas preferencias visuales y el nombre; no contraseñas ni palabras de recuperación. Las categorías siguen siendo el catálogo compartido existente.

#### Pagos y transferencias familiares

Los selectores de origen y destino de movimientos individuales y familiares usan tarjetas seleccionables, también para suscripciones, aportaciones y abonos a préstamos. Como origen solo aparecen cuentas de **débito, nómina o efectivo con saldo disponible**. Solo **Suscripción relacionada** permite usar crédito disponible como origen. Los destinos conservan cuentas sin saldo y tarjetas de crédito para registrar ingresos y pagos. La API también valida la restricción al guardar.

Al capturar un monto o cambiar la cuenta, se comprueba que no exceda su disponible (también el crédito disponible en suscripciones). Si se supera, se vacía el monto, el campo queda rojo y aparece un mensaje de fondos insuficientes; hay que ingresar un monto válido para continuar. Los ingresos no tienen este límite de salida. Al editar se considera la reversión del movimiento original para no descontarlo dos veces. El servidor vuelve a validar el saldo al guardar para evitar sobregiros si cambió desde que se abrió el formulario.

Si MySQL devuelve `ER_NO_REFERENCED_ROW_2` al guardar un movimiento familiar y la tabla conserva `movimiento_ibfk_6 FOREIGN KEY (id_usuario, id_cuenta_destino)`, aplica una sola vez `server/migrations/014-family-destination-owner.sql`, después de la 013 y con respaldo previo. Esta migración sustituye únicamente esa relación por una clave compuesta que usa el destinatario familiar (o el usuario original en movimientos normales). Conserva la validación del propietario de ambas cuentas y los movimientos existentes; no cambia saldos ni elimina registros. La columna de propietario de destino se calcula automáticamente.

En el registro especial, las tarjetas de crédito muestran **Saldo utilizado** y **Pago para no generar intereses**. El monto sugerido usa este último si es mayor que cero; si está en cero o sin configurar, usa la deuda actual (`límite − disponible`, sin valores negativos). También se actualiza al seleccionar otra cuenta de destino; para débito o efectivo queda libre. El monto siempre es editable.

Antes de desplegar esta versión, respalda la base y aplica una sola vez `server/migrations/013-family-transfers.sql` y después `server/migrations/014-family-destination-owner.sql`. La primera añade el destinatario opcional y la segunda ajusta la relación de su cuenta; no modifican registros ni saldos existentes. Si ya aplicaste la 013, ejecuta solo la 014. Reinicia el backend y recompila el frontend.

Desde **Familiar → Tarjetas → Registrar movimiento especial**, en la tarjeta de otro integrante, puedes registrar un pago o transferencia sin salir de la vista familiar. Se precarga esa cuenta como destino y, para crédito, el pago para no generar intereses como monto editable. Solo se habilita el modo familiar; las acciones de edición y eliminación de cuentas siguen bloqueadas. También está disponible desde **Individual → Movimiento → Movimiento familiar** o eligiendo ese tipo dentro de **Nuevo movimiento**. Selecciona una cuenta propia como origen y una de otro integrante actual como destino; ambas muestran el propietario y su color. Captura la fecha real (también admite pagos ya realizados) y el monto. Esto registra lo ocurrido: no ordena pagos ni transferencias bancarias. El servidor comprueba nuevamente la membresía y los propietarios, y actualiza ambos saldos en una sola transacción; no permite retirar desde cuentas ajenas ni mezclar categoría, préstamo, plan o suscripción.

Se conserva un único movimiento visible en ambos historiales y una sola vez en la consulta familiar. Es una transferencia: no duplica ingresos ni gastos y, si el destino es crédito, cuenta como abono del ciclo correspondiente para el pago para no generar intereses. Solo quien envió puede editar o eliminar; el destinatario consulta el movimiento y su evidencia. Editar o eliminar revierte ambos lados y se rechaza sin cambios parciales si el destinatario ya no tiene saldo suficiente para revertir. Para editar una transferencia familiar se requiere seguir en la misma familia; eliminarla y consultar su registro sigue siendo posible al separarse, sin dar acceso a otros datos de la expareja.

Panorama separa **Saldo disponible** (débito + efectivo), **Disponible con crédito** (ese saldo + crédito sin utilizar), **Deuda total** (suma del límite menos disponible de cada crédito, sin deudas negativas) y **Pago para no generar intereses**. El selector Mes/Año completo inicia en el mes y año locales actuales y filtra únicamente el último total por la fecha límite registrada en cada crédito. Los saldos y deuda siguen siendo actuales; no hay instantáneas históricas ni historial de estados de cuenta. Cambiar los datos de una tarjeta reemplaza los anteriores. Los créditos sin límite o sin fecha/importe de pago se señalan como incompletos y no se incluyen en el cálculo que requiere esos datos.

Al seleccionar una tarjeta bancaria o una suscripción, aparece debajo una tabla con fecha, operación, origen, destino, categoría, suscripción y monto. En tarjetas bancarias se pulsa la tarjeta (o se usa Enter/Espacio al enfocarla), sin botón «Ver movimientos»; las suscripciones conservan ese botón adicional. Las tarjetas bancarias incluyen movimientos donde su cuenta es origen o destino; las suscripciones incluyen los vinculados por `id_suscripcion`. Se consulta todo el historial relacionado del usuario autenticado, sin el límite de 250 del panorama. Si no existen registros se muestra **No hay movimientos**; los errores de consulta se muestran con opción de reintentar.

Las contraseñas de usuarios nuevos se guardan con bcrypt. Cada consulta financiera usa el `id` del usuario autenticado. Los datos se cargan al entrar al módulo, no al iniciar sesión ni al abrir el perfil. Las tarjetas usan cuentas cuyo tipo contiene “tarjeta”, “crédito” o “débito” (también sin acentos). Las cuentas se pueden editar; solo se pueden eliminar si no tienen movimientos asociados. El saldo disponible se puede corregir directamente al editar tanto crédito como débito; esta corrección actualiza `cuenta.disponible` sin crear ni modificar movimientos. Los movimientos posteriores siguen ajustando el saldo.

El formulario de tarjetas ofrece **Crédito**, **Débito** y **Efectivo**. En crédito se capturan nombre, límite máximo (`total`), crédito libre (`disponible`), fecha de corte, fecha límite de pago y pago para no generar intereses de este mes. La deuda se calcula como **Saldo utilizado = total − disponible**, sin una columna adicional, y el disponible no puede superar el límite al registrar o editar. Débito y Efectivo solo requieren nombre, tipo y saldo disponible; límite y datos de pago de crédito se guardan como `NULL`. Los tres tipos destacan el **Saldo disponible** como dato principal; solo crédito muestra límite, saldo utilizado, fechas y pago del mes, y permite iniciar el pago como transferencia.

El campo Tipo siempre es un selector con Crédito, Débito y Efectivo, tanto desde Tarjetas como desde Cuentas, al crear o editar. El backend rechaza otros tipos al guardar; los registros antiguos se conservan y requieren elegir una de estas opciones al editarlos. Efectivo aparece junto a Nómina / Débito y conserva las mismas acciones e historial. Se guarda como `cuenta.tipo = 'Efectivo'`; si esa columna usa un ENUM en tu instalación, debe admitir ese valor conservando sus opciones anteriores.

Al registrar crédito se capturan explícitamente **Crédito total (límite máximo)** y **Crédito disponible (sin utilizar)**. Ambos valores se guardan tal como se capturan en `total` y `disponible`, respectivamente; un disponible vacío se rechaza, no se sustituye por cero. Por ejemplo, total 10 000 y disponible 7 000 producen una deuda calculada de 3 000, sin cambiar los valores guardados.

El visor bancario usa el mismo formato visual de Suscripciones: cuadrícula adaptable de tarjetas compactas, fondo del tema, sombra, bordes redondeados y acciones al pie. La altura crece con el contenido y se mantiene el detalle de movimientos debajo de la cuadrícula al seleccionar una tarjeta.

Las tarjetas se separan en dos mitades: **Nómina / Débito** a la izquierda y **Crédito** a la derecha; en móvil se apilan. La papelera solicita confirmación y mantiene la restricción de no eliminar cuentas con movimientos. Solo crédito muestra una barra de **disponible / límite máximo**: verde por encima de 50 %, azul entre más de 20 % y 50 %, y alerta hasta 20 %. Si el límite no permite calcular un porcentaje se solicita configurarlo. El aviso de pago usa la fecha límite registrada y la fecha local actual, se actualiza cada minuto y distingue días restantes, vencimiento hoy y fecha vencida; no adelanta automáticamente la fecha al mes siguiente ni determina si ya se cubrió el pago.

Al desplegar esta reorganización, copia también `saludFinanciera/` junto a `server/` y `src/`, y reinicia el backend: las consultas financieras ya no están en los archivos antiguos de `server/`.

## Catálogo de imágenes de tarjetas

### Roles y gestión de cuentas

Después de completar la migración 015, respalda la base y ejecuta **una sola vez** `server/migrations/016-user-account-roles.sql` completo en MySQL Workbench (incluye `DELIMITER` para crear el trigger), o con `mysql -u USUARIO_MYSQL -p salud_financiera < server/migrations/016-user-account-roles.sql`. Reinicia `apps` tras compilar el frontend con `npm run build`.

La 016 convierte los roles anteriores `usuario` a **Free**, conserva administradores y establece **Admin** para el usuario ID **2**. Los registros nuevos son siempre Free; no aceptan un rol enviado por el cliente. Cada usuario tiene un único rol **Admin / Free / VIP**, visible en la cabecera incluso en móvil. Free y VIP conservan las funciones financieras existentes; este cambio no introduce límites ni cobros.

Solo Admin ve **Gestión de cuentas** en el menú principal. Allí puede buscar usuarios por nombre o ID y cambiar su rol. La API verifica el rol actual del administrador en MySQL antes de listar o modificar usuarios; nunca entrega hashes, datos bancarios o saldos. Si un administrador cambia su propio rol a Free/VIP pierde inmediatamente la gestión en esa pantalla. El usuario ID **2** no se puede degradar: está bloqueado en la interfaz, la API y un trigger de MySQL que también impide quitarle Admin mediante un `UPDATE` directo. El trigger requiere permiso `TRIGGER` al aplicar la migración. No se modifican movimientos ni saldos.

El menú principal muestra **Agregar info de tarjetas nuevas**, junto a **Entrar**, únicamente a administradores. La pantalla permite buscar nombres registrados, agruparlos por tipo, distinguir imágenes asignadas y pendientes, cargar o reutilizar imágenes, previsualizar coincidencias y crear, editar o eliminar reglas. El inventario compartido contiene exclusivamente nombres y tipos de cuentas, suscripciones, servicios y planes: nunca saldos, números de cuenta, usuarios ni titulares. Los nombres de personas de Deudores no se incorporan al catálogo; sus tarjetas pueden mostrar la imagen de la cuenta sugerida, si existe.

Las imágenes opcionales de 40 × 40 px se muestran después del nombre y antes del importe en tarjetas bancarias, nómina, débito, efectivo, servicios, suscripciones, planes, selectores de cuenta y resúmenes de Panorama, también en Familiar. Conservan proporción y esquinas redondeadas. Sin coincidencia, durante la carga o si el archivo falta, el elemento no ocupa espacio y el resto de la tarjeta funciona normalmente.

### Reglas, alias y permisos

Toda la superficie de la tarjeta **Salud financiera** del menú abre el módulo, también mediante teclado con su botón Entrar. **Agregar info de tarjetas nuevas** es un botón independiente, visible solo para Admin, y abre exclusivamente el catálogo sin activar la entrada a finanzas.

En **Nombres registrados**, los pendientes de imagen aparecen desplegados por tipo. Los nombres que ya tienen imagen se retiran de pendientes y quedan en **Con imagen registrada**, plegado inicialmente, desde donde puedes modificar su regla. **Reglas del catálogo** también se puede desplegar para editar o eliminar reglas guardadas. La búsqueda filtra ambos grupos; eliminar una regla devuelve a pendientes los nombres que ya no coincidan con ninguna otra.

Se comparan palabras/frases completas, sin distinguir acentos, mayúsculas, espacios repetidos ni separadores (`BBVA-Nómina` equivale a `bbva nómina`). Una regla **Banco** con palabra **BBVA** cubre sus cuentas de nómina, débito y crédito. Para imágenes diferentes de crédito, crea **Crédito → Producto específico** con **BBVA Vive** y **BBVA Azul**. La regla de producto gana a la general; sin producto coincidente, se usa la imagen del banco. Entre reglas de la misma prioridad gana la frase más larga.

Antes de guardar se revisan coincidencias y reglas parecidas. Las variantes como **Bbbv** o **BBVA Vivee** no se vinculan automáticamente: el administrador puede elegir **Asociar como alias** o confirmar un alias sugerido a partir de nombres reales, revisar de nuevo y guardar. Un alias pertenece a una única regla en su ámbito; puede repetirse en otro ámbito. La palabra principal también se registra como alias dentro de una transacción. Los índices únicos de MySQL bloquean duplicados, incluso si dos administradores guardan al mismo tiempo.

Todos los usuarios autenticados pueden resolver y ver imágenes del catálogo. La lista global de nombres, reglas, archivos, vistas previas y todas las escrituras exigen el rol **admin**, consultado en MySQL usando el usuario de la sesión en cada operación; ser creador de una familia no otorga ese permiso. El registro público siempre crea usuarios normales. El catálogo no cambia cuentas, movimientos ni saldos.

### Aplicar en Ubuntu con `apps`

Requiere el esquema previo de la aplicación y **MySQL 8.0.16 o posterior**, para que se apliquen también las restricciones `CHECK`. Estos comandos son ejemplos desde la carpeta del proyecto; sustituye `USUARIO_MYSQL`, `ID_ELEGIDO` y `USUARIO_SERVICIO` por los reales. No publiques contraseñas ni uses `chmod 777`.

1. Detén `apps`, respalda la base y aplica **una sola vez** la migración 015. Usa el nombre de base configurado en tu `.env` si no es `salud_financiera`. No vuelvas a ejecutar migraciones anteriores ya aplicadas.

   ```sh
   sudo systemctl stop apps
   mysqldump -u USUARIO_MYSQL -p --single-transaction salud_financiera > respaldo-antes-catalogo.sql
   mysql -u USUARIO_MYSQL -p salud_financiera < server/migrations/015-card-image-catalog.sql
   ```

   La migración solo añade `usuario.rol` (todos quedan como `usuario`) y las tablas `catalogo_tarjeta_imagen` y `catalogo_tarjeta_alias`. En tu cliente MySQL, consulta el usuario correcto y promueve **solo su ID**:

   ```sql
   SELECT id, nombre, rol FROM usuario ORDER BY id;
   UPDATE usuario SET rol = 'admin' WHERE id = ID_ELEGIDO;
   ```

   Con la migración 016 aplicada, para revocar a un administrador distinto del ID 2: `UPDATE usuario SET rol = 'free' WHERE id = ID_ELEGIDO;`. El ID 2 está protegido y no admite revocación. Recarga la aplicación para actualizar el menú; el backend aplica la revocación en la siguiente petición.

2. Comprueba que el disco esté realmente montado **antes** de crear carpetas o dar permisos. Averigua el usuario real del proceso; `apps` es el nombre del servicio, no necesariamente su usuario.

   ```sh
   findmnt --mountpoint /run/media/lenovoserver/discoDuro
   systemctl show apps -p User -p Group -p WorkingDirectory
   systemctl cat apps
   ```

   Si `findmnt` no muestra el montaje, detente y monta el disco. Después, solo si hace falta, crea la carpeta exacta:

   ```sh
   sudo mkdir -p "/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida"
   ```

   Con ACL disponibles, concede acceso **solo a esta carpeta** al usuario de servicio real:

   ```sh
   sudo setfacl -m u:USUARIO_SERVICIO:rwx,d:u:USUARIO_SERVICIO:rwx "/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida"
   sudo -u USUARIO_SERVICIO test -r "/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida"
   sudo -u USUARIO_SERVICIO test -w "/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida"
   namei -l "/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida"
   ```

   Los directorios padre también necesitan permiso de paso (`x`); concédelo únicamente en los padres que lo requieran. Los archivos existentes deben ser legibles por el usuario del servicio. Si el disco usa un sistema sin ACL/permisos POSIX, configura su montaje para el usuario/grupo correspondiente; no cambies el propietario de todo el disco. Comprueba también restricciones como `ReadWritePaths` del servicio.

3. Añade al `.env` privado del proyecto, conservando el resto de variables:

   ```dotenv
   CARD_IMAGE_DIR=/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida
   ```

   El servidor carga `.env` desde su directorio de trabajo. Si defines la variable en una unidad de systemd en lugar de `.env`, usa `Environment="CARD_IMAGE_DIR=/run/media/lenovoserver/discoDuro/Servidor/Admin/seguro de vida"`. Los espacios pertenecen al nombre de carpeta; no los escapes dentro de `.env`. La aplicación no crea automáticamente esta carpeta ni usa una ubicación alternativa: un montaje ausente o permisos insuficientes se notifican al administrador. En Linux se comprueba además el montaje del disco de la ruta predeterminada.

   Para impedir también que `apps` arranque sin ese disco, puedes añadir mediante `sudo systemctl edit apps`:

   ```ini
   [Unit]
   RequiresMountsFor=/run/media/lenovoserver/discoDuro
   ConditionPathIsMountPoint=/run/media/lenovoserver/discoDuro
   ```

4. Despliega los archivos de esta versión, compila y arranca el servicio:

   ```sh
   npm ci
   npm run build
   # Necesario si modificaste la unidad/drop-in de systemd:
   sudo systemctl daemon-reload
   sudo systemctl restart apps
   sudo systemctl status apps --no-pager
   sudo journalctl -u apps -n 50 --no-pager
   ```

   Recarga el navegador e inicia sesión con el administrador. Crea **BBVA / Banco** y **BBVA Vive / Crédito / Producto específico** con imágenes diferentes; revisa que **BBVA Nómina** tome la primera y **BBVA Vive** la segunda. Con un usuario normal confirma que se ven las imágenes, no aparece la configuración y `/api/admin/card-catalog` responde 403; sin sesión responde 401. Revisa una tarjeta sin coincidencia y otra cuyo archivo se haya retirado: deben conservar sus importes y acciones sin hueco de imagen.

Las cargas y selecciones de archivos existentes admiten JPEG, PNG y WebP de hasta 5 MB, rechazan animaciones, contenido inválido y enlaces simbólicos, se reorientan/reducen a un máximo de 512 px y se guardan como WebP con UUID seguro. Seleccionar un archivo existente crea una copia administrada; nunca sobrescribe el original. MySQL guarda solo su referencia relativa, reglas y alias. Las imágenes se sirven con sesión desde `/api/card-images/:id/:version.webp`, únicamente si están asociadas a una regla vigente; la carpeta no se publica como contenido estático. Eliminar una regla conserva sus archivos para reutilizarlos. Las cargas previas a un guardado fallido también quedan disponibles en el selector. Respalda esta carpeta junto con MySQL; fotos de perfil y evidencias mantienen sus rutas independientes.

Archivos de esta función: `server/migrations/015-card-image-catalog.sql`, `server/card-catalog.js`, `server/card-catalog-files.js`, `shared/card-catalog.js`, `saludFinanciera/frontend/card-catalog-admin.js`, `saludFinanciera/frontend/card-catalog-image.js`; integración en `server/auth.js`, `server/index.js`, `src/inicio/inicio.js`, `src/inicio/styles.css`, `saludFinanciera/frontend/salud-financiera.js`, `saludFinanciera/frontend/prestamos.js`, `saludFinanciera/frontend/styles.css`, `saludFinanciera/suscripciones/suscripciones.js`, `saludFinanciera/server/family-view.js` y `.env.example`. Pruebas en `shared/card-catalog.test.js`, `server/card-catalog.test.js`, `saludFinanciera/frontend/card-catalog.test.js`, `server/auth.test.js` y `saludFinanciera/frontend/family.test.js`.

## Movimiento y calendario

Movimiento está junto a Panorama. El calendario navega por mes y permite seleccionar un día para consultar cuántos movimientos se registraron, sus ingresos/gastos y su detalle. **Registrar movimiento en este día** abre un modal con esa fecha; **Nuevo movimiento** usa hoy. El modal permite gasto, ingreso y transferencia, con sus cuentas, categoría y relaciones existentes. Los accesos desde tarjetas y planes también abren este modal. Guardar o eliminar actualiza el calendario, el resumen diario y el registro mensual sin perder el mes seleccionado.

La leyenda distingue **azul: pago de tarjeta**, **verde: aportación a plan**, **violeta: suscripción/servicio**. Los puntos son fechas previstas, no pagos realizados; el número del día cuenta únicamente movimientos reales. Al seleccionar un día, sus compromisos previstos tienen un botón Registrar que precarga la fecha y la relación correspondiente: plan o suscripción como gasto, pago de tarjeta como transferencia hacia la tarjeta. El usuario confirma cuenta de origen e importe antes de guardar. No se crean movimientos automáticamente.

Las tarjetas de crédito usan su fecha límite exacta registrada, sin repetirla artificialmente cada mes ni inferir que esté pagada. Los planes pendientes y configurados muestran el día semanal/mensual desde su fecha de inicio, independientemente de Mostrar en Panorama; las suscripciones activas muestran su día de cobro desde su inicio. Los días 29–31 se ajustan al último día del mes cuando es necesario. Las frecuencias trimestrales, semestrales y anuales usan el mes de inicio como ancla, avanzando 3, 6 o 12 meses. Si el día de cobro de ese primer mes es anterior al inicio, el primer marcador pasa al siguiente periodo. Solo los registros antiguos sin fecha de inicio conservan la referencia mensual con aviso. Los marcadores se generan con la configuración actual, no son un historial de cuotas.

Debajo aparece **Registro general**, por defecto con todos los movimientos del usuario conectado, sin filtro de categoría ni límite de 250. El selector permite consultar opcionalmente el **año seleccionado** o el **mes seleccionado**; el calendario incorpora un campo para cambiar directamente de año y un botón Actualizar registros. La tabla incluye fecha guardada en `movimiento.fecha`, operación, origen, destino, categoría, plan, suscripción, monto y acciones de editar/eliminar. Pulsar la fecha de una fila abre ese día en el calendario, incluso si pertenece a otro mes o año. El backend conserva siempre el filtro del usuario autenticado; los contadores diarios y categorías del calendario corresponden al mes visible. La fecha usada es la capturada en el formulario, no una fecha de creación adicional. Los errores muestran opción de reintentar, no se presentan como registros vacíos.

**Registrar categoría**, tanto en Movimiento como dentro del modal, solicita nombre y tipo ingreso/gasto. Usa `POST /api/categories` autenticado y las columnas existentes `id`, `id_ahorros`, `nombre`, `tipo`, insertando `id_ahorros = NULL`. Las categorías son **compartidas**, como el catálogo existente; no se presume una columna de usuario que la tabla no tiene. Se rechazan nombres vacíos, tipos inválidos y duplicados con el mismo nombre/tipo en el catálogo sin ahorro. Las nuevas categorías se incorporan al selector del formulario (filtrado por operación); no requieren migración.

## Planes futuros

### Fecha de inicio de planes y suscripciones

Antes de ejecutar esta versión, respalda la base y aplica una sola vez `server/migrations/003-schedule-start-date.sql`: agrega `fecha_inicio DATE NULL` a `plan_futuro` y `suscripciones`. No repitas el SQL si ya agregaste las columnas. La fecha es obligatoria al crear o editar ambos formularios y se muestra en sus tarjetas. Los registros anteriores quedan en NULL para no inventar una fecha histórica: conservan su comportamiento previo y un aviso para configurar el inicio real al editarlos.

El calendario no genera marcadores anteriores al inicio configurado. Por ejemplo, un plan semanal de lunes que inicia el miércoles 18 de noviembre de 2026 aparece por primera vez el lunes 23, no los lunes anteriores. La proyección y los días faltantes tampoco comienzan antes del inicio. Los planes siguen teniendo marcadores en los periodos siguientes hasta completar realmente la meta; no se limitan a un número fijo de lunes desde el inicio. La fecha estimada se recalcula con el pendiente y las próximas aportaciones. Los movimientos ya guardados siguen apareciendo por su propia `movimiento.fecha` y siguen contando en el monetizado, incluso si son anteriores al inicio; no se borra ni oculta historial.

Al pulsar Editar en planes o suscripciones, la pantalla se desplaza al formulario y enfoca **Fecha de inicio**, situado al principio. Esto también permite completar registros antiguos cuya fecha aún está vacía.

El visor usa tarjetas con **meta fija, monetizado, faltante y barra de progreso**. La meta solo cambia si se modifica explícitamente al editar, nunca por aportaciones ni atrasos. El progreso es monetizado / meta, limitado visualmente a 100 %; el faltante conserva la resta meta − monetizado, incluso si hay un excedente. Mostrar en el panorama controla qué tarjetas aparecen también en Panorama; todos los planes siguen disponibles en Planes futuros.

Monetizado es exclusivamente la suma de todos los `movimiento.monto` vinculados por `id_plan_futuro` y por el mismo usuario, sin el límite de 250 del historial. No admite captura manual. Al crear, editar, reasignar o eliminar movimientos se sincroniza `plan_futuro.monetizado` en la misma transacción; las lecturas también calculan la suma para incluir registros anteriores. Las aportaciones se registran como gasto desde una cuenta en Movimiento, seleccionando el plan.

Al crear o editar se capturan nombre, monto objetivo, frecuencia semanal o mensual, **aportación por periodo** y **día de aportación**. Semanal muestra lunes–domingo y guarda 1–7 en `dia_aportacion`; mensual solicita un número del 1 al 31. El importe positivo se guarda en `aportacion_periodo DECIMAL(15,2)`. Los periodos faltantes se calculan como `ceil(max(meta − monetizado, 0) / aportacion_periodo)`, sin captura manual ni uso del valor antiguo de `periodos_faltantes`. La columna anterior queda sin uso; el dato actualizado se calcula al consultar, no se guarda allí.

La fecha estimada distribuye el pendiente en las próximas fechas del día elegido. Hoy cuenta si todavía no se registró una aportación hoy; si ya se aportó, se proyecta la siguiente cuota después del último movimiento vinculado. Si pasa un día programado y aún falta dinero, la estimación se recorre al siguiente periodo. Una aportación insuficiente puede requerir otro periodo; una mayor reduce los periodos necesarios. Se pueden registrar varios abonos para completar una cuota. No se crean cargos automáticos ni se guarda un historial de cuotas incumplidas. Los meses cortos usan su último día y recuperan el día configurado en los meses siguientes. Ejemplo: $950 pendientes / $200 mensuales = cinco aportaciones, con la última de $150. La proyección se actualiza al consultar y cada minuto en pantalla. Al completar la meta muestra cero periodos y omite futuras fechas.

Panorama muestra solo un resumen compacto de hasta cuatro planes visibles: nombre, monetizado / meta y barra con porcentaje. El nombre abre el plan seleccionado en Planes futuros; **Ver todos** lleva a esa sección. Las fechas, avisos, acciones e historial quedan en Planes futuros para no duplicar la pantalla completa.

Las tarjetas de Planes futuros muestran los días hasta la próxima aportación, con el mismo aviso azul de Suscripciones y alerta cuando faltan dos días o menos; hoy muestra **¡Hoy es día de aportar!**. El botón **Registrar movimiento** abre Movimiento como gasto con el plan preseleccionado. Al pulsar una tarjeta (o Enter/Espacio con foco) aparece debajo la tabla de todos sus movimientos, sin límite de 250, filtrados por `id_plan_futuro` y usuario. La tabla se actualiza al recargar los datos después de guardar movimientos. La papelera abre un modal de confirmación; los planes con movimientos no se pueden eliminar y el error se muestra sin borrar el historial.

**Requiere `dia_aportacion` y `aportacion_periodo`.** Si aún no existen, respalda la base y aplica una sola vez `server/migrations/002-future-plan-schedule.sql`. No lo repitas si ya agregaste ambas columnas manualmente. No requiere fecha inicial ni modifica la columna generada `faltante`. Los planes anteriores sin aportación/día, incluidos los anuales, se muestran con aviso para configurar frecuencia semanal o mensual al editarlos. Reinicia el backend y despliega también `saludFinanciera/plan-calculations.js`.

## Suscripciones

En **Suscripciones → Agregar suscripción** se captura nombre, tipo (`servicio` o `suscripcion`), costo por cobro, frecuencia, día de cobro, tipo de pago y estado. La frecuencia semanal permite elegir lunes–domingo (se guarda 1–7 en `dia_cobro`); las demás usan día del mes (1–31). El costo mensual se calcula automáticamente tanto en la vista previa como en el backend y no admite captura manual. El anual estimado es costo por cobro multiplicado por 52 para semanal, 12 para mensual, 4 para trimestral, 2 para semestral o 1 para anual; para frecuencias no semanales, el mensual es ese anual dividido entre 12, redondeado a centavos. La estimación semanal usa 52 cobros, no fechas exactas de calendario. El anual se calcula directamente, no multiplicando el mensual redondeado.

Las tarjetas muestran costo por cobro y estatus arriba, estimación de un año, costo mensual, monetizado hasta el momento y día de cobro. Su altura se adapta al contenido para evitar desbordamientos. `tipo_pago` guarda `manual` o `automatico` (mostrado como **Automático (domiciliado)**); ya no se capturan ni muestran imágenes. Los valores anteriores se muestran como «Sin definir» hasta elegir una opción al editar. No se modifica la tabla. Los costos se recalculan también al leer registros anteriores; `costo_mensual` se guarda calculado al crear o editar.

El indicador calcula los días desde la fecha local actual hasta el siguiente cobro a partir de la fecha de inicio: semanal busca la siguiente aparición del día elegido, y las otras frecuencias usan el día del mes (ajustado al último día si es más corto) y su intervalo de meses. Si coincide con hoy muestra **¡Hoy es día de pagar!**; las suscripciones inactivas no muestran avisos de pago. Se actualiza cada minuto mientras la sección está abierta. Solo para registros antiguos sin inicio se mantiene la referencia al próximo día configurado, aclarando que no se conoce el mes inicial.

**Monetizado** no se captura manualmente: es la suma de `movimiento.monto` donde `movimiento.id_suscripcion = suscripciones.id` y ambos registros pertenecen al mismo usuario. Se incluyen todos los movimientos relacionados, sin limitarse a los 250 del historial. Las lecturas calculan el total incluso para movimientos anteriores; al crear, editar, reasignar o eliminar un movimiento se sincroniza también `suscripciones.monetizado` en la misma transacción, actualizando tanto la suscripción anterior como la nueva si cambia la relación. Una suscripción nueva inicia en cero. Usa **Movimiento** para vincular un movimiento a una suscripción.

Las tarjetas de frecuencia mensual omiten el detalle «Costo mensual», ya que repite el costo por cobro. El aviso de días faltantes tiene un contenedor y texto destacados en azul, o en color de alerta cuando faltan dos días o menos, adaptados al modo día/noche.

Para frecuencia semanal, el costo mensual usa **costo por cobro × 4 semanas**, mientras la estimación anual conserva **costo por cobro × 52 semanas**. Por eso el anual semanal no equivale al mensual multiplicado por 12.

Las tarjetas permiten editar y muestran un botón de papelera que abre un modal de confirmación antes de eliminar; si existen movimientos asociados se cancela la suscripción en lugar de eliminar su historial. Al desplegar, aplica la migración de fecha de inicio indicada arriba, actualiza `saludFinanciera/schedule.js`, `saludFinanciera/suscripciones/` y los archivos del módulo financiero que la integran y reinicia el backend.
