/*
 * Quoridor UI: builds the board, handles input, and drives the game loop.
 *
 * Two modes:
 *   2P vs AI       — player 0 is the human (blue), player 1 is the AI (red).
 *   4P pass & play — four humans take turns on one device; no AI.
 *
 * Game state is kept as a history of immutable snapshots so we can support
 * undo/redo and record a replay.
 */
(function () {
  const { BOARD_SIZE } = window.QUORIDOR;
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const infoEl = document.getElementById('info');
  const modeEl = document.getElementById('mode');
  const difficultyEl = document.getElementById('difficulty');
  const firstMoveEl = document.getElementById('first-move');
  const difficultyOpt = document.getElementById('difficulty-opt');
  const firstMoveOpt = document.getElementById('first-move-opt');
  const newGameBtn = document.getElementById('new-game');
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const saveBtn = document.getElementById('save-replay');
  const loadBtn = document.getElementById('load-replay');
  const loadFileEl = document.getElementById('load-file');
  const resetScoreBtn = document.getElementById('reset-score');

  // Per-player display metadata (colour + label + goal-direction arrow).
  const PLAYER_META = {
    2: [
      { label: 'You', color: 'blue', arrow: '↑' },
      { label: 'AI', color: 'red', arrow: '↓' },
    ],
    4: [
      { label: 'P1', color: 'blue', arrow: '↑' },
      { label: 'P2', color: 'green', arrow: '←' },
      { label: 'P3', color: 'red', arrow: '↓' },
      { label: 'P4', color: 'yellow', arrow: '→' },
    ],
  };

  // History model.
  let states = [];
  let moves = [];
  let cursor = 0;
  let game; // === states[cursor]

  let busy = false;     // AI is thinking
  let gameOver = false;
  let cellNodes = {};
  const wallLayer = [];
  let previewNode = null;
  let armed = null;
  let wallStrong = []; // per-player "walls left" elements
  let scoreStrong = []; // per-player score elements (2P only)
  let cardEls = [];

  const isTouch = window.matchMedia('(pointer: coarse)').matches;

  // Persistent win tally (2P only).
  const SCORE_KEY = 'quoridor.score';
  let score = loadScore();
  let currentGameScored = false;

  const cellLine = (i) => 2 * i + 1;
  const gapLine = (i) => 2 * i + 2;

  const numPlayers = () => game.numPlayers;
  const vsAI = () => game.numPlayers === 2;
  const meta = () => PLAYER_META[game.numPlayers];

  // --- Board construction ----------------------------------------------

  function buildBoard() {
    boardEl.innerHTML = '';
    cellNodes = {};
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.style.gridRow = `${cellLine(r)} / ${cellLine(r) + 1}`;
        cell.style.gridColumn = `${cellLine(c)} / ${cellLine(c) + 1}`;
        cell.addEventListener('click', () => onCellClick(r, c));
        boardEl.appendChild(cell);
        cellNodes[r + ',' + c] = cell;
      }
    }
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE - 1; c++) {
        addSlot('V', Math.min(r, BOARD_SIZE - 2), c, cellLine(r), cellLine(r) + 1, gapLine(c), gapLine(c) + 1);
      }
    }
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        addSlot('H', r, Math.min(c, BOARD_SIZE - 2), gapLine(r), gapLine(r) + 1, cellLine(c), cellLine(c) + 1);
      }
    }
  }

  function addSlot(orient, ar, ac, rowStart, rowEnd, colStart, colEnd) {
    const slot = document.createElement('div');
    slot.className = 'slot ' + orient.toLowerCase();
    slot.style.gridRow = `${rowStart} / ${rowEnd}`;
    slot.style.gridColumn = `${colStart} / ${colEnd}`;
    slot.addEventListener('mouseenter', () => onSlotHover(orient, ar, ac));
    slot.addEventListener('mouseleave', clearPreview);
    slot.addEventListener('click', () => onSlotClick(orient, ar, ac));
    boardEl.appendChild(slot);
  }

  // Build the player cards for the current game.
  function buildInfo() {
    infoEl.innerHTML = '';
    wallStrong = [];
    scoreStrong = [];
    cardEls = [];
    const m = meta();
    for (let i = 0; i < game.players.length; i++) {
      const card = document.createElement('div');
      card.className = 'player-card';
      const dot = document.createElement('span');
      dot.className = 'dot ' + m[i].color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m[i].label + ' ' + m[i].arrow;
      const walls = document.createElement('span');
      walls.className = 'walls';
      const ws = document.createElement('strong');
      walls.append('Walls: ', ws);
      card.append(dot, name, walls);
      if (vsAI()) {
        const sc = document.createElement('span');
        sc.className = 'score';
        const ss = document.createElement('strong');
        sc.append('Wins: ', ss);
        card.append(sc);
        scoreStrong[i] = ss;
      }
      infoEl.appendChild(card);
      wallStrong[i] = ws;
      cardEls[i] = card;
    }
  }

  // --- Rendering --------------------------------------------------------

  // It is a human's turn to act on this device.
  function humanToMove() {
    return !busy && !gameOver && (!vsAI() || game.current === 0);
  }

  function render() {
    for (const key in cellNodes) {
      cellNodes[key].innerHTML = '';
      cellNodes[key].classList.remove('legal');
    }
    const m = meta();
    for (let i = 0; i < game.players.length; i++) {
      const p = game.players[i];
      const pawn = document.createElement('div');
      pawn.className = 'pawn ' + m[i].color;
      cellNodes[p.row + ',' + p.col].appendChild(pawn);
    }
    clearWalls();
    drawWalls(game.hWalls, 'H');
    drawWalls(game.vWalls, 'V');

    for (let i = 0; i < game.players.length; i++) {
      if (wallStrong[i]) wallStrong[i].textContent = game.players[i].wallsLeft;
      if (cardEls[i]) cardEls[i].classList.toggle('active', !gameOver && game.current === i);
    }

    if (humanToMove()) {
      for (const [r, c] of game.getPawnMoves(game.current)) {
        cellNodes[r + ',' + c].classList.add('legal');
      }
    }
    const canWall = humanToMove() && game.players[game.current].wallsLeft > 0;
    boardEl.querySelectorAll('.slot').forEach((s) => s.classList.toggle('enabled', canWall));
  }

  function drawWalls(grid, orient) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c]) placeWallNode(orient, r, c, false);
      }
    }
  }

  function placeWallNode(orient, r, c, isPreview, validity) {
    const el = document.createElement('div');
    el.className = 'wall' + (isPreview ? ' preview ' + validity : '');
    if (orient === 'H') {
      el.style.gridRow = `${gapLine(r)} / ${gapLine(r) + 1}`;
      el.style.gridColumn = `${cellLine(c)} / ${cellLine(c + 1) + 1}`;
    } else {
      el.style.gridColumn = `${gapLine(c)} / ${gapLine(c) + 1}`;
      el.style.gridRow = `${cellLine(r)} / ${cellLine(r + 1) + 1}`;
    }
    boardEl.appendChild(el);
    if (isPreview) previewNode = el;
    else wallLayer.push(el);
    return el;
  }

  function clearWalls() {
    while (wallLayer.length) boardEl.removeChild(wallLayer.pop());
  }

  function clearPreview() {
    if (previewNode) {
      boardEl.removeChild(previewNode);
      previewNode = null;
    }
  }

  function clearArmed() {
    if (armed) {
      if (armed.node && armed.node.parentNode) boardEl.removeChild(armed.node);
      armed = null;
    }
  }

  // --- Input handlers ---------------------------------------------------

  function onCellClick(r, c) {
    if (!humanToMove()) return;
    clearArmed();
    if (!game.getPawnMoves(game.current).some(([mr, mc]) => mr === r && mc === c)) return;
    applyAndContinue({ type: 'move', row: r, col: c });
  }

  function onSlotHover(orient, r, c) {
    if (isTouch) return;
    clearPreview();
    if (!humanToMove() || game.players[game.current].wallsLeft === 0) return;
    const valid = orient === 'H' ? game.canPlaceHWall(r, c) : game.canPlaceVWall(r, c);
    placeWallNode(orient, r, c, true, valid ? 'valid' : 'invalid');
  }

  function onSlotClick(orient, r, c) {
    if (!humanToMove() || game.players[game.current].wallsLeft === 0) return;
    const valid = orient === 'H' ? game.canPlaceHWall(r, c) : game.canPlaceVWall(r, c);

    if (isTouch) {
      if (armed && armed.orient === orient && armed.r === r && armed.c === c) {
        clearArmed();
        if (valid) applyAndContinue({ type: orient === 'H' ? 'wallH' : 'wallV', r, c });
        return;
      }
      clearArmed();
      const node = placeWallNode(orient, r, c, true, valid ? 'valid armed' : 'invalid');
      armed = { orient, r, c, node };
      previewNode = null;
      setStatus(valid ? 'Tap the same spot again to place the wall.' : "Can't place a wall there.");
      return;
    }

    if (!valid) return;
    clearPreview();
    applyAndContinue({ type: orient === 'H' ? 'wallH' : 'wallV', r, c });
  }

  // --- History / game loop ---------------------------------------------

  function setCursor(i) {
    cursor = i;
    game = states[cursor];
  }

  function pushMove(move) {
    states.length = cursor + 1;
    moves.length = cursor;
    states.push(game.apply(move));
    moves.push(move);
    setCursor(cursor + 1);
  }

  function applyAndContinue(move) {
    clearPreview();
    clearArmed();
    pushMove(move);
    render();
    updateNav();
    const winner = game.getWinner();
    if (winner !== -1) return endGame(winner, true);
    if (vsAI() && game.current === 1) aiTurn();
    else setStatus(turnPrompt());
  }

  function aiPrevCell() {
    if (cursor < 2) return null;
    const p = states[cursor - 2].players[1];
    return p.row + ',' + p.col;
  }

  function aiTurn() {
    busy = true;
    setStatus('AI is thinking…', 'thinking');
    render();
    updateNav();
    setTimeout(() => {
      const move = window.QuoridorAI.chooseMove(game, difficultyEl.value, aiPrevCell());
      if (move) pushMove(move);
      busy = false;
      render();
      const winner = game.getWinner();
      if (winner !== -1) return endGame(winner, true);
      setStatus(turnPrompt());
      updateNav();
    }, 60);
  }

  function turnPrompt() {
    if (vsAI()) return 'Your turn — move your pawn or place a wall.';
    const m = meta()[game.current];
    return `${m.label} (${m.color}) — your move. Pass the device.`;
  }

  function endGame(winner, live) {
    gameOver = true;
    if (live && vsAI() && !currentGameScored) {
      currentGameScored = true;
      if (winner === 0) score.you++; else score.ai++;
      saveScore();
      renderScore();
    }
    render();
    updateNav();
    if (vsAI()) {
      if (winner === 0) setStatus('🎉 You win! Reached the top row.', 'win');
      else setStatus('The AI wins this time. Try again!', 'lose');
    } else {
      const m = meta()[winner];
      setStatus(`🎉 ${m.label} (${m.color}) wins!`, 'win');
    }
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  // --- Undo / redo ------------------------------------------------------

  // 2P: step back/forward a whole turn (human move + AI reply). 4P: one ply.
  function prevHumanState(from) {
    let t = from - 1;
    while (t > 0 && states[t].current !== 0) t--;
    return t >= 0 && t < from && states[t].current === 0 ? t : -1;
  }

  function nextHumanState(from) {
    let t = from + 1;
    while (t < states.length && states[t].current !== 0) t++;
    if (t >= states.length) return from < states.length - 1 ? states.length - 1 : -1;
    return t;
  }

  function undoTarget() {
    return vsAI() ? prevHumanState(cursor) : (cursor >= 1 ? cursor - 1 : -1);
  }

  function redoTarget() {
    return vsAI() ? nextHumanState(cursor) : (cursor < states.length - 1 ? cursor + 1 : -1);
  }

  function undo() {
    if (busy) return;
    const t = undoTarget();
    if (t < 0) return;
    setCursor(t);
    gameOver = false;
    render();
    updateNav();
    setStatus(vsAI() ? 'Took back a turn — your move.' : turnPrompt());
  }

  function redo() {
    if (busy) return;
    const t = redoTarget();
    if (t < 0) return;
    setCursor(t);
    gameOver = false;
    render();
    updateNav();
    const winner = game.getWinner();
    if (winner !== -1) endGame(winner, false);
    else setStatus(turnPrompt());
  }

  function updateNav() {
    undoBtn.disabled = busy || undoTarget() < 0;
    redoBtn.disabled = busy || redoTarget() < 0;
    saveBtn.disabled = cursor <= 0;
  }

  // --- Score (2P) -------------------------------------------------------

  function loadScore() {
    try {
      const s = JSON.parse(localStorage.getItem(SCORE_KEY));
      if (s && typeof s.you === 'number' && typeof s.ai === 'number') return s;
    } catch (e) { /* ignore */ }
    return { you: 0, ai: 0 };
  }

  function saveScore() {
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(score)); } catch (e) { /* ignore */ }
  }

  function renderScore() {
    if (scoreStrong[0]) scoreStrong[0].textContent = score.you;
    if (scoreStrong[1]) scoreStrong[1].textContent = score.ai;
  }

  function resetScore() {
    score = { you: 0, ai: 0 };
    saveScore();
    renderScore();
  }

  // --- Replay record (save / load) -------------------------------------

  function encodeMove(m) {
    if (m.type === 'move') return String.fromCharCode(97 + m.col) + (m.row + 1);
    return String.fromCharCode(97 + m.c) + (m.r + 1) + (m.type === 'wallH' ? 'h' : 'v');
  }

  function decodeToken(tok) {
    let m;
    if ((m = /^([a-i])([1-9])$/.exec(tok))) {
      return { type: 'move', col: m[1].charCodeAt(0) - 97, row: +m[2] - 1 };
    }
    if ((m = /^([a-h])([1-8])([hv])$/.exec(tok))) {
      return { type: m[3] === 'h' ? 'wallH' : 'wallV', c: m[1].charCodeAt(0) - 97, r: +m[2] - 1 };
    }
    return null;
  }

  function isLegalMove(state, m) {
    const p = state.players[state.current];
    if (m.type === 'move') return state.getPawnMoves(state.current).some(([r, c]) => r === m.row && c === m.col);
    if (p.wallsLeft <= 0) return false;
    return m.type === 'wallH' ? state.canPlaceHWall(m.r, m.c) : state.canPlaceVWall(m.r, m.c);
  }

  function saveReplay() {
    const tokens = moves.slice(0, cursor).map(encodeMove);
    const text = [
      '# Quoridor Game Record v1',
      'players: ' + numPlayers(),
      'difficulty: ' + difficultyEl.value,
      'first: ' + firstMoveEl.value,
      'date: ' + new Date().toISOString(),
      'moves: ' + tokens.join(' '),
      '',
    ].join('\n');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    download(text, 'quoridor-' + stamp + '.qgr');
  }

  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function loadReplay(text) {
    const lines = text.split(/\r?\n/);
    let diff = 'medium';
    let first = 'human';
    let np = 2;
    let tokens = [];
    for (const ln of lines) {
      if (ln.startsWith('players:')) np = parseInt(ln.slice(8).trim(), 10) === 4 ? 4 : 2;
      else if (ln.startsWith('difficulty:')) diff = ln.slice(11).trim();
      else if (ln.startsWith('first:')) first = ln.slice(6).trim();
      else if (ln.startsWith('moves:')) tokens = ln.slice(6).trim().split(/\s+/).filter(Boolean);
    }
    const init = new window.QuoridorGame(np);
    if (np === 2 && first === 'ai') init.current = 1;
    const newStates = [init];
    const newMoves = [];
    let cur = init;
    for (let i = 0; i < tokens.length; i++) {
      const mv = decodeToken(tokens[i]);
      if (!mv || !isLegalMove(cur, mv)) {
        setStatus('Could not load replay: invalid move "' + tokens[i] + '".', 'lose');
        return;
      }
      cur = cur.apply(mv);
      newStates.push(cur);
      newMoves.push(mv);
    }
    states = newStates;
    moves = newMoves;
    modeEl.value = String(np);
    if (DIFFICULTY_VALUES.includes(diff)) difficultyEl.value = diff;
    if (first === 'ai' || first === 'human') firstMoveEl.value = first;
    busy = false;
    gameOver = false;
    currentGameScored = true; // loaded games don't affect the tally
    setCursor(states.length - 1);
    syncModeUI();
    buildInfo();
    renderScore();
    render();
    updateNav();
    const winner = game.getWinner();
    if (winner !== -1) endGame(winner, false);
    else if (vsAI() && game.current === 1) { setStatus('Replay loaded — AI to move.'); aiTurn(); }
    else setStatus('Replay loaded (' + newMoves.length + ' moves) — ' + turnPrompt());
  }

  const DIFFICULTY_VALUES = ['easy', 'medium', 'hard', 'expert'];

  // --- New game / init --------------------------------------------------

  function syncModeUI() {
    const four = modeEl.value === '4';
    difficultyOpt.hidden = four;
    firstMoveOpt.hidden = four;
  }

  function newGame() {
    clearPreview();
    clearArmed();
    syncModeUI();
    const np = modeEl.value === '4' ? 4 : 2;
    const init = new window.QuoridorGame(np);
    if (np === 2 && firstMoveEl.value === 'ai') init.current = 1;
    states = [init];
    moves = [];
    busy = false;
    gameOver = false;
    currentGameScored = false;
    setCursor(0);
    buildInfo();
    renderScore();
    render();
    updateNav();
    if (vsAI() && game.current === 1) aiTurn();
    else setStatus(turnPrompt());
  }

  buildBoard();
  modeEl.addEventListener('change', newGame);
  newGameBtn.addEventListener('click', newGame);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  saveBtn.addEventListener('click', saveReplay);
  resetScoreBtn.addEventListener('click', resetScore);
  loadBtn.addEventListener('click', () => loadFileEl.click());
  loadFileEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadReplay(String(reader.result));
    reader.readAsText(file);
    loadFileEl.value = '';
  });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (e.key === 'y' || e.key === 'Y') {
      e.preventDefault();
      redo();
    }
  });

  newGame();
})();
