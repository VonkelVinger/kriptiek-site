export const DILEMMA_ACHIEVEMENT_CATALOG = [
  { id: "dilemma_completed_1", family: "completed", threshold: null, prestige: 10, label: "Eerste Dilemma" },
  { id: "dilemma_completed_10", family: "completed", threshold: 10, prestige: 20, label: "10 Dilemmas voltooi" },
  { id: "dilemma_completed_25", family: "completed", threshold: 25, prestige: 30, label: "25 Dilemmas voltooi" },
  { id: "dilemma_completed_50", family: "completed", threshold: 50, prestige: 40, label: "50 Dilemmas voltooi" },
  { id: "dilemma_completed_100", family: "completed", threshold: 100, prestige: 50, label: "100 Dilemmas voltooi" },
  { id: "dilemma_completed_250", family: "completed", threshold: 250, prestige: 60, label: "250 Dilemmas voltooi" },
  { id: "dilemma_completed_500", family: "completed", threshold: 500, prestige: 70, label: "500 Dilemmas voltooi" },
  { id: "dilemma_completed_1000", family: "completed", threshold: 1000, prestige: 80, label: "1 000 Dilemmas voltooi" },
  { id: "dilemma_solved_10", family: "solved", threshold: 10, prestige: 25, label: "10 Dilemmas opgelos" },
  { id: "dilemma_solved_25", family: "solved", threshold: 25, prestige: 35, label: "25 Dilemmas opgelos" },
  { id: "dilemma_solved_50", family: "solved", threshold: 50, prestige: 45, label: "50 Dilemmas opgelos" },
  { id: "dilemma_solved_100", family: "solved", threshold: 100, prestige: 55, label: "100 Dilemmas opgelos" },
  { id: "dilemma_solved_250", family: "solved", threshold: 250, prestige: 65, label: "250 Dilemmas opgelos" },
  { id: "dilemma_solved_500", family: "solved", threshold: 500, prestige: 75, label: "500 Dilemmas opgelos" },
  { id: "dilemma_streak_5", family: "streak", threshold: 5, prestige: 28, label: "Vyf suksesse in ’n ry" },
  { id: "dilemma_streak_10", family: "streak", threshold: 10, prestige: 38, label: "Tien suksesse in ’n ry" },
  { id: "dilemma_streak_25", family: "streak", threshold: 25, prestige: 58, label: "25 suksesse in ’n ry" },
  { id: "dilemma_streak_50", family: "streak", threshold: 50, prestige: 78, label: "50 suksesse in ’n ry" },
  { id: "dilemma_streak_100", family: "streak", threshold: 100, prestige: 98, label: "100 suksesse in ’n ry" },
  { id: "dilemma_first_guess_1", family: "firstGuess", threshold: 1, prestige: 22, label: "Eerste keer met een raaiskoot opgelos" },
  { id: "dilemma_first_guess_5", family: "firstGuess", threshold: 5, prestige: 42, label: "5 keer met een raaiskoot opgelos" },
  { id: "dilemma_first_guess_10", family: "firstGuess", threshold: 10, prestige: 62, label: "10 keer met een raaiskoot opgelos" },
  { id: "dilemma_first_guess_25", family: "firstGuess", threshold: 25, prestige: 82, label: "25 keer met een raaiskoot opgelos" }
];

export const DILEMMA_ACHIEVEMENT_LABELS = DILEMMA_ACHIEVEMENT_CATALOG.reduce((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {});

export const DILEMMA_ACHIEVEMENT_LEGACY_ALIASES = {
  "dilemma-first": "dilemma_completed_1",
  "dilemma-played-25": "dilemma_completed_25",
  "dilemma-played-50": "dilemma_completed_50",
  "dilemma-played-100": "dilemma_completed_100",
  "dilemma-streak-5": "dilemma_streak_5",
  "dilemma-streak-10": "dilemma_streak_10"
};

const CATALOG_BY_ID = new Map(
  DILEMMA_ACHIEVEMENT_CATALOG.map((entry) => [entry.id, entry])
);

const FAMILY_PRESTIGE_TIEBREAK = {
  firstGuess: 0,
  streak: 1,
  solved: 2,
  completed: 3
};

function familyTiebreakRank(family) {
  return FAMILY_PRESTIGE_TIEBREAK[family] ?? Number.MAX_SAFE_INTEGER;
}

function compareAchievementPrestige(left, right) {
  const leftPrestige = Number(left?.prestige || 0);
  const rightPrestige = Number(right?.prestige || 0);
  if (leftPrestige !== rightPrestige) return rightPrestige - leftPrestige;

  const familyRankDiff = familyTiebreakRank(left?.family) - familyTiebreakRank(right?.family);
  if (familyRankDiff !== 0) return familyRankDiff;

  const leftThreshold = Number.isFinite(Number(left?.threshold)) ? Number(left.threshold) : -1;
  const rightThreshold = Number.isFinite(Number(right?.threshold)) ? Number(right.threshold) : -1;
  if (leftThreshold !== rightThreshold) return rightThreshold - leftThreshold;

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

let medalRenderCounter = 0;

const MEDAL_FAMILY_META = {
  completed: {
    base: "#1f4fa8",
    dark: "#0e2f6e",
    mid: "#2b69d0",
    light: "#75b3ff",
    symbol: "#f9efcc"
  },
  solved: {
    base: "#237338",
    dark: "#134921",
    mid: "#2f9449",
    light: "#84ce81",
    symbol: "#f8f0cf"
  },
  streak: {
    base: "#cf8c0b",
    dark: "#8f5600",
    mid: "#f0b525",
    light: "#ffe291",
    symbol: "#fff4d1"
  },
  firstGuess: {
    base: "#7141b8",
    dark: "#492271",
    mid: "#8d57d9",
    light: "#c7a2ff",
    symbol: "#f9edc9"
  }
};

function hexToRgb(hex) {
  const safe = String(hex || "").replace("#", "");
  const expanded = safe.length === 3 ? safe.split("").map((ch) => ch + ch).join("") : safe;
  const int = Number.parseInt(expanded, 16);
  if (!Number.isFinite(int)) return { r: 255, g: 255, b: 255 };
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getMedalPalette(family, locked) {
  if (locked) {
    return {
      base: "#60656d",
      dark: "#2e333a",
      mid: "#7a818a",
      light: "#a6afb9",
      symbol: "#ede4d1",
      rimLight: "#c7ccd3",
      rimMid: "#727b86",
      rimDark: "#262b32",
      plaqueLight: "#d4d7dd",
      plaqueDark: "#59616b",
      dot: "#a9b0b9"
    };
  }

  const meta = MEDAL_FAMILY_META[family] || MEDAL_FAMILY_META.completed;
  return {
    ...meta,
    rimLight: "#ffe7a0",
    rimMid: "#d89b1d",
    rimDark: "#8f5d00",
    plaqueLight: "#f6cb52",
    plaqueDark: "#bf7b08",
    dot: "#f9dd86"
  };
}

function renderLaurelBranch(side, palette, compact, prefix) {
  const direction = side === "left" ? -1 : 1;
  const leafCount = compact ? 4 : 6;
  const leaves = Array.from({ length: leafCount }, (_, index) => {
    const ratio = leafCount === 1 ? 0 : index / (leafCount - 1);
    const x = 60 + direction * (16 + ratio * 15);
    const y = 86 - ratio * (26 + (compact ? 2 : 6));
    const rotation = direction * (35 + ratio * 18);
    const rx = compact ? 2.8 : 3.2;
    const ry = compact ? 6 : 7.2;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx}" ry="${ry}" fill="url(#${prefix}-laurel-${side})" transform="rotate(${rotation} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join("");

  const startX = 60 + direction * 12;
  const midX = 60 + direction * 30;
  const endX = 60 + direction * 34;
  const stem = `<path d="M ${startX} 93 C ${midX} 84, ${midX} 64, ${endX} 47" fill="none" stroke="${hexToRgba(palette.rimDark, 0.85)}" stroke-width="2.4" stroke-linecap="round"/>`;
  return `<g opacity="0.98">${stem}${leaves}</g>`;
}

function renderMedalSymbol(family, palette) {
  if (family === "completed") {
    return `
      <path d="M 39 66 L 52 79 L 83 47" fill="none" stroke="${hexToRgba(palette.dark, 0.36)}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 39 64 L 52 77 L 83 45" fill="none" stroke="${palette.symbol}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    `;
  }

  if (family === "solved") {
    return `
      <text x="60" y="77" text-anchor="middle" font-size="54" font-weight="900" font-family="Montserrat, Arial, sans-serif" fill="${hexToRgba(palette.dark, 0.34)}">D</text>
      <text x="60" y="74" text-anchor="middle" font-size="54" font-weight="900" font-family="Montserrat, Arial, sans-serif" fill="${palette.symbol}">D</text>
    `;
  }

  if (family === "streak") {
    return `
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <g stroke="${hexToRgba(palette.dark, 0.34)}" stroke-width="8.8">
          <rect x="34" y="46" width="29" height="18" rx="9" transform="rotate(-38 48.5 55)"/>
          <rect x="58" y="54" width="29" height="18" rx="9" transform="rotate(-38 72.5 63)"/>
        </g>
        <g stroke="${palette.symbol}" stroke-width="6.4">
          <rect x="34" y="44" width="29" height="18" rx="9" transform="rotate(-38 48.5 53)"/>
          <rect x="58" y="52" width="29" height="18" rx="9" transform="rotate(-38 72.5 61)"/>
        </g>
        <path d="M 55 66 L 67 56" stroke="${hexToRgba(palette.dark, 0.55)}" stroke-width="3.3"/>
        <path d="M 57 60 L 65 53.5" stroke="${hexToRgba("#fffdf2", 0.92)}" stroke-width="1.8"/>
        <g stroke="${hexToRgba("#fffdf2", 0.34)}" stroke-width="1.1">
          <path d="M 39 50 C 43 46, 52 45, 57 48"/>
          <path d="M 62 58 C 66 54, 75 53, 81 57"/>
        </g>
      </g>
    `;
  }

  return `
    <text x="60" y="79" text-anchor="middle" font-size="60" font-weight="900" font-family="Montserrat, Arial, sans-serif" fill="${hexToRgba(palette.dark, 0.34)}">1</text>
    <text x="60" y="76" text-anchor="middle" font-size="60" font-weight="900" font-family="Montserrat, Arial, sans-serif" fill="${palette.symbol}">1</text>
  `;
}

function lockedTextFill(locked) {
  return locked ? "#f5efe0" : "#fff8dc";
}

function renderThresholdPlaque(threshold, locked, palette, compact, prefix) {
  if (threshold == null) return "";
  const fontSize = String(threshold).length >= 4 ? 14 : 18;
  const shieldPath = compact
    ? "M40 88 L80 88 L84 94 L81 111 Q80 115 75 117 L45 117 Q40 115 39 111 L36 94 Z"
    : "M39 87 L81 87 L85 93 L82 112 Q81 117 75 119 L45 119 Q39 117 38 112 L35 93 Z";
  return `
    <g>
      <path d="${shieldPath}" fill="url(#${prefix}-plaque-fill)" stroke="${palette.rimDark}" stroke-width="2.2"/>
      <path d="M 44 92 C 53 89, 67 89, 77 92" fill="none" stroke="${hexToRgba("#fff7d8", 0.52)}" stroke-width="2" stroke-linecap="round"/>
      <text x="60" y="108" text-anchor="middle" font-size="${fontSize}" font-weight="900" font-family="Montserrat, Arial, sans-serif" fill="${lockedTextFill(locked)}">${threshold}</text>
    </g>
  `;
}

function renderDilemmaMedalSvg(options) {
  const {
    family = "completed",
    threshold = null,
    earned = true,
    locked = !earned,
    size = 76
  } = options || {};

  const compact = Number(size) <= 72;
  const palette = getMedalPalette(family, locked);
  const prefix = `dilemma-medal-${family}-${medalRenderCounter++}`;
  const symbolMarkup = renderMedalSymbol(family, palette);
  const plaqueMarkup = renderThresholdPlaque(threshold, locked, palette, compact, prefix);
  const upperDots = compact ? [34, 60, 86] : [27, 41, 60, 79, 93];
  const dotMarkup = upperDots.map((x) => `<circle cx="${x}" cy="23" r="${compact ? 1.7 : 2.1}" fill="${palette.dot}" opacity="0.9"/>`).join("");

  return `
    <svg class="dilemma-medal-svg" viewBox="0 0 120 124" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${prefix}-rim" x1="18" y1="16" x2="96" y2="102" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${palette.rimLight}"/>
          <stop offset="0.45" stop-color="${palette.rimMid}"/>
          <stop offset="1" stop-color="${palette.rimDark}"/>
        </linearGradient>
        <linearGradient id="${prefix}-rimInner" x1="28" y1="20" x2="88" y2="98" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${hexToRgba(palette.rimLight, 0.96)}"/>
          <stop offset="0.48" stop-color="${hexToRgba(palette.rimMid, 0.95)}"/>
          <stop offset="1" stop-color="${hexToRgba(palette.rimDark, 0.92)}"/>
        </linearGradient>
        <radialGradient id="${prefix}-core" cx="42%" cy="28%" r="70%">
          <stop offset="0" stop-color="${palette.light}"/>
          <stop offset="0.36" stop-color="${palette.mid}"/>
          <stop offset="1" stop-color="${palette.dark}"/>
        </radialGradient>
        <linearGradient id="${prefix}-coreEdge" x1="34" y1="28" x2="82" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${hexToRgba(palette.light, 0.92)}"/>
          <stop offset="1" stop-color="${hexToRgba(palette.dark, 0.95)}"/>
        </linearGradient>
        <linearGradient id="${prefix}-plaque-fill" x1="39" y1="88" x2="81" y2="118" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${palette.plaqueLight}"/>
          <stop offset="1" stop-color="${palette.plaqueDark}"/>
        </linearGradient>
        <linearGradient id="${prefix}-laurel-left" x1="22" y1="49" x2="49" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${hexToRgba(palette.rimLight, 0.98)}"/>
          <stop offset="1" stop-color="${hexToRgba(palette.rimDark, 0.95)}"/>
        </linearGradient>
        <linearGradient id="${prefix}-laurel-right" x1="71" y1="49" x2="98" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${hexToRgba(palette.rimLight, 0.98)}"/>
          <stop offset="1" stop-color="${hexToRgba(palette.rimDark, 0.95)}"/>
        </linearGradient>
        <linearGradient id="${prefix}-star" x1="52" y1="7" x2="70" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${hexToRgba(palette.rimLight, 1)}"/>
          <stop offset="1" stop-color="${hexToRgba(palette.rimDark, 0.95)}"/>
        </linearGradient>
        <filter id="${prefix}-shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="${hexToRgba("#0f172a", locked ? 0.2 : 0.22)}"/>
        </filter>
      </defs>
      <g filter="url(#${prefix}-shadow)">
        <circle cx="60" cy="55" r="45" fill="url(#${prefix}-rim)"/>
        <circle cx="60" cy="55" r="42" fill="none" stroke="${hexToRgba(palette.rimLight, 0.92)}" stroke-width="2.1"/>
        <circle cx="60" cy="55" r="39" fill="url(#${prefix}-rimInner)"/>
        <circle cx="60" cy="55" r="34.5" fill="url(#${prefix}-core)" stroke="url(#${prefix}-coreEdge)" stroke-width="2.2"/>
        <ellipse cx="49" cy="39" rx="20" ry="11" fill="${hexToRgba("#ffffff", locked ? 0.12 : 0.22)}" transform="rotate(-22 49 39)"/>
        <path d="M 29 73 C 42 92, 76 96, 90 77" fill="none" stroke="${hexToRgba("#000000", locked ? 0.12 : 0.16)}" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="60" cy="55" r="35.8" fill="none" stroke="${hexToRgba(palette.rimLight, 0.42)}" stroke-width="1.1"/>
        ${dotMarkup}
        <g transform="translate(0 1)">${renderLaurelBranch("left", palette, compact, prefix)}</g>
        <g transform="translate(0 1)">${renderLaurelBranch("right", palette, compact, prefix)}</g>
        <path d="M60 6 L64.2 14.8 L74 16.1 L66.8 22.7 L68.8 32 L60 27.2 L51.2 32 L53.2 22.7 L46 16.1 L55.8 14.8 Z" fill="url(#${prefix}-star)" stroke="${hexToRgba(palette.rimDark, 0.9)}" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="60" cy="20" r="1.6" fill="${hexToRgba("#ffffff", 0.72)}"/>
        ${symbolMarkup}
        ${plaqueMarkup}
      </g>
    </svg>
  `;
}

export function normalizeDilemmaAchievementId(id) {
  if (!id) return null;
  return DILEMMA_ACHIEVEMENT_LEGACY_ALIASES[id] || id;
}

export function listDilemmaAchievementsByFamily(family) {
  return DILEMMA_ACHIEVEMENT_CATALOG.filter((entry) => entry.family === family);
}

export function buildMedalSpecFromAchievementId(id, options = {}) {
  const canonicalId = normalizeDilemmaAchievementId(id);
  const entry = canonicalId ? CATALOG_BY_ID.get(canonicalId) : null;
  if (!entry) return null;

  const earned = options.earned !== undefined ? options.earned : true;
  const locked = options.locked !== undefined ? options.locked : !earned;

  return {
    family: entry.family,
    threshold: entry.threshold,
    label: options.label || entry.label,
    earned,
    locked,
    size: options.size || 76,
    prestige: entry.prestige,
    achievementId: canonicalId
  };
}

export function selectDilemmaShowcaseMedals(rawAchievementIds) {
  const familyBest = new Map();

  Array.from(new Set(rawAchievementIds || []))
    .map((id) => normalizeDilemmaAchievementId(id))
    .filter(Boolean)
    .forEach((id) => {
      const entry = CATALOG_BY_ID.get(id);
      if (!entry) return;

      const currentBest = familyBest.get(entry.family);
      if (!currentBest || compareAchievementPrestige(entry, currentBest) < 0) {
        familyBest.set(entry.family, entry);
      }
    });

  return Array.from(familyBest.values())
    .sort(compareAchievementPrestige)
    .slice(0, 3)
    .map((entry) => entry.id);
}

export function selectTopDilemmaLeaderboardMedals(rawAchievementIds, options = {}) {
  return selectDilemmaShowcaseMedals(rawAchievementIds)
    .map((id) => buildMedalSpecFromAchievementId(id, {
      ...options,
      earned: true,
      locked: false
    }))
    .filter(Boolean);
}

export function createDilemmaMedalElement(options) {
  const medal = document.createElement("figure");
  medal.className = "dilemma-medal-card";
  medal.style.setProperty("--medal-size", `${options.size || 76}px`);
  const locked = options.locked ?? options.earned === false;
  if (locked) medal.dataset.locked = "true";

  const visual = document.createElement("div");
  visual.className = "dilemma-medal-visual";
  visual.innerHTML = renderDilemmaMedalSvg(options);

  const caption = document.createElement("figcaption");
  caption.className = "dilemma-medal-label";
  caption.textContent = options.label || "Dilemma-medalje";

  medal.append(visual, caption);
  return medal;
}

export function renderMedalCollection(container, medalSpecs) {
  const childTag = container.tagName === "UL" ? "li" : "div";
  container.replaceChildren(...medalSpecs.map((spec) => {
    const slot = document.createElement(childTag);
    slot.className = "dilemma-medal-slot";
    slot.appendChild(createDilemmaMedalElement(spec));
    return slot;
  }));
}
