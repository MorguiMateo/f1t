# Seguridad de dependencias — 2026-10-01

`npm ci` y `npm audit` terminaron con **0 vulnerabilidades reportadas**.
Esto cubre los avisos conocidos por npm en esa fecha, no certifica la seguridad
de la aplicación ni sustituye las pruebas funcionales pendientes.

## Cambios y motivo

- `package-lock.json`: actualizaciones compatibles de `brace-expansion`
  (2.1.7 y 5.0.12), `fast-uri` (3.1.8) y `serialize-javascript` (7.1.2).
  Se ejecutó `npm audit fix` **sin `--force`**.
- `package.json`: override limitado a `xcode → uuid@11.1.1`. La herramienta
  `xcode@3.0.1`, usada por Capacitor CLI 8.5.2, dependía de uuid 7 sin parche.
  No se degradó Capacitor ni se forzaron majors en el resto del árbol.
  uuid 11.1.1 conserva el export CommonJS `require('uuid').v4()` que usa xcode.
  El override cruza un major de uuid, por lo que requiere prueba explícita de
  compatibilidad y revisión al actualizar xcode/Capacitor; no quitarlo hasta
  que la dependencia upstream seleccione una versión corregida compatible.
- `scripts/dependency-tooling.node-test.mjs`: comprueba generación de IDs Xcode
  y round-trip del grafo completo de app/extensión, sin modificar el proyecto.

Referencias primarias: [aviso uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq),
[exports de uuid 11.1.1](https://github.com/uuidjs/uuid/blob/v11.1.1/package.json),
[uso de uuid en xcode](https://github.com/apache/cordova-node-xcode/blob/3.0.1/lib/pbxProject.js),
[brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[fast-uri](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) y
[serialize-javascript](https://github.com/advisories/GHSA-gfhx-hw2g-v5hg).

## Verificación

```bash
npm ci
npm audit
npm run lint
npm test
node --test scripts/*.node-test.mjs
npm run ios:sync
```

Pasaron **220 pruebas Vitest y 10 pruebas Node** (catálogos y tooling), lint,
typecheck/build, sincronización Capacitor y compilación unsigned Release del
esquema App para `generic/platform=iOS Simulator`, que incluye WidgetExtension.
No se ejecutó iOS ni una sesión OAuth real.

Avisos residuales: chunk web inicial de ~538 kB; `glob@11.1.0` está deprecado
por upstream aunque este audit no reporta una vulnerabilidad pendiente;
npm advierte del script opcional de `fsevents@2.3.3` no aprobado. No se aprobó
ese script ni se ocultaron los avisos. El build y las pruebas anteriores
funcionaron con la política actual de instalación.
