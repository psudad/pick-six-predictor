/**
 * divisions.js — Map team abbreviations to division names for standings grouping.
 */
const NFL_DIVISIONS = {
  "AFC East": ["BUF", "MIA", "NE", "NYJ"],
  "AFC North": ["BAL", "CIN", "CLE", "PIT"],
  "AFC South": ["HOU", "IND", "JAX", "TEN"],
  "AFC West": ["DEN", "KC", "LAC", "LV"],
  "NFC East": ["DAL", "NYG", "PHI", "WSH"],
  "NFC North": ["CHI", "DET", "GB", "MIN"],
  "NFC South": ["ATL", "CAR", "NO", "TB"],
  "NFC West": ["ARI", "LAR", "SF", "SEA"],
};

function divisionForAbbr(abbr) {
  for (const [name, teams] of Object.entries(NFL_DIVISIONS)) {
    if (teams.includes(abbr)) {
      return name;
    }
  }
  return "Other";
}
