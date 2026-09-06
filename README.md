# F1t

App fitness personal: rutinas por día, calendario de actividad tipo GitHub y
seguimiento de peso. Web primero, pensada desde el día uno para envolverse en
Capacitor y tener un widget nativo en la pantalla de inicio del iPhone.

Plan, fases y decisiones tomadas: **[PLAN.md](PLAN.md)**.

## Stack

- **Vite + React 19 + TypeScript** — build estático, para que `npx cap add ios`
  funcione sin tocar nada
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

## Estructura

```
src/
├── lib/heatmap.ts   contrato con el widget de iOS — ver abajo
├── lib/device.ts    abstracción web/nativo
├── components/      shell, navegación, piezas compartidas
├── features/        auth, exercises, routines, sessions, body
└── pages/           una por pestaña
public/exercises/    imágenes del catálogo (assets estáticos)
scripts/             generadores de una sola corrida
```

## Dos módulos que no son código común

**`src/lib/heatmap.ts`** — `buildLevels()` devuelve enteros 0–4, uno por día,
longitud `weeks * 7`, alineado a semanas. Ese array es el **contrato con el
widget de iOS**: la web lo dibuja en React y el widget lo dibuja en SwiftUI.
Si cambia la forma, cambia en los dos lados. Por eso está aislado y con tests.

**`src/lib/device.ts`** — todo lo que toca el dispositivo pasa por acá.
Hoy hay una sola implementación (web) y casi todo es no-op. Cuando entre
Capacitor se agrega la nativa y ninguna pantalla cambia.

## Nota de diseño

La intensidad del heatmap se codifica con **opacidad, no con tono**. En iOS 26
el usuario puede poner la pantalla de inicio en modo Clear o Tint, y ahí el
sistema aplana todos los colores del widget a un tinte monocromo: un heatmap
que distingue por color se convertiría en un bloque uniforme. La opacidad
sobrevive intacta.

## Créditos

Catálogo de ejercicios derivado de
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
