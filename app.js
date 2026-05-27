/* Chess coach: chessboard.js for UI, chess.js for rules, Stockfish (WASM/JS) for analysis. */

const game = new Chess();
let board;
let depth = 12;

const $status = document.getElementById('status');
const $turn = document.getElementById('turn');
const $moves = document.getElementById('moves');
const $engineStatus = document.getElementById('engineStatus');
const $depth = document.getElementById('depth');
const $depthValue = document.getElementById('depthValue');

/* ---------- Stockfish worker ---------- */
/* We fetch the engine script as a blob so we can spawn it as a same-origin Worker. */
let stockfish = null;
let engineReady = false;
const STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';

async function bootEngine() {
  try {
    const res = await fetch(STOCKFISH_URL);
    const code = await res.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    stockfish = new Worker(URL.createObjectURL(blob));
    stockfish.onmessage = onEngineMessage;
    stockfish.postMessage('uci');
    stockfish.postMessage('isready');
  } catch (e) {
    $engineStatus.textContent = 'Engine failed to load — using heuristic commentary only.';
    console.error(e);
  }
}

const pendingAnalyses = []; // queue of { fen, resolve, kind }
let currentAnalysis = null;
let currentInfo = { cp: null, mate: null, bestmove: null, pv: null };

function onEngineMessage(e) {
  const line = typeof e.data === 'string' ? e.data : '';
  if (!line) return;

  if (line === 'uciok') {
    stockfish.postMessage('setoption name Threads value 1');
    stockfish.postMessage('setoption name Hash value 32');
  }
  if (line === 'readyok') {
    if (!engineReady) {
      engineReady = true;
      $engineStatus.textContent = 'Stockfish ready.';
      $engineStatus.classList.add('ready');
      drainQueue();
    }
    return;
  }

  if (line.startsWith('info')) {
    // Parse score cp / score mate, and pv
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)$/);
    if (cpMatch) { currentInfo.cp = parseInt(cpMatch[1], 10); currentInfo.mate = null; }
    if (mateMatch) { currentInfo.mate = parseInt(mateMatch[1], 10); currentInfo.cp = null; }
    if (pvMatch) currentInfo.pv = pvMatch[1].trim().split(/\s+/);
  } else if (line.startsWith('bestmove')) {
    const parts = line.split(/\s+/);
    currentInfo.bestmove = parts[1];
    if (currentAnalysis) {
      currentAnalysis.resolve({ ...currentInfo });
      currentAnalysis = null;
      currentInfo = { cp: null, mate: null, bestmove: null, pv: null };
      drainQueue();
    }
  }
}

function drainQueue() {
  if (currentAnalysis || pendingAnalyses.length === 0 || !engineReady) return;
  currentAnalysis = pendingAnalyses.shift();
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage('position fen ' + currentAnalysis.fen);
  stockfish.postMessage('go depth ' + currentAnalysis.depth);
}

function analyze(fen, d = depth) {
  return new Promise((resolve) => {
    if (!stockfish) { resolve(null); return; }
    pendingAnalyses.push({ fen, depth: d, resolve });
    drainQueue();
  });
}

/* ---------- Board wiring ---------- */
function onDragStart(source, piece) {
  if (game.game_over()) return false;
  // Only allow moving the side whose turn it is (you still control both, just alternating)
  if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
      (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
    return false;
  }
}

function onDrop(source, target) {
  const fenBefore = game.fen();
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  const fenAfter = game.fen();
  appendMovePlaceholder(move);
  analyzeMove(move, fenBefore, fenAfter);
}

function onSnapEnd() {
  board.position(game.fen());
  refreshStatus();
}

function refreshStatus() {
  $turn.textContent = game.turn() === 'w' ? 'White' : 'Black';
  let s = '';
  if (game.in_checkmate()) s = 'Checkmate.';
  else if (game.in_stalemate()) s = 'Stalemate.';
  else if (game.in_draw()) s = 'Draw.';
  else if (game.in_check()) s = 'Check!';
  $status.textContent = s;
}

/* ---------- Commentary ---------- */
function classify(cpLoss, isBest) {
  if (isBest || cpLoss <= 10) return 'best';
  if (cpLoss <= 40) return 'good';
  if (cpLoss <= 90) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
}

function fmtEval(info, sideToMove) {
  if (!info) return '?';
  if (info.mate !== null && info.mate !== undefined) {
    const m = sideToMove === 'w' ? info.mate : -info.mate;
    return (m > 0 ? '#' : '#-') + Math.abs(m);
  }
  if (info.cp === null || info.cp === undefined) return '?';
  const cp = sideToMove === 'w' ? info.cp : -info.cp;
  const pawns = (cp / 100).toFixed(2);
  return (cp >= 0 ? '+' : '') + pawns;
}

function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  const tmp = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length > 4 ? uci[4] : undefined;
  const m = tmp.move({ from, to, promotion: promo });
  return m ? m.san : null;
}

function describeMove(move) {
  const bits = [];
  if (move.flags.includes('k')) bits.push('castles kingside');
  else if (move.flags.includes('q')) bits.push('castles queenside');
  else {
    const pieceName = {
      p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
    }[move.piece];
    if (move.flags.includes('c') || move.flags.includes('e')) {
      const cap = move.captured ? {
        p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen',
      }[move.captured] : 'piece';
      bits.push(`${pieceName} captures ${cap} on ${move.to}`);
    } else {
      bits.push(`${pieceName} to ${move.to}`);
    }
  }
  if (move.promotion) bits.push(`promotes to ${move.promotion.toUpperCase()}`);
  if (move.san.endsWith('#')) bits.push('delivers checkmate');
  else if (move.san.endsWith('+')) bits.push('gives check');
  return bits.join(', ');
}

function buildCommentary(quality, cpLoss, bestSan, evalBeforeStr, evalAfterStr, move) {
  const desc = describeMove(move);
  let lead;
  switch (quality) {
    case 'best':
      lead = `Best move. ${capitalize(desc)}.`;
      break;
    case 'good':
      lead = `Good move. ${capitalize(desc)}.`;
      break;
    case 'inaccuracy':
      lead = `Inaccuracy. ${capitalize(desc)}, but the engine preferred ${bestSan ?? '—'}.`;
      break;
    case 'mistake':
      lead = `Mistake. ${capitalize(desc)} concedes ground; ${bestSan ?? '—'} was stronger.`;
      break;
    case 'blunder':
      lead = `Blunder! ${capitalize(desc)} drops material or the initiative — ${bestSan ?? '—'} was the way.`;
      break;
  }
  const detail = `Eval before: ${evalBeforeStr} → after: ${evalAfterStr}` +
    (cpLoss !== null ? ` (centipawn loss: ${cpLoss})` : '');
  return { lead, detail };
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ---------- Render ---------- */
function appendMovePlaceholder(move) {
  const li = document.createElement('li');
  li.className = 'thinking';
  li.dataset.color = move.color;
  const moveNum = Math.ceil(game.history().length / 2);
  const dots = move.color === 'b' ? '…' : '.';
  li.innerHTML = `
    <div class="move-header">
      <span class="move-num">${moveNum}${dots}</span>
      <span class="move-san">${move.san}</span>
      <span class="verdict" data-slot="verdict">analyzing…</span>
    </div>
    <div class="commentary" data-slot="commentary">Stockfish is thinking…</div>
  `;
  $moves.appendChild(li);
  li.scrollIntoView({ block: 'end' });
  refreshStatus();
}

function updateLastMoveCard(verdict, lead, detail) {
  const li = $moves.lastElementChild;
  if (!li) return;
  li.classList.remove('thinking');
  const v = li.querySelector('[data-slot="verdict"]');
  const c = li.querySelector('[data-slot="commentary"]');
  v.textContent = verdict;
  v.className = 'verdict ' + verdict;
  c.innerHTML = `${lead}<div class="detail">${detail}</div>`;
}

/* ---------- Analyze a played move ---------- */
async function analyzeMove(move, fenBefore, fenAfter) {
  $engineStatus.textContent = 'Stockfish thinking…';
  $engineStatus.classList.add('thinking');

  const before = await analyze(fenBefore, depth);
  const after  = await analyze(fenAfter,  depth);

  $engineStatus.classList.remove('thinking');
  $engineStatus.textContent = 'Stockfish ready.';

  if (!before || !after) {
    updateLastMoveCard('book', `${capitalize(describeMove(move))}.`, 'Engine unavailable.');
    return;
  }

  const sideToMove = move.color; // 'w' or 'b' — the side that just moved
  // Stockfish reports score from the perspective of the side TO MOVE in the analyzed FEN.
  // before: side to move was `sideToMove`. after: side to move is the opponent.
  // Convert both to centipawns from `sideToMove`'s perspective.
  const toCp = (info, sign) => {
    if (info.mate !== null && info.mate !== undefined) {
      // big magnitude with correct sign
      return sign * (info.mate > 0 ? 100000 - info.mate : -100000 - info.mate);
    }
    return info.cp === null || info.cp === undefined ? null : sign * info.cp;
  };
  const cpBefore = toCp(before, +1);  // already from sideToMove perspective
  const cpAfter  = toCp(after,  -1);  // flip because side-to-move flipped
  const cpLoss = (cpBefore !== null && cpAfter !== null)
    ? Math.max(0, Math.round(cpBefore - cpAfter))
    : null;

  const bestUci = before.bestmove;
  const bestSan = bestUci ? uciToSan(fenBefore, bestUci) : null;
  const isBest = bestSan && bestSan === move.san;

  const quality = classify(cpLoss ?? 0, isBest);

  const evalBeforeStr = fmtEval(before, sideToMove);
  // For "after", we want eval from white's frame consistently — use side-to-move at fenAfter (opponent), then flip
  const evalAfterStr = fmtEval(after, sideToMove === 'w' ? 'b' : 'w'); // raw from after's side
  // Flip sign for display from same perspective
  const evalAfterFromMoverPerspective = (function () {
    if (after.mate !== null && after.mate !== undefined) {
      const m = -after.mate; // opponent will deliver mate in n => mover gets mated in n
      return (m > 0 ? '#' : '#-') + Math.abs(m);
    }
    if (after.cp === null || after.cp === undefined) return '?';
    const cp = -after.cp;
    return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
  })();

  const { lead, detail } = buildCommentary(
    quality, cpLoss, bestSan,
    evalBeforeStr,
    evalAfterFromMoverPerspective,
    move
  );
  updateLastMoveCard(quality, lead, detail);
}

/* ---------- Buttons & init ---------- */
document.getElementById('undo').addEventListener('click', () => {
  if (game.history().length === 0) return;
  game.undo();
  board.position(game.fen());
  const last = $moves.lastElementChild;
  if (last) last.remove();
  refreshStatus();
});

document.getElementById('reset').addEventListener('click', () => {
  game.reset();
  board.start();
  $moves.innerHTML = '';
  refreshStatus();
});

document.getElementById('flip').addEventListener('click', () => board.flip());

$depth.addEventListener('input', () => {
  depth = parseInt($depth.value, 10);
  $depthValue.textContent = depth;
});

board = Chessboard('board', {
  draggable: true,
  position: 'start',
  pieceTheme: 'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/website/img/chesspieces/wikipedia/{piece}.png',
  onDragStart,
  onDrop,
  onSnapEnd,
});

window.addEventListener('resize', () => board.resize());
refreshStatus();
bootEngine();
