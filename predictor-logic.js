/**
 * predictor-logic.js — Pick Six Predictor (plain functions, no DOM).
 * Used in the browser and loaded by scripts/update-data.mjs via new Function().
 *
 * Formula (each factor is 0–1 before weights):
 *   • Win percentage this season (games before the predicted week)
 *   • Average point differential per game, scaled from −14..+14 into 0–1
 *   • Recent form: win rate in the last 3 completed games
 *   • Home field: +0.04 added only to the home team’s composite score
 *
 * Weights: 40% wins, 35% point diff, 25% recent form (+ home bonus on home only).
 * Confidence: 52–92% from how far apart the two composite scores are.
 */

const PREDICTOR_WEIGHTS = {
  winPct: 0.4,
  pointDiff: 0.35,
  recentForm: 0.25,
  homeFieldBonus: 0.04,
};

/** @typedef {{ teamId: string, week: number, side: 'home'|'away', pf: number, pa: number, win: boolean|null, kickoff: string }} CompletedGame */

/**
 * Build per-team stats using only games with week < beforeWeek.
 * @param {CompletedGame[]} completed
 * @param {string} teamId
 */
function buildTeamSnapshot(completed, teamId, beforeWeek) {
  const games = completed
    .filter((g) => g.teamId === teamId && g.week < beforeWeek)
    .sort((a, b) => a.week - b.week || a.kickoff.localeCompare(b.kickoff));

  if (!games.length) {
    return {
      games: 0,
      winPct: 0.5,
      avgDiff: 0,
      recentWinPct: 0.5,
    };
  }

  let wins = 0;
  let diffSum = 0;
  for (const g of games) {
    if (g.win === true) wins += 1;
    diffSum += g.pf - g.pa;
  }
  const winPct = wins / games.length;
  const avgDiff = diffSum / games.length;

  const last3 = games.slice(-3);
  let rWins = 0;
  for (const g of last3) {
    if (g.win === true) rWins += 1;
  }
  const recentWinPct = last3.length ? rWins / last3.length : winPct;

  return {
    games: games.length,
    winPct,
    avgDiff,
    recentWinPct,
  };
}

function scalePointDiff(avgDiff) {
  const clamped = Math.max(-14, Math.min(14, avgDiff));
  return (clamped + 14) / 28;
}

function compositeScore(snapshot, isHome) {
  const w = PREDICTOR_WEIGHTS;
  let score =
    w.winPct * snapshot.winPct +
    w.pointDiff * scalePointDiff(snapshot.avgDiff) +
    w.recentForm * snapshot.recentWinPct;
  if (isHome) {
    score += w.homeFieldBonus;
  }
  return score;
}

/**
 * Predict winner for one matchup.
 * @param {string} awayId
 * @param {string} homeId
 * @param {CompletedGame[]} completed — full season log
 * @param {number} beforeWeek — only use games from earlier weeks
 */
function predictMatchup(awayId, homeId, completed, beforeWeek) {
  const awaySnap = buildTeamSnapshot(completed, awayId, beforeWeek);
  const homeSnap = buildTeamSnapshot(completed, homeId, beforeWeek);
  const awayScore = compositeScore(awaySnap, false);
  const homeScore = compositeScore(homeSnap, true);
  const diff = homeScore - awayScore;
  const pickedSide = diff >= 0 ? "home" : "away";
  const gap = Math.abs(diff);
  const confidence = Math.round(Math.min(92, Math.max(52, 52 + gap * 180)));
  return {
    pickedSide,
    confidence,
    awayScore: round3(awayScore),
    homeScore: round3(homeScore),
    awaySnap,
    homeSnap,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Flatten normalized season weeks into CompletedGame rows (two per game).
 * @param {{ week: number, games: object[] }[]} weeks
 */
function flattenCompletedGames(weeks) {
  /** @type {CompletedGame[]} */
  const rows = [];
  for (const { week, games } of weeks) {
    for (const game of games) {
      if (!game.status?.completed && game.status?.state !== "post") {
        continue;
      }
      const homeScore = game.home.score;
      const awayScore = game.away.score;
      if (homeScore == null || awayScore == null) continue;
      if (homeScore === awayScore) continue;
      const homeWin = homeScore > awayScore;
      rows.push({
        teamId: game.home.id,
        week,
        side: "home",
        pf: homeScore,
        pa: awayScore,
        win: homeWin,
        kickoff: game.kickoff,
      });
      rows.push({
        teamId: game.away.id,
        week,
        side: "away",
        pf: awayScore,
        pa: homeScore,
        win: !homeWin,
        kickoff: game.kickoff,
      });
    }
  }
  return rows;
}

/**
 * Backtest: for each finished week, predict using only prior weeks.
 * @param {{ week: number, games: object[] }[]} weeks
 */
function runPredictorBacktest(weeks) {
  const completed = flattenCompletedGames(weeks);
  const byWeek = [];
  let totalCorrect = 0;
  let totalGames = 0;

  const weekNums = weeks.map((w) => w.week).sort((a, b) => a - b);
  for (const weekNum of weekNums) {
    const weekBlock = weeks.find((w) => w.week === weekNum);
    if (!weekBlock) continue;
    let correct = 0;
    let graded = 0;
    for (const game of weekBlock.games) {
      const winner = winnerSideFromGame(game);
      if (!winner) continue;
      const pred = predictMatchup(
        game.away.id,
        game.home.id,
        completed,
        weekNum
      );
      graded += 1;
      if (pred.pickedSide === winner) correct += 1;
    }
    if (graded > 0) {
      const accuracy = Math.round((correct / graded) * 1000) / 10;
      byWeek.push({ week: weekNum, correct, total: graded, accuracy });
      totalCorrect += correct;
      totalGames += graded;
    }
  }

  const overallAccuracy =
    totalGames > 0 ? Math.round((totalCorrect / totalGames) * 1000) / 10 : null;

  return {
    overall: {
      correct: totalCorrect,
      total: totalGames,
      accuracy: overallAccuracy,
    },
    byWeek,
    chart: byWeek.map((w) => ({ week: w.week, accuracy: w.accuracy })),
  };
}

function winnerSideFromGame(game) {
  if (!game.status?.completed && game.status?.state !== "post") return null;
  const hs = game.home.score;
  const as = game.away.score;
  if (hs == null || as == null || hs === as) return null;
  return hs > as ? "home" : "away";
}
