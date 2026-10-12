# Plan de F1t

Documento de contexto. Dice **qué se está construyendo, en qué orden y por qué**
se decidió así. El README explica la arquitectura que ya existe; este archivo
explica hacia dónde va. Si una decisión de acá cambia, se edita acá.

---

## 1. Qué es la app

Fitness personal, un solo usuario por cuenta. Cuatro funcionalidades:

1. **Calendario de actividad** tipo GitHub — un cuadrito por día, marca los días
   que fuiste al gym, con intensidad según el volumen entrenado.
2. **Armador de rutinas** — catálogo de los ejercicios más conocidos, cada uno
   con imagen para diferenciarlo de un vistazo y con los músculos que trabaja
   (primarios y secundarios). Las rutinas se organizan por día de la semana.
3. **Seguimiento corporal** — peso, altura, edad y objetivo (bajar, subir o
   mantener). Gráfico de evolución del peso.
4. **Plan de comidas** — implementado sobre el objetivo de la Fase 5; distribución pendiente.

Y una restricción que atraviesa todo: **la app se envuelve en Capacitor
para tener widgets nativos de iOS en SwiftUI** (calendario y rutina de hoy en la
pantalla de inicio). La implementación existe; su aceptación en dispositivo
sigue pendiente — ver §5.

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

Los nombres del dataset están en inglés y son largos ("Barbell Bench Press -
Medium Grip"). Se acortan y se muestran **en español por defecto** ("Press de
banca"), con una fuente editable a mano —`scripts/exercise-es.json`, mismo
patrón que `curated-ids.json`— que por cada ejercicio da el nombre en español
(`es`), el nombre en inglés acortado (`en`) y una lista de alias buscables. El
script valida cobertura total (todo id curado tiene entrada, y no sobran) y
escribe en `catalog.json` los campos `name` (español), `nameEn` (inglés) y
`aliases`.

La búsqueda es **bilingüe**: el índice junta `name`, `nameEn` y los alias (que
incluyen automáticamente el nombre crudo del dataset), más las etiquetas de
músculos y equipamiento en los dos idiomas. Así "press banca", "pecho plano" y
"bench press" encuentran los tres el mismo ejercicio. Costo de performance
despreciable: el índice se arma una sola vez al cargar el chunk y filtrar son
`includes` sobre 165 items; los alias solo suman unos KB gzip a un chunk que ya
es `lazy()` y precacheado.

**Paso futuro — selector de idioma (ES/EN) para los nombres.** El catálogo ya
trae `nameEn` justamente para esto: falta un toggle de idioma y un helper
`displayName(exercise, locale)` que elija entre `name` y `nameEn`. Si en algún
momento la tabla `exercises` de Postgres tuviera que mostrar nombres, se le
agrega una columna `name_en`. Ninguna pantalla depende hoy de esa decisión.

El mapeo a react-body-highlighter se verificó contra los tipos del paquete y
no contra la tabla de §2, que tenía dos huecos: `lower back` → `lower-back` y
`abductors` → `abductors`, los dos 1:1.

### Fase 3 — Rutinas ✅

- `src/features/routines/api.ts` — todo el acceso a `routine_*`, sin React
- `src/features/routines/queries.ts` — los hooks de React Query encima
- CRUD de rutinas, días y ejercicios; una rutina activa; reordenar con
  flechas; series y repeticiones objetivo
- La pestaña **Hoy** resuelve qué toca según el `weekday` de hoy, y si es
  descanso dice cuál es el próximo día
- `RoutineCoverage` — el mapa muscular agregado de una rutina o de un día,
  con lo que queda sin trabajar

Decisiones que no estaban en el plan original:

- **Una rutina entera viaja en una sola query.** `routines` con
  `routine_days(*, routine_exercises(*))` anidado: son unos pocos KB y evita
  la cascada de tres requests encadenados, que en el gimnasio es la
  diferencia entre abrir la app y esperarla. El orden por `weekday` y por
  `position` se impone en JS, no con modificadores de la query: son siete
  días y un puñado de ejercicios, y así el orden se lee en un solo lugar.
- **Las mutaciones invalidan `["routines"]` entero.** Renombrar toca la
  lista, el detalle y la pestaña Hoy; agregar un ejercicio toca el detalle y
  el contador de la lista. Afinar la invalidación sería mantener una tabla de
  dependencias para ahorrar un request de pocos KB de un solo usuario.
- **`user_id` no se manda nunca desde el cliente.** Las columnas tienen
  `default auth.uid()` y la policy `with check` rechaza lo ajeno, así que
  mandarlo sería redundante y además una mentira sobre quién decide la
  identidad. Activar una rutina es apagar la anterior y prender esta **en ese
  orden**, porque `routines_one_active_idx` es un único parcial y dos activas
  no conviven ni por un instante.
- **Elegir ejercicio reusa el catálogo, no un buscador nuevo.** El día linkea
  a `/ejercicios?dia=…&rutina=…` y ahí las tarjetas agregan en vez de abrir
  la ficha. Un segundo buscador embebido serían dos juegos de filtros que se
  van pareciendo cada vez menos. El modo vive en la URL y no en el estado de
  navegación, así que el gesto de volver del teléfono funciona igual.
- **Hoy carga su lista de ejercicios con `lazy()`.** Es la ruta índice: si
  importara el catálogo de forma estática, `catalog.json` volvería al chunk
  inicial y se perdería lo que ganó la Fase 2. El header se pinta enseguida y
  la lista llega mientras todavía se espera a Supabase. El chunk inicial pasó
  de 474 KB a **495 KB (144 KB gzip)**, y el catálogo sigue aparte.
- **El día de la rutina es una pantalla con URL propia**
  (`/rutinas/:routineId/dias/:dayId`) y no un acordeón dentro de la rutina:
  así volver desde el catálogo cae exactamente en el día que se estaba
  editando.
- **El "falta" de la cobertura se calcula sobre 13 grupos grandes**, no
  sobre los 17 del dataset. Cuello, abductores, aductores y antebrazos casi
  nunca se entrenan directo —el dataset tiene dos ejercicios de cuello en
  total—, así que aparecerían como deuda en todas las rutinas y el aviso
  dejaría de significar algo. Sí se muestran cuando están cubiertos.
- **Series y reps se guardan al salir del input, sin botón de guardar**, y
  los inputs no son controlados: el valor vive en el DOM y solo se manda lo
  que cambió. Controlarlos obligaría a re-sincronizar contra lo que devuelve
  cada invalidación, que es de donde salen los campos que se borran solos
  mientras se escribe.
- **Cuatro piezas compartidas nuevas** —`Button`, `TextInput`,
  `ConfirmButton`, `Status`— porque la fase pasó de dos botones en toda la
  app a quince, y la cadena de clases repetida es por donde las pantallas
  empiezan a verse distintas sin que nadie lo haya decidido. El `<Suspense>`
  de las rutas `lazy()` se movió a `AppLayout`: el shell se queda en pantalla
  mientras baja el chunk.

`routine_exercises.notes` existe en el schema y todavía no tiene UI: el plan
pedía series y repeticiones, y tres campos por fila no entran en el ancho de
un teléfono sin volver la lista ilegible. Es el lugar natural para "banco a
30°" cuando haga falta.

### Fase 4 — Sesiones y heatmap vivo ✅

- `src/features/sessions/api.ts` y `queries.ts` — mismo reparto que rutinas:
  las funciones async sin React abajo, los hooks de React Query encima
- `/entrenar` — marcar serie por serie con reps y peso, con el peso de la vez
  pasada ya sugerido
- `<Heatmap>` alimentado por `buildHeatmap()`, **primer consumidor real del
  contrato de la Fase 0**, con la intensidad en opacidad y no en tono
- Racha, días entrenados y series totales en Progreso
- `device.syncWidget()` con el `WidgetPayload` completo

Decisiones que no estaban en el plan original:

- **`set_count` lo mantiene la base, no el cliente.** Un trigger lo recalcula
  en cada insert y delete de `session_sets`
  (`20260920104500_session_set_count.sql`). Es una de las dos columnas del
  §5.2: si la mantuviera el cliente, marcar una serie serían dos requests y
  la intensidad del cuadradito mentiría cada vez que el segundo falle. La
  función es `security invoker` con `search_path = ''`, así que el update
  pasa por la misma policy que cualquier escritura del usuario.
- **No hay botón de "empezar entrenamiento".** La primera serie que se marca
  crea la sesión del día; `useLogSet` hace las dos cosas en una mutación. Un
  paso previo que no registra nada es un paso que se olvida de dar.
  `sessions_one_per_day` convierte los dos toques rápidos en un 23505, que
  no es un error para mostrar sino la confirmación de que la sesión ya
  existe: se relee y sigue.
- **Las sesiones vacías no cuentan como días entrenados.** `fetchSessionDays`
  filtra `set_count > 0`: marcar una serie y desmarcarla deja una fila en
  cero, y sin el filtro el cuadradito saldría en nivel 0 mientras la racha y
  el contador la sumarían igual.
- **La sugerencia de peso sale del día de rutina, no del ejercicio.** Se lee
  la última sesión con el mismo `routine_day_id` y de ahí salen los valores
  por serie: "la vez pasada que hice Empuje" es la comparación que se hace
  en el gimnasio y sale en una query, no en una por ejercicio. La pantalla
  espera esa consulta antes de dibujar las filas, porque un input que se
  autocompleta un segundo tarde pisa lo que se estaba tecleando.
- **Entrenar es otra pantalla** (`/entrenar`), y no un bloque dentro de Hoy:
  Hoy es la ruta índice y el registro necesita el catálogo para las fotos.
  `?dia=` entrena un día que no es el de hoy, que es lo que pasa cuando la
  semana se corre un día —y es un toque desde la pantalla de descanso.
- **Filas de serie: el objetivo manda, pero nunca hacia abajo.** Si están
  todas marcadas aparece una fila más, porque "una más" se decide en el
  momento y no cuando se armó la rutina. Toda esa cuenta vive en
  `plan.ts`, sin React ni red, con sus tests.
- **`heatmapStart()` es nuevo en `heatmap.ts`.** La query pide exactamente el
  rango que se dibuja, y el alineado a semanas sigue existiendo en un solo
  archivo. Duplicar esa cuenta en la query es como se llega a cuadraditos
  vacíos de días que sí se entrenaron.
- **El `WidgetPayload` se arma completo desde ahora**, aunque en web
  `syncWidget()` solo escriba en localStorage. Es lo que mantiene honesto el
  §5.1: el contrato tiene un consumidor real desde el día uno, así que
  cuando llegue SwiftUI no hay que descubrir ahí si la forma servía.
  `buildWidgetPayload()` es puro —los nombres los resuelve quien llama— y
  `WidgetSync` es un componente `lazy()` que no dibuja nada, porque el
  catálogo no puede entrar al chunk inicial.
- **`unwrap`/`unwrapRow` se mudaron a `src/lib/postgrest.ts`.** Con dos
  features escribiendo en Postgres, la copia pegada era el lugar donde una
  de las dos iba a dejar de lanzar.

El chunk inicial queda en **494 KB (144 KB gzip)**: el registro entero pesa
6,2 KB en su propio chunk y el catálogo sigue aparte.

### Fase 5 — Cuerpo y objetivo ✅

Primera fase partida en sub-fases. El motivo no es que sea más grande que las
anteriores —no lo es—, sino que se construye mientras se sigue: cada sub-fase
es un **corte vertical** que termina en algo que se usa en pantalla, no en una
capa a medias esperando a la siguiente. El orden lo imponen los datos: sin
altura no hay IMC, sin peso no hay gráfico, sin los dos no hay TDEE.

#### 5.1 — Perfil corporal ✅

Altura, fecha de nacimiento, sexo, objetivo y peso meta, guardados en
`body_profile`. El cartel de Perfil que decía "se agrega en la Fase 5" pasó a
ser el formulario.

- `src/features/body/profile.ts` — el vocabulario de la fase (objetivos,
  sexos, rangos) y el parseo de cada campo, puro y con 20 tests
- `src/features/body/api.ts` y `queries.ts` — mismo reparto que rutinas y
  sesiones: async sin React abajo, hooks de React Query encima
- `src/features/body/body-profile-form.tsx` — el formulario
- `20260922090000_body_profile_updated_at.sql`

Decisiones que no estaban en el plan original:

- **`updated_at` lo mantiene la base.** La columna nació con `default now()`,
  y un default solo corre en el INSERT. Como el perfil es una fila por usuario
  escrita con upsert, de la segunda vez en adelante es un UPDATE y la fecha
  quedaba clavada en el día que se creó el perfil. Lo arregla un trigger
  `before update`, con el mismo criterio que `set_count` en la Fase 4: si el
  valor se deduce de la escritura, lo deduce Postgres. El cliente que manda su
  propio `now()` es un cliente que puede equivocarse sobre qué hora es.
- **Se agregaron los rangos que faltaban.** `height_cm` tenía check desde el
  día uno; `target_weight_kg` y `birth_date` no, así que un dedazo podía
  guardar una meta de cuatro kilos o un nacimiento en 2098 — y de ahí sale la
  edad que alimenta Mifflin-St Jeor en 5.4. El peso meta usa el mismo rango
  que `weight_entries`: son la misma magnitud, y dos límites distintos para lo
  mismo es como se llega a una meta que se puede tipear y nunca registrar.
- **"No en el futuro" va en un trigger y no en un CHECK.** `current_date` no
  es inmutable, y un CHECK que depende del reloj es una tabla que puede
  negarse a restaurarse desde su propio dump. El límite inferior sí es un
  CHECK, porque 1900 es una constante.
- **El upsert no manda `user_id`.** La PK es `user_id` con
  `default auth.uid()`: Postgres completa la columna al insertar y recién
  después chequea el conflicto, así que `on conflict (user_id)` resuelve en
  una sola sentencia si la fila existe. Decidirlo en el cliente sería leer
  primero y competir con cualquiera que haya leído en el mismo momento.
- **Se manda solo la columna que cambió.** Mandar el formulario entero en cada
  blur es reescribir arriba de lo que otro guardado paralelo acaba de dejar,
  con los valores que React Query le pasó a los inputs hace rato. Mandando una
  columna, dos campos que pierden el foco casi juntos llegan en cualquier
  orden y el resultado es el mismo.
- **La mutación escribe en la caché en vez de invalidar.** La respuesta del
  upsert *es* el nuevo estado del perfil. Y hay un motivo de interfaz: los
  inputs son no controlados, y una invalidación que aterriza mientras otro
  campo tiene el foco es el re-render que hace parpadear lo que se está
  tecleando.
- **Se guarda campo por campo al salir del input, sin botón**, igual que las
  filas de ejercicio de la Fase 3. Un perfil no se llena una vez y se olvida
  —el peso meta es el campo al que se vuelve— y un botón convierte "cambié de
  objetivo" en dos toques más el riesgo de irse de un formulario que parece
  hecho y no guardó nada. Sin botón no hay momento que confirme, así que la
  confirmación es un "Guardando…" con `aria-live`.
- **Los campos numéricos son `type="text"` con `inputMode`, no
  `type="number"`.** Un input numérico cuyo contenido no es un número válido
  reporta su valor como string vacío, que es indistinguible de un campo
  vaciado a propósito: tipear `1.7.8` en Altura borraba la altura guardada. Y
  `type="number"` solo acepta punto decimal, mientras el separador que queda
  bajo el pulgar en un teclado en español es la coma: `81,5` llegaba vacío. El
  teclado numérico lo sigue dando `inputMode`.
- **Los rangos se validan en el cliente para corregir, no para rechazar.**
  Escribir 900 de altura convierte el campo en 260 a la vista, en vez de traer
  un 400 de PostgREST. Los bounds están duplicados a propósito entre
  `profile.ts` y el schema, y la duplicación va en un solo sentido: la base es
  la que los hace cumplir, el cliente es el que evita el viaje. Mismo arreglo
  que `MAX_SETS`.

El chunk inicial pasó de 494 KB a **498,7 KB (145 KB gzip)**: Perfil es una
pestaña y no va con `lazy()`.

#### 5.2 — Registro de peso ✅

Anotar cuánto pesás. `weight_entries` ya tiene única `(user_id, measured_on)`
y check 20–400 desde la Fase 1, así que es un peso por día.

- Alta con fecha por defecto hoy y editable, para cargar atrasado
- Lista de mediciones recientes con el delta contra la anterior
- Borrado de una medición mal cargada
- El peso actual queda **derivado** de la última entrada, no guardado como
  columna del perfil: el peso es una serie temporal, y una copia en
  `body_profile` serían dos fuentes de verdad que el día que falle el segundo
  write se contradicen sin que nadie pueda decir cuál miente

- `src/features/body/weight.ts` — deltas, peso actual y formato, puro y con
  tests
- `src/features/body/weight-api.ts` y `weight-log.tsx`

Pesarse dos veces el mismo día es una **corrección**: upsert con
`onConflict: "user_id,measured_on"`, consistente con `logSet` de la Fase 4.

#### 5.3 — Gráfico de evolución ✅

La curva de peso en el tiempo, con la línea del peso meta cruzada, en
Progreso y debajo del heatmap.

- `src/features/body/weight-trend.ts` — media móvil, escalas y coordenadas
  SVG, puro y con 20 tests
- `src/features/body/weight-chart.tsx` — el componente; no hace cuentas

- SVG propio, **sin librería de charts**. Recharts o Chart.js suman 150–400 KB
  para dibujar una polilínea de treinta puntos sobre un chunk inicial que ya
  está en 145 KB gzip. Y el gráfico es candidato a viajar al widget en la Fase
  6, donde una librería de React no sirve de nada — igual que pasó con
  `buildLevels()`
- Las escalas, los puntos y la media móvil que suaviza el ruido diario de la
  balanza van en un módulo puro con tests, tipo `heatmap.ts` y `plan.ts`. El
  componente solo dibuja

Decisiones que no estaban en el plan original:

- **La media móvil cuenta días, no entradas.** Promedia lo pesado en los 7
  días calendario que terminan en cada punto. Con pesadas irregulares, "las
  últimas tres entradas" mezclaría pesos de meses distintos como si fueran
  seguidos. Las entradas anteriores a la ventana siguen alimentando la media,
  para que el primer valor en pantalla no arranque en frío.
- **El eje X es tiempo real y termina hoy.** Un mes sin pesarse es un hueco
  visible, y dos semanas sin medición se ven como vacío a la derecha.
- **La ventana es `WIDGET_WEEKS`, pero el eje arranca en la primera
  medición.** Mismo medio año que el heatmap de arriba; empezar en el borde de
  la ventana apretaría todo el historial de quien empezó la semana pasada en
  los últimos píxeles.
- **Un historial corto va centrado.** El eje mide como mínimo 14 días. Si
  entre la primera medición y hoy hay menos, los días que faltan se reparten
  mitad antes y mitad después, así que la parte derecha son días que todavía
  no pasaron. Se centra primera medición → hoy, no → última, para que los días
  sin pesarse sigan viéndose. El relleno se achica con cada día de historial
  y es cero desde los 14, así que no hay salto al cruzar el umbral. Con 28 de
  mínimo, tres días de datos centrados ocupaban un décimo del ancho.
- **La meta siempre entra en la escala**, aunque aplane la curva: la
  distancia a la meta es lo que el gráfico viene a mostrar.
- **Rango vertical mínimo de 2 kg.** Sin él, una serie plana convierte 0,3 kg
  de ruido de balanza en una cordillera.
- **`viewBox` fijo y ancho 100 %**, con `vector-effect="non-scaling-stroke"`.
  No hay que medir el contenedor ni escuchar resize.

Con 5.2 y 5.3, el chunk inicial pasó de 498,7 KB a **506,9 KB (147,5 KB gzip)**.

#### 5.4 — IMC, TDEE y objetivo calórico ✅

Los números derivados: IMC con su categoría, BMR por Mifflin-St Jeor, TDEE y
el objetivo calórico según la meta, en una tarjeta de Perfil debajo del
formulario.

- `src/features/body/energy.ts` — las fórmulas, puras y con 17 tests contra
  valores calculados a mano (80 kg, 180 cm, 30 años, hombre → BMR 1780)
- `src/features/body/energy-card.tsx` — la tarjeta; no hace cuentas

Decisiones:

- **El factor de actividad sale de las sesiones, no de una pregunta.** Sin
  migración y sin un campo que se completa una vez optimista. Se cuentan las
  sesiones de los **últimos 28 días** (cuatro semanas enteras: una semana
  floja no mueve el número, un cambio de hábito sí), el promedio semanal se
  redondea a días enteros y cae en los multiplicadores estándar: 0 → 1,2;
  1–2 → 1,375; 3–4 → 1,55; 5–6 → 1,725; 7 → 1,9. La tarjeta dice de dónde
  sale ("3 entrenamientos/semana en las últimas 4 semanas · actividad
  moderada"). Reusa la query de 26 semanas del heatmap, que ya está en caché.
- **Objetivo: −500 kcal para bajar, +300 para subir, el TDEE para
  mantener.** −500 es alrededor de medio kilo por semana; +300 es un
  superávit sin grasa de más. Redondeado a 50, porque la precisión más fina
  es ficción.
- **Nunca por debajo del BMR.** Si el déficit lo cruza, el objetivo sube al
  BMR —redondeando para arriba— y la tarjeta lo dice. Comer menos que el gasto
  en reposo no es un plan que deba repartir una fórmula.
- **El IMC aparece antes que el resto.** Solo necesita altura y peso, así que
  con eso ya se muestra aunque falten sexo o fecha de nacimiento.
- **La categoría se calcula sobre el IMC redondeado**, el mismo que se
  muestra: 24,96 se lee 25,0 y dice "Sobrepeso", no "Normal".
- **Va en Perfil.** Casi todo lo que falta se completa ahí, y como el
  formulario escribe en la caché del perfil al salir de cada campo, la
  tarjeta se recalcula sola. Si falta el peso, lleva a Progreso.

La Fase 7 engancha en `energyReport()`: `target.kcal` es el número contra el
que se cierra el día de comidas.

El chunk inicial pasó de 510,4 KB a **515,1 KB (149,6 KB gzip)**.

#### 5.5 — Integración y cierre ✅

Lo que suele quedar suelto cuando una fase termina. Tres puntos, los tres
cerrados.

**El peso no entra al `WidgetPayload`.** Se decidió que no, y no por
olvido:

- Ninguna sub-fase de la Fase 6 lo muestra: el mediano es el heatmap y el
  grande la rutina de hoy. Un campo sin consumidor es justo lo que el
  payload evitó desde la Fase 4 —se armó completo porque cada campo tenía
  quien lo leyera—.
- La premisa de "agregarlo después es tocar los dos lados" no se sostiene
  para un campo **nuevo**. El `JSONDecoder` de Swift ignora las claves que
  el struct no declara, así que la web puede empezar a mandar `weight`
  cuando quiera sin romper un widget que no lo conoce. Lo que sí rompe es
  renombrar o sacar un campo, y eso sí sigue siendo tocar los dos lados.
- Hay además un costo que no se ve en el tipo. `WidgetSync` se movió de Hoy
  a `AppLayout` para mantener la rutina sincronizada, pero el peso se anota en
  Progreso. Agregar peso exigiría otra query/invalidador y un consumidor real
  en el widget; no se añade al payload por anticipación.

Si algún día hay un widget de peso, el bloque natural es
`weight: { currentKg, targetKg, goal } | null`, con `latestWeight()` y
`toGoal()` de siempre. La decisión quedó también como comentario en
`WidgetPayload`, que es donde alguien la iría a buscar.

**Perfil y Progreso: el reparto se queda como está.** Revisado con el
contenido nuevo encima, el criterio aguanta: **Perfil tiene lo que casi no
cambia y lo que se deduce de eso** (datos corporales, calorías), y
**Progreso tiene las series temporales** (sesiones y peso). Lo que había
que ajustar eran los bordes:

- El vacío de Progreso decía "Nada que mostrar por ahora" arriba del
  registro de peso, que sí mostraba cosas. Ahora dice "Todavía no
  entrenaste", que es de lo único que habla.
- El subtítulo de Perfil decía "Tu cuenta y tus preferencias", pero la app
  no tiene preferencias. Ahora dice "Tu cuenta, tu cuerpo y tu objetivo".
- El cruce entre pestañas iba en un solo sentido. La tarjeta de calorías
  lleva a Progreso cuando falta el peso; ahora el gráfico, cuando no hay
  peso meta, lleva a Perfil. Solo con el perfil cargado: si falló, no
  insiste.

**Integración de la Fase 5 con la Fase 7 (estado actual):**

- **`energyReport()`** (`src/features/body/energy.ts`) es el punto de
  entrada. `target.kcal` es la cifra contra la que se cierra el día de
  comidas, `tdee` el gasto estimado y `goal` el sentido de la meta. Es pura:
  recibe el perfil, el último peso y los días entrenados.
- **La composición se comparte** mediante `useEnergyReportForDate()` en
  `body/queries.ts`: Perfil y `/comidas` usan perfil, pesos y sesiones para
  obtener un objetivo relativo a la fecha local consultada; no duplican la
  fórmula de `energyReport()`.
- **No hay ajuste automático por evolución real del peso.** La media móvil
  de `withTrend()` en `weight-trend.ts` no interviene en el objetivo.
  `energyReport()` usa el último peso válido hasta la fecha consultada; el
  objetivo/TDEE se fijan al primer registro del día.
- Las queries de perfil y peso comparten claves con Perfil/Progreso; las
  sesiones para energía usan una clave por fecha, no el total de 26 semanas
  del heatmap. La ruta `/comidas` es `lazy()`.

El chunk inicial pasó de 515,1 KB a **515,9 KB (149,8 KB gzip)**.

### Fase 6 — Capacitor y widget de iOS ⚠️ código implementado; aceptación pendiente

**Estado al 2026-10-01:** 6.1–6.5 tienen implementación en el árbol de trabajo,
pero **ninguna subfase está aceptada en producto iOS**. Xcode 27 está instalado
y seleccionado. Los builds genéricos de iOS Simulator **sin firma** de `App` y
`WidgetExtension` pasaron en Debug y Release. No hay runtime de Simulator
(`simctl` lista cero runtimes/dispositivos); iOS 26 requiere una descarga de
~7,99 GB con espacio libre escaso (~11 GB reportados). Tampoco hay Apple
Developer Team: no se pudieron ejecutar app/widgets, firmar App Groups, probar
OAuth real ni pasos físicos.
La [checklist de publicación](docs/ios-release-checklist.md) es la puerta de
aceptación; tests TypeScript/build web no la reemplazan.

Los IDs `com.f1t.app`, `com.f1t.app.widget` y `group.com.f1t.app` son
**placeholders sin titularidad/provisión comprobadas**. Reclamar IDs propios y
habilitar el mismo App Group para app y extensión antes de firmar. En Supabase
ya se verificó la allowlist remota con `f1t://auth/callback`, orígenes locales
y dominios Vercel, conservando entradas previas, `site_url` y el proveedor
Google habilitado. **La configuración no equivale a una prueba OAuth real.**
El icono y splash nativos siguen siendo los del template.

#### 6.1 — La cáscara ☑ código; ☐ simulador/serie real

`ios/` contiene el host Capacitor 8 con Swift Package Manager (**iOS 17+**), configuración
de safe areas/scroll, service worker omitido en WebView y OAuth Google nativo
con navegador del sistema, deep link y canje PKCE. Falta ejecutar app firmada,
iniciar sesión y registrar/verificar una serie persistida en Simulator o iPhone.

#### 6.2 — `DeviceBridge` nativo ☑ código; ☐ App Group firmado

`device.ts` selecciona plataforma; `F1tWidgetPlugin` valida el payload,
escribe `widget-payload.json` atómicamente en el App Group y recarga WidgetKit.
`WidgetSync` vive en `AppLayout`, no solo en Hoy, y la limpieza de logout
serializa la eliminación de datos privados. Hay que confirmar lectura/escritura
del JSON en el contenedor compartido bajo perfiles reales; la copia web en
localStorage es solo diagnóstica.

#### 6.3 — Widget mediano: heatmap ☑ código; ☐ visual iOS 26

La extensión SwiftUI lee 26 semanas × 7 niveles y usa opacidad para 0–4.
Falta instalar/agregar el widget y comparar niveles, vacío, logout y aspecto
en modos **Clear y Tint** en iOS 26, no solo el render web.

#### 6.4 — Widget grande: rutina de hoy ☑ código; ☐ visual/cambio de día

Lee `todayLabel`/`todayExercises` y el `routineWeek` v2 del mismo payload;
WidgetKit precarga entradas para cambio de día local sin abrir la app.
Falta probar rutina activa, descanso, cambios de rutina, límite de ejercicios,
medianoche local y limpieza al cerrar sesión.

#### 6.5 — Recordatorios y pasos ☑ código; ☐ dispositivo físico

`F1tActivityPlugin` usa `UNUserNotificationCenter` y `CMPedometer`, con
recordatorios en Perfil y pasos en Hoy solo en iOS. Falta verificar permiso,
programación, cancelación, cierre de sesión y notificación con app cerrada; la
lectura de pasos y permisos de Movimiento y condición física debe probarse en
**iPhone físico**, no inferirse del Simulator.

### Fase 7 — Plan de comidas ⚠️ código implementado; distribución pendiente

Se apoya en `energyReport()` de 5.4. El catálogo curado va en el bundle; el
diario privado usa Supabase. La selección de fuente y las condiciones legales
están detalladas en [docs/food-data-decision.md](docs/food-data-decision.md).
El frontend web está desplegado en Vercel **como producción privada protegida**,
no disponible anónimamente. La CLI autoapuntó el primer despliegue a
producción y `ssoProtection` (`deploymentType=all`) se habilitó antes del
estado Ready. El alias `https://f1t-pied.vercel.app` figura Ready, pero `/`,
`/comidas` y `/data/foods-catalog.json` devuelven 302 a Vercel Authentication
sin sesión; **todos los URLs de deployment** están protegidos, no hay preview
pública. `vercel.json` explicita Vite/`npm run build`/`dist`; Vercel tiene
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en todos los entornos.
`.vercelignore` excluye `.env`, proyecto nativo y snapshots de la subida.
Validación local: **220 tests Vitest, 4 Node, build y lint pasan**; la
automatización del navegador integrado falló y OAuth/CRUD real siguen sin
verificar.

#### 7.1 — Elegir la fuente ✅ decisión documentada

Se eligió **Open Food Facts (OFF)** para el primer recorte de productos
etiquetados para Argentina frente a USDA FDC, no por superioridad nutricional
sino por identificación local. La fuente tiene licencia ODbL/DbCL: la
publicación del recorte descargable, atribución y separación del diario privado
**requieren revisión legal/compliance antes de distribución pública**. No se
asume exención por tamaño ni se incorporan imágenes OFF.

#### 7.2 — Catálogo curado ☑ código/datos; ☐ auditoría externa/legal

Versión `2026-10-01.1`: **43 productos** de 81 candidatos consultados, todos
con `en:argentina` en la ficha OFF. Se revisaron identidad/campos, país,
base y coherencia kcal/kJ/macros, pero **no se verificaron independientemente
las etiquetas actuales ni la disponibilidad comercial**. Es menor que el
objetivo inicial de ~80–120; no se completó con calorías conjeturadas.
El código `7790895000782` se retiró: OFF daba 42 kcal/100 ml, mientras la
[ficha actual de Coca-Cola Argentina](https://www.coca-cola.com/ar/es/brands/coca-cola/original)
da 30 kcal/100 ml para Sabor Original;
no se pudo confirmar la etiqueta vigente de ese código exacto.
`whitelist.json` fija revisión, fecha, hash SHA-256, kcal/100, unidad y nota.
`scripts/foods/snapshots/` fija solo respuestas seleccionadas. El importador
sin red genera `src/features/foods/catalog.json` y copias abiertas descargables
bajo `public/data/`, con atribución ODbL, sin fotos ni datos personales. El
JSON independiente contiene URLs de fuente, licencias ODbL/DbCL y atribución;
el acceso HTTP anónimo está bloqueado por Vercel Authentication.

`node scripts/food-import.mjs --check` valida hashes/derivados sin escribir;
`node scripts/food-fetch.mjs --refresh` deja nuevas respuestas en `staged/`
para revisión; `node scripts/food-promote.mjs` promueve una ficha con versión
mayor. El fetch usa User-Agent identificable y pausa de 4,5 s por solicitud
(<15 lecturas de producto/min/IP). Ver [procedimiento](scripts/foods/README.md).

#### 7.3 — Registro de comidas ☑ código/SQL/hosting privado; ☐ CRUD real verificado

La ruta `/comidas` permite búsqueda offline, registro por fecha local y
cantidad positiva en g/ml (hasta 5.000 con dos decimales), edición de cantidad
y borrado. Cada entrada guarda snapshot de producto, versión y kcal/100; las
kcal son columna generada, por lo que editar cantidad recalcula solo esa
entrada. No hay porciones implícitas, conversión ml→g ni escáner universal.
`food_days`/`food_entries` tienen RLS de lectura; las escrituras pasan por RPC
con comprobación de propietario. La migración
`supabase/migrations/20260929155045_food_diary.sql` figura **local = remote**
en `npm run db:status` del Supabase vinculado: se aplicó allí el
2026-09-29 y se verificó el estado ese día. El hosting privado actual **no**
demuestra que el diario se haya probado end-to-end ni lo vuelve público.

#### 7.4 — Cierre contra el objetivo ☑ código; ☐ aceptación con datos reales

`/comidas` compara kcal ingeridas con `energyReport().target.kcal` para la
fecha local y muestra TDEE estimado sin volver a compensar el ejercicio. Al
primer registro se fija objetivo/TDEE en `food_days`; si no es calculable se
fija un par nulo y se permite registrar. Ante fallo de la consulta energética,
el usuario debe confirmar expresamente registrar sin objetivo. Borrar la
última comida **no** borra el snapshot del día; cambios futuros de peso,
perfil, sesiones o catálogo no reescriben el historial. No hay autoajuste del
objetivo por tendencia del peso.

**Tipos Supabase:** tras el push, el generador produce tipos diferentes de
`src/lib/database.types.ts` y pierde la nulabilidad de argumentos RPC como
`p_target_kcal` y `p_tdee_kcal`. El script `npm run db:types` redirige sobre
ese archivo: **generar a un temporal y revisar el diff**, no sobrescribirlo
ciegamente.

---

**Seguridad de dependencias (2026-10-01):** `npm ci` y `npm audit` reportaron
0 vulnerabilidades tras parches compatibles y un override limitado a
`xcode → uuid@11.1.1`, sin degradar Capacitor. Pasaron 220 tests Vitest,
10 tests Node, lint, build, `ios:sync` y build Simulator unsigned Release.
Se redesplegó el frontend protegido: Ready; `/`, `/comidas` y el catálogo
continúan devolviendo 302 al visitante anónimo. Persisten la aceptación real
y las puertas externas descritas arriba. Ver
[decisión de dependencias y avisos residuales](docs/dependency-security.md).

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
