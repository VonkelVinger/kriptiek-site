// functions/index.js  (2nd-gen)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { DateTime } = require("luxon");
const axios = require("axios");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const REGION = "europe-west1";

// Placement bonus table for positions 1–10
const PLACEMENT_POINTS = [200, 175, 150, 125, 110, 100, 90, 80, 70, 60];

const GAME_COLL = "blitstiekGames";
const LEADERBOARD_SUB = "leaderboard";

function lockPath(gameId) {
  return db.doc("jobLocks/blitstiek__" + gameId);
}

function gameIdFor(date) {
  const dt = DateTime.fromJSDate(date || new Date(), {
    zone: "Africa/Johannesburg",
  });
  return "Game" + dt.toFormat("yyyy-LL-dd");
}

async function awardDailyPlacementFor(gameId) {
  const lockRef = lockPath(gameId);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    logger.info("Daily job already completed — skipping.", { gameId });
    return { status: "already_done", gameId };
  }

  const boardSnap = await db
    .collection(GAME_COLL)
    .doc(gameId)
    .collection(LEADERBOARD_SUB)
    .orderBy("time", "asc")
    .limit(10)
    .get();

  const winners = boardSnap.docs.map((d, i) => {
    const data = d.data() || {};
    return {
      ref: d.ref,
      data,
      place: i + 1,
      bonus: PLACEMENT_POINTS[i] || 0,
    };
  });

  logger.info("Computed placements", {
    gameId,
    placements: winners.map((w) => ({
      place: w.place,
      bonus: w.bonus,
      time: w.data && w.data.time ? w.data.time : null,
      kBlit_total: w.data && w.data.kBlit_total ? w.data.kBlit_total : 0,
    })),
  });

  // 🔹 Preload previous overall totals for each winner (outside the transaction)
  const prevTotals = {};

  for (const w of winners) {
    const data = w.data;
    const uid =
      w.ref.id ||
      (data && (data.uid || data.userId)) ||
      null;

    if (!uid || prevTotals[uid] !== undefined) continue;

    const snap = await db.collection("users").doc(String(uid)).get();
    prevTotals[uid] = snap.exists
      ? Number(snap.data().blitstiekTotal || 0)
      : 0;
  }

  // 🔹 Transaction: only writes (all reads happened above)
  await db.runTransaction(async (tx) => {
    const freshLock = await tx.get(lockRef);
    if (freshLock.exists) return;

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      const data = w.data;

      const uid =
        w.ref.id ||
        (data && (data.uid || data.userId)) ||
        null;

      const basePoints = Number((data && data.kBlit_total) || 0);
      const placementBonus = Number(w.bonus || 0);

      // Points earned for THIS day:
      const dayIncrement = basePoints + placementBonus;

      // Previous overall total from users/{uid}
      const prevTotal = uid ? (prevTotals[uid] || 0) : 0;
      const newTotal = prevTotal + dayIncrement;

      // 1) Update leaderboard row (store this day's total + placement info)
      tx.update(w.ref, {
        placementBonus,
        placementPlace: w.place,
        total: dayIncrement,
        placementAwardedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 2) Update per-user overall total
      if (uid) {
        const userRef = db.collection("users").doc(String(uid));
        tx.set(
          userRef,
          {
            blitstiekTotal: newTotal,
            blitstiekUpdatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    tx.set(lockRef, {
      done: true,
      awardedCount: winners.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      gameId,
      ruleVersion: "2025-10-26",
    });
  });

  logger.info("Placement bonuses awarded.", {
    gameId,
    count: winners.length,
  });
  return { status: "ok", gameId, count: winners.length };
}// ----------------------
// SLIMSTIEK (medals by score) — V2
// ----------------------

// Medal bonus by placement (top 3 only)
const SLIMSTIEK_MEDAL_BONUS = [200, 175, 150]; // place 1/2/3

const SLIMSTIEK_GAME_COLL = "slimstiekGames";       // slimstiekGames/{GameYYYY-MM-DD}
const SLIMSTIEK_LB_SUB    = "leaderboard";          // slimstiekGames/{gameId}/leaderboard/{uid}

function slimstiekLockPath(gameId) {
  return db.doc("jobLocks/slimstiek__" + gameId);
}

async function awardSlimstiekMedalsFor(gameId) {
  const lockRef = slimstiekLockPath(gameId);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    logger.info("Slimstiek daily job already completed — skipping.", { gameId });
    return { status: "already_done", gameId };
  }

  // Top 3 by score desc, ts asc (exactly how slimstiek.html ranks)
  const boardSnap = await db
    .collection(SLIMSTIEK_GAME_COLL)
    .doc(String(gameId))
    .collection(SLIMSTIEK_LB_SUB)
    .orderBy("score", "desc")
    .orderBy("ts", "asc")
    .limit(3)
    .get();

  const winners = boardSnap.docs.map((d, i) => {
    const data = d.data() || {};
    return {
      ref: d.ref,
      uid: d.id,
      place: i + 1, // 1/2/3
      bonus: SLIMSTIEK_MEDAL_BONUS[i] || 0,
      score: Number(data.score || 0),
      ts: data.ts || null,
    };
  });

  logger.info("Computed Slimstiek placements", {
    gameId,
    placements: winners.map((w) => ({
      uid: w.uid,
      place: w.place,
      bonus: w.bonus,
      score: w.score,
      ts: w.ts ? "present" : null,
    })),
  });

  // Transaction: writes only (same pattern as your other jobs)
  await db.runTransaction(async (tx) => {
    const freshLock = await tx.get(lockRef);
    if (freshLock.exists) return;

    for (const w of winners) {
      // Write medal fields onto the leaderboard row (profile reads placementPlace)
      tx.update(w.ref, {
        placementBonus: Number(w.bonus || 0),
        placementPlace: Number(w.place), // 1/2/3
        total: Number(w.bonus || 0),     // keep parity with other games (not shown in UI)
        placementAwardedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    tx.set(lockRef, {
      done: true,
      awardedCount: winners.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      gameId,
      ruleVersion: "2026-02-21",
      mode: "score_desc_ts_asc_top3",
    });
  });

  logger.info("Slimstiek medals awarded.", { gameId, count: winners.length });
  return { status: "ok", gameId, count: winners.length };
}

// ----------------------
// DILEMMA (medals by guesses) — V2
// ----------------------

// Medal bonus by guesses (1=gold, 2=silver, 3=bronze)
const DILEMMA_MEDAL_BONUS = { 1: 200, 2: 175, 3: 150 };

// Dilemma collections
const DILEMMA_GAME_COLL = "games"; // games/{GameYYYY-MM-DD}
const DILEMMA_LB_SUB = "leaderboard"; // games/{gameId}/leaderboard/{uid}

function dilemmaLockPath(gameId) {
  return db.doc("jobLocks/dilemma__" + gameId);
}

// Source of truth for win/loss is userGames/{uid}/plays/{gameId}
async function readPlayResult(uid, gameId) {
  const snap = await db
    .collection("userGames")
    .doc(String(uid))
    .collection("plays")
    .doc(String(gameId))
    .get();

  if (!snap.exists) return { didWin: false, guesses: null };
  const d = snap.data() || {};
  return {
    didWin: d.result === "win",
    guesses: Number.isFinite(Number(d.guesses)) ? Math.trunc(Number(d.guesses)) : null,
  };
}
async function ensureDilemmaArchiveWord(gameId) {
  const gameRef = db.collection(DILEMMA_GAME_COLL).doc(String(gameId));
  const privateRef = gameRef.collection("private").doc("data");

  const [gameSnap, privateSnap] = await Promise.all([
    gameRef.get(),
    privateRef.get(),
  ]);

  if (!gameSnap.exists) {
    throw new Error(`Game doc not found for ${gameId}`);
  }
  if (!privateSnap.exists) {
    throw new Error(`Private answer doc not found for ${gameId}`);
  }

  const gameData = gameSnap.data() || {};
  const privateData = privateSnap.data() || {};

  const existingArchiveWord = String(gameData.archiveWord || "").trim().toUpperCase();
  const privateWord = String(privateData.word || "").trim().toUpperCase();

  if (!privateWord) {
    throw new Error(`Private word missing for ${gameId}`);
  }

  if (existingArchiveWord === privateWord) {
    return { status: "already_set", gameId };
  }

  await gameRef.set(
    {
      archiveWord: privateWord,
      archiveWordSetAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("Dilemma archiveWord ensured.", { gameId });
  return { status: "set", gameId };
}

async function awardDilemmaMedalsFor(gameId) {
  await ensureDilemmaArchiveWord(gameId);

  const lockRef = dilemmaLockPath(gameId);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    logger.info("Dilemma daily job already completed — skipping.", { gameId });
    return { status: "already_done", gameId };
  }

  // Only rows that could possibly medal (guesses <= 3)
  const boardSnap = await db
    .collection(DILEMMA_GAME_COLL)
    .doc(String(gameId))
    .collection(DILEMMA_LB_SUB)
    .where("guesses", "<=", 3)
    .get();

  const candidates = boardSnap.docs.map((d) => {
    const data = d.data() || {};
    return { ref: d.ref, uid: d.id, guesses: Number(data.guesses) || null };
  });

  // Precompute winners outside transaction (all reads happen here)
  const winners = [];
  for (const c of candidates) {
    const uid = c.uid;
    if (!uid) continue;

    let didWin = false;
    let guesses = c.guesses;

    try {
      const play = await readPlayResult(uid, gameId);
      didWin = play.didWin;
      if (play.guesses != null) guesses = play.guesses;
    } catch {
      didWin = false;
    }

    if (!didWin) continue;
    if (![1, 2, 3].includes(guesses)) continue;

    winners.push({
      ref: c.ref,
      uid,
      medalTier: guesses, // 1=gold, 2=silver, 3=bronze
      bonus: Number(DILEMMA_MEDAL_BONUS[guesses] || 0),
    });
  }

  // Preload previous totals for each awarded user (outside transaction)
  const prevTotals = {};
  for (const w of winners) {
    const uid = w.uid;
    if (!uid || prevTotals[uid] !== undefined) continue;

    const snap = await db.collection("users").doc(String(uid)).get();
    prevTotals[uid] = snap.exists ? Number(snap.data().dilemmaTotal || 0) : 0;
  }

  // Transaction: writes only (reads were done above)
  await db.runTransaction(async (tx) => {
    const freshLock = await tx.get(lockRef);
    if (freshLock.exists) return;

    for (const w of winners) {
      const uid = w.uid;

      const prevTotal = uid ? (prevTotals[uid] || 0) : 0;
      const dayIncrement = Number(w.bonus || 0);
      const newTotal = prevTotal + dayIncrement;

      // 1) Update leaderboard row with medal fields
      tx.update(w.ref, {
        placementBonus: Number(w.bonus || 0),
        placementPlace: Number(w.medalTier), // 1/2/3 as tier
        total: dayIncrement,
        placementAwardedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 2) Update per-user overall total
      if (uid) {
        const userRef = db.collection("users").doc(String(uid));
        tx.set(
          userRef,
          {
            dilemmaTotal: newTotal,
            dilemmaUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    tx.set(lockRef, {
      done: true,
      awardedCount: winners.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      gameId,
      ruleVersion: "2026-02-21",
      mode: "guesses_tiers_1_2_3_win_only",
    });
  });

  logger.info("Dilemma medals awarded.", { gameId, count: winners.length });
  return { status: "ok", gameId, count: winners.length };
}

// Nightly 23:55 SAST (2nd-gen) — SLIMSTIEK
exports.slimstiekDailyPointsV2 = onSchedule(
  {
    schedule: "55 23 * * *",
    timeZone: "Africa/Johannesburg",
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const gameId = gameIdFor();
    logger.info("Slimstiek nightly job start", { gameId });
    try {
      return await awardSlimstiekMedalsFor(gameId);
    } catch (e) {
      logger.error("Slimstiek nightly job failed", {
        gameId,
        error: (e && e.message) || String(e),
      });
      throw e;
    }
  }
);
// Manual HTTPS trigger — ?date=YYYY-MM-DD or ?gameId=GameYYYY-MM-DD
exports.slimstiekDailyPointsRunNowV2 = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    try {
      let gameId = req.query.gameId;
      const date = req.query.date;

      if (!gameId) {
        if (date) {
          const dt = DateTime.fromISO(String(date), { zone: "Africa/Johannesburg" });
          if (!dt.isValid) {
            res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD" });
            return;
          }
          gameId = "Game" + dt.toFormat("yyyy-LL-dd");
        } else {
          gameId = gameIdFor();
        }
      }

      const out = await awardSlimstiekMedalsFor(String(gameId));
      res.json(out);
    } catch (e) {
      logger.error("Slimstiek manual run failed", {
        error: (e && e.message) || String(e),
      });
      res.status(500).json({ error: (e && e.message) || String(e) });
    }
  }
);

// Nightly 23:55 SAST (2nd-gen) — DILEMMA
exports.dilemmaDailyPointsV2 = onSchedule(
  {
    schedule: "55 23 * * *",
    timeZone: "Africa/Johannesburg",
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const gameId = gameIdFor();
    logger.info("Dilemma nightly job start", { gameId });
    try {
      return await awardDilemmaMedalsFor(gameId);
    } catch (e) {
      logger.error("Dilemma nightly job failed", {
        gameId,
        error: (e && e.message) || String(e),
      });
      throw e;
    }
  }
);

// Manual HTTPS trigger — ?date=YYYY-MM-DD or ?gameId=GameYYYY-MM-DD
exports.dilemmaDailyPointsRunNowV2 = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    try {
      let gameId = req.query.gameId;
      const date = req.query.date;

      if (!gameId) {
        if (date) {
          const dt = DateTime.fromISO(String(date), { zone: "Africa/Johannesburg" });
          if (!dt.isValid) {
            res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD" });
            return;
          }
          gameId = "Game" + dt.toFormat("yyyy-LL-dd");
        } else {
          gameId = gameIdFor();
        }
      }

      const out = await awardDilemmaMedalsFor(String(gameId));
      res.json(out);
    } catch (e) {
      logger.error("Dilemma manual run failed", {
        error: (e && e.message) || String(e),
      });
      res.status(500).json({ error: (e && e.message) || String(e) });
    }
  }
);

// Nightly 23:55 SAST (2nd-gen)
exports.blitstiekDailyPointsV2 = onSchedule(
  {
    schedule: "55 23 * * *",
    timeZone: "Africa/Johannesburg",
    region: REGION,
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const gameId = gameIdFor();
    logger.info("Nightly job start", { gameId });
    try {
      return await awardDailyPlacementFor(gameId);
    } catch (e) {
      logger.error("Nightly job failed", {
        gameId,
        error: (e && e.message) || String(e),
      });
      throw e;
    }
  }
);

// Manual HTTPS trigger — ?date=YYYY-MM-DD or ?gameId=GameYYYY-MM-DD
exports.blitstiekDailyPointsRunNowV2 = onRequest(
  { region: REGION, cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    try {
      let gameId = req.query.gameId;
      const date = req.query.date;

      if (!gameId) {
        if (date) {
          const dt = DateTime.fromISO(String(date), {
            zone: "Africa/Johannesburg",
          });
		            if (!dt.isValid) {
            res
              .status(400)
              .json({ error: "Invalid date. Use YYYY-MM-DD" });
            return;
          }
          gameId = "Game" + dt.toFormat("yyyy-LL-dd");
        } else {
          gameId = gameIdFor();
        }
      }

      const out = await awardDailyPlacementFor(String(gameId));
      res.json(out);
    } catch (e) {
      logger.error("Manual run failed", {
        error: (e && e.message) || String(e),
      });
      res.status(500).json({ error: (e && e.message) || String(e) });
    }
  }
);

// ----------------------
// PAYSTACK SUBSCRIPTIONS
// ----------------------

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const PAYSTACK_MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const PAYSTACK_YEAR_MS = 366 * 24 * 60 * 60 * 1000;

function planDurationMs(plan) {
  if (plan === "annual") return PAYSTACK_YEAR_MS;
  return PAYSTACK_MONTH_MS;
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function activateSupporterFromPaystack(metadata = {}) {
  const uid = metadata.uid;
  const plan = metadata.plan;

  if (!uid || !plan) {
    throw new Error("Missing uid or plan in Paystack metadata.");
  }

  const supporterRef = db.collection("supportersPublic").doc(String(uid));
  const snap = await supporterRef.get();
  const existing = snap.exists ? (snap.data() || {}) : {};

  const nowMs = Date.now();
  const baseMs = Math.max(safeNumber(existing.untilMs, 0), nowMs);
  const untilMs = baseMs + planDurationMs(plan);

  await supporterRef.set(
    {
      active: true,
      untilMs,
      provider: "paystack",
      plan,
      updatedAtMs: nowMs
    },
    { merge: true }
  );

  return { uid, plan, untilMs };
}

const PAYSTACK_PLANS = {
  monthly: {
    code: "PLN_ac15cwgdonvqaa9",
    amount: 4000
  },
  annual: {
    code: "PLN_7y9w8vlyg4ackfg",
    amount: 40000
  }
};

exports.createCheckoutUrl = onCall(
  { region: REGION, cors: true, secrets: ["PAYSTACK_SECRET_KEY"] },
  async (req) => {
    const uid = req.auth?.uid;
    const userName = req.auth?.token?.name || "";
    const email = req.auth?.token?.email;

    if (!uid || !email) {
      throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const plan = req.data?.plan;

    if (!PAYSTACK_PLANS[plan]) {
      throw new HttpsError("invalid-argument", "Invalid plan.");
    }
    const selectedPlan = PAYSTACK_PLANS[plan];

    try {
      const response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email,
          amount: selectedPlan.amount,
          plan: selectedPlan.code,
          metadata: {
            uid,
            plan,
            userName
          }
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET}`,
            "Content-Type": "application/json"
          }
        }
      );
	        return {
        authorization_url: response.data.data.authorization_url
      };

    } catch (err) {
      logger.error("Paystack init error", err);
      throw new HttpsError("internal", "Failed to initialize payment.");
    }
  }
);

exports.paystackWebhook = onRequest(
  {
    region: REGION,
    secrets: ["PAYSTACK_SECRET_KEY"],
    cors: false,
    timeoutSeconds: 120
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const signature = req.get("x-paystack-signature") || "";
      const expectedSignature = crypto
        .createHmac("sha512", PAYSTACK_SECRET)
        .update(req.rawBody)
        .digest("hex");

      if (!signature || signature !== expectedSignature) {
        logger.error("Invalid Paystack signature");
        res.status(401).send("Invalid signature");
        return;
      }

      const event = req.body || {};
      const eventType = event.event || "";
      const data = event.data || {};
      const metadata = data.metadata || {};

      logger.info("Paystack webhook received", {
        event: eventType,
        reference: data.reference || null,
        customerEmail: data.customer?.email || data.email || null,
        uid: metadata.uid || null,
        plan: metadata.plan || null
      });

      if (eventType === "charge.success") {
        const out = await activateSupporterFromPaystack(metadata);
        logger.info("Supporter activated from Paystack", out);
      }

      res.status(200).send("OK");
    } catch (e) {
      logger.error("Paystack webhook failed", {
        error: (e && e.message) || String(e)
      });
      res.status(500).send("Webhook error");
    }
  }
);

function computeStatesForGuess(guess, target) {
  const result = Array(target.length).fill("absent");
  const targetChars = target.split("");
  const guessChars = guess.split("");

  for (let i = 0; i < guessChars.length; i++) {
    if (guessChars[i] === targetChars[i]) {
      result[i] = "correct";
      targetChars[i] = null;
      guessChars[i] = null;
    }
  }

  for (let i = 0; i < guessChars.length; i++) {
    if (!guessChars[i]) continue;
    const idx = targetChars.indexOf(guessChars[i]);
    if (idx !== -1) {
      result[i] = "present";
      targetChars[idx] = null;
    }
  }

  return result;
}

exports.checkDilemmaGuess = onCall(
  { region: REGION },
  async (req) => {
    const context = req.auth;
    const data = req.data;

    if (!context) {
      throw new HttpsError("unauthenticated", "Jy moet aangemeld wees.");
    }

    const gameId = String(data?.gameId || "").trim();
    const rawGuess = String(data?.guess || "").trim().toUpperCase();

    if (!gameId || !rawGuess) {
      throw new HttpsError("invalid-argument", "Ongeldige versoek.");
    }

    const publicRef = db.doc(`games/${gameId}`);
    const privateRef = db.doc(`games/${gameId}/private/data`);

    const [publicSnap, privateSnap] = await Promise.all([
      publicRef.get(),
      privateRef.get()
    ]);

    if (!publicSnap.exists) {
      throw new HttpsError("not-found", "Spel nie gevind nie.");
    }

    if (!privateSnap.exists) {
      throw new HttpsError("failed-precondition", "Privaat data ontbreek.");
    }

    const game = publicSnap.data() || {};
    const privateData = privateSnap.data() || {};

    const target = String(privateData.word || "").toUpperCase();
    const expectedLength = Number(game.length || target.length);

    if (!target || rawGuess.length !== expectedLength) {
      throw new HttpsError("invalid-argument", "Ongeldige poging.");
    }

    const states = computeStatesForGuess(rawGuess, target);
    const isCorrect = rawGuess === target;

    return {
      guess: rawGuess,
      states,
      isCorrect,
      length: expectedLength
    };
  }
);

// ----------------------
// DILEMMA JOURNEY ACHIEVEMENTS — V1
// ----------------------

const DILEMMA_JOURNEY_RULE_VERSION = "journey-v1";
const DILEMMA_JOURNEY_ACHIEVEMENTS = [
  { id: "dilemma-first", completed: 1 },
  { id: "dilemma-streak-5", streak: 5 },
  { id: "dilemma-streak-10", streak: 10 },
  { id: "dilemma-played-25", completed: 25 },
  { id: "dilemma-played-50", completed: 50 },
  { id: "dilemma-played-100", completed: 100 },
];

function dilemmaJourneyChronologyMs(playSnap, playData) {
  const finishedAt = playData?.finishedAt;
  if (finishedAt?.toMillis) {
    const finishedAtMs = finishedAt.toMillis();
    if (Number.isFinite(finishedAtMs)) return finishedAtMs;
  }

  if (finishedAt != null && Number.isFinite(Number(finishedAt))) {
    return Number(finishedAt);
  }

  const dateKey = String(playSnap.id || "").replace(/^Game/, "");
  const gameDateMs = Date.parse(`${dateKey}T00:00:00Z`);
  return Number.isFinite(gameDateMs) ? gameDateMs : 0;
}

exports.processDilemmaJourneyAchievements = onCall(
  { region: REGION },
  async (req) => {
    const context = req.auth;
    const data = req.data;

    if (!context) {
      throw new HttpsError("unauthenticated", "User must be logged in.");
    }

    const uid = String(context.uid);
    const gameId = String(data?.gameId || "").trim();

    if (!gameId || gameId.includes("/")) {
      throw new HttpsError("invalid-argument", "A valid gameId is required.");
    }

    const playsRef = db
      .collection("userGames")
      .doc(uid)
      .collection("plays");
    const sourcePlayRef = playsRef.doc(gameId);
    const sourcePlaySnap = await sourcePlayRef.get();

    if (!sourcePlaySnap.exists) {
      throw new HttpsError("not-found", "Dilemma play not found.");
    }

    const sourcePlay = sourcePlaySnap.data() || {};
    if (sourcePlay.result !== "win" && sourcePlay.result !== "loss") {
      throw new HttpsError(
        "failed-precondition",
        "Dilemma play does not have an explicit result."
      );
    }

    const historySnap = await playsRef.get();
    const plays = [];

    historySnap.forEach((playSnap) => {
      const play = playSnap.data() || {};
      if (play.result !== "win" && play.result !== "loss") return;

      plays.push({
        gameId: playSnap.id,
        result: play.result,
        chronologyMs: dilemmaJourneyChronologyMs(playSnap, play),
      });
    });

    plays.sort((a, b) =>
      (a.chronologyMs - b.chronologyMs) || a.gameId.localeCompare(b.gameId)
    );

    const totalCompleted = plays.length;
    const totalWins = plays.filter((play) => play.result === "win").length;
    let currentWinStreak = 0;
    let bestWinStreak = 0;

    for (const play of plays) {
      currentWinStreak = play.result === "win" ? currentWinStreak + 1 : 0;
      bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
    }

    const qualifiedIds = new Set(
      DILEMMA_JOURNEY_ACHIEVEMENTS
        .filter((achievement) =>
          (achievement.completed && totalCompleted >= achievement.completed) ||
          (achievement.streak && bestWinStreak >= achievement.streak)
        )
        .map((achievement) => achievement.id)
    );

    const sourceGuessesValue = sourcePlay.guesses == null ?
      null : Number(sourcePlay.guesses);
    const sourceGuesses = Number.isFinite(sourceGuessesValue) ?
      Math.trunc(sourceGuessesValue) : null;
    const achievementRefs = DILEMMA_JOURNEY_ACHIEVEMENTS.map((achievement) =>
      db.doc(`users/${uid}/achievements/${achievement.id}`)
    );

    const result = await db.runTransaction(async (tx) => {
      const achievementSnaps = await Promise.all(
        achievementRefs.map((achievementRef) => tx.get(achievementRef))
      );
      const earnedAchievementIds = [];
      const newlyAwardedAchievementIds = [];

      DILEMMA_JOURNEY_ACHIEVEMENTS.forEach((achievement, index) => {
        if (achievementSnaps[index].exists) {
          earnedAchievementIds.push(achievement.id);
          return;
        }

        if (!qualifiedIds.has(achievement.id)) return;

        tx.create(achievementRefs[index], {
          achievementId: achievement.id,
          awardedAt: admin.firestore.FieldValue.serverTimestamp(),
          ruleVersion: DILEMMA_JOURNEY_RULE_VERSION,
          sourceGameId: gameId,
          sourceResult: sourcePlay.result,
          sourceGuesses,
          evidence: {
            totalCompleted,
            totalWins,
            currentWinStreak,
            bestWinStreak,
          },
        });

        earnedAchievementIds.push(achievement.id);
        newlyAwardedAchievementIds.push(achievement.id);
      });

      return { earnedAchievementIds, newlyAwardedAchievementIds };
    });

    return result;
  }
);
