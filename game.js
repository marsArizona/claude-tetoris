'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Mezcla un color hex con blanco (amt > 0) o negro (amt < 0).
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const target = amt < 0 ? 0 : 255;
  const t = Math.abs(amt);
  const mix = v => Math.round(v + (target - v) * t);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// Rectángulo con esquinas redondeadas (path manual, sin depender de ctx.roundRect).
function roundedRect(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// Textura pixel art precalculada: un canvas offscreen por color y tamaño.
const pixelCache = new Map();

function pixelTile(color, size) {
  const key = color + size;
  if (pixelCache.has(key)) return pixelCache.get(key);
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const t = tile.getContext('2d');
  const px = Math.max(2, Math.floor(size / 10)); // tamaño de "pixel"
  const n = Math.floor(size / px);
  const light = shade(color, 0.45), dark = shade(color, -0.35), dither = shade(color, -0.15);
  t.fillStyle = color;
  t.fillRect(0, 0, n * px, n * px);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let fill = null;
      if (i === n - 1 || j === n - 1) fill = dark;           // borde inferior/derecho
      else if (i === 0 || j === 0) fill = light;             // borde superior/izquierdo
      else if (i === 1 && j === 1) fill = '#ffffff';          // brillo
      else if ((i + j) % 3 === 0 && i > 1 && j > 1) fill = dither; // tramado
      if (fill) { t.fillStyle = fill; t.fillRect(j * px, i * px, px, px); }
    }
  }
  pixelCache.set(key, tile);
  return tile;
}

// Cada skin define su paleta (índice = tipo de pieza) y cómo pintar un bloque
// en (px, py) de lado `size`. El alpha global lo gestiona drawBlock.
const SKINS = {
  retro: {
    label: 'Retro',
    colors: [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#7986cb', '#ffb74d', '#f06292'],
    drawBlock(context, px, py, size, color) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(px + 1, py + 1, size - 2, 4);
    },
  },
  neon: {
    label: 'Neon',
    colors: [null, '#00f0ff', '#fff200', '#d000ff', '#39ff14', '#ff073a', '#4d4dff', '#ff8c00', '#ff2ec4'],
    drawBlock(context, px, py, size, color) {
      context.shadowColor = color;
      context.shadowBlur = size * 0.5;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px + 3, py + 3, size - 6, size - 6);
      context.fillStyle = color;
      context.globalAlpha *= 0.35;
      context.fillRect(px + 5, py + 5, size - 10, size - 10);
      // sin resetear, el glow contaminaría la cuadrícula y el resto de dibujos
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
    },
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6ef', '#fdf1a8', '#d9b8e8', '#b9e4c0', '#f5b5b5', '#b8c2ec', '#fdd4a6', '#f8bbd9'],
    drawBlock(context, px, py, size, color) {
      const r = size * 0.25;
      roundedRect(context, px + 2, py + 2, size - 4, size - 4, r);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = shade(color, -0.15);
      context.lineWidth = 1.5;
      context.stroke();
      // brillo suave arriba
      roundedRect(context, px + 5, py + 4, size - 10, size * 0.25, r / 2);
      context.fillStyle = 'rgba(255,255,255,0.45)';
      context.fill();
    },
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#29adff', '#ffec27', '#a259d9', '#00e436', '#ff004d', '#3a5fcd', '#ffa300', '#ff77a8'],
    drawBlock(context, px, py, size, color) {
      context.drawImage(pixelTile(color, size), px, py);
    },
  },
};

const SKIN_KEY = 'skin';
let skin = SKINS.retro;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,0,8],[8,8,8],[0,0,0]],                  // U (herradura)
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const SETTLE_STEP = 60; // ms por fila durante la animación de sedimentación

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, pieceIds, nextPieceId, current, next, score, lines, level, paused, gameOver, settling, settleAccum, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c]) {
        board[current.y + r][current.x + c] = current.shape[r][c];
        pieceIds[current.y + r][current.x + c] = nextPieceId;
      }
  nextPieceId++;
}

function removeFullRows() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      pieceIds.splice(r, 1);
      pieceIds.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

// Agrupa las celdas ocupadas en fragmentos: bloques contiguos de la misma pieza.
function findFragments() {
  const seen = createBoard();
  const fragments = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!board[r][c] || seen[r][c]) continue;
      const id = pieceIds[r][c];
      const cells = [];
      const stack = [[r, c]];
      seen[r][c] = 1;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        cells.push([cr, cc]);
        for (const [nr, nc] of [[cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]]) {
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (seen[nr][nc] || !board[nr][nc] || pieceIds[nr][nc] !== id) continue;
          seen[nr][nc] = 1;
          stack.push([nr, nc]);
        }
      }
      fragments.push(cells);
    }
  }
  return fragments;
}

// Sedimentación: avanza una fila todos los fragmentos sin apoyo. Devuelve si algo se movió.
function settleStep() {
  const fragments = findFragments();
  // los más bajos primero, para que los apilados encima caigan en el mismo paso
  fragments.sort((a, b) => Math.max(...b.map(([r]) => r)) - Math.max(...a.map(([r]) => r)));
  let moved = false;
  for (const cells of fragments) {
    const own = new Set(cells.map(([r, c]) => r * COLS + c));
    const canFall = cells.every(([r, c]) =>
      r + 1 < ROWS && (!board[r + 1][c] || own.has((r + 1) * COLS + c)));
    if (!canFall) continue;
    // de abajo hacia arriba para no pisar celdas del propio fragmento
    cells.sort((a, b) => b[0] - a[0]);
    for (const [r, c] of cells) {
      board[r + 1][c] = board[r][c];
      pieceIds[r + 1][c] = pieceIds[r][c];
      board[r][c] = 0;
      pieceIds[r][c] = 0;
    }
    moved = true;
  }
  return moved;
}

function clearLines() {
  const cleared = removeFullRows();
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  if (clearLines()) {
    // la siguiente pieza espera a que termine de caer el sedimento
    current = null;
    settling = true;
    settleAccum = 0;
  } else {
    spawn();
  }
}

// Un paso de la animación: baja el sedimento una fila; si ya se posó, busca
// líneas nuevas (cascada) y, si no hay, devuelve el control al jugador.
function advanceSettle() {
  if (settleStep()) return;
  if (clearLines()) return;
  settling = false;
  dropAccum = 0;
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  skin.drawBlock(context, x * size, y * size, size, skin.colors[colorIndex]);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--grid').trim(); // hereda overrides de la skin
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  if (!current) return;

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (settling) {
    settleAccum += dt;
    if (settleAccum >= SETTLE_STEP) {
      settleAccum = 0;
      advanceSettle();
    }
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  draw();
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  pieceIds = createBoard();
  nextPieceId = 1;
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  settling = false;
  settleAccum = 0;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver || settling) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

const themeBtn = document.getElementById('theme-toggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  themeBtn.textContent = theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro';
  draw(); // repinta la cuadrícula aunque el juego esté en pausa
}

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  themeBtn.blur(); // evita que Space/Enter vuelvan a activar el botón
});

const skinSelect = document.getElementById('skin-select');
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

function loadSkin() {
  try {
    const saved = localStorage.getItem(SKIN_KEY);
    if (Object.hasOwn(SKINS, saved)) return saved;
  } catch (e) { /* localStorage no disponible */ }
  return 'retro';
}

function applySkin(name) {
  if (!Object.hasOwn(SKINS, name)) name = 'retro';
  skin = SKINS[name];
  document.documentElement.dataset.skin = name; // fondo/cuadrícula por CSS
  skinSelect.value = name;
  try { localStorage.setItem(SKIN_KEY, name); } catch (e) { /* sin persistencia */ }
  draw(); // repinta aunque el juego esté en pausa o terminado
  drawNext();
}

for (const [name, s] of Object.entries(SKINS)) skinSelect.add(new Option(s.label, name));

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // devuelve el teclado al juego
});

// Mientras se juega, las teclas del juego no cambian la skin: se ceden al juego.
skinSelect.addEventListener('keydown', e => {
  if (paused || gameOver || !GAME_KEYS.includes(e.code)) return;
  e.preventDefault();
  skinSelect.blur();
});

skin = SKINS[loadSkin()];
init();
applyTheme(document.documentElement.dataset.theme);
applySkin(loadSkin());
