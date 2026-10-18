#!/usr/bin/env node
/**
 * Fetches NFL season results + standings from ESPN, runs Pick Six backtest,
 * writes data/*.json. No npm dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const STANDINGS =
  "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";

const predictorSrc = readFileSync(join(ROOT, "predictor-logic.js"), "utf8");
const predictorApi = new Function(
  `${predictorSrc}\nreturn { predictMatchup, runPredictorBacktest, flattenCompletedGames, buildTeamSnapshot, PREDICTOR_WEIGHTS };`
)();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}`);
  }
  return res.json();
}

function normalizeGame(event) {
  const competition = event.competitions?.[0];
  if (!competition) return null;
  const competitors = competition.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const status = competition.status || event.status || {};
  const statusType = status.type || {};
  const teamFrom = (competitor) => {
    const team = competitor.team || {};
    const logos = team.logos || [];
    return {
      id: String(team.id || competitor.id),
      name: team.displayName || team.name || "Team",
      abbr: team.abbreviation || "",
      logo: team.logo || logos[0]?.href || "",
      score: parseScore(competitor.score),
    };
  };
  return {
    id: String(event.id),
    away: teamFrom(away),
    home: teamFrom(home),
    kickoff: competition.date || event.date,
    status: {
      state: statusType.state || "pre",
      detail: statusType.detail || statusType.shortDetail || "",
      completed: Boolean(statusType.completed),
    },
  };
}

function parseScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseStandings(raw) {
  const divisions = [];
  for (const conf of raw.children || []) {
    const confAbbr = conf.abbreviation || conf.name;
    const entries = conf.standings?.entries || [];
    const teams = entries.map((entry) => {
      const stats = {};
      for (const s of entry.stats || []) {
        stats[s.name] = s.displayValue ?? s.value;
      }
      const t = entry.team;
      return {
        id: String(t.id),
        name: t.displayName,
        abbr: t.abbreviation,
        logo: t.logos?.[0]?.href || "",
        wins: num(stats.wins),
        losses: num(stats.losses),
        ties: num(stats.ties),
        winPct: stats.winPercent || stats.winpercent || "",
        pointsFor: num(stats.pointsFor),
        pointsAgainst: num(stats.pointsAgainst),
        differential: stats.differential || stats.pointDifferential || "",
        streak: stats.streak || "",
        divisionRecord: stats["vs. Div."] || stats.divisionRecord || "",
      };
    });
    teams.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    divisions.push({
      conference: confAbbr,
      name: `${confAbbr} (conference)`,
      teams,
    });
  }
  return {
    seasonYear: raw.children?.[0]?.standings?.season,
    divisions,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildTeamProfiles(weeks) {
  /** @type {Record<string, object>} */
  const teams = {};
  const ensure = (id, name, abbr, logo) => {
    if (!teams[id]) {
      teams[id] = {
        id,
        name,
        abbr,
        logo,
        wins: 0,
        losses: 0,
        ties: 0,
        home: { wins: 0, losses: 0, ties: 0 },
        away: { wins: 0, losses: 0, ties: 0 },
        pointsFor: 0,
        pointsAgainst: 0,
        gameLog: [],
      };
    }
    return teams[id];
  };

  for (const { week, games } of weeks) {
    for (const game of games) {
      if (!game.status?.completed && game.status?.state !== "post") continue;
      const hs = game.home.score;
      const as = game.away.score;
      if (hs == null || as == null) continue;

      const home = ensure(game.home.id, game.home.name, game.home.abbr, game.home.logo);
      const away = ensure(game.away.id, game.away.name, game.away.abbr, game.away.logo);
      home.pointsFor += hs;
      home.pointsAgainst += as;
      away.pointsFor += as;
      away.pointsAgainst += hs;

      if (hs === as) {
        home.ties += 1;
        away.ties += 1;
        home.gameLog.push(logRow(week, game, "home", "T", hs, as));
        away.gameLog.push(logRow(week, game, "away", "T", as, hs));
        continue;
      }
      const homeWin = hs > as;
      if (homeWin) {
        home.wins += 1;
        home.home.wins += 1;
        away.losses += 1;
        away.away.losses += 1;
      } else {
        away.wins += 1;
        away.away.wins += 1;
        home.losses += 1;
        home.home.losses += 1;
      }
      home.gameLog.push(logRow(week, game, "home", homeWin ? "W" : "L", hs, as));
      away.gameLog.push(logRow(week, game, "away", homeWin ? "L" : "W", as, hs));
    }
  }

  for (const t of Object.values(teams)) {
    t.gameLog.sort((a, b) => b.week - a.week || b.kickoff.localeCompare(a.kickoff));
  }
  return teams;
}

function logRow(week, game, side, result, pf, pa) {
  const opp = side === "home" ? game.away : game.home;
  return {
    week,
    kickoff: game.kickoff,
    opponent: opp.name,
    opponentAbbr: opp.abbr,
    side,
    result,
    scoreFor: pf,
    scoreAgainst: pa,
  };
}

async function main() {
  const now = new Date().toISOString();
  const meta = await fetchJson(`${SCOREBOARD}?seasontype=2`);
  const seasonYear = meta.season?.year ?? new Date().getFullYear();
  const currentWeek = meta.week?.number ?? 1;

  const weeks = [];
  for (let w = 1; w <= currentWeek; w++) {
    const data = await fetchJson(
      `${SCOREBOARD}?week=${w}&seasontype=2&dates=${seasonYear}`
    );
    const games = (data.events || []).map(normalizeGame).filter(Boolean);
    weeks.push({ week: w, games });
  }

  const standingsRaw = await fetchJson(STANDINGS);
  const standings = parseStandings(standingsRaw);
  standings.updatedAt = now;
  standings.seasonYear = seasonYear;

  const teams = buildTeamProfiles(weeks);
  const backtest = predictorApi.runPredictorBacktest(weeks);

  const season = {
    updatedAt: now,
    seasonYear,
    currentWeek,
    weeks,
    teams,
  };

  const predictor = {
    updatedAt: now,
    seasonYear,
    formula: predictorApi.PREDICTOR_WEIGHTS,
    ...backtest,
  };

  const metaFile = {
    updatedAt: now,
    seasonYear,
    currentWeek,
    sources: ["espn-scoreboard", "espn-standings"],
  };

  mkdirSync(DATA_DIR, { recursive: true });
  const files = {
    "season.json": season,
    "standings.json": standings,
    "predictor.json": predictor,
    "meta.json": metaFile,
  };

  let changed = false;
  for (const [name, obj] of Object.entries(files)) {
    const path = join(DATA_DIR, name);
    const next = JSON.stringify(obj, null, 2);
    let prev = "";
    try {
      prev = readFileSync(path, "utf8");
    } catch {
      changed = true;
    }
    if (prev !== next) {
      writeFileSync(path, next);
      changed = true;
      console.log("Wrote", name);
    } else {
      console.log("Unchanged", name);
    }
  }

  if (!changed) {
    console.log("No file changes — skip commit.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
