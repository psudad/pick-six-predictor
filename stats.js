/**
 * stats.js — Grade user picks and compare to Pick Six Predictor.
 */

function gradePick(game, pick) {
  if (!pick) {
    return "none";
  }
  const winner = getWinnerSide(game);
  if (!winner) {
    return "pending";
  }
  return pick.pickedSide === winner ? "correct" : "wrong";
}

function gradePredictorPick(game, predictedSide) {
  if (!predictedSide) {
    return "none";
  }
  const winner = getWinnerSide(game);
  if (!winner) {
    return "pending";
  }
  return predictedSide === winner ? "correct" : "wrong";
}

function summarizeWeek(games, season, week) {
  let wins = 0;
  let losses = 0;
  let pending = 0;
  let unpicked = 0;
  let homePicks = 0;
  let awayPicks = 0;

  for (const game of games) {
    const pick = getPick(season, week, game.id);
    const grade = gradePick(game, pick);
    if (grade === "none") {
      unpicked += 1;
      continue;
    }
    if (grade === "pending") {
      pending += 1;
      if (pick.pickedSide === "home") {
        homePicks += 1;
      } else {
        awayPicks += 1;
      }
      continue;
    }
    if (pick.pickedSide === "home") {
      homePicks += 1;
    } else {
      awayPicks += 1;
    }
    if (grade === "correct") {
      wins += 1;
    } else {
      losses += 1;
    }
  }

  const graded = wins + losses;
  const accuracy = graded ? Math.round((wins / graded) * 100) : null;

  return {
    wins,
    losses,
    pending,
    unpicked,
    graded,
    accuracy,
    homePicks,
    awayPicks,
  };
}

function summarizePredictorWeek(games, weekNum, completedGames) {
  let wins = 0;
  let losses = 0;
  let pending = 0;

  for (const game of games) {
    const pred = predictMatchup(game.away.id, game.home.id, completedGames, weekNum);
    const grade = gradePredictorPick(game, pred.pickedSide);
    if (grade === "pending") {
      pending += 1;
    } else if (grade === "correct") {
      wins += 1;
    } else if (grade === "wrong") {
      losses += 1;
    }
  }

  const graded = wins + losses;
  return {
    wins,
    losses,
    pending,
    graded,
    accuracy: graded ? Math.round((wins / graded) * 100) : null,
  };
}

function formatRecord(wins, losses) {
  if (wins === 0 && losses === 0) {
    return "0–0";
  }
  return `${wins}–${losses}`;
}

function compareUserVsPredictor(games, season, week, completedGames) {
  let userCorrect = 0;
  let predictorCorrect = 0;
  let bothCorrect = 0;
  let graded = 0;

  for (const game of games) {
    const winner = getWinnerSide(game);
    if (!winner) continue;
    graded += 1;
    const pick = getPick(season, week, game.id);
    const pred = predictMatchup(game.away.id, game.home.id, completedGames, week);
    const userOk = pick && pick.pickedSide === winner;
    const predOk = pred.pickedSide === winner;
    if (userOk) userCorrect += 1;
    if (predOk) predictorCorrect += 1;
    if (userOk && predOk) bothCorrect += 1;
  }

  return {
    graded,
    userCorrect,
    predictorCorrect,
    bothCorrect,
    userAccuracy: graded ? Math.round((userCorrect / graded) * 1000) / 10 : null,
    predictorAccuracy: graded
      ? Math.round((predictorCorrect / graded) * 1000) / 10
      : null,
  };
}
