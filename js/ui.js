/*
 * Quoridor UI: builds the board, handles input, and drives the human-vs-AI
 * game loop. Player 0 is the human, player 1 is the AI.
 */
(function () {
  const { BOARD_SIZE } = window.QUORIDOR;
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const difficultyEl = document.getElementById('difficulty');
  const newGameBtn = document.getElementById('new-game');
  const wallEls = [document.getElementById('walls-0'), document.getElementById('walls-1')];
  const cardEls = [document.querySelector('.player-card.you'), document.querySelector('.player-card.ai')];

  let game;
  let busy = false; // true while AI is thinking or game is over
  let cellNodes = {}; // "r,c" -> element
  const wallLayer = []; // dynamically created wall + preview nodes
  let previewNode = null;

  // grid line helpers (1-indexed CSS grid lines)
  const cellLine = (i) => 2 * i + 1;
  const gapLine = (i) => 2 * i + 2;

  function buildBoard() {
    boardEl.innerHTML = '';
    cellNodes = {};

    // Cells
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.gridRow = `${cellLine(r)} / ${cellLine(r) + 1}`;
        cell.style.gridColumn = `${cellLine(c)} / ${cellLine(c) + 1}`;
        cell.addEventListener('click', () => onCellClick(r, c));
        boardEl.appendChild(cell);
        cellNodes[r + ',' + c] = cell;
      }
    }

    // Vertical wall slots (between horizontally adjacent cells)
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE - 1; c++) {
        const anchorR = Math.min(r, BOARD_SIZE - 2);
        addSlot('V', anchorR, c, cellLine(r), cellLine(r) + 1, gapLine(c), gapLine(c) + 1);
      }
    }
    // Horizontal wall slots (between vertically adjacent cells)
    for (let r = 0; r < BOARD_SIZE - 1; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const anchorC = Math.min(c, BOARD_SIZE - 2);
        addSlot('H', r, anchorC, gapLine(r), gapLine(r) + 1, cellLine(c), cellLine(c) + 1);
      }
    }
  }

  function addSlot(orient, ar, ac, rowStart, rowEnd, colStart, colEnd) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.style.gridRow = `${rowStart} / ${rowEnd}`;
    slot.style.gridColumn = `${colStart} / ${colEnd}`;
    slot.addEventListener('mouseenter', () => onSlotHover(orient, ar, ac));
    slot.addEventListener('mouseleave', clearPreview);
    slot.addEventListener('click', () => onSlotClick(orient, ar, ac));
    boardEl.appendChild(slot);
  }

  // --- Rendering --------------------------------------------------------

  function render() {
    // Clear pawns
    for (const key in cellNodes) {
      const node = cellNodes[key];
      node.innerHTML = '';
      node.classList.remove('legal');
    }
    // Pawns
    for (let i = 0; i < 2; i++) {
      const p = game.players[i];
      const pawn = document.createElement('div');
      pawn.className = 'pawn p' + i;
      cellNodes[p.row + ',' + p.col].appendChild(pawn);
    }
    // Walls
    clearWalls();
    drawWalls(game.hWalls, 'H', false);
    drawWalls(game.vWalls, 'V', false);

    // Wall counts + active player highlight
    wallEls[0].textContent = game.players[0].wallsLeft;
    wallEls[1].textContent = game.players[1].wallsLeft;
    cardEls[0].classList.toggle('active', game.current === 0 && !busy);
    cardEls[1].classList.toggle('active', game.current === 1);

    // Legal pawn destinations (only on human's turn)
    if (!busy && game.current === 0) {
      for (const [r, c] of game.getPawnMoves(0)) {
        cellNodes[r + ',' + c].classList.add('legal');
      }
    }

    // Enable/disable wall slots
    const slots = boardEl.querySelectorAll('.slot');
    const canWall = !busy && game.current === 0 && game.players[0].wallsLeft > 0;
    slots.forEach((s) => s.classList.toggle('enabled', canWall));
  }

  function drawWalls(grid, orient, isPreview, validity) {
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c]) placeWallNode(orient, r, c, isPreview, validity);
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

  // --- Input handlers ---------------------------------------------------

  function onCellClick(r, c) {
    if (busy || game.current !== 0) return;
    const legal = game.getPawnMoves(0).some(([mr, mc]) => mr === r && mc === c);
    if (!legal) return;
    applyAndContinue({ type: 'move', row: r, col: c });
  }

  function onSlotHover(orient, r, c) {
    clearPreview();
    if (busy || game.current !== 0 || game.players[0].wallsLeft === 0) return;
    const valid = orient === 'H' ? game.canPlaceHWall(r, c) : game.canPlaceVWall(r, c);
    placeWallNode(orient, r, c, true, valid ? 'valid' : 'invalid');
  }

  function onSlotClick(orient, r, c) {
    if (busy || game.current !== 0 || game.players[0].wallsLeft === 0) return;
    const valid = orient === 'H' ? game.canPlaceHWall(r, c) : game.canPlaceVWall(r, c);
    if (!valid) return;
    clearPreview();
    applyAndContinue({ type: orient === 'H' ? 'wallH' : 'wallV', r, c });
  }

  // --- Game loop --------------------------------------------------------

  function applyAndContinue(move) {
    game = game.apply(move);
    render();
    const winner = game.getWinner();
    if (winner !== -1) return endGame(winner);
    // Now it's the AI's turn.
    aiTurn();
  }

  function aiTurn() {
    busy = true;
    setStatus('AI is thinking…', 'thinking');
    render();
    // Defer so the UI can paint the "thinking" state before we block.
    setTimeout(() => {
      const difficulty = difficultyEl.value;
      const move = window.QuoridorAI.chooseMove(game, difficulty);
      if (move) game = game.apply(move);
      busy = false;
      render();
      const winner = game.getWinner();
      if (winner !== -1) return endGame(winner);
      setStatus('Your turn — move your pawn or place a wall.');
    }, 60);
  }

  function endGame(winner) {
    busy = true;
    render();
    if (winner === 0) setStatus('🎉 You win! Reached the top row.', 'win');
    else setStatus('The AI wins this time. Try again!', 'lose');
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  function newGame() {
    game = new window.QuoridorGame();
    busy = false;
    setStatus('Your turn — move your pawn or place a wall.');
    render();
  }

  // --- Init -------------------------------------------------------------

  buildBoard();
  newGameBtn.addEventListener('click', newGame);
  newGame();
})();
