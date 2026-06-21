/*
 * Quoridor AI opponent.
 *
 * Uses negamax search with alpha-beta pruning. The position is evaluated by
 * comparing each player's shortest path to goal (BFS). To keep the branching
 * factor tractable in the browser, candidate wall placements are restricted to
 * walls that actually interfere with the opponent's current shortest path or
 * sit next to a pawn, rather than all ~128 legal walls.
 *
 * Difficulty tiers:
 *   easy   - depth 1, frequent random moves, light wall use   (clearly beatable)
 *   medium - depth 2, occasional random move
 *   hard   - depth 3, no randomness, plays the search out
 */

const WIN_SCORE = 100000;

const DIFFICULTY = {
  easy: { depth: 1, randomness: 0.45, useWalls: true },
  medium: { depth: 2, randomness: 0.12, useWalls: true },
  hard: { depth: 3, randomness: 0.0, useWalls: true },
  // Expert searches as deep as it can within a time budget (iterative
  // deepening) and never blunders. Quoridor is not a solved game, so this is
  // the strongest practical setting rather than provably perfect play.
  expert: { iterative: true, randomness: 0.0, useWalls: true, timeBudget: 2000, maxDepth: 7 },
};

// Cooperative timeout for iterative deepening: negamax throws TIMEOUT once the
// deadline passes, aborting the in-progress (deeper) search.
const TIMEOUT = { timeout: true };
let searchDeadline = Infinity;

// Evaluation from the perspective of the side to move.
function evaluate(game) {
  const me = game.current;
  const opp = 1 - me;
  const myDist = game.shortestPath(me).dist;
  const oppDist = game.shortestPath(opp).dist;

  if (myDist === 0) return WIN_SCORE;
  if (oppDist === 0) return -WIN_SCORE;

  const wallDiff = game.players[me].wallsLeft - game.players[opp].wallsLeft;
  return (oppDist - myDist) + 0.2 * wallDiff;
}

// Anchor key helpers for deduping candidate walls.
function addBlockingAnchors(a, b, set) {
  const [r1, c1] = a;
  const [r2, c2] = b;
  if (r1 === r2) {
    // horizontal step -> a vertical wall blocks it
    const cc = Math.min(c1, c2);
    set.add('V,' + r1 + ',' + cc);
    set.add('V,' + (r1 - 1) + ',' + cc);
  } else {
    // vertical step -> a horizontal wall blocks it
    const rr = Math.min(r1, r2);
    set.add('H,' + rr + ',' + c1);
    set.add('H,' + rr + ',' + (c1 - 1));
  }
}

function addNearbyAnchors(pawn, set) {
  for (let dr = -1; dr <= 0; dr++) {
    for (let dc = -1; dc <= 0; dc++) {
      const r = pawn.row + dr;
      const c = pawn.col + dc;
      set.add('H,' + r + ',' + c);
      set.add('V,' + r + ',' + c);
    }
  }
}

// Generate candidate moves for the side to move.
function getCandidateMoves(game, useWalls) {
  const moves = [];

  // Pawn moves, ordered most-advancing-first (cheap proxy: rows from goal) so
  // pruning sees the strongest move early without a BFS per move.
  const me = game.current;
  const goalRow = game.players[me].goalRow;
  const pawnMoves = game.getPawnMoves(me).map(([row, col]) => ({
    move: { type: 'move', row, col },
    key: Math.abs(row - goalRow),
  }));
  pawnMoves.sort((x, y) => x.key - y.key);
  for (const pm of pawnMoves) moves.push(pm.move);

  if (useWalls && game.players[me].wallsLeft > 0) {
    const opp = 1 - me;
    const anchors = new Set();

    const path = game.shortestPath(opp).path;
    if (path) {
      for (let i = 0; i < path.length - 1; i++) {
        addBlockingAnchors(path[i], path[i + 1], anchors);
      }
    }
    addNearbyAnchors(game.players[opp], anchors);
    addNearbyAnchors(game.players[me], anchors);

    const oppPawn = game.players[opp];
    const wallMoves = [];
    for (const key of anchors) {
      const [o, rs, cs] = key.split(',');
      const r = parseInt(rs, 10);
      const c = parseInt(cs, 10);
      if (o === 'H' && game.canPlaceHWall(r, c)) {
        wallMoves.push({ type: 'wallH', r, c });
      } else if (o === 'V' && game.canPlaceVWall(r, c)) {
        wallMoves.push({ type: 'wallV', r, c });
      }
    }
    // Order walls by proximity to opponent pawn (more disruptive first).
    wallMoves.sort((x, y) => {
      const dx = Math.abs(x.r - oppPawn.row) + Math.abs(x.c - oppPawn.col);
      const dy = Math.abs(y.r - oppPawn.row) + Math.abs(y.c - oppPawn.col);
      return dx - dy;
    });
    for (const wm of wallMoves) moves.push(wm);
  }

  return moves;
}

function negamax(game, depth, alpha, beta, useWalls, ply) {
  if (Date.now() > searchDeadline) throw TIMEOUT;
  const winner = game.getWinner();
  if (winner !== -1) {
    // The player who just moved won, i.e. NOT the side to move. Subtract `ply`
    // so that wins reached sooner score higher (and losses are delayed) — this
    // makes the AI go for the win immediately instead of dithering when several
    // lines all eventually win.
    return -(WIN_SCORE - ply);
  }
  if (depth === 0) {
    return evaluate(game);
  }

  let best = -Infinity;
  const moves = getCandidateMoves(game, useWalls);
  for (const move of moves) {
    const child = game.apply(move);
    const val = -negamax(child, depth - 1, -beta, -alpha, useWalls, ply + 1);
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

function sameMove(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  return a.type === 'move' ? a.row === b.row && a.col === b.col : a.r === b.r && a.c === b.c;
}

// One full-depth alpha-beta search at the root, returning the best move and its
// value. Candidates are already ordered toward progress (most-advancing pawn
// move first), so the first move achieving the best score is also the most
// forward-progressing one — no separate tie-break needed. `preferredMove` (the
// best move from the previous iteration) is searched first to sharpen pruning.
function rootSearchAB(game, depth, useWalls, preferredMove) {
  let moves = getCandidateMoves(game, useWalls);
  if (preferredMove) {
    moves = [preferredMove, ...moves.filter((m) => !sameMove(m, preferredMove))];
  }
  let bestVal = -Infinity;
  let bestMove = moves[0];
  let alpha = -Infinity;
  for (const move of moves) {
    const val = -negamax(game.apply(move), depth - 1, -Infinity, -alpha, useWalls, 1);
    if (val > bestVal) {
      bestVal = val;
      bestMove = move;
    }
    if (val > alpha) alpha = val;
  }
  return { move: bestMove, val: bestVal };
}

// Iterative deepening within a time budget: search depth 1, 2, 3, … keeping the
// best move from the deepest fully-completed iteration. Used by Expert.
function chooseIterative(game, cfg) {
  searchDeadline = Date.now() + cfg.timeBudget;
  try {
    let best = rootSearchAB(game, 1, cfg.useWalls, null);
    for (let d = 2; d <= cfg.maxDepth; d++) {
      try {
        best = rootSearchAB(game, d, cfg.useWalls, best.move);
      } catch (e) {
        if (e === TIMEOUT) break;
        throw e;
      }
      // Stop early once a forced win/loss is proven — deeper won't change it.
      if (Math.abs(best.val) >= WIN_SCORE - 1000) break;
      if (Date.now() >= searchDeadline) break;
    }
    return best.move;
  } finally {
    searchDeadline = Infinity;
  }
}

// Public: choose a move for the side to move at the given difficulty.
function chooseMove(game, difficulty) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const moves = getCandidateMoves(game, cfg.useWalls);
  if (moves.length === 0) return null;

  if (cfg.iterative) return chooseIterative(game, cfg);

  // Occasionally play a random move (mostly a pawn move) to look beatable.
  if (Math.random() < cfg.randomness) {
    const pawnOnly = moves.filter((m) => m.type === 'move');
    const pool = pawnOnly.length && Math.random() < 0.8 ? pawnOnly : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const me = game.current;
  let bestVal = -Infinity;
  let bestMoves = [];
  // Use a tiny epsilon for float comparisons (the eval has fractional terms).
  const EPS = 1e-9;
  for (const move of moves) {
    const child = game.apply(move);
    // Full window each time (no shared alpha) so ties are detected correctly.
    const val = -negamax(child, cfg.depth - 1, -Infinity, Infinity, cfg.useWalls, 1);
    if (val > bestVal + EPS) {
      bestVal = val;
      bestMoves = [move];
    } else if (val >= bestVal - EPS) {
      bestMoves.push(move);
    }
  }

  // Tie-break toward progress: among equally-rated moves prefer the one that
  // leaves us closest to our own goal (so we never dither sideways/backward or
  // waste a turn on a pointless wall when advancing is just as good).
  let pick = bestMoves;
  let minDist = Infinity;
  const byProgress = [];
  for (const move of bestMoves) {
    const d = game.apply(move).shortestPath(me).dist;
    if (d < minDist - EPS) {
      minDist = d;
      byProgress.length = 0;
      byProgress.push(move);
    } else if (d <= minDist + EPS) {
      byProgress.push(move);
    }
  }
  if (byProgress.length) pick = byProgress;

  return pick[Math.floor(Math.random() * pick.length)];
}

window.QuoridorAI = { chooseMove, DIFFICULTY };
