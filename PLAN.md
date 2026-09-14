# Plan de F1t

Documento de contexto. Dice **qué se está construyendo, en qué orden y por qué**
se decidió así. El README explica la arquitectura que ya existe; este archivo
explica hacia dónde va. Si una decisión de acá cambia, se edita acá.

---

## 1. Qué es la app

Fitness personal, un solo usuario por cuenta. Tres funcionalidades, más una
cuarta a futuro:

1. **Calendario de actividad** tipo GitHub — un cuadrito por día, marca los días
   que fuiste al gym, con intensidad según el volumen entrenado.
2. **Armador de rutinas** — catálogo de los ejercicios más conocidos, cada uno
   con imagen para diferenciarlo de un vistazo y con los músculos que trabaja
   (primarios y secundarios). Las rutinas se organizan por día de la semana.
3. **Seguimiento corporal** — peso, altura, edad y objetivo (bajar, subir o
   mantener). Gráfico de evolución del peso.
4. **Plan de comidas** — a futuro, cuelga del objetivo de la fase 3.

Y una restricción que atraviesa todo: **la app se va a envolver en Capacitor
para tener widgets nativos de iOS en SwiftUI** (calendario y rutina de hoy en la
pantalla de inicio). Eso ya condiciona el código de hoy, no es un "después
vemos" — ver §5.

---

## 2. De dónde salen las imágenes de los ejercicios

Investigado el 2026-09-06. Cuatro opciones reales:

| Fuente | Ejercicios | Imágenes | Licencia | Veredicto |
|---|---|---|---|---|
| **[free-exercise-db](https://github.com/yuhonas/free-exercise-db)** | 876 | 2 fotos JPG por ejercicio (inicio/fin) | Unlicense (dominio público) | **Elegida** |
| [wger](https://wger.de) | ~200 en la instancia pública | pocas, sin animaciones | AGPL/CC, copyleft con atribución | Descartada: catálogo chico, hay que auto-hospedar con Docker |
| [ExerciseDB](https://github.com/ExerciseDB/exercisedb-api) | 11.000+ | GIFs animados | free tier no comercial vía RapidAPI; licencia comercial USD 299–599 | Descartada: de pago y atada a un tercero |
| [WorkoutX](https://workoutxapp.com) | 1.400+ | los mismos assets de ExerciseDB | 500 requests/mes gratis | Descartada: es ExerciseDB con métrica encima |

### Decisión: free-exercise-db, descargada de una y servida como assets propios

No como API en vivo. Se baja una vez con un script, se recorta a un catálogo
curado, se optimiza y las imágenes quedan en `public/exercises/`.

**Por qué no consumirla como API:**
- Ninguna app fitness necesita datos en tiempo real: el press de banca no cambia.
- La PWA tiene service worker. Si las imágenes son assets propios, funcionan
  offline en el gym, que es exactamente donde peor anda el WiFi.
- Sin dependencia de que un tercero siga vivo, sin rate limits, sin API key.
- Cuando entre Capacitor, los assets ya viajan dentro del bundle de la app iOS.

**Datos concretos, verificados contra el repo:**

- JSON completo: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json` (982 KB)
- Imágenes: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<id>/0.jpg` y `1.jpg`
- 876 ejercicios; 873 tienen exactamente 2 imágenes, 3 no tienen ninguna
- Las fotos son JPG de 850×567, ~55–70 KB cada una → bajar las 1746 crudas son ~100 MB

Forma de cada registro:

```json
{
  "id": "Barbell_Full_Squat",
  "name": "Barbell Full Squat",
  "force": "push",
  "level": "intermediate",
  "mechanic": "compound",
  "equipment": "barbell",
  "primaryMuscles": ["quadriceps"],
  "secondaryMuscles": ["calves", "glutes", "hamstrings", "lower back"],
  "instructions": ["...", "..."],
  "category": "strength",
  "images": ["Barbell_Full_Squat/0.jpg", "Barbell_Full_Squat/1.jpg"]
}
```

Vocabularios cerrados del dataset:

- `category`: strength, stretching, plyometrics, strongman, powerlifting, cardio, olympic weightlifting
- `equipment`: body only, machine, other, foam roll, kettlebells, dumbbell, cable, barbell, bands, medicine ball, exercise ball, e-z curl bar
- `level`: beginner, intermediate, expert
- `force`: pull, push, static · `mechanic`: compound, isolation
- **músculos (17)**: abdominals, hamstrings, adductors, quadriceps, biceps, shoulders, chest, middle back, calves, glutes, lower back, lats, triceps, traps, forearms, neck, abductors

### Curado y optimización

876 ejercicios es ruido: hay decenas de variantes casi idénticas. El pedido es
"los ejercicios más conocidos", así que el script filtra a **~150–200** con una
lista blanca de ids escrita a mano, revisable, versionada en el repo.

Medido con `sharp` sobre una foto real del dataset:

| Formato | Peso |
|---|---|
| original 850px JPG | 69,7 KB |
| 640px WebP q75 | 25,3 KB |
| **480px WebP q72** | **16,8 KB** ← elegido |
| 400px WebP q72 | 13,3 KB |

A 480px, 200 ejercicios × 2 imágenes ≈ **6,8 MB** en el repo. Aceptable para
precachear entero en el service worker.

`sharp` ya es devDependency y `scripts/gen-icons.mjs` ya sigue este patrón de
"generador de una sola corrida", así que el script nuevo entra sin agregar nada.

### Los músculos en un diagrama

Las 2 fotos muestran el movimiento, no la anatomía. Para "qué músculos entrena"
va un mapa corporal SVG: **[react-body-highlighter](https://github.com/giavinh79/react-body-highlighter)**
(MIT, React web puro, sin react-native, vistas anterior y posterior, colores por
intensidad). Alternativas equivalentes si diera problemas:
[body-highlighter](https://github.com/lahaxearnaud/body-highlighter) y
[body-muscles](https://github.com/vulovix/body-muscles), ambas agnósticas de framework.

Su vocabulario no coincide con el del dataset, hace falta una tabla de mapeo en
`src/lib/muscles.ts`. Los casos que no son 1:1:

| free-exercise-db | react-body-highlighter |
|---|---|
| `shoulders` | `front-deltoids` + `back-deltoids` |
| `lats` | `upper-back` |
| `middle back` | `upper-back` |
| `traps` | `trapezius` |
| `abdominals` | `abs` |
| `glutes` | `gluteal` |
| `forearms` | `forearm` |
| `hamstrings` | `hamstring` |
| `adductors` | `adductor` |

> **Nota legal.** El código de free-exercise-db es Unlicense, pero la cadena de
> titularidad de las **fotos** es difusa (vienen de bodybuilding.com). Para uso
> personal no hay problema. Si F1t alguna vez se publica como producto pago,
> hay que reemplazar las imágenes.

---

## 3. Modelo de datos (Supabase)

Todas las tablas con `user_id uuid references auth.users` y RLS
`user_id = auth.uid()`. Sin excepciones: la seguridad la da RLS, no el cliente.

```
exercises          catálogo, global, sin user_id, solo lectura
                   id text PK (el slug de free-exercise-db), name, category,
                   equipment, level, force, mechanic,
                   primary_muscles text[], secondary_muscles text[],
                   instructions text[], images text[]

routines           id, user_id, name, is_active, created_at
routine_days       id, routine_id, weekday int (0=domingo), label text
                   ("Empuje", "Pierna", …); un día sin fila = descanso
routine_exercises  id, routine_day_id, exercise_id, position int,
                   target_sets int, target_reps text ("8-12"), notes

sessions           id, user_id, performed_on date, routine_day_id null,
                   set_count int, notes
                   ↑ performed_on y set_count son EXACTAMENTE lo que consume
                     HeatmapSession en src/lib/heatmap.ts. No renombrar.
session_sets       id, session_id, exercise_id, set_index, reps, weight_kg

body_profile       user_id PK, height_cm, birth_date, sex, goal
                   ('lose' | 'gain' | 'maintain'), target_weight_kg
weight_entries     id, user_id, measured_on date, weight_kg
```

Restricción única `(user_id, performed_on)` en `sessions`: un entrenamiento por
día, que es lo que el heatmap asume.

---

## 4. Fases

### Fase 0 — Andamiaje ✅ (commit `27b667b`)

Vite + React 19 + TS, Tailwind v4 con tema claro/oscuro, PWA, 4 rutas con nav
inferior, `src/lib/heatmap.ts` con 16 tests, `src/lib/device.ts`. Build y tests
en verde.

### Fase 1 — Supabase y auth ✅ (commit `7134721`)

Las 8 tablas de §3 con RLS y una policy por tabla, login con Google, guard de
rutas, cliente tipado desde el schema real. La CLI de Supabase entró como
devDependency, con los scripts `db:*` en `package.json`.

Dos cosas se decidieron acá porque §3 tenía una ambigüedad —decía "sin
excepciones" pero no listaba `user_id` en las tablas hijas:

- **`user_id` va en todas las tablas, también las hijas.** Así la policy es
  `user_id = auth.uid()` directo, sin subconsulta por fila. La consistencia
  entre padre e hija la garantiza una **FK compuesta** `(routine_id, user_id)`
  contra `routines(id, user_id)`: colgar un día de la rutina de otro usuario
  es un error de integridad, no un agujero de permisos.
- **Las policies usan `(select auth.uid())`**, no `auth.uid()` a secas. Entre
  paréntesis Postgres lo evalúa una vez por consulta y no una vez por fila.

### Fase 2 — Catálogo de ejercicios ✅

- `scripts/fetch-exercises.mjs` — baja el JSON, filtra por la lista blanca,
  convierte a WebP 480px q72 en `public/exercises/<id>/0.webp`, escribe
  `src/features/exercises/catalog.json` y el SQL de seed de `exercises`
- `scripts/curated-ids.json` — la lista blanca, editable a mano
- `src/lib/muscles.ts` — traducción al español y mapeo a react-body-highlighter
- Buscador por nombre, filtros por músculo y equipamiento
- Ficha: las 2 fotos + mapa muscular + instrucciones

Números reales, mejores que la estimación de §2: **165 ejercicios**, 330
imágenes, **14,6 KB promedio** por imagen y **5,4 MB** en total contra los
6,8 MB previstos. Los 17 músculos quedan cubiertos como primarios.

Tres decisiones que no estaban en el plan original:

- **El catálogo se navega desde el bundle, no desde Postgres.** La tabla
  `exercises` existe porque `routine_exercises` tiene una FK contra ella, pero
  buscar un ejercicio lee `catalog.json`. Mismo motivo que las imágenes: en el
  gimnasio no hay señal, y 165 registros filtrados en memoria no justifican un
  round-trip ni un estado de carga.
- **Las rutas del catálogo van con `lazy()`.** `catalog.json` (209 KB) y
  react-body-highlighter (176 KB) solo hacen falta en dos pantallas; en el
  chunk inicial casi duplicaban el peso de abrir la app. El chunk inicial
  quedó en 474 KB (138 KB gzip) y el catálogo en 37 KB gzip aparte. El
  service worker precachea los dos, así que offline no cambia.
- **El catálogo no es una quinta pestaña.** Vive en `/ejercicios` y se entra
  desde Rutinas, que es donde hace falta elegir ejercicios. La nav se queda
  en cuatro.

Los nombres del dataset están en inglés. Se traducen los 17 músculos y las
categorías (poco y cerrado); los nombres de ejercicios quedan en inglés. Para
que eso no rompa la búsqueda, el índice incluye las etiquetas traducidas:
escribir "pecho" encuentra el press de banca aunque se llame "Bench Press".

El mapeo a react-body-highlighter se verificó contra los tipos del paquete y
no contra la tabla de §2, que tenía dos huecos: `lower back` → `lower-back` y
`abductors` → `abductors`, los dos 1:1.

### Fase 3 — Rutinas

- CRUD de rutinas, días y ejercicios (`routine_*`)
- Asignar días de la semana, ordenar ejercicios, series y reps objetivo
- La pestaña **Hoy** resuelve qué toca hoy según el `weekday` actual
- Mapa muscular agregado: qué cubre la rutina y qué está dejando afuera

### Fase 4 — Sesiones y heatmap vivo

- Registrar entrenamiento desde Hoy: marcar series, reps y peso
- `<Heatmap>` en React alimentado por `buildLevels()` — **primer consumidor real
  del contrato de la Fase 0**, dibujado con opacidad, no con tono (ver README)
- Racha actual y total de días entrenados en Progreso
- Primera llamada a `device.syncWidget()` con el `WidgetPayload` completo

### Fase 5 — Cuerpo y objetivo

- `body_profile`: altura, fecha de nacimiento, sexo, objetivo
- `weight_entries` + gráfico de evolución
- IMC y estimación de TDEE (Mifflin-St Jeor) con el objetivo calórico según meta

### Fase 6 — Capacitor y widget de iOS

El motivo por el que `device.ts` y `heatmap.ts` existen desde el día uno.

- `npx cap add ios` sobre el build estático
- Implementación nativa de `DeviceBridge`: escribe el `WidgetPayload` al App
  Group, `UNUserNotificationCenter` para recordatorios, `CMPedometer` para pasos
- Widget en SwiftUI: heatmap (mediano, 26 semanas) y rutina de hoy (grande)
- El `Heatmap` de SwiftUI lee el mismo array de `buildLevels()`

**Ninguna pantalla de la web cambia en esta fase.** Si alguna tiene que cambiar,
es que algo se hizo mal en las fases anteriores.

### Fase 7 — Plan de comidas (futuro)

Cuelga del objetivo de la Fase 5. Sin investigar todavía: hace falta decidir
fuente de datos nutricionales (Open Food Facts, USDA FoodData Central) con el
mismo criterio de §2 — preferir dataset descargable sobre API en vivo.

---

## 5. Invariantes

Cosas que no se rompen sin discutirlo primero:

1. **`buildLevels()` es el contrato con SwiftUI.** Devuelve enteros 0–4, largo
   `weeks * 7`, alineado a semanas. Si cambia la forma, cambia en los dos lados.
2. **Las columnas `sessions.performed_on` y `sessions.set_count`** son las que
   consume `HeatmapSession`. Renombrarlas rompe el heatmap.
3. **Todo lo que toca el dispositivo pasa por `device.ts`.** Ninguna feature
   llama a Capacitor directo.
4. **La intensidad del heatmap se codifica con opacidad, no con tono.** En iOS 26
   los modos Clear y Tint aplanan el color del widget a monocromo.
5. **Build estático.** Nada de SSR ni de rutas de servidor: `npx cap add ios`
   tiene que seguir funcionando sin tocar nada.
6. **Las imágenes son assets propios, no una API.** Offline en el gym.
7. **RLS en toda tabla con datos de usuario.** La anon key es pública por diseño.

## 6. Fuera de alcance

Multiusuario o social, videos de ejercicios, timer de descanso con audio en
background (web no puede; queda para nativo), Android, importar datos de otras
apps, wearables.
