/**
 * app.js — Pick Six UI: games, predictor, accuracy, standings, teams.
 */

(function () {
  const REFRESH_MS = 3 * 60 * 1000;

  let current = {
    week: 1,
    seasonYear: new Date().getFullYear(),
    games: [],
    label: "",
  };

  let seasonBundle = { weeks: [], teams: {}, seasonYear: 2026, currentWeek: 1 };
  let predictorBacktest = null;
  let completedGameRows = [];
  let minWeek = 1;
  let currentNflWeek = 18;
  let loading = false;
  let refreshTimer = null;

  const els = {
    lastUpdated: document.getElementById("last-updated"),
    weekNumber: document.getElementById("week-number"),
    seasonLabel: document.getElementById("season-label"),
    loadStatus: document.getElementById("load-status"),
    liveRefreshNote: document.getElementById("live-refresh-note"),
    gamesList: document.getElementById("games-list"),
    weekPrev: document.getElementById("week-prev"),
    weekNext: document.getElementById("week-next"),
    manualForm: document.getElementById("manual-game-form"),
    manualPanel: document.getElementById("manual-add-panel"),
    navBtns: document.querySelectorAll(".nav-btn"),
    views: {
      games: document.getElementById("view-games"),
      accuracy: document.getElementById("view-accuracy"),
      standings: document.getElementById("view-standings"),
      teams: document.getElementById("view-teams"),
      backup: document.getElementById("view-backup"),
    },
    accPredictorOverall: document.getElementById("acc-predictor-overall"),
    accPredictorDetail: document.getElementById("acc-predictor-detail"),
    accUserOverall: document.getElementById("acc-user-overall"),
    accUserDetail: document.getElementById("acc-user-detail"),
    accuracyChart: document.getElementById("accuracy-chart"),
    statWeekRecord: document.getElementById("stat-week-record"),
    statWeekDetail: document.getElementById("stat-week-detail"),
    statSeasonRecord: document.getElementById("stat-season-record"),
    statSeasonAccuracy: document.getElementById("stat-season-accuracy"),
    statVsPredictor: document.getElementById("stat-vs-predictor"),
    statVsDetail: document.getElementById("stat-vs-detail"),
    historyList: document.getElementById("history-list"),
    standingsRoot: document.getElementById("standings-root"),
    teamSelect: document.getElementById("team-select"),
    teamPanel: document.getElementById("team-panel"),
    exportBtn: document.getElementById("export-btn"),
    importInput: document.getElementById("import-input"),
    backupMsg: document.getElementById("backup-msg"),
  };

  init();

  async function init() {
    wireNavigation();
    wireWeekButtons();
    wireManualForm();
    wireBackup();
    wireTeamSelect();

    setStatus("Loading NFL schedule…");
    try {
      await loadBackgroundData();
      const meta = await fetchCurrentWeekMeta();
      current.week = meta.week;
      current.seasonYear = meta.seasonYear;
      currentNflWeek = meta.week;
      await refreshWeek();
      updateLastUpdatedLabel();
    } catch (err) {
      setStatus(err.message || "Could not load schedule.", true);
      els.manualPanel.open = true;
      try {
        await loadBackgroundData();
        current.week = seasonBundle.currentWeek || 1;
        current.seasonYear = seasonBundle.seasonYear;
        await refreshWeek();
      } catch {
        current.week = 1;
      }
    }
  }

  async function loadBackgroundData() {
    try {
      seasonBundle = await loadSeasonBundle();
      completedGameRows = flattenCompletedGames(seasonBundle.weeks || []);
    } catch {
      seasonBundle = { weeks: [], teams: {}, seasonYear: current.seasonYear, currentWeek: 1 };
      completedGameRows = [];
    }
    try {
      predictorBacktest = await loadPredictorSnapshot();
    } catch {
      predictorBacktest = runPredictorBacktest(seasonBundle.weeks || []);
    }
  }

  function wireNavigation() {
    els.navBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        els.navBtns.forEach((b) => b.classList.toggle("nav-btn--active", b === btn));
        Object.entries(els.views).forEach(([name, section]) => {
          const active = name === view;
          section.classList.toggle("view--active", active);
          section.hidden = !active;
        });
        if (view === "accuracy") {
          els.statSeasonRecord.textContent = "…";
          void refreshAccuracyView();
        }
        if (view === "standings") {
          void renderStandings();
        }
        if (view === "teams") {
          populateTeamSelect();
        }
      });
    });
  }

  function wireWeekButtons() {
    els.weekPrev.addEventListener("click", () => {
      if (current.week <= minWeek || loading) return;
      current.week -= 1;
      refreshWeek();
    });
    els.weekNext.addEventListener("click", () => {
      if (loading || current.week >= currentNflWeek + 1) return;
      current.week += 1;
      refreshWeek();
    });
  }

  function wireManualForm() {
    els.manualForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(els.manualForm);
      const awayName = String(fd.get("away")).trim();
      const homeName = String(fd.get("home")).trim();
      const kickoffRaw = fd.get("kickoff");
      const id = `manual-${Date.now()}`;
      const kickoff = kickoffRaw
        ? new Date(String(kickoffRaw)).toISOString()
        : new Date().toISOString();

      const game = {
        id,
        away: {
          id: "away-man",
          name: awayName,
          abbr: awayName.slice(0, 3).toUpperCase(),
          logo: "",
          score: null,
        },
        home: {
          id: "home-man",
          name: homeName,
          abbr: homeName.slice(0, 3).toUpperCase(),
          logo: "",
          score: null,
        },
        kickoff,
        status: { state: "pre", detail: "Manual game", completed: false },
        source: "manual",
      };

      addManualGame(current.seasonYear, current.week, game);
      els.manualForm.reset();
      mergeManualGamesIntoCurrent();
      renderGames();
      setStatus("Manual game added.", false, true);
    });
  }

  function wireBackup() {
    els.exportBtn.addEventListener("click", () => {
      exportPicksJson();
      showBackupMsg("Download started.", true);
    });
    els.importInput.addEventListener("change", async () => {
      const file = els.importInput.files?.[0];
      els.importInput.value = "";
      if (!file) return;
      const result = await importPicksJson(file);
      showBackupMsg(result.message, result.ok);
      renderGames();
      refreshAccuracyView();
    });
  }

  function wireTeamSelect() {
    els.teamSelect.addEventListener("change", () => {
      renderTeamPanel(els.teamSelect.value);
    });
  }

  async function refreshWeek() {
    loading = true;
    updateWeekControls();
    setStatus("Loading games…");
    clearRefreshTimer();

    try {
      const result = await loadWeekGames(current.week, current.seasonYear);
      current.games = sortGamesForDisplay(result.games);
      current.week = result.week;
      current.seasonYear = result.seasonYear;
      current.label = result.label;
      mergeManualGamesIntoCurrent();
      mergeWeekIntoSeasonBundle(current.week, current.games);
      completedGameRows = flattenCompletedGames(seasonBundle.weeks || []);

      const upcoming = current.games.filter((g) => g.status?.state === "pre").length;
      setStatus(
        current.games.length
          ? `${current.games.length} games · ${upcoming} upcoming`
          : "No games listed for this week.",
        false,
        !!current.games.length
      );
    } catch (err) {
      current.games = mergeFromSnapshotWeek(current.week);
      mergeManualGamesIntoCurrent();
      setStatus(
        (err.message || "Fetch failed.") + " Showing saved data if available.",
        true
      );
      els.manualPanel.open = true;
    }

    els.weekNumber.textContent = String(current.week);
    els.seasonLabel.textContent = `${current.seasonYear} regular season · ${current.label}`;
    loading = false;
    updateWeekControls();
    renderGames();
    updateLastUpdatedLabel();

    if (current.week === currentNflWeek && hasLiveGames(current.games)) {
      els.liveRefreshNote.hidden = false;
      refreshTimer = setInterval(() => {
        if (!loading) void softRefreshScores();
      }, REFRESH_MS);
    } else {
      els.liveRefreshNote.hidden = true;
    }
  }

  function mergeWeekIntoSeasonBundle(week, games) {
    if (!seasonBundle.weeks) seasonBundle.weeks = [];
    const rest = seasonBundle.weeks.filter((w) => w.week !== week);
    rest.push({ week, games });
    rest.sort((a, b) => a.week - b.week);
    seasonBundle.weeks = rest;
  }

  function mergeFromSnapshotWeek(week) {
    const block = (seasonBundle.weeks || []).find((w) => w.week === week);
    return block ? sortGamesForDisplay(block.games) : [];
  }

  async function softRefreshScores() {
    try {
      const result = await loadWeekGames(current.week, current.seasonYear);
      current.games = sortGamesForDisplay(result.games);
      mergeManualGamesIntoCurrent();
      mergeWeekIntoSeasonBundle(current.week, current.games);
      completedGameRows = flattenCompletedGames(seasonBundle.weeks || []);
      renderGames();
      updateLastUpdatedLabel();
    } catch {
      /* ignore transient errors */
    }
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function mergeManualGamesIntoCurrent() {
    const manual = getManualGames(current.seasonYear, current.week);
    const ids = new Set(current.games.map((g) => g.id));
    for (const g of manual) {
      if (!ids.has(g.id)) current.games.push(g);
    }
    current.games = sortGamesForDisplay(current.games);
  }

  function updateWeekControls() {
    els.weekPrev.disabled = current.week <= minWeek || loading;
    els.weekNext.disabled = current.week >= currentNflWeek + 1 || loading;
  }

  function renderGames() {
    els.gamesList.innerHTML = "";
    if (!current.games.length) {
      els.gamesList.innerHTML =
        '<p class="empty-state">No games to show. Try another week or add one manually.</p>';
      return;
    }

    for (const game of current.games) {
      els.gamesList.appendChild(buildGameCard(game));
    }
  }

  function buildGameCard(game) {
    const card = document.createElement("article");
    card.className = "game-card";
    const pick = getPick(current.seasonYear, current.week, game.id);
    const locked = isGameLocked(game);
    const winner = getWinnerSide(game);
    const grade = gradePick(game, pick);

    const prediction = predictMatchup(
      game.away.id,
      game.home.id,
      completedGameRows,
      current.week
    );

    const meta = document.createElement("div");
    meta.className = "game-card__meta";
    meta.innerHTML = `
      <span>${formatKickoff(game.kickoff)}</span>
      <span class="badge">${escapeHtml(game.status.detail || statusLabel(game))}</span>
    `;
    card.appendChild(meta);

    const teams = document.createElement("div");
    teams.className = "game-card__teams";
    teams.appendChild(buildTeamButton(game, "away", pick, locked, winner));
    const at = document.createElement("div");
    at.className = "game-card__at";
    at.textContent = "@";
    teams.appendChild(at);
    teams.appendChild(buildTeamButton(game, "home", pick, locked, winner));
    card.appendChild(teams);

    const predRow = document.createElement("div");
    predRow.className = "predictor-row";
    const predTeam =
      prediction.pickedSide === "home" ? game.home.name : game.away.name;
    predRow.innerHTML = `
      <span class="predictor-tag">Pick Six Predictor</span>
      <span><strong>${escapeHtml(predTeam)}</strong> · ${prediction.confidence}% confidence</span>
    `;
    card.appendChild(predRow);

    const picksRow = document.createElement("div");
    picksRow.className = "picks-compare";
    const userText = pick ? pick.teamName : "No pick yet";
    picksRow.innerHTML = `
      <span class="pick-label">Your pick:</span> <span>${escapeHtml(userText)}</span>
      <span class="pick-divider">|</span>
      <span class="pick-label">Model:</span> <span>${escapeHtml(predTeam)}</span>
    `;
    card.appendChild(picksRow);

    const result = document.createElement("div");
    result.className = "game-card__result " + resultClass(grade, pick);
    result.textContent = resultMessage(grade, pick, game, winner);
    card.appendChild(result);

    return card;
  }

  function buildTeamButton(game, side, pick, locked, winner) {
    const team = game[side];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "team-btn";
    btn.dataset.side = side;

    if (pick && pick.pickedSide === side) btn.classList.add("team-btn--picked");
    if (winner === side) btn.classList.add("team-btn--winner-final");
    if (locked) {
      btn.classList.add("team-btn--locked");
      btn.disabled = true;
    }

    const logoHtml = team.logo
      ? `<img src="${escapeAttr(team.logo)}" alt="" width="56" height="56" loading="lazy" />`
      : `<span class="team-btn__abbr" aria-hidden="true">${escapeHtml(team.abbr || side[0].toUpperCase())}</span>`;

    const score =
      team.score != null ? `<span class="team-btn__score">${team.score}</span>` : "";

    btn.innerHTML = `
      ${logoHtml}
      <span class="team-btn__name">${escapeHtml(team.name)}</span>
      ${score}
    `;

    if (!locked) {
      btn.addEventListener("click", () => {
        setPick(current.seasonYear, current.week, game.id, side, team.name);
        renderGames();
      });
    }

    return btn;
  }

  function resultClass(grade, pick) {
    if (!pick) return "result--pending";
    if (grade === "correct") return "result--correct";
    if (grade === "wrong") return "result--wrong";
    return "result--pending";
  }

  function resultMessage(grade, pick, game, winner) {
    if (!pick) {
      return !isGameLocked(game)
        ? "Tap a team to pick the winner."
        : "No pick saved.";
    }
    if (grade === "pending") {
      return `Your pick: ${pick.teamName}. Waiting for final score.`;
    }
    if (grade === "correct") {
      return `Correct — you picked ${pick.teamName}.`;
    }
    if (grade === "wrong") {
      const winTeam = winner === "home" ? game.home.name : game.away.name;
      return `Miss — you picked ${pick.teamName}; ${winTeam} won.`;
    }
    return "";
  }

  function statusLabel(game) {
    const s = game.status?.state;
    if (s === "in") return "Live";
    if (s === "post") return "Final";
    return "Upcoming";
  }

  function formatKickoff(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  async function refreshAccuracyView() {
    renderPredictorAccuracySummary();

    let weekGames = current.games.length
      ? current.games
      : mergeFromSnapshotWeek(current.week);
    weekGames = weekGames.concat(getManualGames(current.seasonYear, current.week));

    const weekSum = summarizeWeek(weekGames, current.seasonYear, current.week);
    els.statWeekRecord.textContent = formatRecord(weekSum.wins, weekSum.losses);
    els.statWeekDetail.textContent = buildDetailLine(weekSum);

    const seasonAgg = await aggregateSeason(current.seasonYear);
    els.statSeasonRecord.textContent = formatRecord(seasonAgg.wins, seasonAgg.losses);
    els.statSeasonAccuracy.textContent =
      seasonAgg.graded > 0
        ? `${seasonAgg.accuracy}% accuracy (${seasonAgg.graded} graded picks)`
        : "Make picks on finished games to see accuracy.";

    els.accUserOverall.textContent =
      seasonAgg.accuracy != null ? `${seasonAgg.accuracy}%` : "—";
    els.accUserDetail.textContent =
      seasonAgg.graded > 0
        ? `${formatRecord(seasonAgg.wins, seasonAgg.losses)} on ${seasonAgg.graded} games`
        : "No graded picks yet.";

    renderHistory(seasonAgg.byWeek);
    renderAccuracyChart(predictorBacktest?.chart || []);
    renderPredictorWeekList(predictorBacktest?.byWeek || []);

    const seasonVs = aggregateSeasonVsPredictor(current.seasonYear);
    if (seasonVs.graded > 0) {
      els.statVsPredictor.textContent = `${seasonVs.userCorrect} vs ${seasonVs.predictorCorrect}`;
      els.statVsDetail.textContent = `Season correct picks (you vs Pick Six Predictor) on ${seasonVs.graded} finals.`;
    }
  }

  function aggregateSeasonVsPredictor(seasonYear) {
    let userCorrect = 0;
    let predictorCorrect = 0;
    let graded = 0;
    for (const block of seasonBundle.weeks || []) {
      const comp = compareUserVsPredictor(
        block.games,
        seasonYear,
        block.week,
        completedGameRows
      );
      userCorrect += comp.userCorrect;
      predictorCorrect += comp.predictorCorrect;
      graded += comp.graded;
    }
    return { userCorrect, predictorCorrect, graded };
  }

  function renderPredictorWeekList(rows) {
    let host = document.getElementById("predictor-week-list");
    if (!host) {
      host = document.createElement("div");
      host.id = "predictor-week-list";
      host.className = "history-list";
      els.accuracyChart.parentElement?.appendChild(host);
    }
    host.innerHTML = "";
    if (!rows.length) return;
    const title = document.createElement("h4");
    title.className = "section-title";
    title.textContent = "Predictor by week";
    host.appendChild(title);
    for (const row of rows) {
      const el = document.createElement("div");
      el.className = "history-row";
      el.innerHTML = `<span>Week ${row.week}</span><span>${row.correct}/${row.total} · ${row.accuracy}%</span>`;
      host.appendChild(el);
    }
  }

  function renderPredictorAccuracySummary() {
    const bt = predictorBacktest || runPredictorBacktest(seasonBundle.weeks || []);
    const overall = bt.overall;
    if (overall?.accuracy != null) {
      els.accPredictorOverall.textContent = `${overall.accuracy}%`;
      els.accPredictorDetail.textContent = `${overall.correct}/${overall.total} correct (season backtest)`;
    } else {
      els.accPredictorOverall.textContent = "—";
      els.accPredictorDetail.textContent = "Not enough completed weeks yet.";
    }
  }

  function renderAccuracyChart(points) {
    els.accuracyChart.innerHTML = "";
    if (!points.length) {
      els.accuracyChart.innerHTML = '<p class="muted">Chart appears after week 1 completes.</p>';
      return;
    }

    const w = 320;
    const h = 160;
    const pad = { t: 12, r: 12, b: 28, l: 36 };
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const maxWeek = Math.max(...points.map((p) => p.week));
    const minA = 40;
    const maxA = 100;

    const coords = points.map((p) => {
      const x = pad.l + (innerW * (p.week - 1)) / Math.max(1, maxWeek - 1);
      const y = pad.t + innerH - (innerH * (p.accuracy - minA)) / (maxA - minA);
      return { x, y, ...p };
    });

    const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const circles = coords
      .map(
        (c) =>
          `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="#3d8bfd"><title>Week ${c.week}: ${c.accuracy}%</title></circle>`
      )
      .join("");

    els.accuracyChart.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" class="accuracy-svg" preserveAspectRatio="xMidYMid meet">
        <line x1="${pad.l}" y1="${pad.t + innerH}" x2="${w - pad.r}" y2="${pad.t + innerH}" stroke="#2e3d52" />
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + innerH}" stroke="#2e3d52" />
        <text x="4" y="${pad.t + 8}" fill="#9aa8b8" font-size="10">100%</text>
        <text x="4" y="${pad.t + innerH}" fill="#9aa8b8" font-size="10">${minA}%</text>
        <polyline fill="none" stroke="#3d8bfd" stroke-width="2" points="${line}" />
        ${circles}
        <text x="${pad.l}" y="${h - 6}" fill="#9aa8b8" font-size="10">Week 1</text>
        <text x="${w - pad.r - 24}" y="${h - 6}" fill="#9aa8b8" font-size="10">Week ${maxWeek}</text>
      </svg>
    `;
  }

  async function aggregateSeason(seasonYear) {
    const store = loadStore();
    const weekNumbers = new Set();
    for (const pick of Object.values(store.picks)) {
      if (pick.season === seasonYear) weekNumbers.add(pick.week);
    }
    weekNumbers.add(current.week);

    let wins = 0;
    let losses = 0;
    let graded = 0;
    const byWeek = [];
    const weeks = Array.from(weekNumbers).sort((a, b) => b - a);

    for (const w of weeks) {
      let games = [];
      try {
        const r = await loadWeekGames(w, seasonYear);
        games = r.games;
      } catch {
        games = mergeFromSnapshotWeek(w);
      }
      games = games.concat(getManualGames(seasonYear, w));
      const sum = summarizeWeek(games, seasonYear, w);
      wins += sum.wins;
      losses += sum.losses;
      graded += sum.graded;
      if (sum.graded > 0 || sum.pending > 0) {
        byWeek.push({ week: w, ...sum });
      }
    }

    const accuracy = graded ? Math.round((wins / graded) * 100) : null;
    return { wins, losses, graded, accuracy, byWeek };
  }

  function buildDetailLine(sum) {
    const parts = [];
    if (sum.pending) parts.push(`${sum.pending} waiting on final`);
    if (sum.unpicked) parts.push(`${sum.unpicked} not picked`);
    if (sum.graded && sum.accuracy != null) parts.push(`${sum.accuracy}% this week`);
    return parts.length ? parts.join(" · ") : "Pick teams on Home.";
  }

  function renderHistory(byWeek) {
    els.historyList.innerHTML = "";
    if (!byWeek.length) {
      els.historyList.innerHTML =
        '<p class="muted empty-state">No graded weeks yet.</p>';
      return;
    }
    for (const row of byWeek) {
      const el = document.createElement("div");
      el.className = "history-row";
      const acc = row.graded > 0 && row.accuracy != null ? `${row.accuracy}%` : "—";
      el.innerHTML = `<span>Week ${row.week}</span><span>${formatRecord(row.wins, row.losses)} · ${acc}</span>`;
      els.historyList.appendChild(el);
    }
  }

  async function renderStandings() {
    els.standingsRoot.innerHTML = '<p class="muted">Loading standings…</p>';
    try {
      const data = await loadStandingsData();
      const teams = [];
      for (const div of data.divisions || []) {
        for (const t of div.teams) {
          teams.push({ ...t, conference: div.conference });
        }
      }
      const byDivision = {};
      for (const t of teams) {
        const divName = divisionForAbbr(t.abbr);
        if (!byDivision[divName]) byDivision[divName] = [];
        byDivision[divName].push(t);
      }

      els.standingsRoot.innerHTML = "";
      for (const [divName, divTeams] of Object.entries(byDivision).sort()) {
        divTeams.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
        const section = document.createElement("section");
        section.className = "standings-block";
        section.innerHTML = `<h3>${escapeHtml(divName)}</h3>`;
        const table = document.createElement("div");
        table.className = "standings-table";
        table.innerHTML = `
          <div class="standings-row standings-row--head">
            <span>Team</span><span>W</span><span>L</span><span>T</span><span>PCT</span><span>DIFF</span><span>STRK</span>
          </div>`;
        for (const t of divTeams) {
          const row = document.createElement("div");
          row.className = "standings-row";
          row.innerHTML = `
            <span class="standings-team">${escapeHtml(t.abbr)}</span>
            <span>${t.wins}</span><span>${t.losses}</span><span>${t.ties}</span>
            <span>${escapeHtml(String(t.winPct))}</span>
            <span>${escapeHtml(String(t.differential))}</span>
            <span>${escapeHtml(String(t.streak))}</span>`;
          table.appendChild(row);
        }
        section.appendChild(table);
        els.standingsRoot.appendChild(section);
      }
    } catch {
      els.standingsRoot.innerHTML =
        '<p class="status-msg status-msg--error">Could not load standings.</p>';
    }
  }

  function populateTeamSelect() {
    const teams = Object.values(seasonBundle.teams || {}).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (!teams.length) {
      els.teamSelect.innerHTML = '<option value="">No team data yet</option>';
      return;
    }
    els.teamSelect.innerHTML = teams
      .map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.name)}</option>`)
      .join("");
    renderTeamPanel(teams[0].id);
  }

  function renderTeamPanel(teamId) {
    const t = seasonBundle.teams?.[teamId];
    if (!t) {
      els.teamPanel.innerHTML = "No data for this team.";
      els.teamPanel.classList.add("muted");
      return;
    }
    els.teamPanel.classList.remove("muted");
    const logRows = (t.gameLog || [])
      .slice(0, 8)
      .map(
        (g) =>
          `<tr><td>Wk ${g.week}</td><td>${escapeHtml(g.result)}</td><td>${escapeHtml(g.opponentAbbr)}</td><td>${g.scoreFor}-${g.scoreAgainst}</td><td>${escapeHtml(g.side)}</td></tr>`
      )
      .join("");

    els.teamPanel.innerHTML = `
      <div class="team-panel__head">
        ${t.logo ? `<img src="${escapeAttr(t.logo)}" alt="" width="48" height="48" />` : ""}
        <div>
          <h3>${escapeHtml(t.name)}</h3>
          <p>${t.wins}-${t.losses}-${t.ties} · PF ${t.pointsFor} · PA ${t.pointsAgainst}</p>
          <p class="muted small">Home ${t.home.wins}-${t.home.losses} · Away ${t.away.wins}-${t.away.losses}</p>
        </div>
      </div>
      <h4>Recent games</h4>
      <table class="team-log">
        <thead><tr><th>Week</th><th>R</th><th>Opp</th><th>Score</th><th>Site</th></tr></thead>
        <tbody>${logRows || '<tr><td colspan="5">No games yet</td></tr>'}</tbody>
      </table>`;
  }

  function updateLastUpdatedLabel() {
    const info = getDataSourceInfo();
    const stamp = info.updatedAt || seasonBundle.updatedAt || predictorBacktest?.updatedAt;
    const when = stamp ? formatTimestamp(stamp) : "unknown";
    const src = info.live ? "Live ESPN" : "Saved snapshot";
    els.lastUpdated.textContent = `Last updated: ${when} (${src})`;
  }

  function formatTimestamp(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function setStatus(msg, isError, isOk) {
    els.loadStatus.textContent = msg;
    els.loadStatus.classList.toggle("status-msg--error", !!isError);
    els.loadStatus.classList.toggle("status-msg--ok", !!isOk);
  }

  function showBackupMsg(msg, ok) {
    els.backupMsg.textContent = msg;
    els.backupMsg.classList.toggle("status-msg--ok", !!ok);
    els.backupMsg.classList.toggle("status-msg--error", !ok);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }
})();
