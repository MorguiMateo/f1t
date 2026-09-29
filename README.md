# F1t

App fitness personal: rutinas por día, calendario de actividad tipo GitHub y
seguimiento de peso. Web primero, pensada desde el día uno para envolverse en
Capacitor y tener un widget nativo en la pantalla de inicio del iPhone.

Plan, fases y decisiones tomadas: **[PLAN.md](PLAN.md)**.

## Stack

- **Vite + React 19 + TypeScript** — build estático preparado para una futura
  integración con Capacitor
- **Tailwind CSS v4** — tokens en `src/index.css`, tema claro y oscuro
- **Supabase** — Postgres, Auth con Google, RLS
- **TanStack Query** — caché de datos remotos
- **vite-plugin-pwa** — manifest, service worker, iconos de iOS

## Comandos

```bash
npm run dev      # servidor de desarrollo
npm run build    # typecheck + build de producción
npm run preview  # sirve el build
npm test         # tests (vitest)
npm run lint     # oxlint
npm run icons    # regenera los iconos de la PWA
```

Validación local del catálogo, seed y assets, y tests del validador:

```bash
node scripts/check-exercise-catalog.mjs
node --test scripts/check-exercise-catalog.node-test.mjs
```

## Antes de publicar el frontend

Aplicar `supabase/migrations/20260929010000_integrity_boundaries.sql` mediante
un despliegue autorizado **antes** del frontend: este ya llama a las RPC
`activate_routine` y `swap_routine_exercise_positions`. No ejecutar
`npm run db:push` automáticamente. El preflight de la migración aborta si hay
ejercicios duplicados en un día o sesiones vinculadas a un día de otro usuario;
resolver esos registros manualmente, sin borrado automático, antes de reintentar.

La regresión SQL local está en `supabase/tests/20260929_integrity.sql`. Una
validación independiente pasó en un clúster temporal PostgreSQL 16.9 con las
cuatro migraciones, el seed de 165 ejercicios y pruebas de RLS/preflight;
PostgreSQL 17, configurado para el proyecto, aún no fue validado.

## Estructura

```
src/
├── lib/heatmap.ts   contrato previsto para el widget de iOS — ver abajo
├── lib/device.ts    abstracción web/nativo
├── components/      shell, navegación, piezas compartidas
├── features/        auth, exercises, routines, sessions, body
└── pages/           una por pestaña
public/exercises/    imágenes del catálogo (assets estáticos)
scripts/             generadores de una sola corrida
```

## Dos módulos que no son código común

**`src/lib/heatmap.ts`** — `buildLevels()` devuelve enteros 0–4, uno por día,
longitud `weeks * 7`, alineado a semanas. La web usa esos niveles para el
calendario; el array está previsto como **contrato con el futuro widget de
iOS** en SwiftUI. Mantener su forma estable facilitará compartir el cálculo.
Por eso está aislado y con tests.

**`src/lib/device.ts`** — todo lo que toca el dispositivo pasa por acá.
Hoy hay una sola implementación (web) y casi todo es no-op. Cuando entre
Capacitor se agrega la nativa y ninguna pantalla cambia.

## Nota de diseño

La intensidad del heatmap se codifica con **opacidad, no con tono**. En iOS 26,
los modos Clear y Tint de la pantalla de inicio aplanan los colores de los
widgets a un tinte monocromo: un futuro widget que distinguiera niveles por
color perdería esa distinción. La opacidad la conserva.

## Créditos

Catálogo de ejercicios derivado de
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
