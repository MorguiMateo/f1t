# Aceptación actual — integración nativa (2026-10-09)

Xcode 27 y simuladores iOS 27 están disponibles. Las listas vacías y resultados
de fechas anteriores que aparecen debajo son históricos. La aceptación física
continúa pendiente; no hubo publicación, cambios remotos ni instalación iPhone.

- [x] Compilar app y extensión tras estabilizar las fuentes, con membresía
  explícita por target y mínimo iOS 17 (Xcode 27 / FIT P2 Isolated).
- [x] Repetir XCTest completo sobre las fuentes finales: **130 casos, 128 pass,
  0 fail, 2 skip; TEST SUCCEEDED**. Las tres regresiones anteriores están cerradas
  con sus expectativas conservadas. Preparación: 165 ejercicios; Node: **20/20**.
  Evidencia: `/tmp/f1t-ux-final-rerun.xcresult`,
  `/tmp/f1t-ux-final-rerun-xctest.log`, `/tmp/f1t-ux-final-rerun-build.log`,
  `/tmp/f1t-ux-final-rerun-prepare.log` y `/tmp/f1t-ux-final-rerun-node.log`.
- [ ] Abrir enlaces de entrenamiento con app abierta y cold start: mismo día
  activo, día movido, OAuth intacto; rechazar otra cuenta, fecha/día inválidos,
  sesión contradictoria y respuestas de una generación anterior.
- [ ] En iPhone firmado: iniciar entrenamiento, bloquear/apagar **la pantalla**,
  marcar una serie, extender/omitir descanso y regresar a la sesión exacta.
  El dispositivo debe estar encendido; comprobar cualquier desbloqueo exigido.
- [ ] En modo avión: registrar series, relanzar, comprobar cola local y
  sincronización idempotente al recuperar red. Cerrar/cambiar cuenta debe
  impedir acceso y sincronización de datos del propietario anterior.
- [ ] Probar avisos con permisos concedidos/denegados, Concentración/Silencio,
  restablecimiento del proceso, cambio de fecha y cleanup de sesión. AlarmKit
  opcional en iOS 26+; en iOS 17–25 verificar alternativa ordinaria sin crash.
- [ ] Verificar sustitución local sin alterar la rutina, rechazo de sustituciones
  con series/borradores existentes y conservación del progreso al relanzar.
- [ ] Verificar drafts de reps/kg, errores inline, restauración y edición de
  plan durante entrenamiento, accesibilidad/Dynamic Type y diario de comidas.
  VoiceOver/retención interactiva de tabs requieren automatización UI o dispositivo:
  el árbol AX no se expone en el host de XCTest unitario de este runtime.
  Son los dos skips de `NativeCacheUIRegressionTests`:
  `testProductionNumericRowVoiceOverNamesFromTheActualAccessibilityTree` y
  `testVisitedTabsMountLazilyAndRetainOriginalScrollAcrossVisits`.
- [ ] Comprobar que App Group/widget no contiene credenciales, y logout borra
  estado privado visible, notificaciones y alarmas de descanso.

## Fuera del alcance implementado

- Presentación personalizada para Apple Watch (solo mirroring automático).
- Revisión/lease cross-device en servidor; no hubo migración remota.
- Exactly-once para los RPC de alimentos ante pérdida de respuesta.

---

> **Actualización Swift/SwiftUI:** el target iOS ya no es Capacitor.
> Usar [native-swift.md](native-swift.md) para preparar, compilar y probar.
> `ios:sync` prepara recursos nativos; no ejecutar `cap sync` sobre el proyecto
> migrado. Los apartados de host/WebView de esta checklist son históricos;
> las comprobaciones de firma, App Group, OAuth, iPhone y distribución siguen
> siendo necesarias.

# F1t — checklist de aceptación iOS y apertura web

**Estado 2026-10-01: pendiente de aceptación.** El proyecto nativo apunta a
**iOS 17+**. Xcode 27 está instalado/seleccionado y compila, pero no hay
runtime/dispositivo de Simulator; la firma está configurada localmente con el
Personal Team `JD8CG96M2A` pero el provisioning no está verificado; no se ejecutaron
app, widgets o pasos en un dispositivo. Marcar una casilla solo tras observar
el resultado: un build genérico sin firma no prueba OAuth, App Groups o UI.

## Comprobado localmente (no aceptación de producto)

- [x] `xcodebuild -version` muestra Xcode 27; `App` y `WidgetExtension`
  compilaron con `CODE_SIGNING_ALLOWED=NO` para `generic/platform=iOS Simulator`
  en **Debug y Release**. Swift Package Manager; no se requiere CocoaPods.
- [x] `vercel.json` fija Vite, `npm run build` y `dist`; `.vercelignore` excluye
  `.env`, proyecto iOS y snapshots de la subida a Vercel.
- [x] Build/lint locales, 220 tests Vitest y 4 tests Node pasaron. El
  importador determinista verifica el catálogo OFF `2026-10-01.1` de 43
  productos, sin el código retirado `7790895000782` ni kcal inferidas.
- [x] El proyecto Vercel `f1t` está vinculado; `https://f1t-pied.vercel.app`
  figura **Ready, target production**, pero **no es lanzamiento público**.
  El primer deploy de CLI autoapuntó a producción; `ssoProtection` con
  `deploymentType=all` se activó antes de Ready. Todos los URLs de deployment,
  incluso el alias de producción, exigen Vercel Authentication. GET anónimo a
  `/`, `/comidas` y `/data/foods-catalog.json` devolvió **302 a SSO**; no hay
  preview anónima. Tras corregir dependencias, se redesplegó el 2026-10-01:
  Ready y nuevamente 302 en esos endpoints. Una descarga autenticada del
  catálogo coincidió exactamente con el JSON local de 43 productos.
- [x] La configuración remota `uri_allow_list` de Supabase se amplió y verificó
  con estas **seis entradas exactas** (sin borrar las anteriores):
  `http://localhost:5173`, `http://127.0.0.1:5173`, `f1t://auth/callback`,
  `https://f1t-pied.vercel.app`,
  `https://f1t-morguimateos-projects.vercel.app` y
  `https://f1t-7ies7q166-morguimateos-projects.vercel.app`. Se conservaron
  `site_url` y las credenciales del proveedor Google; Google figura
  `enabled=true`. **No se ha probado un login real.**

## Preparación externa pendiente

- [ ] Liberar espacio antes de descargar runtime iOS 26 (~7,99 GB; espacio
  libre escaso, ~11 GB reportados). Instalar runtime, crear simulador y
  comprobar `xcrun simctl list runtimes` / `xcrun simctl list devices`.
  Actualmente ambas listas están vacías; **no se ejecutó un simulador**.
- [ ] Confirmar en Xcode que el Personal Team `Mateo Morgui (Personal Team)`
  (`JD8CG96M2A`) puede aprovisionar los IDs **propuestos** (no registrados ni
  verificados aún): `com.morguimateo.f1t`, `com.morguimateo.f1t.widget`,
  `group.com.morguimateo.f1t`. Firma automática y App Groups ya están
  configurados localmente en `App` y `WidgetExtension`; falta que Xcode genere
  los perfiles (Signing & Capabilities sin errores) en un iPhone conectado. Si
  los IDs cambian, alinear `capacitor.config.ts`,
  `ios/App/App.xcodeproj/project.pbxproj`, ambos entitlements,
  `ios/App/Shared/F1tWidgetPayload.swift` y `CFBundleURLName` en `Info.plist`.
  Los perfiles de Personal Team caducan a los 7 días.
- [ ] Durante la prueba OAuth, confirmar el retorno por el callback exacto
  `f1t://auth/callback` ya permitido. Google Cloud conserva el callback HTTPS
  de Supabase, no este esquema privado. No exponer `.env` ni credenciales.
- [ ] Confirmar `npm run db:status` en la base de destino: las migraciones
  `20260929010000` y `20260929155045` figuraron `local = remote` en el
  Supabase vinculado el 2026-09-29. No ejecutar `npm run db:push` sin
  autorización/preflight. Vercel tiene `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_ANON_KEY` en todos los entornos; eso no prueba OAuth/CRUD.

## Pruebas funcionales aún no ejecutadas

- [ ] `npm run ios:sync && npm run ios:open`; elegir equipo, esquema `App` y
  Simulator/iPhone. Completar Google OAuth y retorno por
  `f1t://auth/callback`, crear/activar rutina, registrar una serie y confirmar
  persistencia tras relanzar. Probar cancelación/error de OAuth y cold start.
- [ ] En app firmada, registrar serie y confirmar que
  `group.com.morguimateo.f1t/widget-payload.json` se escribe/actualiza como JSON
  válido: 182 niveles 0–4, `todayLabel`, `todayExercises`, `streak` y
  `routineWeek` v2. Verificar que app y extensión leen el **mismo** App Group;
  al cerrar sesión se borra el archivo y los widgets dejan de mostrar datos
  privados. La copia web en `localStorage` no es prueba suficiente.
- [ ] Agregar widgets mediano/grande: heatmap, rutina/descanso, límite de
  ejercicios, cambios de rutina, actualización tras serie, medianoche local
  y estado vacío/logout. En iOS 26 comprobar **Clear y Tint**: niveles
  distinguibles por opacidad.
- [ ] En **iPhone físico firmado**, empezar el entrenamiento guiado de hoy:
  aparece la Live Activity con foto, ejercicio y «Serie N de M · X reps» en
  pantalla de bloqueo y Dynamic Island; marcar en la app actualiza serie,
  progreso y descanso. Tocar **Serie hecha** con la app cerrada guarda la
  serie (verificar en Progreso y en la web), avanza y arranca el descanso;
  sin red muestra el error. Completar muestra «Entrenamiento completo»;
  Salir, cerrar sesión o cambiar de cuenta la retiran. Con Actividades en
  vivo desactivadas en Ajustes la app sigue funcionando.
- [ ] Agregar widgets pequeño y de pantalla de bloqueo (circular,
  rectangular, inline): estado normal (rutina/racha) y en curso
  (ejercicio/serie/descanso); vuelven al normal al salir, a las 6 h sin
  cambios o al día siguiente.
- [ ] En Perfil, conceder/denegar notificaciones, guardar/cancelar recordatorio
  por día/hora local, entrega con app cerrada y limpieza al cerrar sesión.
- [ ] En **iPhone físico**, conceder/denegar Movimiento y condición física,
  comparar «Pasos de hoy» con el dispositivo, refresco al volver a primer
  plano y estado sin sensor/permiso. No inferir pasos del Simulator.
- [ ] Probar Google OAuth web y CRUD real de `/comidas` con cuenta en el sitio
  protegido: alta, edición, borrado, fecha local, kcal y snapshot de
  objetivo/TDEE. Falló la automatización del navegador integrado; no se
  completó una prueba end-to-end.

## Puertas antes de abrir al público

- [ ] Revisar legal/compliance **ODbL/DbCL**, atribución, descarga del recorte
  derivado abierto y separación del diario privado. El JSON independiente
  ya incluye URLs de fuente/licencias/atribución, pero el HTTP anónimo está
  protegido por SSO. Verificar `/data/foods-catalog.json` y
  `/data/foods-catalog-attribution.json` **tras una apertura autorizada**;
  no quitar Vercel Authentication hasta cerrar estas puertas. Revalidar
  etiquetas actuales; `en:argentina` no prueba vigencia comercial.
- [ ] Revisar icono/splash nativos (aún placeholders), firma, versión y destino
  de publicación; repetir smoke test con build de distribución.
- [x] Dependencias revisadas: `npm ci` y `npm audit` reportan **0
  vulnerabilidades** al 2026-10-01. Pasaron 220 tests Vitest, 10 tests Node,
  lint, build, `ios:sync` y build Simulator unsigned Release tras los cambios.
  Repetir el audit antes de abrir al público; no equivale a una certificación
  de seguridad. Ver [decisión y avisos residuales](dependency-security.md).
- [ ] Si se regeneran tipos Supabase, **no** ejecutar `npm run db:types` a
  ciegas: redirige sobre `src/lib/database.types.ts`. Generar a temporal y
  revisar nulabilidad de `p_target_kcal`/`p_tdee_kcal` antes de reemplazar.
