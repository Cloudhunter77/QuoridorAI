# Quoridor AI

A browser implementation of the board game **Quoridor** with a single-player
mode against an AI opponent with selectable difficulty. No build step and no
dependencies — it's plain HTML/CSS/JavaScript.

## Play

Open `index.html` in any modern browser:

```
# either just double-click index.html, or serve it locally:
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Rules

- The board is 9×9. You are the **blue** pawn at the bottom; reach the **top
  row** to win. The AI is the **red** pawn at the top, racing for the bottom.
- On your turn you either:
  - **Move your pawn** one square orthogonally — click a highlighted cell, or
  - **Place a wall** — click a slot between cells (10 walls each).
- Walls are two cells long. Click a horizontal slot for a horizontal wall, a
  vertical slot for a vertical wall. A **green** preview means the placement is
  legal, **red** means it isn't.
- A wall may never completely seal off a player from their goal row.
- When the two pawns are face to face you may **jump** over the opponent
  (straight ahead, or diagonally if a wall is behind them).

You can pick the difficulty and whether **you or the AI moves first** before
starting a new game (you're always the blue pawn at the bottom either way).

## Mobile / touch

The board scales to the viewport, so it works in a phone browser. Since touch
has no hover, **wall placement is two taps**: the first tap shows a pulsing
preview, the second tap on the same slot confirms it (tap a cell or another slot
to cancel). Tap targets for wall slots are enlarged on touch screens. Moving a
pawn is a single tap on a highlighted cell.

To open it on a phone, either host the folder (e.g. GitHub Pages) and visit the
URL, or run `python3 -m http.server 8000` on a computer and browse to
`http://<computer-ip>:8000` from the phone on the same network.

## Difficulty

| Level  | Search depth | Behaviour                                   |
|--------|--------------|---------------------------------------------|
| Easy   | 1            | Often plays random moves; uses walls lightly. Clearly beatable. |
| Medium | 2            | Solid play, occasional slip.                |
| Hard   | 3            | Plays the search out, no randomness.        |
| Expert | iterative deepening (~depth 4–6, 2s budget) | Strongest setting. Searches as deep as it can in the time budget and never blunders. |

> **Note:** Quoridor is not a solved game, so "Expert" is the strongest
> *practical* AI rather than provably perfect play. In testing it beats Hard
> roughly 70% of the time as both first and second player.

## How the AI works

- **Evaluation:** each position is scored by the difference between the two
  players' shortest paths to goal (breadth-first search over the board honoring
  walls), with a small bonus for keeping walls in hand.
- **Search:** negamax with alpha-beta pruning.
- **Move generation:** to keep the branching factor manageable in the browser,
  candidate wall placements are limited to walls that actually interfere with
  the opponent's current shortest path or sit next to a pawn, rather than all
  ~128 legal walls. Moves are ordered (best pawn moves and most disruptive walls
  first) to maximise pruning.

## Project structure

```
index.html        # markup + layout
css/styles.css    # board and UI styling
js/game.js        # game state, rules, move generation, pathfinding
js/ai.js          # negamax + alpha-beta AI, difficulty tiers
js/ui.js          # board rendering, input handling, game loop
```
