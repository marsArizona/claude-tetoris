# TETORIS

Implementación del clásico **Tetris** en JavaScript vanilla, usando HTML5 Canvas y CSS. Sin dependencias externas, sin frameworks, sin proceso de build: solo abrir y jugar.

![Tech](https://img.shields.io/badge/HTML5-Canvas-orange)
![Tech](https://img.shields.io/badge/CSS3-blueviolet)
![Tech](https://img.shields.io/badge/JavaScript-Vanilla-yellow)

---

## Tabla de contenidos

- [TETORIS](#tetoris)
  - [Tabla de contenidos](#tabla-de-contenidos)
  - [Qué hace el proyecto](#qué-hace-el-proyecto)
  - [Cómo ejecutar el juego](#cómo-ejecutar-el-juego)
    - [Opción 1: abrir el archivo directamente](#opción-1-abrir-el-archivo-directamente)
    - [Opción 2: servidor local (recomendado)](#opción-2-servidor-local-recomendado)
  - [Controles](#controles)
  - [Records](#records)
  - [Cómo funciona](#cómo-funciona)
    - [1. `index.html`](#1-indexhtml)
    - [2. `style.css`](#2-stylecss)
    - [3. `game.js`](#3-gamejs)
    - [Flujo del juego](#flujo-del-juego)
  - [Tecnologías](#tecnologías)
  - [Estructura del proyecto](#estructura-del-proyecto)
  - [Personalización](#personalización)
  - [Licencia](#licencia)

---

## Qué hace el proyecto

Es una versión jugable del Tetris clásico con todas las mecánicas que esperarías:

- Tablero de **10 × 20** celdas.
- Las **7 piezas estándar** (I, O, T, S, Z, J, L) más una pieza extra en forma de **U / herradura**, cada una con su color.
- **Rotación** con _wall kicks_ básicos (pequeños desplazamientos para que la pieza pueda rotar pegada a la pared).
- **Soft drop** (bajada acelerada) y **hard drop** (caída instantánea).
- **Pieza fantasma** (_ghost piece_): muestra dónde aterrizará la pieza actual.
- **Vista previa** de la siguiente pieza.
- **Sedimentación**: al eliminar una línea, los restos de piezas que quedan sin apoyo caen (animados, fila a fila) hasta posarse; si al caer completan otra línea, también se elimina (cascada).
- **Sistema de puntuación** clásico de Tetris (100 / 300 / 500 / 800 multiplicado por nivel).
- **Niveles** que aumentan cada 10 líneas y aceleran la caída.
- **Menú de pausa** con opciones para reanudar, reiniciar, ver los controles y elegir el nivel inicial.
- **Game Over** con opción de reinicio.
- **Pantalla de inicio** y **tabla de records local** (Top 5, mejor combo y líneas máximas), guardada en el navegador. Ver [Records](#records).

---

## Cómo ejecutar el juego

No hay nada que instalar ni compilar. Tienes dos opciones:

### Opción 1: abrir el archivo directamente

```bash
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

### Opción 2: servidor local (recomendado)

Cualquier servidor estático funciona. Algunos ejemplos:

```bash
# Con Python 3
python3 -m http.server 8000

# Con Node.js (npx)
npx serve .

# Con PHP
php -S localhost:8000
```

Después abre `http://localhost:8000` en el navegador.

---

## Controles

| Tecla     | Acción                            |
| --------- | --------------------------------- |
| `←` / `→` | Mover la pieza horizontalmente    |
| `↑` o `X` | Rotar la pieza en sentido horario |
| `↓`       | Soft drop (bajar más rápido)      |
| `Espacio` | Hard drop (caída instantánea)     |
| `P` o `Esc` | Abrir / cerrar el menú de pausa |
| `Enter`   | Empezar partida (pantalla de inicio) |

### Menú de pausa

Al pausar aparece un menú con estas opciones:

- **Reanudar**: vuelve a la partida (también con `P` o `Esc`).
- **Reiniciar**: empieza una nueva partida sin recargar la página.
- **Ver controles**: muestra u oculta la lista de teclas dentro del menú.
- **Nivel inicial**: elige con qué nivel (1–10) empezará la **próxima** partida. Se guarda en `localStorage` (`startLevel`).

Dentro del menú se navega con `↑` / `↓` o `Tab`, se activa con `Enter`, y en el selector de nivel `←` / `→` cambian el valor. Mientras el menú está abierto el juego no recibe ninguna tecla, y al reanudar el reloj de caída se reinicia para que la pieza no salte. La pausa no se puede abrir durante el Game Over, pero sí durante la animación de sedimentación.

---

## Records

Al abrir el juego aparece una **pantalla de inicio** con el título, la tabla de records y las estadísticas históricas. La partida no empieza (no cae ninguna pieza) hasta pulsar **JUGAR** o `Enter`.

- **Top 5**: se guardan las 5 mejores puntuaciones con nombre del jugador, puntos, líneas, nivel y fecha.
- **Entrar en el top**: al terminar la partida, si la puntuación es mayor que 0 y hay menos de 5 records o supera al quinto, aparece el mensaje **¡Nuevo récord!** y un campo de texto (máx. 12 caracteres, por defecto "Jugador"). Con `Enter` o el botón **Guardar** se guarda y la fila nueva queda resaltada en la tabla. Mientras escribes, las teclas del juego (Espacio, `P`, flechas…) no tienen efecto.
- **Mejor combo**: número máximo de piezas **consecutivas** que eliminan al menos una línea. Cada pieza cuenta una sola vez aunque provoque una cascada; una pieza que no elimina nada reinicia el combo a 0.
- **Líneas máximas**: el mayor número de líneas eliminadas en una sola partida.
- El mejor combo y las líneas máximas se actualizan en cada Game Over, entre o no la puntuación en el top.
- **Borrar records**: el botón de la pantalla de inicio (pide confirmación) borra la tabla y las estadísticas.

Los datos se guardan en `localStorage` con las claves `records` (array del top 5 ordenado por puntuación) y `stats` (`{ bestCombo, maxLines }`). Si esos datos están corruptos o no se pueden leer, la tabla y las estadísticas empiezan vacías. Si pulsas **Reiniciar** sin haber guardado el nombre, el récord se guarda con el nombre que haya en el campo.

---

## Cómo funciona

El juego se compone de tres archivos que cooperan:

### 1. `index.html`

Define la estructura visual:

- Un `<canvas id="board">` de **300 × 600** píxeles donde se renderiza el tablero.
- Un panel lateral con `SCORE`, `LINES`, `LEVEL`, vista de la siguiente pieza y la lista de controles.
- Un overlay para el estado **GAME OVER** (con la tabla de records y el campo para el nombre) y otro (`#pause-menu`) para el menú de pausa.
- Un overlay `#start-screen` con la pantalla de inicio: records, botón **JUGAR** y **Borrar records**.

### 2. `style.css`

Aporta el aspecto visual con estética _dark / retro arcade_: fondo oscuro, tipografía monoespaciada para los marcadores y _backdrop blur_ en los overlays.

### 3. `game.js`

Contiene toda la lógica del juego. A grandes rasgos:

- **Modelo del tablero**: una matriz `ROWS × COLS` donde cada celda guarda `0` (vacía) o un índice de color (1–8) que identifica el tipo de pieza. Una matriz paralela `pieceIds` guarda a qué pieza concreta pertenece cada celda.
- **Piezas**: definidas como matrices cuadradas. Para rotar se calcula la transposición + reverso de filas (`rotateCW`).
- **Detección de colisiones** (`collide`): comprueba que ninguna celda de la pieza salga del tablero ni se solape con bloques ya fijados.
- **Wall kicks** (`tryRotate`): si la rotación choca, intenta desplazar la pieza ±1 y ±2 columnas antes de descartar el giro.
- **Game loop** (`loop`): basado en `requestAnimationFrame`, acumula el tiempo transcurrido y baja la pieza una fila cuando se supera `dropInterval`.
- **Limpieza de líneas** (`clearLines`): recorre el tablero de abajo hacia arriba; cada fila completa se elimina y se inserta una vacía en la cima. Si se eliminó alguna, el juego entra en estado `settling`: cada `SETTLE_STEP` ms (`60`), `settleStep` agrupa las celdas en fragmentos (bloques contiguos de una misma pieza) y baja una fila cada fragmento sin apoyo. Cuando todo se posa, se vuelven a buscar líneas completas (cascada; cada pasada puntúa por separado) y, si no hay más, aparece la siguiente pieza. Durante la animación los controles (salvo la pausa) se ignoran.
- **Puntuación**: usa la tabla clásica `[0, 100, 300, 500, 800]` multiplicada por el nivel actual; el hard drop suma 2 puntos por celda recorrida y el soft drop 1 punto por fila.
- **Nivel y velocidad**: la partida empieza en el nivel inicial elegido en el menú de pausa (`startLevel`, 1 por defecto). El nivel se calcula como `max(startLevel, floor(lines / 10) + 1)`: nunca baja del nivel inicial y solo sube cuando las líneas acumuladas alcanzan ese umbral (p. ej. empezando en nivel 5 se pasa al 6 con 50 líneas). La velocidad de caída se calcula como `max(100, 1000 − (level − 1) × 90)` milisegundos.
- **Ghost piece** (`ghostY`): proyecta la posición final de la pieza actual hacia abajo y la dibuja con `globalAlpha = 0.2`.

### Flujo del juego

```
carga de la página → tablero vacío + pantalla de inicio (records)
  ↓ JUGAR / Enter
init()
  ├─ createBoard()                  → matriz vacía
  ├─ next = randomPiece()
  ├─ spawn()                        → mueve next a current y genera nueva next
  └─ requestAnimationFrame(loop)
        ↓
   loop(timestamp)
     ├─ acumula dt
     ├─ si dt ≥ dropInterval → baja la pieza o llama a lockPiece()
     ├─ draw()  (grid + tablero + ghost + pieza actual)
     └─ requestAnimationFrame(loop)

   keydown → mover / rotar / soft-drop / hard-drop / pausa (P o Esc)
               └─ con el menú de pausa abierto, las teclas solo navegan el menú
```

Cuando una pieza recién generada ya colisiona al aparecer (`spawn`), se dispara `endGame()` y se muestra el overlay de **Game Over**, que actualiza las estadísticas y muestra la tabla de records (con el campo de nombre si la puntuación entra en el top 5).

---

## Tecnologías

- **HTML5** — marcado y dos elementos `<canvas>` (tablero y vista previa).
- **CSS3** — _flexbox_, variables de color, `backdrop-filter` y `box-shadow`.
- **JavaScript (ES6+) vanilla** — `const`/`let`, _arrow functions_, _spread operator_, `Array.from`, _template literals_…
- **Canvas 2D API** — para todo el renderizado del juego.
- **`requestAnimationFrame`** — para el bucle de juego sincronizado con el navegador.

**Sin dependencias.** No hay `package.json`, ni bundler, ni transpilador.

---

## Estructura del proyecto

```
03-tetris/
├── index.html      # Estructura del DOM y canvas
├── style.css       # Estilos del juego (dark theme)
├── game.js         # Toda la lógica del Tetris (~300 líneas)
└── README.md
```

---

## Personalización

Algunos parámetros fáciles de tunear en `game.js`:

| Constante      | Significado                              | Por defecto           |
| -------------- | ---------------------------------------- | --------------------- |
| `COLS`         | Columnas del tablero                     | `10`                  |
| `ROWS`         | Filas del tablero                        | `20`                  |
| `BLOCK`        | Tamaño en píxeles de cada celda          | `30`                  |
| `COLORS`       | Paleta de colores por tipo de pieza      | 8 colores             |
| `LINE_SCORES`  | Puntos por 1, 2, 3 o 4 líneas eliminadas | `[0,100,300,500,800]` |
| `dropInterval` | Velocidad inicial de caída en ms         | `1000`                |

> Si cambias `COLS`, `ROWS` o `BLOCK`, recuerda ajustar también `width` y `height` del `<canvas id="board">` en `index.html` para que coincida (`COLS × BLOCK` × `ROWS × BLOCK`).

---

## Licencia

Proyecto de uso libre con fines educativos y de práctica.
