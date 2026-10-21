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
const MAX_START_LEVEL = 10;

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
const newRecordEl = document.getElementById('new-record');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const recordsBody = document.getElementById('records-body');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const pauseMenu = document.getElementById('pause-menu');
const menuItems = [...pauseMenu.querySelectorAll('.menu-item')];
const menuControls = document.getElementById('menu-controls');
const startLevelEl = document.getElementById('start-level-value');

let startLevel = loadStartLevel();
let menuIndex = 0;
const pressedKeys = new Set(); // teclas físicamente pulsadas ahora mismo
let blockedKeys = new Set();   // teclas ignoradas hasta que se suelten (al salir del menú)

const RECORDS_KEY = 'tetoris-records';
const MAX_RECORDS = 5;
const MAX_NAME = 12;

let board, pieceIds, nextPieceId, current, next, score, lines, level, combo, maxCombo, paused, gameOver, settling, settleAccum, lastTime, dropAccum, dropInterval, animId;
let pendingRecord = null; // entrada del top aún sin nombre confirmado
let lastSavedRank = -1;   // puesto de la última entrada guardada, para resaltarla

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
    level = startLevel + Math.floor(lines / 10);
    dropInterval = dropIntervalFor(level);
    updateHUD();
  }
  return cleared;
}

function dropIntervalFor(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
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
  const cleared = clearLines();
  // combo: piezas consecutivas que completan al menos una línea
  combo = cleared ? combo + 1 : 0;
  maxCombo = Math.max(maxCombo, combo);
  if (cleared) {
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
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

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

// ---- Tabla de récords (localStorage) ----

function sanitizeName(name) {
  return String(name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
}

function toCount(v) {
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

// Lee y valida los récords; ante cualquier dato inesperado devuelve valores seguros.
function loadRecords() {
  const empty = { scores: [], bestCombo: 0, maxLines: 0 };
  let data;
  try {
    data = JSON.parse(localStorage.getItem(RECORDS_KEY));
  } catch {
    return empty;
  }
  if (!data || typeof data !== 'object') return empty;
  const scores = (Array.isArray(data.scores) ? data.scores : [])
    .filter(e => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.score) && e.score >= 0)
    .map(e => ({ name: sanitizeName(e.name) || 'Anónimo', score: toCount(e.score), lines: toCount(e.lines) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECORDS);
  return { scores, bestCombo: toCount(data.bestCombo), maxLines: toCount(data.maxLines) };
}

function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // almacenamiento no disponible (modo privado, cuota llena…): se ignora
  }
}

// Posición (0-based) que ocuparía la puntuación en el top, o -1 si no entra.
function recordRank(scores, value) {
  if (value <= 0) return -1;
  const idx = scores.findIndex(e => value > e.score);
  if (idx !== -1) return idx;
  return scores.length < MAX_RECORDS ? scores.length : -1;
}

// Pinta la tabla; si hay una entrada pendiente se muestra resaltada en su puesto.
function renderRecords() {
  const records = loadRecords();
  const rows = records.scores.slice();
  let highlight = -1;
  if (pendingRecord) {
    highlight = pendingRecord.rank;
    rows.splice(highlight, 0, pendingRecord.entry);
  } else if (gameOver && lastSavedRank !== -1) {
    highlight = lastSavedRank;
  }
  recordsBody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'records-empty';
    td.textContent = 'Sin récords todavía';
    tr.append(td);
    recordsBody.append(tr);
  }
  rows.slice(0, MAX_RECORDS).forEach((e, i) => {
    const tr = document.createElement('tr');
    if (i === highlight) tr.className = 'highlight';
    for (const text of [i + 1, e.name || '???', e.score.toLocaleString(), e.lines]) {
      const td = document.createElement('td');
      td.textContent = text; // textContent: el nombre nunca se interpreta como HTML
      tr.append(td);
    }
    recordsBody.append(tr);
  });
  bestComboEl.textContent = records.bestCombo;
  maxLinesEl.textContent = records.maxLines;
}

// Guarda la entrada pendiente con el nombre escrito (o "Anónimo").
function commitPendingRecord() {
  if (!pendingRecord) return;
  const records = loadRecords();
  const entry = { ...pendingRecord.entry, name: sanitizeName(nameInput.value) || 'Anónimo' };
  lastSavedRank = recordRank(records.scores, entry.score);
  if (lastSavedRank !== -1) {
    records.scores.splice(lastSavedRank, 0, entry);
    records.scores = records.scores.slice(0, MAX_RECORDS);
    saveRecords(records);
  }
  pendingRecord = null;
  nameForm.classList.add('hidden');
  nameInput.blur();
  renderRecords();
}

function showOverlay(mode) {
  overlay.classList.toggle('start', mode === 'start');
  document.getElementById('records').classList.toggle('hidden', mode === 'pause');
  if (mode !== 'gameover') {
    newRecordEl.classList.add('hidden');
    nameForm.classList.add('hidden');
  }
  restartBtn.textContent = mode === 'start' ? 'Jugar' : 'Reiniciar';
  renderRecords();
  overlay.classList.remove('hidden');
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  // combo y líneas máximas cuentan aunque la puntuación no entre en el top
  const records = loadRecords();
  const newCombo = maxCombo > records.bestCombo;
  const newLines = lines > records.maxLines;
  records.bestCombo = Math.max(records.bestCombo, maxCombo);
  records.maxLines = Math.max(records.maxLines, lines);
  saveRecords(records);
  bestComboEl.classList.toggle('new-best', newCombo);
  maxLinesEl.classList.toggle('new-best', newLines);

  lastSavedRank = -1;
  const rank = recordRank(records.scores, score);
  if (rank !== -1) {
    pendingRecord = { rank, entry: { name: '', score, lines } };
    newRecordEl.textContent = `¡Nuevo récord! Puesto ${rank + 1} del top ${MAX_RECORDS}`;
    newRecordEl.classList.remove('hidden');
    nameInput.value = '';
    nameForm.classList.remove('hidden');
  } else {
    pendingRecord = null;
    newRecordEl.classList.add('hidden');
    nameForm.classList.add('hidden');
  }
  showOverlay('gameover');
  if (pendingRecord) nameInput.focus();
}

// ---- Menú de pausa ----

function loadStartLevel() {
  try {
    const n = parseInt(localStorage.getItem('startLevel'), 10);
    if (n >= 1 && n <= MAX_START_LEVEL) return n;
  } catch (_) { /* almacenamiento no disponible */ }
  return 1;
}

function setStartLevel(n) {
  startLevel = Math.min(MAX_START_LEVEL, Math.max(1, n));
  startLevelEl.textContent = startLevel;
  try { localStorage.setItem('startLevel', startLevel); } catch (_) { /* ignorar */ }
}

function selectMenuItem(i) {
  menuIndex = (i + menuItems.length) % menuItems.length;
  menuItems.forEach((el, idx) => el.classList.toggle('selected', idx === menuIndex));
  menuItems[menuIndex].focus({ preventScroll: true });
}

function openMenu() {
  paused = true;
  cancelAnimationFrame(animId);
  pauseMenu.classList.remove('hidden');
  selectMenuItem(0);
}

// Cierra el menú; las teclas que sigan pulsadas no llegan al juego hasta soltarlas.
function closeMenu() {
  pauseMenu.classList.add('hidden');
  menuControls.classList.add('hidden');
  menuItems[2].setAttribute('aria-expanded', 'false');
  document.activeElement?.blur();
  blockedKeys = new Set(pressedKeys);
}

function resume() {
  closeMenu();
  paused = false;
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

function restart() {
  closeMenu();
  init();
}

function toggleControls() {
  const hidden = menuControls.classList.toggle('hidden');
  menuItems[2].setAttribute('aria-expanded', String(!hidden));
}

function activateMenuItem(action) {
  if (action === 'resume') resume();
  else if (action === 'restart') restart();
  else if (action === 'controls') toggleControls();
  else if (action === 'level') setStartLevel(startLevel % MAX_START_LEVEL + 1); // Enter: cicla
}

// Mientras el menú está abierto ninguna tecla llega al juego.
function handleMenuKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // atajos del navegador
  const action = menuItems[menuIndex].dataset.action;
  switch (e.code) {
    case 'Escape':
    case 'KeyP':
      if (!e.repeat) resume();
      break;
    case 'ArrowUp':
      selectMenuItem(menuIndex - 1);
      break;
    case 'ArrowDown':
      selectMenuItem(menuIndex + 1);
      break;
    case 'Tab':
      selectMenuItem(menuIndex + (e.shiftKey ? -1 : 1));
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (action === 'level') setStartLevel(startLevel + (e.code === 'ArrowLeft' ? -1 : 1));
      break;
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      if (!e.repeat) activateMenuItem(action);
      break;
    default:
      return;
  }
  e.preventDefault();
}

menuItems.forEach((el, idx) => {
  el.addEventListener('mouseenter', () => selectMenuItem(idx));
  el.addEventListener('click', e => {
    // e.detail === 0: clic sintetizado por teclado, ya lo gestiona handleMenuKey
    if (e.detail === 0 || el.dataset.action === 'level') return;
    activateMenuItem(el.dataset.action);
  });
});

pauseMenu.querySelectorAll('.level-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    if (e.detail === 0) return;
    setStartLevel(startLevel + Number(btn.dataset.step));
  });
});

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
  commitPendingRecord(); // reiniciar sin pulsar "Guardar" conserva el récord
  bestComboEl.classList.remove('new-best');
  maxLinesEl.classList.remove('new-best');
  board = createBoard();
  pieceIds = createBoard();
  nextPieceId = 1;
  score = 0;
  lines = 0;
  level = startLevel;
  combo = 0;
  maxCombo = 0;
  paused = false;
  gameOver = false;
  settling = false;
  settleAccum = 0;
  dropInterval = dropIntervalFor(level);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  pauseMenu.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // mientras se escribe el nombre, las teclas no controlan el juego
  if (e.target === nameInput) return;
  pressedKeys.add(e.code);
  if (paused) { handleMenuKey(e); return; }
  if (blockedKeys.has(e.code)) { e.preventDefault(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!gameOver) openMenu();
    return;
  }
  if (gameOver || settling) return;
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

document.addEventListener('keyup', e => {
  pressedKeys.delete(e.code);
  blockedKeys.delete(e.code);
});

// Si la ventana pierde el foco no recibimos los keyup: olvidamos el estado.
window.addEventListener('blur', () => {
  pressedKeys.clear();
  blockedKeys.clear();
});


restartBtn.addEventListener('click', () => {
  init();
  restartBtn.blur(); // evita que Space/Enter reinicien la partida
});

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  commitPendingRecord();
});

nameInput.addEventListener('input', () => {
  if (!pendingRecord) return;
  pendingRecord.entry.name = sanitizeName(nameInput.value);
  renderRecords();
});

resetRecordsBtn.addEventListener('click', () => {
  resetRecordsBtn.blur();
  if (!confirm('¿Borrar todos los récords? Esta acción no se puede deshacer.')) return;
  try {
    localStorage.removeItem(RECORDS_KEY);
  } catch {
    // sin acceso a localStorage: nada que borrar
  }
  lastSavedRank = -1;
  bestComboEl.classList.remove('new-best');
  maxLinesEl.classList.remove('new-best');
  renderRecords();
});

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

setStartLevel(startLevel);
// Pantalla de inicio: tablero vacío y récords hasta pulsar "Jugar"
board = createBoard();
current = null;
gameOver = true;
showOverlay('start');
applyTheme(document.documentElement.dataset.theme);
