/*
 * Quoridor UI: builds the board, handles input, and drives the human-vs-AI
 * game loop. Player 0 is the human (blue, bottom), player 1 is the AI.
 *
 * Game state is kept as a history of immutable snapshots so we can support
 * undo/redo, record a replay, and tell the AI which positions have already
 * occurred (so it commits to a plan instead of oscillating).
 */
(function () {
  const { BOARD_SIZE } = window.QUORIDOR;
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const difficultyEl = document.getElementById('difficulty');
  const firstMoveEl = document.getElementById('first-move');
  const newGameBtn = document.getElementById('new-game');
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const saveBtn = document.getElementById('save-replay');
  const loadBtn = document.getElementById('load-replay');
  const loadFileEl = document.getElementById('load-file');
  const wallEls = [document.getElementById('walls-0'), document.getElementById('walls-1')];
  const cardEls = [document.querySelector('.player-card.you'), document.querySelector('.player-card.ai')];

  // History model: states[i] is a snapshot; moves[i] transitions states[i] ->
  // states[i+1]; cursor is the index of the state currently shown.
  let states = [];
  let moves = [];
  let cursor = 0;
  let game; // always === states[cursor]

  let busy = false;     // AI is thinking (block input)
  let gameOver = false; // a player has reached their goal
  let cellNodes = {};
  const wallLayer = [];
  let previewNode = null;
  let armed = null; // touch: a wall slot awaiting confirmation

  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const DIFFICULTY_VALUES = ['easy', 'medium', 'hard', 'expert'];

  const cellLine = (i) => 2 * i + 1;
  const gapLine = (i) => 2 * i + 2;

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

  // --- Rendering --------------------------------------------------------

  function humanCanAct() {
    return !busy && !gameOver && game.current === 0;
  }

  function render() {
    for (const key in cellNodes) {
      cellNodes[key].innerHTML = '';
      cellNodes[key].classList.remove('legal');
    }
    for (let i = 0; i < 2; i++) {
      const p = game.players[i];
      const pawn = document.createElement('div');
      pawn.className = 'pawn p' + i;
      cellNodes[p.row + ',' + p.col].appendChild(pawn);
    }
    clearWalls();
    drawWalls(game.hWalls, 'H');
    drawWalls(game.vWalls, 'V');

    wallEls[0].textContent = game.players[0].wallsLeft;
    wallEls[1].textContent = game.players[1].wallsLeft;
    cardEls[0].classList.toggle('active', humanCanAct());
    cardEls[1].classList.toggle('active', !gameOver && game.current === 1);

    if (humanCanAct()) {
      for (const [r, c] of game.getPawnMoves(0)) {
        cellNodes[r + ',' + c].classList.add('legal');
      }
    }
    const canWall = humanCanAct() && game.players[0].wallsLeft > 0;
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
    if (!humanCanAct()) return;
    clearArmed();
    if (!game.getPawnMoves(0).some(([mr, mc]) => mr === r && mc === c)) return;
    applyAndContinue({ type: 'move', row: r, col: c });
  }

  function onSlotHover(orient, r, c) {
    if (isTouch) return;
    clearPreview();
    if (!humanCanAct() || game.players[0].wallsLeft === 0) return;
    const valid = orient === 'H' ? game.canPlaceHWall(r, c) : game.canPlaceVWall(r, c);
    placeWallNode(orient, r, c, true, valid ? 'valid' : 'invalid');
  }

  function onSlotClick(orient, r, c) {
    if (!humanCanAct() || game.players[0].wallsLeft === 0) return;
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
    // Drop any redo branch, then append the new state.
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
    if (winner !== -1) return endGame(winner);
    aiTurn();
  }

  function aiTurn() {
    busy = true;
    setStatus('AI is thinking…', 'thinking');
    render();
    updateNav();
    setTimeout(() => {
      // Positions already seen this game — the AI avoids returning to them.
      const visited = new Set(states.slice(0, cursor + 1).map((s) => s.signature()));
      const move = window.QuoridorAI.chooseMove(game, difficultyEl.value, visited);
      if (move) pushMove(move);
      busy = false;
      render();
      const winner = game.getWinner();
      if (winner !== -1) return endGame(winner);
      setStatus('Your turn — move your pawn or place a wall.');
      updateNav();
    }, 60);
  }

  function endGame(winner) {
    gameOver = true;
    render();
    updateNav();
    if (winner === 0) setStatus('🎉 You win! Reached the top row.', 'win');
    else setStatus('The AI wins this time. Try again!', 'lose');
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  // --- Undo / redo ------------------------------------------------------

  // Index of the nearest human-to-move state strictly before `from`, or -1.
  function prevHumanState(from) {
    let t = from - 1;
    while (t > 0 && states[t].current !== 0) t--;
    return t >= 0 && t < from && states[t].current === 0 ? t : -1;
  }

  // Index of the next human-to-move state after `from` (or the last state).
  function nextHumanState(from) {
    let t = from + 1;
    while (t < states.length && states[t].current !== 0) t++;
    if (t >= states.length) return cursor < states.length - 1 ? states.length - 1 : -1;
    return t;
  }

  function undo() {
    if (busy) return;
    const t = prevHumanState(cursor);
    if (t < 0) return;
    setCursor(t);
    gameOver = false;
    setStatus('Took back a turn — your move.');
    render();
    updateNav();
  }

  function redo() {
    if (busy) return;
    const t = nextHumanState(cursor);
    if (t < 0) return;
    setCursor(t);
    gameOver = false;
    render();
    updateNav();
    const winner = game.getWinner();
    if (winner !== -1) endGame(winner);
    else setStatus('Your turn — move your pawn or place a wall.');
  }

  function updateNav() {
    undoBtn.disabled = busy || prevHumanState(cursor) < 0;
    redoBtn.disabled = busy || cursor >= states.length - 1;
    saveBtn.disabled = cursor <= 0;
  }

  // --- Replay record (save / load) -------------------------------------
  //
  // Encoding: a pawn move to (row,col) is "<col-letter a-i><row 1-9>", e.g. e9.
  // A wall is "<col-letter a-h><row 1-8><h|v>" using its anchor, e.g. e3h.

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
    let tokens = [];
    for (const ln of lines) {
      if (ln.startsWith('difficulty:')) diff = ln.slice(11).trim();
      else if (ln.startsWith('first:')) first = ln.slice(6).trim();
      else if (ln.startsWith('moves:')) tokens = ln.slice(6).trim().split(/\s+/).filter(Boolean);
    }
    // Rebuild and validate against the rules before committing.
    const init = new window.QuoridorGame();
    init.current = first === 'ai' ? 1 : 0;
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
    if (DIFFICULTY_VALUES.includes(diff)) difficultyEl.value = diff;
    if (first === 'ai' || first === 'human') firstMoveEl.value = first;
    busy = false;
    gameOver = false;
    setCursor(states.length - 1);
    render();
    updateNav();
    const winner = game.getWinner();
    if (winner !== -1) {
      endGame(winner);
    } else if (game.current === 1) {
      setStatus('Replay loaded — AI to move.');
      aiTurn();
    } else {
      setStatus('Replay loaded (' + newMoves.length + ' moves) — your turn.');
    }
  }

  // --- New game / init --------------------------------------------------

  function newGame() {
    clearPreview();
    clearArmed();
    const init = new window.QuoridorGame();
    if (firstMoveEl.value === 'ai') init.current = 1;
    states = [init];
    moves = [];
    busy = false;
    gameOver = false;
    setCursor(0);
    render();
    updateNav();
    if (game.current === 1) aiTurn();
    else setStatus('Your turn — move your pawn or place a wall.');
  }

  buildBoard();
  newGameBtn.addEventListener('click', newGame);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  saveBtn.addEventListener('click', saveReplay);
  loadBtn.addEventListener('click', () => loadFileEl.click());
  loadFileEl.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadReplay(String(reader.result));
    reader.readAsText(file);
    loadFileEl.value = ''; // allow re-loading the same file
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
