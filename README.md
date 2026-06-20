# Dragon Boat Festival Planner

A browser-based tool for building and optimizing dragon boat race lineups across multiple teams and heats.

## Features

- **Multi-team, multi-heat scheduling** — configure up to 4 teams and multiple race heats, each with its own start time
- **Drag-and-drop seat assignment** — move paddlers from the roster into any of the 20 boat seats (10 rows × left/right)
- **Drummer and steerer slots** — assign crew beyond the 20 paddling seats
- **Balance indicators** — real-time left/right and front/back weight balance feedback with severity levels
- **Auto-optimizer** — uses linear programming (jsLPSolver) to fill seats while optimizing for:
  - Left/right weight balance
  - Paddler side preferences
  - Position preferences
  - Gender distribution targets
- **Time conflict detection** — paddlers assigned to overlapping heats (within 20 min) are excluded from conflicting lineups
- **Side exclusivity** — paddlers marked as side-exclusive are only placed on their preferred side
- **Persistence** — lineup state is saved to `localStorage` and restored on reload
- **Print view** — browser-printable heat sheets

## Tech Stack

- Vanilla JavaScript (no framework)
- [jsLPSolver](https://github.com/JWally/jsLPSolver) (bundled as `solver.js`) for seat optimization
- Plain CSS

## File Structure

```
index.html      — app shell
app.js          — UI rendering, drag-and-drop, state management
optimizer.js    — LP model builder and seat assignment logic
data.js         — paddler roster (name, weight, side preference, gender)
solver.js       — bundled jsLPSolver library
styles.css      — styles
```

## Getting Started

Open `index.html` directly in a browser — no build step or server required.

1. Enter a festival name and choose the number of teams and heats
2. Set start times for each heat
3. Mark paddlers as attending on the roster
4. Drag paddlers into seats, or use the **Auto-fill** button to run the optimizer
5. Adjust priorities (balance, side preference, gender) in the optimizer modal before running

## Roster Data

Paddler data lives in [`data.js`](data.js). Each entry has:

| Field | Description |
|---|---|
| `name` | Full name |
| `side_pref` | Preferred paddling side (`"L"` or `"R"`) |
| `side_excl` | `1` = paddler may only sit on their preferred side |
| `weight_kg` | Used for balance calculations |
| `pref_pos` | Preferred seat index (0–19), or `null` |
| `gender` | `"M"` or `"F"` |

To update the roster, edit the `PADDLERS` array in `data.js`.
