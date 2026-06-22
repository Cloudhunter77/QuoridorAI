/*
 * Quoridor game engine: board state, rules, move generation and validation.
 *
 * Board: 9x9 grid of cells, indexed [row][col] with row/col in 0..8.
 *   - Player 0 (human) starts bottom-center (row 8, col 4), goal row 0.
 *   - Player 1 (AI)    starts top-center    (row 0, col 4), goal row 8.
 *
 * Walls: anchored on the 8x8 grid of interior intersections (r,c in 0..7).
 *   - Horizontal wall anchored (r,c) lies on the line between cell-rows r and
 *     r+1, spanning columns c and c+1.
 *   - Vertical wall anchored (r,c) lies on the line between cell-cols c and
 *     c+1, spanning rows r and r+1.
 */

const BOARD_SIZE = 9;
const WALLS_PER_PLAYER = 10;

const DIRECTIONS = [
  [-1, 0], // up
  [1, 0],  // down
  [0, -1], // left
  [0, 1],  // right
];

function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

class QuoridorGame {
  constructor() {
    // 8x8 boolean matrices of wall anchors.
    this.hWalls = QuoridorGame._emptyWallGrid();
    this.vWalls = QuoridorGame._emptyWallGrid();

    this.players = [
      { row: 8, col: 4, goalRow: 0, wallsLeft: WALLS_PER_PLAYER }, // human
      { row: 0, col: 4, goalRow: 8, wallsLeft: WALLS_PER_PLAYER }, // AI
    ];

    this.current = 0; // index of player to move
  }

  static _emptyWallGrid() {
    const g = [];
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
      g.push(new Array(BOARD_SIZE - 1).fill(false));
    }
    return g;
  }

  clone() {
    const g = Object.create(QuoridorGame.prototype);
    g.hWalls = this.hWalls.map((row) => row.slice());
    g.vWalls = this.vWalls.map((row) => row.slice());
    g.players = this.players.map((p) => ({ ...p }));
    g.current = this.current;
    return g;
  }

  // --- Wall lookups (bounds-safe) ---------------------------------------

  _hWall(r, c) {
    return r >= 0 && r < BOARD_SIZE - 1 && c >= 0 && c < BOARD_SIZE - 1 && this.hWalls[r][c];
  }

  _vWall(r, c) {
    return r >= 0 && r < BOARD_SIZE - 1 && c >= 0 && c < BOARD_SIZE - 1 && this.vWalls[r][c];
  }

  // Is movement from (r,c) one step in direction (dr,dc) blocked by a wall?
  // Assumes the target cell is in bounds.
  isBlocked(r, c, dr, dc) {
    if (dr === 0 && dc === 1) {
      // right: vertical wall on column boundary c
      return this._vWall(r, c) || this._vWall(r - 1, c);
    }
    if (dr === 0 && dc === -1) {
      // left
      return this._vWall(r, c - 1) || this._vWall(r - 1, c - 1);
    }
    if (dr === 1 && dc === 0) {
      // down: horizontal wall on row boundary r
      return this._hWall(r, c) || this._hWall(r, c - 1);
    }
    if (dr === -1 && dc === 0) {
      // up
      return this._hWall(r - 1, c) || this._hWall(r - 1, c - 1);
    }
    return false;
  }

  // --- Pawn movement ----------------------------------------------------

  // Legal pawn destinations for a player, including jumps over the opponent.
  getPawnMoves(idx) {
    const me = this.players[idx];
    const opp = this.players[1 - idx];
    const moves = [];

    for (const [dr, dc] of DIRECTIONS) {
      const nr = me.row + dr;
      const nc = me.col + dc;
      if (!inBounds(nr, nc)) continue;
      if (this.isBlocked(me.row, me.col, dr, dc)) continue;

      if (nr === opp.row && nc === opp.col) {
        // Opponent is adjacent: attempt to jump.
        const jr = nr + dr;
        const jc = nc + dc;
        if (inBounds(jr, jc) && !this.isBlocked(nr, nc, dr, dc)) {
          moves.push([jr, jc]); // straight jump
        } else {
          // Blocked behind opponent -> diagonal jumps.
          const perps = dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
          for (const [pr, pc] of perps) {
            const dr2 = nr + pr;
            const dc2 = nc + pc;
            if (inBounds(dr2, dc2) && !this.isBlocked(nr, nc, pr, pc)) {
              moves.push([dr2, dc2]);
            }
          }
        }
      } else {
        moves.push([nr, nc]);
      }
    }
    return moves;
  }

  // --- Wall placement validation ---------------------------------------

  canPlaceHWall(r, c) {
    if (r < 0 || r >= BOARD_SIZE - 1 || c < 0 || c >= BOARD_SIZE - 1) return false;
    if (this.hWalls[r][c]) return false;
    if (this._hWall(r, c - 1) || this._hWall(r, c + 1)) return false; // overlap
    if (this._vWall(r, c)) return false; // crossing
    return this._pathsExistWith('h', r, c);
  }

  canPlaceVWall(r, c) {
    if (r < 0 || r >= BOARD_SIZE - 1 || c < 0 || c >= BOARD_SIZE - 1) return false;
    if (this.vWalls[r][c]) return false;
    if (this._vWall(r - 1, c) || this._vWall(r + 1, c)) return false; // overlap
    if (this._hWall(r, c)) return false; // crossing
    return this._pathsExistWith('v', r, c);
  }

  // Temporarily place a wall and verify both players can still reach goal.
  _pathsExistWith(orientation, r, c) {
    const grid = orientation === 'h' ? this.hWalls : this.vWalls;
    grid[r][c] = true;
    const ok = this.hasPathToGoal(0) && this.hasPathToGoal(1);
    grid[r][c] = false;
    return ok;
  }

  // --- Pathfinding (BFS over cells, walls only, pawns ignored) ----------

  hasPathToGoal(idx) {
    return this.shortestPath(idx).dist !== Infinity;
  }

  shortestPath(idx) {
    const start = this.players[idx];
    const goalRow = start.goalRow;
    const visited = Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(false));
    const parent = {};
    const queue = [[start.row, start.col]];
    visited[start.row][start.col] = true;

    let head = 0;
    while (head < queue.length) {
      const [r, c] = queue[head++];
      if (r === goalRow) {
        // reconstruct path
        const path = [];
        let key = r + ',' + c;
        let cur = [r, c];
        while (cur) {
          path.push(cur);
          cur = parent[key];
          if (cur) key = cur[0] + ',' + cur[1];
        }
        path.reverse();
        return { dist: path.length - 1, path };
      }
      for (const [dr, dc] of DIRECTIONS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc) || visited[nr][nc]) continue;
        if (this.isBlocked(r, c, dr, dc)) continue;
        visited[nr][nc] = true;
        parent[nr + ',' + nc] = [r, c];
        queue.push([nr, nc]);
      }
    }
    return { dist: Infinity, path: null };
  }

  // --- Game flow --------------------------------------------------------

  getWinner() {
    if (this.players[0].row === this.players[0].goalRow) return 0;
    if (this.players[1].row === this.players[1].goalRow) return 1;
    return -1;
  }

  // Compact string fully identifying a position (pawns + walls + side to move).
  // Two states with the same signature are the same position — used to detect
  // repetitions (so the AI commits instead of oscillating) and for navigation.
  signature() {
    let s = this.players[0].row + ',' + this.players[0].col + '|' +
            this.players[1].row + ',' + this.players[1].col + '|' + this.current + '|';
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
      for (let c = 0; c < BOARD_SIZE - 1; c++) {
        if (this.hWalls[r][c]) s += 'H' + r + c;
        if (this.vWalls[r][c]) s += 'V' + r + c;
      }
    }
    return s;
  }

  // Apply a move object and return a NEW game state (does not mutate this).
  apply(move) {
    const ng = this.clone();
    const p = ng.players[ng.current];
    if (move.type === 'move') {
      p.row = move.row;
      p.col = move.col;
    } else if (move.type === 'wallH') {
      ng.hWalls[move.r][move.c] = true;
      p.wallsLeft--;
    } else if (move.type === 'wallV') {
      ng.vWalls[move.r][move.c] = true;
      p.wallsLeft--;
    }
    ng.current = 1 - ng.current;
    return ng;
  }
}

// Expose globally (classic script, no modules so it runs from file://).
window.QuoridorGame = QuoridorGame;
window.QUORIDOR = { BOARD_SIZE, WALLS_PER_PLAYER, DIRECTIONS, inBounds };
