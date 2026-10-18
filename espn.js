/**
 * espn.js — ESPN API + fallback to committed data/ snapshots on GitHub Pages.
 */

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_STANDINGS =
  "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";
const ESPN_TEAM_SCHEDULE = (teamId, season) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/schedule?season=${season}`;

const SNAPSHOT = {
  meta: "data/meta.json",
  season: "data/season.json",
  standings: "data/standings.json",
  predictor: "data/predictor.json",
};

/** @type {{ live: boolean, updatedAt: string|null, source: string }} */
let dataSourceInfo = {
  live: false,
  updatedAt: null,
  source: "none",
};

function getDataSourceInfo() {
  return { ...dataSourceInfo };
}

async function fetchLiveJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchSnapshot(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Snapshot ${path} unavailable`);
  }
  return response.json();
}

async function fetchLiveOrSnapshot(liveUrl, snapshotPath) {
  try {
    const data = await fetchLiveJson(liveUrl);
    dataSourceInfo.live = true;
    dataSourceInfo.source = "espn-live";
    dataSourceInfo.updatedAt = new Date().toISOString();
    return { data, live: true };
  } catch {
    const data = await fetchSnapshot(snapshotPath);
    dataSourceInfo.live = false;
    dataSourceInfo.source = "data-snapshot";
    dataSourceInfo.updatedAt = data.updatedAt || data.meta?.updatedAt || null;
    return { data, live: false };
  }
}

function buildScoreboardUrl(week, seasonYear) {
  const params = new URLSearchParams({
    week: String(week),
    seasontype: "2",
  });
  if (seasonYear) {
    params.set("dates", String(seasonYear));
  }
  return `${ESPN_SCOREBOARD}?${params.toString()}`;
}

async function fetchScoreboard(week, seasonYear) {
  const url = buildScoreboardUrl(week, seasonYear);
  try {
    return await fetchLiveJson(url);
  } catch (err) {
    const season = await fetchSnapshot(SNAPSHOT.season);
    const block = (season.weeks || []).find((w) => w.week === week);
    if (!block) {
      throw err;
    }
    dataSourceInfo.live = false;
    dataSourceInfo.source = "data-snapshot";
    dataSourceInfo.updatedAt = season.updatedAt || null;
    return {
      events: block.games.map(gameToPseudoEvent),
      week: { number: week, text: `Week ${week}` },
      season: { year: season.seasonYear },
    };
  }
}

function gameToPseudoEvent(game) {
  return {
    id: game.id,
    date: game.kickoff,
    competitions: [
      {
        date: game.kickoff,
        competitors: [
          {
            homeAway: "away",
            score: game.away.score,
            team: {
              id: game.away.id,
              displayName: game.away.name,
              abbreviation: game.away.abbr,
              logo: game.away.logo,
            },
          },
          {
            homeAway: "home",
            score: game.home.score,
            team: {
              id: game.home.id,
              displayName: game.home.name,
              abbreviation: game.home.abbr,
              logo: game.home.logo,
            },
          },
        ],
        status: {
          type: {
            state: game.status?.state,
            detail: game.status?.detail,
            completed: game.status?.completed,
          },
        },
      },
    ],
  };
}

function normalizeGame(event) {
  const competition = event.competitions?.[0];
  if (!competition) {
    return null;
  }

  const competitors = competition.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) {
    return null;
  }

  const status = competition.status || event.status || {};
  const statusType = status.type || {};

  return {
    id: String(event.id),
    away: teamFromCompetitor(away),
    home: teamFromCompetitor(home),
    kickoff: competition.date || event.date,
    status: {
      state: statusType.state || "pre",
      detail: statusType.detail || statusType.shortDetail || "",
      completed: Boolean(statusType.completed),
    },
    source: "espn",
  };
}

function teamFromCompetitor(competitor) {
  const team = competitor.team || {};
  return {
    id: String(team.id || competitor.id),
    name: team.displayName || team.name || "Team",
    abbr: team.abbreviation || "",
    logo: team.logo || pickLogo(team.logos),
    score: parseScore(competitor.score),
  };
}

function pickLogo(logos) {
  if (!logos || !logos.length) {
    return "";
  }
  return logos[0].href || "";
}

function parseScore(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchCurrentWeekMeta() {
  try {
    const data = await fetchLiveJson(`${ESPN_SCOREBOARD}?seasontype=2`);
    dataSourceInfo.live = true;
    dataSourceInfo.updatedAt = new Date().toISOString();
    dataSourceInfo.source = "espn-live";
    const week = data.week?.number ?? 1;
    const seasonYear = data.season?.year ?? new Date().getFullYear();
    return { week, seasonYear, seasonType: data.season?.type ?? 2 };
  } catch {
    const meta = await fetchSnapshot(SNAPSHOT.meta);
    const season = await fetchSnapshot(SNAPSHOT.season);
    dataSourceInfo.live = false;
    dataSourceInfo.updatedAt = meta.updatedAt || season.updatedAt || null;
    dataSourceInfo.source = "data-snapshot";
    return {
      week: meta.currentWeek ?? season.currentWeek ?? 1,
      seasonYear: meta.seasonYear ?? season.seasonYear,
      seasonType: 2,
    };
  }
}

async function loadWeekGames(week, seasonYear) {
  const data = await fetchScoreboard(week, seasonYear);
  const events = data.events || [];
  const games = events.map(normalizeGame).filter(Boolean);
  const resolvedWeek = data.week?.number ?? week;
  const resolvedSeason = data.season?.year ?? seasonYear;
  const label = data.week?.text || `Week ${resolvedWeek}`;
  return {
    games,
    week: resolvedWeek,
    seasonYear: resolvedSeason,
    label,
  };
}

/**
 * Season bundle: snapshot from data/season.json, with current week refreshed live when possible.
 */
async function loadSeasonBundle() {
  const snapPromise = fetchSnapshot(SNAPSHOT.season).catch(() => null);
  let meta;
  try {
    meta = await fetchCurrentWeekMeta();
  } catch (err) {
    const snap = await snapPromise;
    if (snap) {
      return snap;
    }
    throw err;
  }

  try {
    const current = await loadWeekGames(meta.week, meta.seasonYear);
    const snap = await snapPromise;
    if (snap && snap.seasonYear === meta.seasonYear && Array.isArray(snap.weeks)) {
      const weeks = snap.weeks.filter((w) => w.week !== meta.week);
      weeks.push({ week: meta.week, games: current.games });
      weeks.sort((a, b) => a.week - b.week);
      return {
        ...snap,
        weeks,
        currentWeek: meta.week,
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      seasonYear: meta.seasonYear,
      currentWeek: meta.week,
      weeks: [{ week: meta.week, games: current.games }],
      teams: {},
      updatedAt: new Date().toISOString(),
    };
  } catch {
    const snap = await snapPromise;
    if (snap) {
      return snap;
    }
    throw new Error("Could not load season data.");
  }
}

async function loadStandingsData() {
  const { data, live } = await fetchLiveOrSnapshot(
    ESPN_STANDINGS,
    SNAPSHOT.standings
  );
  if (live) {
    return parseStandingsFromEspn(data);
  }
  return data;
}

async function loadPredictorSnapshot() {
  return fetchSnapshot(SNAPSHOT.predictor);
}

function parseStandingsFromEspn(raw) {
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
        wins: Number(stats.wins) || 0,
        losses: Number(stats.losses) || 0,
        ties: Number(stats.ties) || 0,
        winPct: stats.winPercent || "",
        pointsFor: Number(stats.pointsFor) || 0,
        pointsAgainst: Number(stats.pointsAgainst) || 0,
        differential: stats.differential || stats.pointDifferential || "",
        streak: stats.streak || "",
        divisionRecord: stats["vs. Div."] || stats.divisionRecord || "",
      };
    });
    teams.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    divisions.push({
      conference: confAbbr,
      name: `${confAbbr} conference`,
      teams,
    });
  }
  return {
    updatedAt: new Date().toISOString(),
    seasonYear: raw.children?.[0]?.standings?.season,
    divisions,
  };
}

async function fetchTeamSchedule(teamId, seasonYear) {
  try {
    const data = await fetchLiveJson(ESPN_TEAM_SCHEDULE(teamId, seasonYear));
    return (data.events || []).map(normalizeGame).filter(Boolean);
  } catch {
    const season = await fetchSnapshot(SNAPSHOT.season);
    const team = season.teams?.[teamId];
    if (team?.gameLog?.length) {
      return team.gameLog.map((g) => ({
        id: `log-${teamId}-${g.week}`,
        kickoff: g.kickoff,
        home:
          g.side === "home"
            ? { id: teamId, name: team.name, abbr: team.abbr, logo: team.logo, score: g.scoreFor }
            : {
                id: "opp",
                name: g.opponent,
                abbr: g.opponentAbbr,
                logo: "",
                score: g.scoreAgainst,
              },
        away:
          g.side === "away"
            ? { id: teamId, name: team.name, abbr: team.abbr, logo: team.logo, score: g.scoreFor }
            : {
                id: "opp",
                name: g.opponent,
                abbr: g.opponentAbbr,
                logo: "",
                score: g.scoreAgainst,
              },
        status: {
          state: "post",
          detail: "Final",
          completed: true,
        },
      }));
    }
    return [];
  }
}

function isGameLocked(game) {
  const state = game.status?.state;
  return state === "in" || state === "post" || game.status?.completed;
}

function getWinnerSide(game) {
  if (!game.status?.completed && game.status?.state !== "post") {
    return null;
  }
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  if (homeScore == null || awayScore == null) {
    return null;
  }
  if (homeScore === awayScore) {
    return null;
  }
  return homeScore > awayScore ? "home" : "away";
}

function sortGamesForDisplay(games) {
  const order = { pre: 0, in: 1, post: 2 };
  return [...games].sort((a, b) => {
    const oa = order[a.status?.state] ?? 0;
    const ob = order[b.status?.state] ?? 0;
    if (oa !== ob) return oa - ob;
    return new Date(a.kickoff) - new Date(b.kickoff);
  });
}

function hasLiveGames(games) {
  return games.some((g) => g.status?.state === "in");
}
