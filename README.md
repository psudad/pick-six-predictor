# Pick Six

A static NFL **picks tracker** and **Pick Six Predictor** for a school project. Plain **HTML**, **CSS**, and **JavaScript** only — no frameworks, no build step, no backend, no API keys. Deploy from the repository root on GitHub Pages (`main` branch).

## What you get

- **Home** — Current NFL week on load (from ESPN), upcoming games first, tap-to-pick winners, live score refresh every 3 minutes when games are in progress.
- **Pick Six Predictor** — Explainable model pick + confidence % on every game card.
- **Accuracy** — Your record vs the predictor, backtest chart, week-by-week history.
- **Standings** — Division tables (W–L–T, win %, point differential, streak).
- **Teams** — Per-team season record, home/away splits, points for/against, recent game log.
- **Backup** — Export/import picks as JSON (`localStorage`).

Live data comes from ESPN’s public APIs. If the browser cannot reach ESPN, the site falls back to JSON snapshots in `data/` (updated by GitHub Actions).

## Pick Six Predictor formula

For each game in week **W**, only games from weeks **1 … W−1** are used (no peeking at the same week).

For each team, compute:

| Factor | Weight | Description |
|--------|--------|-------------|
| Win percentage | **40%** | Wins ÷ games played so far |
| Point differential | **35%** | Average (points scored − allowed) per game, scaled from −14..+14 into 0–1 |
| Recent form | **25%** | Win rate in the **last 3** completed games |
| Home field | **+0.04** | Added only to the **home** team’s composite score |

The team with the higher composite score is the predicted winner.

**Confidence** (about 52%–92%): grows when the two composite scores are farther apart (`52 + 180 × |home − away|`, capped).

The same rules power:

1. **Live picks** on game cards (using stats through the prior week).
2. **Backtest accuracy** in `data/predictor.json` and on the Accuracy tab (each finished week graded with only earlier-week data).

Implementation: `predictor-logic.js` (browser + `scripts/update-data.mjs`).

## Files (GitHub Pages)

| File / folder | Purpose |
|---------------|---------|
| `index.html` | Pages and layout |
| `style.css` | Mobile-first styles |
| `espn.js` | ESPN fetch + `data/` fallback |
| `predictor-logic.js` | Predictor + backtest math |
| `divisions.js` | Division names for standings |
| `storage.js` | Picks in `localStorage` |
| `stats.js` | Grading and comparisons |
| `app.js` | UI wiring |
| `data/*.json` | Snapshots (season, standings, predictor backtest, meta) |
| `.nojekyll` | Disable Jekyll on GitHub Pages |
| `.github/workflows/update-data.yml` | Scheduled ESPN refresh |

## Run locally

```bash
python3 -m http.server 8765
```

Open [http://localhost:8765](http://localhost:8765). Use a local server (not `file://`) so `fetch` and `data/` work.

## GitHub Pages

1. Push all files (including `.nojekyll` and `data/`) to **`main`** at the repo root.
2. **Settings → Pages → Deploy from branch → `main` / root**.

## Automatic data updates

Workflow: `.github/workflows/update-data.yml`

- Runs `node scripts/update-data.mjs` (no npm dependencies).
- Commits `data/` only when JSON changes (`GITHUB_TOKEN`, `contents: write`).
- Cron (UTC) covers Sunday early/late windows, Monday Night Football, and Thursday Night Football, with **20:10 and 21:10 UTC** on Sundays to cover **4:10 PM ET** in both EDT and EST.

The page shows **Last updated** (live ESPN vs snapshot).

## ESPN endpoints used

```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=N&seasontype=2&dates=YYYY
GET https://site.api.espn.com/apis/v2/sports/football/nfl/standings
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{id}/schedule?season=YYYY
```

## Notes for presenting

- Picks stay in the browser unless you export JSON.
- ESPN endpoints are unofficial and may change.
- Ties are not graded as win/loss.
- No analytics or tracking scripts.
