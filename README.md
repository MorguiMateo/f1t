# F1t

App fitness personal: rutinas, entrenamiento, calendario de actividad,
seguimiento corporal y diario de comidas. **El cliente iOS es ahora Swift/SwiftUI
nativo**, sin WebView ni dependencia de Capacitor en su target. La web
React/Vite se conserva; ambos usan el mismo Supabase y los datos existentes.

## iOS nativo

```sh
npm run ios:prepare  # configuración pública local + catálogos e imágenes
npm run ios:open     # proyecto Xcode, esquema App (iOS 17+)
npm run ios:build    # build Debug para Simulator (firma ad-hoc)
npm run ios:test     # tests nativos en iPhone 18 Pro Simulator
```

`ios:sync` prepara recursos nativos: **ya no ejecuta Capacitor ni copia la web**.
Configurar `.env`/`.env.local` ignorados con URL y clave pública anon Supabase;
no incluir claves privadas/service_role. Sesión en Keychain, OAuth PKCE con
navegador del sistema, pantallas nativas y widgets existentes. Login real,
CRUD remoto y aceptación en iPhone siguen requiriendo pruebas manuales;
compilar no implica aceptación del producto.

Ver [implementación, paridad y checklist nativa](docs/native-swift.md).
La documentación antigua de Capacitor se conserva como contexto histórico,
no como procedimiento para regenerar el proyecto migrado.

## Web conservada

Vite + React 19 + TypeScript, Tailwind CSS v4, Supabase, TanStack Query y PWA.
`npm run dev`, `npm run build`, `npm test` y `npm run lint` conservan su uso.
El hosting existente sigue siendo privado; esta migración no modifica servicios
remotos, despliegues ni base de datos. Fases históricas: [PLAN.md](PLAN.md).

## Comidas (Fase 7)

La [decisión 7.1](docs/food-data-decision.md) eligió Open Food Facts (OFF)
frente a USDA para el primer recorte argentino. El catálogo offline
`2026-10-01.1` contiene **43 productos con `en:argentina` en su ficha OFF**;
no son 43 etiquetas actuales verificadas independientemente. La pantalla
`/comidas` permite buscar, registrar por fecha local en gramos o mililitros,
editar cantidad y borrar. Guarda versión, procedencia, kcal/100 y kcal de cada
entrada, más un snapshot de objetivo/TDEE al primer registro del día; cambios
de perfil o entrenamientos no reescriben ese historial. La búsqueda funciona
sin red; guardar requiere Supabase. Los valores son orientativos y prevalece
la etiqueta actual del envase. Se excluyó el código `7790895000782` por una
discrepancia con la [información actual de Coca-Cola Argentina](https://www.coca-cola.com/ar/es/brands/coca-cola/original)
sin confirmar la etiqueta vigente de ese código exacto; no se sustituyó por
una cifra inferida.

Regeneración reproducible desde snapshots fijados, **sin red**:

```bash
node scripts/food-import.mjs --check
node --test scripts/food-catalog.node-test.mjs
```

Para actualizar fichas, seguir el [procedimiento de importación](scripts/foods/README.md):
`node scripts/food-fetch.mjs --refresh` deja respuestas solo en `staged/`;
`node scripts/food-promote.mjs` requiere revisión humana y sube la versión.
El fetch usa User-Agent identificable y espera 4,5 s entre productos para
mantenerse por debajo de **15 lecturas de producto/min/IP**. OFF no se consulta
durante el uso de la app. El recorte y la atribución legibles por máquina están
en `public/data/foods-catalog.json` y
`public/data/foods-catalog-attribution.json` (rutas `/data/...` en el build
estático, pero hoy bloqueadas para visitantes anónimos por Vercel Authentication).
No se distribuyen imágenes OFF. **La revisión legal/ODbL del recorte abierto y
la separación del diario privado está pendiente antes de distribuir.**

## Base de datos y despliegue

`npm run db:status` mostró `local = remote` para
`20260929010000_integrity_boundaries.sql` y
`20260929155045_food_diary.sql` en el Supabase vinculado el **2026-09-29**;
la migración del diario se aplicó allí ese día. En otro proyecto, aplicar
ambas migraciones por despliegue autorizado **antes** del frontend: éste llama
a las RPC de rutinas y a `log_food_entry`, `set_food_entry_quantity` y
`delete_food_entry`. No ejecutar `npm run db:push` automáticamente. El
preflight de la migración de integridad aborta ante ejercicios duplicados en
un día o sesiones vinculadas al día de otro usuario: resolver esos registros
manualmente, sin borrado automático, y reintentar.

La regresión SQL local está en `supabase/tests/20260929_integrity.sql`; una
validación independiente pasó en PostgreSQL 16.9 con las primeras cuatro
migraciones y seed de 165 ejercicios. PostgreSQL 17, configurado para el
proyecto, no está validado por esa prueba. Las pruebas del diario están en
`supabase/tests/20260929_food_diary.sql` y
`supabase/tests/20260929_food_diary_rls.sql`.

`npm run db:types` **redirige directamente** a `src/lib/database.types.ts`.
No ejecutarlo a ciegas: los tipos generados tras el push difieren de los
modelados a mano y pierden la nulabilidad de argumentos RPC como
`p_target_kcal`/`p_tdee_kcal`. Generar primero a un archivo temporal, revisar
el diff y preservar el contrato de argumentos nullables antes de reemplazar.

## Hosting web privado (no lanzamiento público)

El proyecto Vercel `f1t` está creado/vinculado y
[`https://f1t-pied.vercel.app`](https://f1t-pied.vercel.app) figura **Ready,
target `production`**. `vercel.json` fija `framework: vite`,
`npm run build` y `dist`; `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` están
configuradas en todos los entornos de Vercel (la anon key es pública por
diseño; no publicar credenciales privadas). `.vercelignore` excluye `.env`,
proyecto nativo y snapshots de la subida. La CLI apuntó automáticamente a
producción en el primer despliegue; se habilitó `ssoProtection` con
`deploymentType=all` **antes de que quedara Ready**. **Todos los URLs de
deployment, incluido el alias de producción, exigen Vercel Authentication**:
visitas anónimas a `/`, `/comidas` y `/data/foods-catalog.json` devolvieron
HTTP 302 hacia SSO. No hay preview anónima ni acceso público al catálogo.

Validación local: **220 tests Vitest, 14 tests Node, build y lint en verde**.
Tras revisar dependencias, `npm ci` y `npm audit` reportan **0 vulnerabilidades**;
la suite completa de scripts suma **14 tests Node**, incluidos dos de
compatibilidad del override `xcode → uuid`. El frontend actualizado se
redesplegó el 2026-10-01; quedó Ready y los tres endpoints anónimos anteriores
siguen devolviendo 302. El catálogo alojado coincide con la copia local. Ver
[seguridad de dependencias](docs/dependency-security.md) para el motivo,
verificación nativa y avisos residuales.
La automatización con navegador integrado falló; Google OAuth real y el CRUD
del diario no están comprobados end-to-end. La revisión legal ODbL y de
etiquetas actuales sigue siendo una puerta externa antes de abrir el sitio.

## Estructura y contratos

- `src/lib/heatmap.ts`: `buildLevels()` entrega 26 × 7 enteros 0–4, alineados a
  semanas; es el contrato con SwiftUI. La intensidad usa **opacidad, no tono**,
  para los modos Clear y Tint de iOS 26.
- `src/lib/device.ts`: puente del cliente web/host anterior; la app nativa usa `ios/App/Native/native-device.swift`. Web guarda solo una copia
  diagnóstica del payload; iOS sincroniza con el App Group.
- `src/features/foods/` y `public/data/`: catálogo OFF offline, diario y
  recorte/atribución descargables. Los datos privados viven en Supabase con RLS.
- `public/exercises/`: imágenes estáticas del catálogo de ejercicios.

Catálogo de ejercicios derivado de
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
