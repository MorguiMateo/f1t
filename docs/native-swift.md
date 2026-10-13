# FIT nativa: Swift / SwiftUI


> **FIT es un cambio de nombre visible, no una app con otro identificador.**
> Conserva `com.morguimateo.f1t` y sustituye cualquier instalación anterior con
> ese mismo bundle ID (incluida la app llamada F1t). **No pueden coexistir como
> dos apps nativas independientes.** La web/PWA conserva su nombre F1t; el
> renombre no cambia su identidad. Se conservan OAuth `f1t://auth/callback`,
> App Group, Keychain,
> identificadores de widgets/notificaciones, esquema `App` e icono existente.

El target iOS `App` ahora arranca en `UIHostingController` con pantallas SwiftUI.
No enlaza Capacitor, no copia `dist`, no utiliza WKWebView y no depende de npm
para ejecutar la app instalada. El cliente web existente se conserva como
producto separado y referencia; los archivos del antiguo host quedaron fuera
del target, no fueron borrados. Supabase, RLS, RPC y los datos existentes no
se migran ni se modifican remotamente por este cambio.

## Arquitectura UI/UX integrada (2026-10-10)

Este apartado describe el código actual de ambos clientes. La evidencia fechada
de migraciones anteriores se conserva más abajo y corresponde a esas versiones.
La verificación automatizada de esta actualización terminó el 2026-10-10:
516 pruebas web y 42 comprobaciones Node aprobadas; build, TypeScript y lint web
sin errores ni advertencias. La suite completa de iOS aprobó 140 pruebas, con
0 fallos y 2 omisiones por accesibilidad no expuesta en el host. El build nativo
incremental final no emitió advertencias; una compilación anterior detectó una
advertencia preexistente de API obsoleta en shortcuts, cuyo código no se cambió.
La comprobación de navegador cubrió el acceso sin sesión en nueve rutas; no
acredita las pantallas protegidas, OAuth real ni una validación completa con
VoiceOver/Dynamic Type. No se desplegó ni se modificaron datos remotos.

### Navegación y orden de la información

- Se conservan cuatro pestañas: **Hoy, Rutinas, Progreso y Perfil**
  (`FitTab` / `NativeTabsView`). Entrenar sigue
  siendo una pantalla, no una sexta pestaña.
- **Hoy** ordena entrenamiento → pasos. Un único CTA
  principal se adapta a empezar, retomar o revisar. En iOS, la sesión activa
  sustituye la acción principal del plan del día; si corresponde a otra fecha o
  día, ese plan queda secundario. Conserva fecha y plan congelado de la sesión.
  El detalle de ejercicios es desplegable y la edición secundaria; la carga
  inicial es compacta. Pasos coloca refresco manual y ayuda del widget en opciones.
- En web, `selectTodayDay` prioriza `session.routine_day_id` sobre el calendario
  y el enlace incluye `?dia=`. Si el día no está disponible en la rutina activa,
  ofrece revisar Progreso: no lo sustituye silenciosamente por otro entrenamiento.
  La finalización exige los índices previstos registrados, no un total agregado.
- **Progreso** agrupa **Entrenamiento** y **Cuerpo**, sin crear más pestañas.
  Actividad de 26 semanas primero y evolución por ejercicio al final; separadas de pesos y
  gráfico corporal. «Anotar peso» conduce a Cuerpo. Web usa `seccion=cuerpo`;
  iOS conserva las secciones montadas y usa `NativeProgressRoute` para accesos
  contextuales. Perfil reúne datos corporales, objetivo y preferencias.

### Disponibilidad por dominio y estado de guardado

`NativeStore.domainState(_:)` devuelve `NativeDomainState` con `loaded`,
`loading`, `usingCachedData`, `error` y `lastUpdatedAt`, por dominio:

| Consulta | Datos |
| --- | --- |
| `store.domainState(.training)` | Rutinas, días, ejercicios del plan, sesiones y series |
| `store.domainState(.body)` | Perfil corporal y pesos |

Las propiedades heredadas `loaded`/`loading`/`usingCachedData` describen
entrenamiento, no toda la cuenta; `bodyLoaded` accede a su
dominio. Un fallo de cuerpo no convierte entrenamiento disponible en
una pantalla bloqueada, ni una lectura parcial confirma un snapshot completo.
Frescura de lectura y sincronización de escrituras son estados distintos:
**borrador sin registrar**, **guardado en este iPhone**, **pendiente de
sincronizar** y **sincronizado** no son intercambiables. Cuerpo sigue
requiriendo confirmación de red; no adquieren la outbox de series.

### Borradores, salida y contrato de pestañas

- Los borradores nunca registran series por cambiar de pantalla.
  Entrenamiento nativo los conserva en `NativeWorkoutRepository`; web usa
  `createWorkoutDraftStore`/`createWorkoutSetRegistry` y `localStorage`, aislados
  por cuenta, fecha, día, ejercicio e índice. Una respuesta tardía no debe borrar
  una edición posterior. Fallar la persistencia no equivale a guardar.
- Perfil nativo aplica `NativeSignOutPolicy` y consulta
  `pendingWorkoutChanges()` antes de salir. La revisión distingue borradores
  de entrenamiento de comandos registrados en outbox, permite revisar fechas,
  sincronizar solo comandos registrados o cancelar; descartar exige otra
  confirmación. Ediciones pendientes del perfil corporal o sincronización de
  entrenamiento en curso impiden cerrar. `signOut(discardUnsyncedWorkouts:expectedGeneration:)` y
  `NativeWorkoutAction` rechazan confirmaciones de una generación anterior.
  **Esta revisión no es una función del cierre de sesión web.** El descarte descrito es de entrenamiento local, no de
  registros remotos ya sincronizados.
- `NativeTabsView` monta pestañas al visitarlas y conserva su identidad; repetir
  la pestaña activa emite `fitTabRootRequest`, sin resetear el árbol ni forzar
  blur. Cada raíz debe consumir la solicitud con
  `fitTabRoot(isDirty:returnToRoot:)`; los formularios publican
  `fitNavigationDraft(_:)`. `FitTabRootPolicy.canReturn` rechaza borradores
  propios o descendientes: no difiere un pop que se ejecutaría tras guardar.
  Verificar el comportamiento de las cuatro pestañas en QA: conectar el contrato
  no equivale a aceptación interactiva.

### Revisión al finalizar y selección de pendientes

`NativeWorkoutFinishReview` usa `NativeWorkoutFinishSummary` para mostrar series
registradas, ejercicios pendientes y borradores del día/fecha exactos mediante
`NativeWorkoutDraftReference.scoped`. Permite revisar filas antes de finalizar;
registrarlas sigue requiriendo una acción explícita. Finalizar conserva registros
y borradores, termina descanso/actividad en vivo y no completa ejercicios
pendientes ni confirma sincronización remota.

«Hacer este ejercicio después» usa `NativeWorkoutProgress.nextPending` sobre el
orden congelado: avanza cíclicamente entre pendientes, sin registrar ni completar
series y sin alternar indefinidamente solo los dos primeros. El menú permite
elegir otro pendiente; «Siguiente ejercicio» no significa que se registró solo.

### Validación reproducible de esta actualización

Desde la raíz del repositorio, estas pruebas comprueban reglas y persistencia;
son comandos para ejecutar en QA, **no resultados de esta edición documental**:

```sh
npm test -- src/pages/today-selection.test.ts src/pages/today-page.test.tsx \
  src/features/sessions/workout-drafts.test.ts src/features/sessions/exercise-log-drafts.test.tsx
node --test scripts/native-today-ux.node-test.mjs scripts/native-workout-ux.node-test.mjs \
  scripts/native-ui-contract.node-test.mjs src/features/body/native-signout-policy.node-test.mjs
npm run ios:test -- -only-testing:NativeTests/NativeDomainRecoveryTests
```

El último comando usa el destino configurado en `ios:test`; si no está disponible,
elegir uno existente con las instrucciones de preparación/validación posteriores.
Las pruebas de políticas Swift no comprueban entrega de notificaciones ni todas
las conexiones de SwiftUI. Se conserva obligatoria la checklist de **Firma y
aceptación manual pendiente**: OAuth real, dispositivo firmado, VoiceOver,
teclado, retorno de pestañas con edición, cambios de cuenta, red y cambio de día.

## Integración de entrenamiento bloqueado (2026-10-09)

Esta actualización mantiene SwiftUI nativo e iOS 17 como mínimo. Los apartados
fechados anteriores son evidencia histórica, no validación de esta versión.

- `AppDelegate` instala los handlers y la limpieza de cuenta antes de montar
  escenas. La restauración de Keychain/entrenamiento se comparte con el root,
  también en un lanzamiento sin UI; no solicita permisos durante el arranque.
- `f1t://workout?date=AAAA-MM-DD&day=ID` abre el día exacto validado dentro de
  la cuenta autenticada. Un enlace sin parámetros prioriza el entrenamiento
  activo, también si empezó en una fecha anterior y usa su plan congelado.
  No se aceptan fechas inválidas/futuras, días ajenos ni un día que
  contradiga la sesión guardada. Un cambio de cuenta/generación cancela la ruta.
  El callback OAuth `f1t://auth/callback` conserva su flujo PKCE independiente.
- Perfil dispone de estado de Actividades en vivo/notificaciones y acceso a
  Ajustes. AlarmKit es opcional y se guarda por disponibilidad iOS 26+;
  `NSAlarmKitUsageDescription` explica su finalidad. iOS 17 conserva el camino
  de notificaciones ordinarias. No se solicita permiso al abrir los ajustes.
  Una cancelación AlarmKit incierta no dispara una segunda vía de aviso: solo
  una indisponibilidad confirmada permite el fallback ordinario.
- Pantalla **apagada/bloqueada** no significa teléfono apagado: el iPhone debe
  permanecer encendido. No se garantiza ejecución ilimitada en background,
  red, entrega bajo Concentración, ni evitar la autenticación que exija iOS.

### Técnica y fuentes

El catálogo incorpora 165 guías breves en español, redactadas como adaptaciones
por ejercicio: **no son traducciones exactas verificadas**. Conserva instrucciones
originales y atribución free-exercise-db (Unlicense). `Band_Hip_Adductions` presenta
una advertencia explícita por discrepancia en la fuente original; no se oculta ni
se sustituye por una traducción inferida. Revisar la técnica en iPhone forma parte
de la aceptación pendiente.

### Persistencia y alcance de las escrituras

El entrenamiento usa un journal privado por cuenta: series/comandos y borradores
se guardan juntos antes de indicar éxito local; una cola posterior sincroniza
por la clave existente `(session_id, exercise_id, set_index)`. Un error de red
mantiene el comando pendiente. **Guardado en este iPhone** y **Sincronizado** no
son el mismo estado. Reps/kg inválidos conservan el borrador y muestran error;
no deben truncarse ni convertirse silenciosamente en una serie registrada.
El entrenamiento activo conserva plan/día, revisión, ejercicio seleccionado y
fecha absoluta de fin del descanso fuera del ciclo de vida de las vistas.
Deshacer una eliminación exige su token durable vigente: no puede sobrescribir
una serie posterior ni resucitar una sesión eliminada. Los borradores pertenecen
a cuenta/generación, fecha, día, ejercicio e índice, no solo al ejercicio.

Cuerpo no comparte la outbox de series. Persiste las filas realmente devueltas
por el ACK antes de refrescar y solo envía el campo editado del perfil.
No se cambió el esquema remoto.

La inserción de ejercicios conserva el ID del intento y primero reconcilia por
cuenta/día/ejercicio/ID. Si el POST se confirmó pero se perdió la respuesta, el
retry no repite ese POST ni sobrescribe metadatos posteriores. La restricción
UNIQUE existente evita duplicados en bases migradas; no se modificó el servidor.

### Alcance pospuesto explícitamente

- Apple Watch: se conserva el mirroring automático compatible con ActivityKit;
  **no** hay presentación pequeña personalizada validada para Watch.
- Revisión/lease de sesión compartida entre dispositivos en el servidor:
  **no implementada**. Las revisiones locales y upserts existentes no constituyen
  un bloqueo cross-device ni una garantía de exclusión global.
- Entrega de alarmas, autenticación bajo bloqueo y funcionamiento real del iPhone:
  pendientes de aceptación física; no se garantizan desde tests de Simulator.

La sustitución local está implementada y sus regresiones de integración pasan.
Conserva la rutina original, rechaza series/borradores existentes
y archiva el plan realmente realizado al finalizar; no es una edición cross-device.

### Estado de validación de esta integración

- Preparación nativa correcta: 165 ejercicios; sin build web ni Capacitor sync.
- Build App + widget correcta en Xcode 27, Simulator iOS 27, destino existente
  `FIT P2 Isolated` (`AAF06FC0-CFDE-4376-BFD5-41203FF217EC`), mínimo configurado iOS 17.
- XCTest completo final: **130 casos, 128 aprobados, 0 fallidos y 2 omitidos**;
  `TEST SUCCEEDED`. Pasan las regresiones de GET 401/403 (snapshot invalidado,
  outbox/borradores conservados), PATCH condicional vacío (carga concurrente
  recuperada sin otro PATCH) y sugerencia actualizada solo en filas intactas.
- `scripts/ios-native-prepare-rest.node-test.mjs` conserva la carrera determinista
  cancelación vieja suspendida → descanso nuevo → reanudar vieja. Compila el
  coordinador de avisos completo, sin copiar su algoritmo, contra límites del
  sistema simulados; comprueba que la alarma nueva persiste y la incertidumbre
  no genera fallback. Complementa, no sustituye, XCTest del provider real.
- Preparación/layout/configuración/carrera: **20/20 Node**, sin omisiones.
- Los dos casos omitidos son
  `NativeCacheUIRegressionTests.testProductionNumericRowVoiceOverNamesFromTheActualAccessibilityTree`
  y `NativeCacheUIRegressionTests.testVisitedTabsMountLazilyAndRetainOriginalScrollAcrossVisits`.
  SwiftUI no expone el árbol AX en este host unitario: VoiceOver y retención
  interactiva de tabs requieren automatización UI/dispositivo. La batería sí
  comprueba teclado/layout/borradores y montaje inicial por separado; no se
  deducen los dos comportamientos omitidos de compilar ni de capturas.

Evidencia final del 2026-10-09:
`/tmp/f1t-ux-final-rerun-prepare.log`, `/tmp/f1t-ux-final-rerun-build.log`,
`/tmp/f1t-ux-final-rerun-xctest.log`, `/tmp/f1t-ux-final-rerun.xcresult`,
`/tmp/f1t-ux-final-rerun-summary.json` y `/tmp/f1t-ux-final-rerun-node.log`.
El build y XCTest completos usaron el esquema `App`, configuración Debug,
el destino existente indicado arriba y firma ad hoc de Simulator:

```sh
npm run ios:prepare
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,id=AAF06FC0-CFDE-4376-BFD5-41203FF217EC' \
  -derivedDataPath /tmp/f1t-ux-final-derived \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,id=AAF06FC0-CFDE-4376-BFD5-41203FF217EC' \
  -derivedDataPath /tmp/f1t-ux-final-derived \
  -resultBundlePath /tmp/f1t-ux-final-rerun.xcresult \
  -parallel-testing-enabled NO -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 60 -maximum-test-execution-time-allowance 60 \
  -collect-test-diagnostics never \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES test
node --test --test-reporter=tap scripts/ios-native-prepare.node-test.mjs \
  scripts/ios-native-layout.node-test.mjs scripts/ios-native-prepare-rest.node-test.mjs
```

Para repetir XCTest, elegir un `resultBundlePath` nuevo: Xcode no sobrescribe
el bundle de evidencia existente. No se repitió la batería web porque esta
integración no modificó el cliente React.

La aceptación en **iPhone físico firmado** sigue
pendiente: Simulator/builds no prueban entrega bloqueada, AlarmKit real,
provisioning/App Group ni OAuth Google real. No se han modificado datos remotos,
publicado, iniciado sesión real ni instalado en un teléfono.

## Preparar y abrir

```sh
npm run ios:prepare
npm run ios:open
npm run ios:build
npm run ios:test
```

`ios:sync` es ahora un alias de preparación **nativa**: no ejecuta `cap sync`.
No usar `npx cap sync ios` ni regenerar el proyecto con Capacitor; sus archivos
viejos se conservan solo como referencia. El proyecto es
`ios/App/App.xcodeproj`, esquema compartido `App`, mínimo iOS 17.
`ios:test` selecciona `iPhone 18 Pro`; elegir otro destino disponible si el
runtime local es distinto. Xcode 27/iOS Simulator 27 están presentes en el
entorno donde se hizo esta migración.

La preparación lee exclusivamente `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY` de `.env`, `.env.local` y variables de proceso;
`.env.local` prevalece sobre `.env`. Genera `ios/native-config.xcconfig` y
`ios/App/NativeResources/`, ambos ignorados. La configuración contiene únicamente
la URL y la clave pública anon/publishable: **rechaza service_role y sb_secret**.
Nunca distribuir una clave privada. `native-settings.xcconfig` incluye la
configuración local para Debug y Release. Las credenciales de sesión nunca
van a xcconfig, recursos, UserDefaults o App Group: se guardan en Keychain
con `AfterFirstUnlockThisDeviceOnly`.

### Evitar un build con configuración incompleta

El target **App** valida los valores públicos **ya expandidos por Xcode** antes
de compilar, tanto en Debug como Release, incluso con ⌘R o `xcodebuild` directo.
Si faltan o son inválidos, el build falla con una indicación de ejecutar
`npm run ios:prepare`; no imprime URL ni clave. No se genera el xcconfig dentro
del build, porque Xcode ya resolvió los settings para esa ejecución.
La validación necesita Node.js en el Mac (también busca los directorios habituales
de Homebrew); la app instalada sigue sin depender de Node/npm.

**No envolver `https://…` entre comillas en un xcconfig:** `//` inicia un
comentario incluso allí. El generador usa `https:/$()/…`, que Xcode expande a
una URL HTTPS completa. Se encontraron builds locales previos con `SupabaseURL`
truncado a `"https:`, que provoca el mensaje «Configuración incompleta»; no se
inspeccionó el bundle instalado en el teléfono. El generador actual conserva el
escape correcto y el nuevo control impide volver a compilar ese valor roto.

Si la app instalada muestra ese mensaje: ejecutá `npm run ios:prepare`, abrí
`ios/App/App.xcodeproj` y ejecutá **App → tu iPhone → ⌘R** para actualizarla.
Preparar o compilar en Simulator **no actualiza** el teléfono. No hace falta
borrar la app, cerrar sesión ni cambiar Supabase/Google, IDs o firmas.

Regresión de este arreglo: **22/22 Node y 31/31 XCTest**; builds Debug/Release
Simulator y Debug iOS genérico (este último sin firma) aprobados. Los tres
`Info.plist` compilados coinciden con la configuración pública preparada.
Builds negativos reales con configuración ausente, URL entrecomillada/truncada
o clave privada fallan como corresponde. Logs locales:
`/tmp/fit-config-{debug,release,device,xctest,node-all}.log`.

Los recursos incluyen 165 ejercicios, su atribución e imágenes locales. Búsqueda y consulta funcionan sin red. Series de entrenamiento
se registran localmente y se sincronizan después; cuerpo requiere red
para confirmar escrituras. La copia de lectura privada vive en archivos del
sandbox aislados por cuenta y protegidos por el dispositivo; el journal durable
del entrenamiento no contiene credenciales. Una recarga fallida conserva la
última copia disponible de esa cuenta y muestra error/reintento, excepto un
GET 401/403 definitivo: invalida el snapshot de lectura durable sin borrar la
outbox ni los borradores privados. Los registros completos se
paginan en bloques de 500 mediante cursores keyset: sesiones/pesos por fecha+ID,
y claves únicas
para el resto. Evita truncación y saltos/duplicados causados por desplazamientos
OFFSET ante altas/bajas concurrentes. No es aislamiento de snapshot: altas detrás
del cursor o cambios de la clave de orden requieren otra recarga.

## Instalar FIT en tu iPhone (paso a paso)

**Son instrucciones para que las ejecutes vos. Este cambio no instaló FIT en
el teléfono ni modificó cuentas, certificados o provisioning.** No hace falta
borrar F1t primero; ejecutar en el dispositivo actualiza la app con el mismo ID.

1. En Terminal, desde `/Users/mateomorgui/Desktop/F1t`, ejecutá:
   ```sh
   npm run ios:prepare
   npm run ios:open
   ```
   Se abre `ios/App/App.xcodeproj`; la preparación usa la configuración pública
   local de Supabase. No copies claves privadas ni cambies el callback.
2. Conectá el iPhone al Mac, desbloquealo y aceptá **Confiar en este ordenador**
   si lo pide. Esperá a que Xcode lo reconozca; mantenelo desbloqueado.
3. En el iPhone, **Ajustes → Privacidad y seguridad → Modo de desarrollador**,
   activalo, reiniciá y confirmá la activación al volver a encender. Si no aparece,
   emparejá/conectá el dispositivo en Xcode primero. Es necesario para ejecutar
   builds de desarrollo. [Guía oficial de Apple](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
4. En el Mac, **Xcode → Settings → Apple Accounts**, agregá tu cuenta Apple
   si falta. Seleccioná el proyecto azul **App** y, en **TARGETS**, revisá tanto
   **App** como **WidgetExtension → Signing & Capabilities**: **Automatically
   manage signing** activado y el mismo equipo **Mateo**, `JD8CG96M2A`, en ambos.
   No cambies bundle IDs ni App Group. El proyecto ya conserva esa configuración;
   estas indicaciones no la alteran automáticamente.
5. En la barra superior elegí el esquema compartido **App** y tu **iPhone** como
   destino (no un Simulator). Pulsá **⌘R** o el botón triangular Run. Xcode
   compila, firma, instala/actualiza y abre FIT. La firma de Simulator descrita
   abajo no sirve para instalar en iPhone; Xcode usa la firma del equipo.
   [Ejecutar en un dispositivo: Apple](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).
6. Si iOS solicita confiar en el desarrollador, verificá que sea **tu propio
   firmante** y seguí la indicación en **Ajustes → General → VPN y gestión de
   dispositivos**; volvé a ejecutar. No confíes en certificados desconocidos.
7. Si usás **Personal Team** gratuito, el provisioning vence a los **7 días**:
   reconectá el iPhone y ejecutá **⌘R** para renovar/reinstalar cuando venza.
   No es distribución App Store/TestFlight. [Límites oficiales de Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account).

Si Xcode indica errores de firma, equipo o App Group, **detenete y revisá el
mensaje**: no borres perfiles ni cambies IDs/capabilities para ocultarlo. La
compatibilidad de provisioning del equipo y la instalación real todavía deben
validarse en el teléfono. Luego probá Google, pasos, recordatorios y widgets.

## Funciones implementadas

- Google OAuth PKCE S256 con `ASWebAuthenticationSession`, callback exacto
  `f1t://auth/callback`, un intento a la vez, canje de código, refresh
  serializado, restauración en Keychain y cierre local aun si falla la red.
  La revocación remota usa `scope=local` y el token de la sesión saliente; no
  cierra todas las sesiones de la cuenta ni afecta un nuevo login. Su respuesta
  tardía no modifica el estado del nuevo acceso. Un access token ya emitido
  puede seguir válido hasta vencer; la revocación no garantiza borrado remoto.
  El login web anterior no se transfiere: volver a iniciar sesión una vez.
- Hoy: resumen de rutina/día y acceso al entrenamiento guiado y pasos;
  las instrucciones, imágenes y series editables aparecen dentro del entrenamiento.
  Selector de día y «Entrenar igual» conservan la fecha real `performed_on`.
  Una sesión activa conserva su identidad y plan congelado; no se reescribe su
  enlace original al cambiar la rutina. El historial permite correcciones,
  repeticiones/peso y series extra, y conserva
  ejercicios ya registrados aunque se retiren de la rutina. El progreso local
  deriva de las series durables; `set_count` remoto lo mantiene el trigger de Supabase.
- Rutinas: crear/renombrar/borrar/activar; días; catálogo/búsqueda; objetivos,
  notas, quitar y ordenar ejercicios mediante RPC transaccional y posiciones
  esperadas. Cobertura muscular con diagrama corporal y lista textual.
- Progreso: heatmap de 26 semanas por opacidad, racha, días y series; tocar un
  día del calendario abre ese entrenamiento para corregir o borrar (con
  confirmación). Peso fechado/correcciones/borrado y gráfico con promedio
  móvil de siete días.
- Perfil: campos corporales opcionales guardados al salir de cada campo y
  objetivos de peso.
- Pasos: CoreMotion al solicitarlo; permisos opcionales, indisponibilidad en
  Simulator informada. Recordatorios locales únicamente para días activos,
  hora configurable, permiso explícito y limpieza al salir/cambiar cuenta.
  Relanzar/restaurar o refrescar la misma cuenta conserva las preferencias;
  eventos con identidad entrante evitan leer el estado anterior de `@Published`.
- Widgets: mismo App Group y extensiones existentes, payload v2 atómico,
  182 niveles/7 días, máximo seis ejercicios, limpieza al salir. No se
  comparten tokens ni perfil con la extensión. Familias: pequeño,
  mediano (heatmap), grande y Lock Screen circular/rectangular/inline; ver
  «Live Activity del entrenamiento».

La interfaz conserva el lenguaje visual del cliente web original (la UI que se
veía cuando la app era Capacitor): colores claro/oscuro de `src/index.css`, tipografía
Archivo empaquetada en `App/Fonts` (OFL, licencia junto a las fuentes),
tarjetas, botones, encabezados y barra inferior de cuatro pestañas (Hoy,
Rutinas, Progreso, Perfil). Entrenar es su propia pantalla, como en la web. El mapa muscular usa los
polígonos de
`react-body-highlighter` (MIT) en `native-body-map.swift`. Los tokens y
componentes viven en `native-theme.swift`; etiquetas y formatos en español,
en `native-format.swift`. Las funciones exclusivas de la app nativa (pasos,
elegir otro día de rutina, editar días pasados desde el calendario de Progreso) se presentan con el mismo estilo. Se conserva el
escalado de texto, VoiceOver, estados vacíos y errores explícitos. No incluye
un modo demo ni backend inventado para simular aceptación.

## Firma y aceptación manual pendiente

Se conservan Team `JD8CG96M2A`, bundle `com.morguimateo.f1t`, extensión
`com.morguimateo.f1t.widget`, App Group `group.com.morguimateo.f1t` y esquema
`f1t`. La allowlist Supabase existente debe seguir permitiendo el callback;
esta migración no cambió configuración remota ni instaló otra app en iPhone.

Compilar y los tests locales **no verifican** Google real, RLS en una cuenta,
CRUD remoto, App Group firmado, notificaciones entregadas o pasos reales.
Antes de considerar terminado el producto:

1. Entrar con Google, cancelar/reintentar, relanzar app, refrescar sesión;
   comprobar logout offline y cambio de cuenta sin datos/widget anteriores.
2. Crear rutina/día/ejercicio, activar, reordenar, registrar/corregir/desmarcar
   series y confirmar historial en ambos clientes con datos existentes. Entrenar
   hoy en día de descanso y con otro día de plan sin alterar la fecha; repetir
   sobre sesión existente y comprobar que conserva su enlace original.
3. Guardar perfil/pesos y registrar comida hoy y en fecha pasada; comprobar
   snapshot, edición de cantidad, borrado y barreras RLS entre cuentas.
4. Instalar firmado en iPhone, verificar ambos widgets y su limpieza,
   permisos/denegación de pasos, recordatorios/días/hora y cierre de sesión.
5. Validar accesibilidad, giro/iPad, zonas horarias/cambio de día y errores
   reales de red. El refresh sucede al volver al primer plano y al cambiar el día local (revisión cada minuto en primer plano); el contador
   de pasos se actualiza al pedirlo, no es un servicio de fondo.
6. Completar revisión ODbL, etiquetas de privacidad/recopilación y distribución,
   todavía pendientes. Los manifiestos de APIs no sustituyen esa revisión.
7. Relanzar con recordatorios activos y misma cuenta: conserva hora/estado;
   logout/cambio de cuenta los elimina. Reingresar mientras termina un logout
   lento: verificar revocación solo de la sesión saliente en el servidor real.

Referencias de autenticación: [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
y [Apple ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession).

## Validación local de la migración

- Build genérico iOS Simulator Debug y Release de app + WidgetExtension con firma ad-hoc.
- 30 tests XCTest: los diez de PKCE/callbacks, fechas locales, heatmap/racha,
  cálculos, snapshots, Keychain/App Group, recursos e interfaz; nueve nuevos
  sobre restauración/logout/cambio de cuenta durante `willSet`, día alternativo
  y enlace existente, logout suspendido con login reemplazante, paginación de
  1200 filas con altas/bajas y empates, precisión timestamp/filtros y manifiestos
  reales empaquetados en app/extensión; tres adicionales capturan el `URLRequest`
  final de la segunda página vía URLProtocol (502 filas, sin `pageLoader`),
  prueban offsets positivos/negativos, microsegundos, signos `+`, literales
  porcentuales, UTF-8 y filtros; uno comprueba marca FIT e identidad compilada;
  siete adicionales validan callback PKCE, errores seguros y canje HTTP real
  capturado con URLProtocol sin red remota.
  Transporte y datos de esos casos son fixtures
  aislados, no aceptación de Supabase remoto.
- Regresión web: 220 tests Vitest, build y lint.
- 17 tests Node (10 anteriores + 7 para configuración pública, protección
  del flujo nativo, categorías/reasons, recursos por target y marca/identidad).

Un detalle de integración importante: **no llamar `Resources` a una carpeta
copiada en la raíz del `.app` plano**. CoreFoundation la interpreta como un
bundle antiguo, no encuentra el identificador y Simulator rechaza instalar
con `Missing bundle ID`, aunque el Info.plist de raíz sea correcto. Por eso
se usa `NativeResources`.

Los comandos `ios:build`/`ios:test` firman **ad-hoc el Simulator** con
`CODE_SIGN_IDENTITY=-`; no necesitan certificado ni provisioning de iPhone.
Un build con `CODE_SIGNING_ALLOWED=NO` sirve para compilar, pero al ejecutarlo
Keychain y App Group pueden fallar por falta de entitlements. La firma ad-hoc
se verificó en Simulator; no sustituye la firma del dispositivo físico.
La pantalla de acceso nativa se abrió e inspeccionó en Simulator; la navegación
vacía de las cinco pantallas se montó en XCTest, no es una sesión autenticada
ni prueba de CRUD remoto. Los tests incluyen roundtrip de Keychain en un
servicio exclusivo de prueba y acceso al contenedor App Group.

## Manifiestos de privacidad y alcance de validación

`App/PrivacyInfo.xcprivacy` declara UserDefaults `CA92.1` por preferencias
privadas de recordatorios, y FileTimestamp `C617.1` por metadatos del archivo
de payload propio en App Group. `WidgetExtension/PrivacyInfo.xcprivacy` declara
solo FileTimestamp `C617.1`: la extensión lee ese archivo y no UserDefaults.
Ambos se copian en la raíz de su bundle. No se inventa una declaración general
de «sin recopilación»: faltan la auditoría completa y etiquetas para distribución.
Razones contrastadas con [Apple: APIs y razones aprobadas](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons)
y [TN3183](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest).

El alcance de logout se verificó contra el [contrato oficial de Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/logout.go);
los filtros compuestos de cursores siguen [PostgREST: operadores lógicos](https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators).
Pruebas de regresión de los cinco P2: `/tmp/f1t-p2-debug.log`,
`/tmp/f1t-p2-release.log`, `/tmp/f1t-p2-tests.log`, `/tmp/f1t-p2-node.log`.
Estos logs locales no se versionan y no reemplazan la aceptación manual anterior.

Comandos ejecutados tras las correcciones P2 (firma ad-hoc, sin provisioning):

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/f1t-p2-debug \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath /tmp/f1t-p2-debug \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES test
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/f1t-p2-release \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build
node --test scripts/*node-test.mjs
npm test
npm run build
npm run lint
```

Resultados locales: Debug/Release `BUILD SUCCEEDED`, XCTest 19/19, Node 16/16,
Vitest 220/220, build web y lint aprobados. Logs adicionales:
`/tmp/f1t-p2-web-tests.log`, `/tmp/f1t-p2-web-build.log`, `/tmp/f1t-p2-lint.log`.

### Corrección de transporte tras segunda revisión

`URLQueryItem` recibe valores **sin pre-encoding**. Después de generar la query,
`NativeAPI.request` sustituye solo `+` literal por `%2B` en `percentEncodedQuery`
antes de crear el `URLRequest`. No vuelve a codificar toda la query: conserva
puntuación y escapes existentes. Un literal `%2B` dentro de un valor se transmite
como `%252B` y vuelve a `%2B` con un único decode; el signo `+` real viaja como
`%2B`, nunca `%252B`. Los offsets negativos y seis dígitos fraccionales se conservan.

La razón es el [parser oficial PostgREST v14.5](https://github.com/PostgREST/postgrest/blob/v14.5/src/PostgREST/ApiRequest/QueryParams.hs#L137),
que usa `parseQueryReplacePlus True` (un `+` sin escapar se convierte en espacio).
Las tres regresiones fallaron antes de aplicar la corrección:
`/tmp/f1t-transport-red.log`. Tras corregirla: XCTest 22/22, Node 16/16,
Debug/Release Simulator app+widget aprobados con los mismos comandos anteriores.
Logs finales: `/tmp/f1t-transport-tests.log`, `/tmp/f1t-transport-node.log`,
`/tmp/f1t-transport-debug.log`, `/tmp/f1t-transport-release.log`.
No se hicieron cambios ni pruebas de escrituras contra servicios remotos.

### Validación del nombre FIT

Se añadió una regresión XCTest para verificar `CFBundleDisplayName=FIT` y el
texto de Movimiento en los bundles compilados, más bundle IDs, callback y App
Group sin cambios. La inspección independiente de Info.plist compilados sí
confirmó FIT e IDs conservados; la ejecución XCTest se detalla abajo.
Una regresión Node verifica la marca visible de login/widget/notificación y la
estabilidad de identificadores técnicos y nombre web. Debug Simulator app+widget
aprobado y Node **17/17**. La suite de **23 XCTest compiló**, pero en esa
validación original el runner de Simulator no llegó a conectar: primer intento venció
tras 385 segundos; un reintento sin paralelismo tampoco inició tests y fue
interrumpido tras más de seis minutos. Se observó carga del sistema muy alta
(144–289); el muestreo muestra render inicial UIKit/SwiftUI/CoreText. **No se
reportaron 23/23 aprobados en esa intervención**. Esta limitación quedó cerrada
al validar la corrección del retorno Google: la suite completa **30/30**, incluida
la regresión FIT, pasó en `/tmp/fit-oauth-xctest-all.log`. Los 22/22 anteriores
correspondían a la corrección de transporte, no a esa primera validación FIT.
Logs `/tmp/fit-brand-debug.log`, `/tmp/fit-brand-tests-startup-failed.log`,
`/tmp/fit-brand-tests.log`, `/tmp/fit-brand-node.log`; muestreo
`/tmp/fit-brand-runner-sample.txt`. Valores inspeccionados de
Info.plist compilados: `/tmp/fit-brand-bundles.log`. **Instalación en iPhone no
realizada**; no se modificó el icono ni la firma del dispositivo.

## Retorno de Google: validación segura y diagnóstico

El mensaje anterior «El retorno de Google no es válido» significaba que FIT
rechazó el callback **antes de intercambiar el código por una sesión**. No prueba
que el nombre FIT, la cuenta o la configuración remota estén mal. **El callback
real del teléfono todavía no se capturó ni se conoce su causa concreta.**

Se corrigió un rechazo local reproducible: `?code=...#` con fragmento vacío ahora
es compatible, como en el cliente oficial Swift. Se separaron errores de ruta,
formato, código ausente/vacío/repetido, fragmento/tokens y proveedor. Se acepta
solo la ruta exacta `f1t://auth/callback`, un código no vacío en query y fragmento
ausente/vacío. Metadata de query como `sb_flow_id` se ignora (un intento local a
la vez); no decide el verifier. Tokens, códigos en fragmento, conflictos y
fragmentos de éxito desconocidos siguen rechazados. El canje sigue verificando
PKCE S256 con el verifier local, nunca extraído del callback.

Los errores oficiales pueden aparecer en query y fragmento con marcador `sb=`.
FIT los reconoce **solo para rechazar y explicar**, no para iniciar sesión. Solo
códigos conocidos seleccionan mensajes fijos; nunca se muestra
`error_description`, códigos desconocidos, URLs, códigos de acceso, tokens o
correo. Descripciones espejadas pueden tener representación distinta por la
codificación del servidor; se ignoran, sin doble decode. Identificadores de error
contradictorios se rechazan.

Si vuelve a fallar, el mensaje incluirá **Diagnóstico seguro** con motivo fijo,
`s/h/p` (coincide esquema/host/path: 1 sí, 0 no), `c` (cantidad de códigos, máximo
99) y `f` (categoría del fragmento). Podés compartir ese mensaje o una captura
**de ese texto**, nunca la URL de callback ni códigos/tokens. Esto permitirá
identificar el branch real sin secretos. **Para recibir este arreglo en el
build instalado, volvé a ejecutar App en tu iPhone con ⌘R**; no se instaló ni
cambió provisioning desde esta intervención.

Fuentes primarias contrastadas: [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[Auth: redirect PKCE](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/api/verify.go),
[Auth: callback/errores OAuth](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/api/external.go),
[Swift: extracción de parámetros](https://github.com/supabase/supabase-swift/blob/6c7d3b521c37ca8866d41b1d10f9da6aa848cb07/Sources/Auth/Internal/Helpers.swift)
y [Swift: PKCE/canje](https://github.com/supabase/supabase-swift/blob/6c7d3b521c37ca8866d41b1d10f9da6aa848cb07/Sources/Auth/AuthClient.swift).
El servidor inspeccionado agrega el código a la query y **no añade `#` vacío
por defecto**; Go normaliza el fragmento vacío. No se atribuye ese caso al
callback del usuario sin evidencia.

### Regresión offline del parser de producción

```sh
# Swift/macOS: sin red, UIKit, Keychain ni Simulator.
swiftc ios/App/Native/native-oauth-callback.swift scripts/native-oauth-callback-tests.swift \
  -o /tmp/fit-oauth-callback-tests
/tmp/fit-oauth-callback-tests
# Opcional: Go estándar reproduce las formas de los helpers públicos de Auth;
# no ejecuta un servidor ni agrega una dependencia a la app.
mkdir -p /tmp/fit-oauth-primary
go run scripts/native-oauth-redirect-fixtures.go > /tmp/fit-oauth-primary/redirect-fixtures.json
/tmp/fit-oauth-callback-tests /tmp/fit-oauth-primary/redirect-fixtures.json
```

Build Debug app+widget aprobado, sin warnings; suite XCTest completa **30/30**,
con los **7/7** casos nuevos de callback y la regresión FIT antes pendiente.
Node **17/17**. La ejecución con fixtures Go pasa **52 casos**, diagnósticos sin
datos y contrato
`authorize`/`POST token?grant_type=pkce` (`auth_code`, `code_verifier`). Sin fixtures
externos el runner ejecuta los 45 casos base. XCTest añade siete casos, incluyendo
URLRequest de canje capturado y cero solicitudes ante callbacks rechazados.
Logs: `/tmp/fit-oauth-standalone.log`, `/tmp/fit-oauth-debug.log`,
`/tmp/fit-oauth-xctest.log` (siete casos enfocados), `/tmp/fit-oauth-xctest-all.log`
(suite completa), `/tmp/fit-oauth-node.log`. No se verificó Google/Supabase real;
la causa del retorno del teléfono y su aceptación tras ⌘R siguen pendientes.

## Entrenamiento guiado: implementación actual y evidencia histórica (2026-10-05)

- **Hoy** coloca el día, cantidades y CTA antes del detalle desplegable del plan.
  Una sesión activa puede mostrar el nombre del ejercicio actual. Editar el día
  y entrenar en un día de descanso siguen disponibles; la sesión activa tiene
  prioridad y el plan de otro día queda secundario.
- Empezar/retomar desde Hoy usa `.guided`; revisar una sesión finalizada usa
  `.history`. Se muestra **Ejercicio N
  de M**, un ejercicio y sus series requeridas. **Siguiente ejercicio** exige cada
  índice requerido guardado: duplicados, índices fuera de objetivo o huecos no
  cuentan. No avanza automáticamente: el descanso de la última serie queda visible
  hasta tocar Siguiente / Completar entrenamiento.
- Un objetivo ausente/cero usa **1 serie**, tanto al mostrarlo como al comprobar
  finalización. El modo guiado no agrega filas infinitas. El modelo ya impide
  ejercicios repetidos dentro del mismo día (`routine_day_id, exercise_id`); se
  deduplican defensivamente para evitar identidades SwiftUI repetidas.
- Salir conserva las series guardadas, borradores y el cursor del controlador
  activo; al volver se restaura el ejercicio seleccionado del plan congelado.
  Sin sesión activa restaurable se utiliza el primer ejercicio pendiente.
  Si todos terminaron, se muestra una confirmación con **Revisar o
  corregir series**. El calendario y el historial siguen abriendo el editor
  `.history` por defecto: todas las series, correcciones, desmarcado y filas extra
  continúan disponibles sin imponer el flujo guiado.
- **Descanso** es una preferencia local del dispositivo: inicialmente **2 min**,
  ajustable **0,5–10 min** en pasos de medio minuto. Es un valor inicial de UI, no
  una recomendación médica. Cambiarlo afecta el próximo descanso, no el actual.
  Se muestra `mm:ss` y **Omitir**; no bloquea marcar series ni Siguiente.
- El reloj empieza/reinicia solamente al confirmar un **nuevo** guardado local durable;
  editar, desmarcar, refrescar o fallar no lo inicia. Usa una fecha de fin para
  calcular tiempo real, incluso después de background o de cambiar de pestaña.
  La fecha absoluta se persiste y puede programar un aviso ordinario o AlarmKit,
  según disponibilidad y permiso. Salir de la vista o el rollover diario no la
  elimina. Completar, borrar la sesión o cambiar/cerrar cuenta limpia el estado.
- La escritura publica el guardado local después de persistir serie y comando;
  la outbox sincroniza posteriormente. Un fallo de red no retira esa serie ni
  reinicia su descanso. Guardas por fila y de cuenta/generación protegen los
  cambios, sin confundir éxito local con confirmación remota.
- Al cambiar el día elegido se conserva el contrato existente: una sesión por fecha
  y sus series por `(session_id, exercise_id, set_index)`; no se reescribe el día de
  rutina histórico. El entrenamiento activo mantiene su plan congelado aunque
  cambie la rutina; la sustitución local no altera la rutina y el plan realizado
  se archiva al finalizar. Cada borrador conserva su contexto completo.

### Evidencia local

Validación Simulator iPhone 18 Pro: **16/16 XCTest enfocados**, **47/47 XCTest
completos**, **27/27 Node** y **220/220 Vitest**. Build Debug Simulator app+widget
aprobado. Las regresiones de scroll prueban Hoy compacto y un editor de 24 series
al máximo desplazamiento, en 375×667 sin home indicator y 430×932 con 34pt;
verifican viewport, botón visible/tocable, margen de 32pt y teclado del shell.

Capturas de fixtures nativos (sin login/bootstrap/red) exportadas a
`/tmp/fit-guided-screenshots/`: `guided-Today-summary-no-exercises.png`,
`guided-only-first-exercise.png`, `guided-resume-only-second-exercise.png`,
`guided-complete-with-history-edit.png`,
`guided-live-rest-timer-production-panel.png` y geometría `Today-bottom-*` /
`Workout-bottom-*`. La captura del reloj compone el panel de producción con una
fecha local; los triggers reales de escritura se prueban por transporte HTTP
interceptado, **no** contra Supabase. No hubo instalación física, cambios remotos,
esquema, cuenta real ni provisioning. No se verificó una sesión real en iPhone.

Logs: `/tmp/fit-guided-build.log`, `/tmp/fit-guided-focused.log`,
`/tmp/fit-guided-all-xctest.log`, `/tmp/fit-guided-node.log`,
`/tmp/fit-guided-vitest.log`. Para recibirlo en el teléfono: abrir
`ios/App/App.xcodeproj`, seleccionar App y el iPhone habitual y ejecutar **⌘R**.
No hace falta ejecutar migraciones ni `db:push`.

## Live Activity: implementación actual y evidencia histórica (2026-10-05)

- Al abrir/restaurar el entrenamiento **guiado activo**, incluso de fecha anterior, se inicia una
  Live Activity (`F1tWorkoutAttributes`, `Shared/workout-activity.swift`) en
  pantalla de bloqueo y Dynamic Island: foto del ejercicio, **título = ejercicio**,
  **descripción = «Serie N de M · X reps · Y kg»**, «Ejercicio N de M», barra de
  series hechas/planificadas y cuenta regresiva del descanso. Las reps/peso
  sugeridos son los mismos que precarga la fila: sesión anterior del mismo día,
  si no el objetivo de la rutina.
- El ejercicio mostrado sigue el cursor persistido del controlador activo.
  La última serie habilita la finalización explícita; no sustituye esa acción.
  **Salir y guardar progreso** o el rollover diario conservan la sesión activa.
  Completar, borrar la sesión o cambiar/cerrar cuenta limpia la actividad.
- **Serie hecha** (`F1tLogSetIntent`, `LiveActivityIntent`) se ejecuta en el proceso
  de la app, incluso lanzada en segundo plano: `AppDelegate` registra el handler
  sobre `NativeStore.shared` antes de cualquier escena. Usa `saveWorkoutSet` (upsert
  por `session_id, exercise_id, set_index`), valida cuenta/revisión/contexto y
  borrador durable, y rechaza acciones obsoletas sin tocar la red. El guardado
  local inicia el descanso canónico; la sincronización remota es posterior.
  No exige que la fecha de la sesión activa sea hoy. Un error se muestra en la actividad.
- Las extensiones no leen el bundle de la app: la foto se copia reducida (180 px,
  JPEG) a `live-thumbs/` del App Group. El estado en curso para widgets vive en
  `workout-live.json`; los widgets lo ignoran si es de otro día o tiene más de 6 h
  sin cambios. El estado derivado se limpia al terminar o borrar la sesión, no
  por salir de la vista; las miniaturas se limpian al cerrar sesión. El snapshot
  diario de widgets y el archivo privado del entrenamiento son contratos distintos.
- Widgets: **pequeño** (rutina de hoy + racha, o ejercicio/serie en curso con
  foto), **grande** con cabecera «En curso», y Lock Screen **circular** (racha o
  progreso de series), **rectangular** (rutina o ejercicio + serie + descanso) e
  **inline**. El mediano (heatmap) no cambia.
- Requiere `NSSupportsLiveActivities` (App) y que el usuario no haya desactivado
  Actividades en vivo en Ajustes; sin permiso, los widgets igual muestran el
  entreno en curso. No hay push remoto: solo se actualiza desde el dispositivo.


### Corrección del bloqueo de Cuerpo

El calendario retenido en la sección oculta escribía su ancho en `@State`
desde `onGeometryChange`. Con altura cero, esa medida cambiaba el tamaño de
sus filas y generaba un ciclo continuo de layout en el hilo principal.
`FitHeatmapLayout` calcula y coloca las filas sin escribir estado. Las secciones
siguen montadas para preservar borradores. La regresión nativa abre Cuerpo con
un peso guardado y verifica que el campo siga respondiendo.
