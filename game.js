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
// --- Menú de pausa: elementos ---
const pauseMenu = document.getElementById('pause-menu');
const pauseResumeBtn = document.getElementById('pause-resume');
const pauseRestartBtn = document.getElementById('pause-restart');
const pauseControlsBtn = document.getElementById('pause-controls-btn');
const pauseControlsList = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level');

// ---- Records: elementos del DOM ----
const MAX_RECORDS = 5;
const DEFAULT_NAME = 'Jugador';
const startScreen = document.getElementById('start-screen');
const startRecords = document.getElementById('start-records');
const startStats = document.getElementById('start-stats');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const recordsPanel = document.getElementById('records-panel');
const newRecordMsg = document.getElementById('new-record-msg');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const gameoverRecords = document.getElementById('gameover-records');
const gameoverStats = document.getElementById('gameover-stats');

let board, pieceIds, nextPieceId, current, next, score, lines, level, paused, gameOver, settling, settleAccum, lastTime, dropAccum, dropInterval, animId;
let startLevel = 1; // nivel con el que empezó la partida actual (suelo del nivel)

// ---- Records: estado de la partida ----
// combo = piezas consecutivas que eliminan al menos una línea (cascada incluida, una vez por pieza)
let combo = 0, gameBestCombo = 0, pendingRecord = false;

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

function intervalForLevel(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

function clearLines() {
  const cleared = removeFullRows();
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(startLevel, Math.floor(lines / 10) + 1);
    dropInterval = intervalForLevel(level);
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
    combo++;
    gameBestCombo = Math.max(gameBestCombo, combo);
    // la siguiente pieza espera a que termine de caer el sedimento
    current = null;
    settling = true;
    settleAccum = 0;
  } else {
    combo = 0;
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

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  showGameOverRecords();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    closePauseMenu();
    // reinicia el reloj para que la pieza no salte al reanudar
    lastTime = performance.now();
    dropAccum = 0;
    settleAccum = 0;
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    openPauseMenu();
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
  if (pendingRecord) saveName(); // Reiniciar sin pulsar Guardar no pierde el récord
  board = createBoard();
  pieceIds = createBoard();
  nextPieceId = 1;
  score = 0;
  lines = 0;
  startLevel = loadStartLevel();
  level = startLevel;
  paused = false;
  gameOver = false;
  settling = false;
  settleAccum = 0;
  dropInterval = intervalForLevel(level);
  dropAccum = 0;
  combo = 0;
  gameBestCombo = 0;
  pendingRecord = false;
  startScreen.classList.add('hidden');
  recordsPanel.classList.add('is-hidden');
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  closePauseMenu();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return; // escribir el nombre no mueve piezas
  if (isStartScreenVisible()) {
    const onButton = e.target && e.target.tagName === 'BUTTON';
    if (!onButton && (e.code === 'Enter' || e.code === 'NumpadEnter')) { e.preventDefault(); init(); }
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    // Esc sobre el selector solo cierra su desplegable, no el menú
    if (e.code === 'Escape' && paused && document.activeElement === startLevelSelect) return;
    e.preventDefault();
    if (!e.repeat) togglePause(); // mantener la tecla no hace parpadear el menú
    return;
  }
  if (paused) { handlePauseMenuKey(e); return; }
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

restartBtn.addEventListener('click', init);

// --- Menú de pausa ---
const MAX_START_LEVEL = 10;

function loadStartLevel() {
  let v = 1;
  try { v = parseInt(localStorage.getItem('startLevel'), 10); } catch (_) {}
  return v >= 1 && v <= MAX_START_LEVEL ? v : 1;
}

function saveStartLevel(v) {
  try { localStorage.setItem('startLevel', String(v)); } catch (_) {}
}

const PAUSE_ITEMS = [pauseResumeBtn, pauseRestartBtn, pauseControlsBtn, startLevelSelect];

function openPauseMenu() {
  startLevelSelect.value = String(loadStartLevel());
  pauseMenu.classList.remove('hidden');
  pauseResumeBtn.focus();
}

function closePauseMenu() {
  pauseMenu.classList.add('hidden');
  pauseControlsList.classList.add('hidden');
  pauseControlsBtn.textContent = 'Ver controles';
  pauseControlsBtn.setAttribute('aria-expanded', 'false');
  // sin foco en el menú, Space/Enter no reactivan sus botones al volver al juego
  if (PAUSE_ITEMS.includes(document.activeElement)) document.activeElement.blur();
}

// Navegación con teclado dentro del menú; las teclas nunca llegan al juego.
function handlePauseMenuKey(e) {
  const items = PAUSE_ITEMS;
  const idx = items.indexOf(document.activeElement);
  let step = 0;
  if (e.code === 'ArrowDown') step = 1;
  else if (e.code === 'ArrowUp') step = -1;
  else if (e.code === 'Tab') step = e.shiftKey ? -1 : 1;
  else if (document.activeElement === startLevelSelect &&
           (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault();
    const v = Number(startLevelSelect.value) + (e.code === 'ArrowRight' ? 1 : -1);
    if (v >= 1 && v <= MAX_START_LEVEL) {
      startLevelSelect.value = String(v);
      saveStartLevel(v);
    }
    return;
  }
  else if (idx === -1 && (e.code === 'Enter' || e.code === 'Space')) step = 1;
  if (!step) return;
  e.preventDefault();
  const n = items.length;
  // sin foco en el menú: avanzar va al primero, retroceder al último
  items[idx === -1 ? (step > 0 ? 0 : n - 1) : (idx + step + n) % n].focus();
}

for (let i = 1; i <= MAX_START_LEVEL; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = String(i);
  startLevelSelect.appendChild(opt);
}

pauseResumeBtn.addEventListener('click', () => { if (paused) togglePause(); });
pauseRestartBtn.addEventListener('click', init);
pauseControlsBtn.addEventListener('click', () => {
  const show = pauseControlsList.classList.contains('hidden');
  pauseControlsList.classList.toggle('hidden', !show);
  pauseControlsBtn.textContent = show ? 'Ocultar controles' : 'Ver controles';
  pauseControlsBtn.setAttribute('aria-expanded', String(show));
});
startLevelSelect.addEventListener('change', () => saveStartLevel(Number(startLevelSelect.value)));
// --- fin menú de pausa ---

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

// ---- Records: localStorage, tablas y pantalla de inicio ----

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

function loadRecords() {
  const data = loadJSON('records');
  if (!Array.isArray(data)) return [];
  return data
    .filter(r => r && typeof r === 'object' && Number.isFinite(r.score))
    .map(r => ({
      name: String(r.name ?? DEFAULT_NAME).slice(0, 12),
      score: r.score,
      lines: Number(r.lines) || 0,
      level: Number(r.level) || 1,
      date: String(r.date ?? ''),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECORDS);
}

function loadStats() {
  const data = loadJSON('stats');
  const s = data && typeof data === 'object' ? data : {};
  return { bestCombo: Number(s.bestCombo) || 0, maxLines: Number(s.maxLines) || 0 };
}

function qualifiesForRecords(points) {
  const records = loadRecords();
  return points > 0 && (records.length < MAX_RECORDS || points > records[records.length - 1].score);
}

// Inserta la puntuación actual y devuelve su posición (o -1 si no entró)
function addRecord(name) {
  const entry = { name, score, lines, level, date: new Date().toISOString().slice(0, 10) };
  const records = loadRecords();
  records.push(entry);
  records.sort((a, b) => b.score - a.score);
  const top = records.slice(0, MAX_RECORDS);
  saveJSON('records', top);
  return top.indexOf(entry);
}

function renderRecords(table, highlight = -1) {
  const records = loadRecords();
  const rows = [];
  const head = document.createElement('tr');
  for (const h of ['#', 'Nombre', 'Puntos', 'Líneas', 'Nivel']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  rows.push(head);
  if (!records.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'records-empty';
    td.textContent = 'Sin records todavía';
    tr.appendChild(td);
    rows.push(tr);
  }
  records.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === highlight) tr.className = 'record-highlight';
    for (const v of [i + 1, r.name, r.score.toLocaleString(), r.lines, r.level]) {
      const td = document.createElement('td');
      td.textContent = v; // textContent: el nombre nunca se interpreta como HTML
      tr.appendChild(td);
    }
    rows.push(tr);
  });
  table.replaceChildren(...rows);
}

function renderStats(el) {
  const stats = loadStats();
  el.textContent = `Mejor combo: ${stats.bestCombo} · Líneas máx.: ${stats.maxLines}`;
}

function isStartScreenVisible() {
  return !startScreen.classList.contains('hidden');
}

function showStartScreen() {
  renderRecords(startRecords);
  renderStats(startStats);
  startScreen.classList.remove('hidden');
  playBtn.focus();
}

function showGameOverRecords() {
  const stats = loadStats();
  saveJSON('stats', {
    bestCombo: Math.max(stats.bestCombo, gameBestCombo),
    maxLines: Math.max(stats.maxLines, lines),
  });
  pendingRecord = qualifiesForRecords(score);
  newRecordMsg.textContent = pendingRecord ? '¡Nuevo récord! Escribe tu nombre' : '';
  nameForm.classList.toggle('is-hidden', !pendingRecord);
  renderRecords(gameoverRecords);
  renderStats(gameoverStats);
  recordsPanel.classList.remove('is-hidden');
  if (pendingRecord) {
    nameInput.value = DEFAULT_NAME;
    setTimeout(() => {
      if (!pendingRecord) return;
      nameInput.focus();
      nameInput.select();
    }, 400);
  }
}

function saveName() {
  if (!pendingRecord) return;
  pendingRecord = false;
  const name = nameInput.value.trim().slice(0, 12) || DEFAULT_NAME;
  const pos = addRecord(name);
  nameInput.blur();
  nameForm.classList.add('is-hidden');
  newRecordMsg.textContent = pos >= 0 ? `¡Nuevo récord! Puesto #${pos + 1}` : '';
  renderRecords(gameoverRecords, pos);
}

saveNameBtn.addEventListener('click', saveName);
nameInput.addEventListener('keydown', e => {
  if (e.repeat) { e.preventDefault(); return; } // ignora teclas mantenidas desde la partida
  if (e.isComposing) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); saveName(); }
});
playBtn.addEventListener('click', () => { playBtn.blur(); init(); });
resetRecordsBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los records?')) return;
  try {
    localStorage.removeItem('records');
    localStorage.removeItem('stats');
  } catch { /* sin almacenamiento */ }
  renderRecords(startRecords);
  renderStats(startStats);
});

// Antes de la primera partida: tablero vacío y juego detenido hasta pulsar JUGAR
board = createBoard();
pieceIds = createBoard();
current = null;
gameOver = true;
showStartScreen();
applyTheme(document.documentElement.dataset.theme);
