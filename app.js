/* ─────────────────────────────────────────────
   Chess Coach — app.js
   chess.js  → move rules & validation
   chessboard.js → board UI
   Stockfish 10 (JS) → loaded as blob Worker
   ───────────────────────────────────────────── */

'use strict';

// ── Game state ──────────────────────────────
const game  = new Chess();
let   board = null;
let   depth = 12;

// ── DOM refs ─────────────────────────────────
const $engineBadge  = document.getElementById('engineBadge');
const $engineLabel  = document.getElementById('engineLabel');
const $turnIndicator = document.getElementById('turnIndicator');
const $turnDot      = $turnIndicator.querySelector('.turn-dot');
const $turnLabel    = document.getElementById('turnLabel');
const $gameStatus   = document.getElementById('gameStatus');
const $feed         = document.getElementById('feed');
const $feedEmpty    = document.getElementById('feedEmpty');
const $moveCount    = document.getElementById('moveCount');
const $depthSlider  = document.getElementById('depthSlider');
const $depthVal     = document.getElementById('depthVal');

// ── Stockfish engine ─────────────────────────
const SF_URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
let   sfWorker       = null;
let   engineReady    = false;

const analysisQueue  = [];   // { fen, depth, resolve }
let   activeJob      = null;
let   latestInfo     = newInfo();

function newInfo() {
  return { cp: null, mate: null, bestmove: null, pv: null };
}

async function bootEngine() {
  try {
    const res  = await fetch(SF_URL);
    const code = await res.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    sfWorker   = new Worker(URL.createObjectURL(blob));
    sfWorker.onmessage = onEngineMsg;
    sfWorker.postMessage('uci');
    sfWorker.postMessage('isready');
  } catch (e) {
    $engineLabel.textContent = 'Engine unavailable';
    console.error('Stockfish load error:', e);
  }
}

function onEngineMsg(e) {
  const line = typeof e.data === 'string' ? e.data : '';
  if (!line) return;

  if (line === 'readyok') {
    if (!engineReady) {
      engineReady = true;
      $engineLabel.textContent = 'Stockfish ready';
      $engineBadge.classList.add('ready');
      flushQueue();
    }
    return;
  }

  if (line.startsWith('info')) {
    const cpM    = line.match(/score cp (-?\d+)/);
    const mateM  = line.match(/score mate (-?\d+)/);
    const pvM    = line.match(/ pv ([a-h][1-8][a-h][1-8]\S*)/);
    if (cpM)   { latestInfo.cp   = parseInt(cpM[1], 10); latestInfo.mate = null; }
    if (mateM) { latestInfo.mate = parseInt(mateM[1], 10); latestInfo.cp  = null; }
    if (pvM)   { latestInfo.pv   = pvM[1].split(/\s+/); }
  }

  if (line.startsWith('bestmove')) {
    latestInfo.bestmove = line.split(/\s+/)[1] ?? null;
    if (activeJob) {
      activeJob.resolve({ ...latestInfo });
      activeJob   = null;
      latestInfo  = newInfo();
      flushQueue();
    }
  }
}

function flushQueue() {
  if (activeJob || analysisQueue.length === 0 || !engineReady) return;
  activeJob = analysisQueue.shift();
  sfWorker.postMessage('ucinewgame');
  sfWorker.postMessage('position fen ' + activeJob.fen);
  sfWorker.postMessage('go depth '    + activeJob.depth);
}

function analyze(fen) {
  return new Promise(resolve => {
    if (!sfWorker) { resolve(null); return; }
    analysisQueue.push({ fen, depth, resolve });
    flushQueue();
  });
}

// ── Board wiring ─────────────────────────────
function onDragStart(source, piece) {
  if (game.game_over()) return false;
  const isWhite = piece.startsWith('w');
  if ((game.turn() === 'w' && !isWhite) || (game.turn() === 'b' && isWhite)) return false;
}

function onDrop(source, target) {
  const fenBefore = game.fen();
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';

  const fenAfter = game.fen();
  spawnCard(move);
  runAnalysis(move, fenBefore, fenAfter);
}

function onSnapEnd() {
  board.position(game.fen());
  refreshStatus();
}

function refreshStatus() {
  const isWhite = game.turn() === 'w';
  $turnDot.className  = 'turn-dot ' + (isWhite ? 'white' : 'black');
  $turnLabel.textContent = isWhite ? 'White to move' : 'Black to move';

  let s = '';
  if      (game.in_checkmate()) s = 'Checkmate';
  else if (game.in_stalemate()) s = 'Stalemate';
  else if (game.in_draw())      s = 'Draw';
  else if (game.in_check())     s = 'Check';
  $gameStatus.textContent = s;

  const n = game.history().length;
  $moveCount.textContent = n + (n === 1 ? ' move' : ' moves');
}

// ── Commentary card ───────────────────────────
function spawnCard(move) {
  $feedEmpty && ($feedEmpty.style.display = 'none');

  const hist = game.history();
  const total = hist.length;
  const moveNo = Math.ceil(total / 2);
  const side   = move.color === 'w' ? '' : '…';

  const card = document.createElement('div');
  card.className = 'card thinking';
  card.dataset.moveIdx = total - 1;

  card.innerHTML = `
    <div class="card-top">
      <span class="card-num">${moveNo}${side}</span>
      <span class="card-san">${move.san}</span>
      <span class="card-symbol" data-slot="symbol">⏳</span>
      <span class="card-verdict" data-slot="verdict"><span class="thinking-dots"></span></span>
    </div>
    <div class="card-body">
      <div data-slot="comment" class="thinking-dots"></div>
    </div>
    <div class="card-eval" data-slot="eval" style="display:none"></div>
  `;

  $feed.appendChild(card);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return card;
}

function fillCard(card, { quality, symbol, verdict, comment, suggest,
                          evalBefore, evalAfter, cpLoss, bestSan }) {
  card.className = 'card ' + quality;
  card.querySelector('[data-slot="symbol"]').textContent  = symbol;
  card.querySelector('[data-slot="verdict"]').textContent = verdict;

  const commentEl = card.querySelector('[data-slot="comment"]');
  commentEl.textContent = comment;
  if (suggest) {
    const s = document.createElement('div');
    s.className = 'suggest';
    s.innerHTML = 'Engine preferred <code>' + suggest + '</code>';
    commentEl.after(s);
  }

  // Eval row
  if (evalBefore !== null || evalAfter !== null) {
    const evalEl = card.querySelector('[data-slot="eval"]');
    evalEl.style.display = 'flex';

    const fmt = (v) => {
      if (v === null) return { txt: '?', cls: '' };
      if (typeof v === 'string') return { txt: v, cls: '' };
      const txt = (v >= 0 ? '+' : '') + (v / 100).toFixed(2);
      return { txt, cls: v >= 0 ? 'positive' : 'negative' };
    };

    const before = fmt(evalBefore);
    const after  = fmt(evalAfter);
    const loss   = cpLoss !== null ? `${cpLoss} cp loss` : '';

    evalEl.innerHTML = `
      <span class="eval-chip ${before.cls}">${before.txt}</span>
      <span class="eval-arrow">→</span>
      <span class="eval-chip ${after.cls}">${after.txt}</span>
      ${loss ? `<span class="eval-loss">${loss}</span>` : ''}
    `;
  }
}

// ── Analysis logic ────────────────────────────
async function runAnalysis(move, fenBefore, fenAfter) {
  const card = $feed.lastElementChild;

  $engineBadge.className = 'engine-badge thinking';
  $engineLabel.textContent = 'Analysing…';

  const [infoBefore, infoAfter] = await Promise.all([
    analyze(fenBefore),
    analyze(fenAfter),
  ]);

  $engineBadge.className = 'engine-badge ready';
  $engineLabel.textContent = 'Stockfish ready';

  if (!infoBefore || !infoAfter) {
    fillCard(card, {
      quality: 'good', symbol: '?', verdict: 'Unknown',
      comment: describeMove(move) + '.',
      suggest: null, evalBefore: null, evalAfter: null, cpLoss: null, bestSan: null,
    });
    return;
  }

  // Centipawn from the MOVING side's perspective:
  //   infoBefore.cp is from side-to-move perspective at fenBefore → that IS the mover
  //   infoAfter.cp is from side-to-move at fenAfter → that's the OPPONENT → negate
  const cpBefore = toCp(infoBefore, +1);
  const cpAfter  = toCp(infoAfter,  -1);

  const cpLoss = (cpBefore !== null && cpAfter !== null)
    ? Math.max(0, Math.round(cpBefore - cpAfter))
    : null;

  const bestUci = infoBefore.bestmove;
  const bestSan = bestUci ? uciToSan(fenBefore, bestUci) : null;
  const isBest  = !!bestSan && bestSan === move.san;

  const quality = classifyMove(cpLoss, isBest);
  const { symbol, verdict } = QUALITY_META[quality];

  const comment = buildComment(quality, move, game, cpLoss);
  const suggest = (!isBest && quality !== 'best' && bestSan) ? bestSan : null;

  // Display evals from white's perspective for consistency
  const evalFromWhite = (info, sideToMove) => {
    if (info.mate !== null && info.mate !== undefined) {
      const m = sideToMove === 'w' ? info.mate : -info.mate;
      return (m > 0 ? 'M' : '-M') + Math.abs(m);
    }
    if (info.cp === null) return null;
    return sideToMove === 'w' ? info.cp : -info.cp;
  };

  const evalBefore = evalFromWhite(infoBefore, move.color);
  // fenAfter's side-to-move is the opponent
  const evalAfter  = evalFromWhite(infoAfter, move.color === 'w' ? 'b' : 'w');
  // negate because infoAfter reports from the opponent's perspective
  const evalAfterAdjusted = typeof evalAfter === 'number' ? -evalAfter : evalAfter;

  fillCard(card, { quality, symbol, verdict, comment, suggest,
                   evalBefore, evalAfter: evalAfterAdjusted,
                   cpLoss: quality !== 'best' ? cpLoss : null,
                   bestSan });
}

// ── Helpers ──────────────────────────────────
function toCp(info, sign) {
  if (!info) return null;
  if (info.mate !== null && info.mate !== undefined) {
    return sign * (info.mate > 0 ? 100000 - info.mate : -100000 - info.mate);
  }
  return (info.cp !== null && info.cp !== undefined) ? sign * info.cp : null;
}

function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  try {
    const tmp  = new Chess(fen);
    const move = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4),
                             promotion: uci[4] ?? undefined });
    return move ? move.san : null;
  } catch { return null; }
}

function classifyMove(cpLoss, isBest) {
  if (isBest || (cpLoss !== null && cpLoss <= 10)) return 'best';
  if (cpLoss !== null && cpLoss <= 40)  return 'good';
  if (cpLoss !== null && cpLoss <= 90)  return 'inaccuracy';
  if (cpLoss !== null && cpLoss <= 200) return 'mistake';
  return 'blunder';
}

const QUALITY_META = {
  best:       { symbol: '!!', verdict: 'Best move' },
  good:       { symbol: '!',  verdict: 'Good'       },
  inaccuracy: { symbol: '?!', verdict: 'Inaccuracy' },
  mistake:    { symbol: '?',  verdict: 'Mistake'    },
  blunder:    { symbol: '??', verdict: 'Blunder'    },
};

// ── Rich commentary text ──────────────────────
const CENTER_SQUARES = ['d4','d5','e4','e5'];
const CENTER_REGION  = ['c3','c4','c5','c6','d3','d4','d5','d6','e3','e4','e5','e6','f3','f4','f5','f6'];

function describeMove(move) {
  const pieceName = {
    p:'Pawn', n:'Knight', b:'Bishop', r:'Rook', q:'Queen', k:'King'
  }[move.piece] ?? 'Piece';

  if (move.flags.includes('k')) return 'castles kingside, safeguarding the king';
  if (move.flags.includes('q')) return 'castles queenside, centralizing the rook';
  if (move.san.endsWith('#'))   return `${pieceName} delivers checkmate on ${move.to}`;

  const parts = [];
  if (move.flags.includes('c') || move.flags.includes('e')) {
    const cap = { p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen' }[move.captured ?? ''] ?? 'piece';
    parts.push(`${pieceName} captures the ${cap} on ${move.to}`);
  } else {
    parts.push(`${pieceName} moves to ${move.to}`);
  }

  if (move.san.includes('+')) parts.push('giving check');
  if (move.promotion)         parts.push(`promoting to ${move.promotion.toUpperCase()}`);

  return parts.join(', ');
}

function buildComment(quality, move, gameAfter, cpLoss) {
  const movePiece = { p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king' }[move.piece];
  const isOpening = gameAfter.history().length <= 20;
  const isCapture = !!(move.flags.includes('c') || move.flags.includes('e'));
  const isCheck   = move.san.includes('+');
  const isMate    = move.san.includes('#');
  const isCastle  = move.flags.includes('k') || move.flags.includes('q');
  const toCenter  = CENTER_SQUARES.includes(move.to);
  const toCentral = CENTER_REGION.includes(move.to);

  // Opening heuristics
  const developingPiece = isOpening && (move.piece === 'n' || move.piece === 'b') &&
    ((move.color === 'w' && move.from[1] === '1') || (move.color === 'b' && move.from[1] === '8'));

  if (isMate) return 'Checkmate delivered. The game is over.';

  if (quality === 'best' || quality === 'good') {
    if (isCastle) {
      return move.flags.includes('k')
        ? 'Kingside castling tucks the king to safety behind the f/g/h pawns and connects the rooks — a textbook priority.'
        : 'Queenside castling activates the rook on d1/d8 immediately and keeps the king somewhat protected behind a pawn chain.';
    }
    if (isCapture && move.captured === 'q') return 'Winning the queen is a decisive material gain. The rest is technique.';
    if (isCapture) {
      const cap = { p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen' }[move.captured ?? ''] ?? 'piece';
      return `Capturing the ${cap} is the correct recapture sequence here, maintaining material balance and leaving no loose pieces.`;
    }
    if (developingPiece && toCentral) {
      return `Developing the ${movePiece} to a central or active square. In the opening, piece development and center control are the top priorities.`;
    }
    if (toCenter) return `Occupying the center with the ${movePiece}. Central pawns and pieces cramp the opponent and create space for an attack.`;
    if (isCheck) return `The check forces the opponent to react, gaining a tempo and potentially disrupting their structure.`;
    if (move.piece === 'r' || move.piece === 'q') {
      return `Activating the ${movePiece} on an open file or key rank — the heavy pieces belong in the game, not sitting idle.`;
    }
    return `${describeMove(move)} — a principled move that improves piece coordination and leaves no weaknesses.`;
  }

  if (quality === 'inaccuracy') {
    if (isCapture) {
      return `The capture isn't wrong, but it may release central tension prematurely or hand the opponent a more active recapture.`;
    }
    if (developingPiece) {
      return `Developing the ${movePiece}, but to a less optimal square. Pieces generally want to reach squares where they control the most area.`;
    }
    return `A reasonable move, but it slightly loosens the position or lets the opponent seize the initiative. ${cpLoss !== null ? `About ${cpLoss} centipawns below the best option.` : ''}`;
  }

  if (quality === 'mistake') {
    if (isCapture) {
      return `The capture looks tempting but likely creates a structural weakness or allows a counter-tactic the opponent can exploit.`;
    }
    return `This move hands the opponent a concrete advantage — either through a tactical sequence, a material imbalance, or a positional concession. (${cpLoss ?? '?'} cp loss)`;
  }

  // blunder
  if (isCapture) {
    return `Captures here are met by a strong counter-tactic — the material is poisoned. Stockfish sees immediate punishment. (${cpLoss ?? '?'} cp loss)`;
  }
  return `A serious error that likely drops material or allows a decisive tactical blow. Double-check for loose pieces, back-rank threats, and forks before moving. (${cpLoss ?? '?'} cp loss)`;
}

// ── Controls ─────────────────────────────────
document.getElementById('undoBtn').addEventListener('click', () => {
  if (!game.history().length) return;
  game.undo();
  board.position(game.fen());
  $feed.lastElementChild?.remove();
  if (!game.history().length && $feedEmpty) $feedEmpty.style.display = '';
  refreshStatus();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  game.reset();
  board.start();
  $feed.innerHTML = '';
  if ($feedEmpty) { $feed.appendChild($feedEmpty); $feedEmpty.style.display = ''; }
  refreshStatus();
});

document.getElementById('flipBtn').addEventListener('click', () => board.flip());

$depthSlider.addEventListener('input', () => {
  depth = parseInt($depthSlider.value, 10);
  $depthVal.textContent = depth;
});

// ── Init ─────────────────────────────────────
board = Chessboard('board', {
  draggable: true,
  position:  'start',
  pieceTheme: 'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/website/img/chesspieces/wikipedia/{piece}.png',
  onDragStart,
  onDrop,
  onSnapEnd,
});

window.addEventListener('resize', () => board.resize());
refreshStatus();
bootEngine();
