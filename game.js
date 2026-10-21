'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
  '#f06292', // U - pink
];

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

// ---- Skins visuales ----
// Cada skin define su paleta (índices 1–8 = I,O,T,S,Z,J,L,U) y cómo pinta un bloque.
const SKIN_STORAGE_KEY = 'skin';
const DEFAULT_SKIN = 'retro';

// Ruta de rectángulo redondeado; usa roundRect si existe y si no arcTo.
function roundRectPath(context, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

const SKINS = {
  retro: {
    label: 'Retro',
    colors: COLORS,
    drawBlock(context, x, y, colorIndex, size, alpha) {
      context.globalAlpha = alpha;
      context.fillStyle = this.colors[colorIndex];
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
    },
  },
  neon: {
    label: 'Neón',
    colors: [null, '#00f0ff', '#fff200', '#d500ff', '#39ff14', '#ff073a', '#2979ff', '#ff9100', '#ff2bd6'],
    drawBlock(context, x, y, colorIndex, size, alpha) {
      const color = this.colors[colorIndex];
      const px = x * size + 3, py = y * size + 3, s = size - 6;
      context.shadowColor = color;
      context.shadowBlur = size * 0.5;
      context.globalAlpha = alpha * 0.3;
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
      context.globalAlpha = alpha;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px, py, s, s);
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
      context.fillStyle = 'rgba(255,255,255,0.8)';
      context.fillRect(px + 3, py + 3, 3, 3);
    },
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6ef', '#fff1a8', '#d7b8f3', '#b9e4c9', '#f7b7b7', '#b8c4f3', '#ffd6a5', '#f9c0d9'],
    drawBlock(context, x, y, colorIndex, size, alpha) {
      const px = x * size + 2, py = y * size + 2, s = size - 4, r = size * 0.25;
      context.globalAlpha = alpha;
      roundRectPath(context, px, py, s, s, r);
      context.fillStyle = this.colors[colorIndex];
      context.fill();
      context.lineWidth = 1.5;
      if (alpha < 1) {
        // contorno más visible para la pieza fantasma sobre fondo claro
        context.globalAlpha = Math.min(1, alpha * 3);
        context.strokeStyle = this.colors[colorIndex];
        context.stroke();
        return;
      }
      context.strokeStyle = 'rgba(255,255,255,0.75)';
      context.stroke();
      roundRectPath(context, px + 4, py + 3, s - 8, s * 0.3, r * 0.6);
      context.fillStyle = 'rgba(255,255,255,0.35)';
      context.fill();
    },
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#00b8d4', '#ffd600', '#aa00ff', '#00c853', '#d50000', '#2962ff', '#ff6d00', '#c51162'],
    drawBlock(context, x, y, colorIndex, size, alpha) {
      const px = Math.round(x * size), py = Math.round(y * size), s = Math.round(size);
      const u = Math.max(2, Math.round(s / 10)); // tamaño de "píxel"
      context.globalAlpha = alpha;
      context.fillStyle = this.colors[colorIndex];
      context.fillRect(px, py, s, s);
      // bisel: claro arriba/izquierda, oscuro abajo/derecha
      context.fillStyle = 'rgba(255,255,255,0.45)';
      context.fillRect(px, py, s, u);
      context.fillRect(px, py, u, s);
      context.fillStyle = 'rgba(0,0,0,0.4)';
      context.fillRect(px, py + s - u, s, u);
      context.fillRect(px + s - u, py, u, s);
      // textura de puntos en damero
      context.fillStyle = 'rgba(0,0,0,0.18)';
      for (let j = 2; j * u < s - 2 * u; j += 2)
        for (let i = 2 + (j / 2) % 2; i * u < s - 2 * u; i += 2)
          context.fillRect(px + i * u, py + j * u, u, u);
      context.fillStyle = 'rgba(255,255,255,0.8)';
      context.fillRect(px + u, py + u, u, u);
    },
  },
};

let activeSkin = SKINS[DEFAULT_SKIN];

// Delegado global: pinta con el skin activo y restaura el estado del contexto.
function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.save();
  activeSkin.drawBlock(context, x, y, colorIndex, size, alpha ?? 1);
  context.restore();
  context.globalAlpha = 1;
}
// ---- fin skins ----

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
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

init();
applyTheme(document.documentElement.dataset.theme);

// ---- Selector de skin ----
const skinSelect = document.getElementById('skin-select');

function loadSkin() {
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    return Object.prototype.hasOwnProperty.call(SKINS, stored) ? stored : DEFAULT_SKIN;
  } catch (e) {
    return DEFAULT_SKIN;
  }
}

function applySkin(name) {
  if (!Object.prototype.hasOwnProperty.call(SKINS, name)) name = DEFAULT_SKIN;
  activeSkin = SKINS[name];
  document.documentElement.dataset.skin = name;
  skinSelect.value = name;
  try { localStorage.setItem(SKIN_STORAGE_KEY, name); } catch (e) { /* sin almacenamiento */ }
  draw();
  drawNext();
}

for (const [key, skin] of Object.entries(SKINS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = skin.label;
  skinSelect.appendChild(opt);
}

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  skinSelect.blur(); // las teclas del juego no deben cambiar el selector
});

// Con la partida en marcha, las teclas de juego no modifican el selector (el juego
// las sigue recibiendo); en pausa o Game Over funciona como un select normal.
skinSelect.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { e.preventDefault(); return; }
  if (paused || gameOver) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyX'].includes(e.code)) {
    e.preventDefault();
    skinSelect.blur();
  }
});

applySkin(loadSkin());
