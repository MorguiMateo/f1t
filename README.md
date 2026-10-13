# F1t

App fitness personal: rutinas, entrenamiento, calendario de actividad,
seguimiento corporal. **El cliente iOS es ahora Swift/SwiftUI
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

## Base de datos

Las migraciones históricas se conservan para reproducir el esquema existente;
la app actual usa rutinas, entrenamientos, perfil corporal y pesos. No se borran
datos remotos ni se ejecutan migraciones o despliegues como parte de esta edición.

`npm run db:types` redirige directamente a `src/lib/database.types.ts`.
Generar a un archivo temporal y revisar el diff antes de reemplazarlo.
La regresión local de integridad está en `supabase/tests/20260929_integrity.sql`.

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
deployment, incluido el alias de producción, exigen Vercel Authentication.
No se cambió el hosting ni se publicó esta edición.

## Progreso

Entrenamiento muestra Actividad de 26 semanas primero y evolución por ejercicio
al final; no incluye la búsqueda de fecha ni el listado de entrenamientos.
El calendario permite abrir un día registrado. Cuerpo conserva el registro,
el historial y la curva de peso, junto con el objetivo corporal de Perfil.

## Estructura y contratos

- `src/lib/heatmap.ts`: `buildLevels()` entrega 26 × 7 enteros 0–4, alineados a
  semanas; es el contrato con SwiftUI. La intensidad usa **opacidad, no tono**,
  para los modos Clear y Tint de iOS 26.
- `src/lib/device.ts`: puente del cliente web/host anterior; la app nativa usa `ios/App/Native/native-device.swift`. Web guarda solo una copia
  diagnóstica del payload; iOS sincroniza con el App Group.
- `public/exercises/`: imágenes estáticas del catálogo de ejercicios.

Catálogo de ejercicios derivado de
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
