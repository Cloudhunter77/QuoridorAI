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
};

// Evaluation from the perspective of the side to move.
function evaluate(game) {
  const me = game.current;
  const opp = 1 - me;
  const myDist = game.shortestPath(me).dist;
  const oppDist = game.shortestPath(opp).dist;

  if (myDist === 0) return WIN_SCORE;
  if (oppDist === 0) return -WIN_SCORE;

  const wallDiff = game.players[me].wallsLeft - game.players[opp].wallsLeft;
  return (oppDist - myDist) + 0.1 * wallDiff;
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

  // Pawn moves, ordered by resulting own distance (best first for pruning).
  const me = game.current;
  const pawnMoves = game.getPawnMoves(me).map(([row, col]) => {
    const child = game.apply({ type: 'move', row, col });
    return { move: { type: 'move', row, col }, dist: child.shortestPath(me).dist };
  });
  pawnMoves.sort((x, y) => x.dist - y.dist);
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

function negamax(game, depth, alpha, beta, useWalls) {
  const winner = game.getWinner();
  if (winner !== -1) {
    // The player who just moved won, i.e. NOT the side to move.
    return -WIN_SCORE;
  }
  if (depth === 0) {
    return evaluate(game);
  }

  let best = -Infinity;
  const moves = getCandidateMoves(game, useWalls);
  for (const move of moves) {
    const child = game.apply(move);
    const val = -negamax(child, depth - 1, -beta, -alpha, useWalls);
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

// Public: choose a move for the side to move at the given difficulty.
function chooseMove(game, difficulty) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const moves = getCandidateMoves(game, cfg.useWalls);
  if (moves.length === 0) return null;

  // Occasionally play a random move (mostly a pawn move) to look beatable.
  if (Math.random() < cfg.randomness) {
    const pawnOnly = moves.filter((m) => m.type === 'move');
    const pool = pawnOnly.length && Math.random() < 0.8 ? pawnOnly : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  let bestVal = -Infinity;
  let bestMoves = [];
  let alpha = -Infinity;
  const beta = Infinity;
  for (const move of moves) {
    const child = game.apply(move);
    const val = -negamax(child, cfg.depth - 1, -beta, -alpha, cfg.useWalls);
    if (val > bestVal) {
      bestVal = val;
      bestMoves = [move];
    } else if (val === bestVal) {
      bestMoves.push(move);
    }
    if (val > alpha) alpha = val;
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

window.QuoridorAI = { chooseMove, DIFFICULTY };
