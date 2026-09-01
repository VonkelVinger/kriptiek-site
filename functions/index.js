// functions/index.js  (2nd-gen)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { DateTime } = require("luxon");
const axios = require("axios");
const crypto = require("crypto");
const paystack = require("./paystack-supporter-helpers");

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

function redactedPaystackCode(value) {
  if (!value || typeof value !== "string") return null;
  return `…${value.slice(-6)}`;
}

function lifecycleStatus(eventType, subscription) {
  if (eventType === "subscription.not_renew") return "not_renew";
  if (eventType === "subscription.disable") return "disabled";
  if (eventType === "invoice.payment_failed") return "payment_failed";
  if (eventType === "subscription.create") return subscription.status || "active";
  return null;
}

/**
 * Applies only webhook facts which can be mapped to a Kriptiek user without
 * email matching. Private collections retain Paystack identifiers; the public
 * entitlement document intentionally does not.
 */
async function processPaystackWebhookEvent(eventType, event) {
  const data = paystack.paymentData(event);
  const metadata = paystack.metadataFor(data);
  const subscription = paystack.subscriptionFor(data);
  const customerCode = subscription.customerCode || paystack.customerCodeFor(data);
  const paymentReference = paystack.stablePaymentReference(data);
  const nowMs = Date.now();
  const isChargeSuccess = eventType === "charge.success";
  const isPaidInvoice = eventType === "invoice.update" && paystack.successfulInvoice(data);
  const isPayment = isChargeSuccess || isPaidInvoice;
  // Paystack creates a subscription only after its initial charge. Its
  // next_payment_date is therefore a safe authoritative paid-through boundary.
  const isSubscriptionBoundary = eventType === "subscription.create" && subscription.nextPaymentMs > nowMs;
  const updatesPaidBoundary = isPayment || isSubscriptionBoundary;

  if (isPayment && !paymentReference) {
    const error = new Error("Mapped Paystack payment has no stable reference.");
    error.code = "missing-payment-reference";
    throw error;
  }

  return db.runTransaction(async (tx) => {
    const customerRef = customerCode
      ? db.collection("paystackCustomers").doc(String(customerCode))
      : null;
    const subscriptionRef = subscription.code
      ? db.collection("paystackSubscriptions").doc(String(subscription.code))
      : null;
    const processedRef = isPayment
      ? db.collection("paystackProcessedCharges").doc(paymentReference)
      : null;

    // Keep every transaction read before its writes.
    const [customerSnap, subscriptionSnap, processedSnap] = await Promise.all([
      customerRef ? tx.get(customerRef) : Promise.resolve(null),
      subscriptionRef ? tx.get(subscriptionRef) : Promise.resolve(null),
      processedRef ? tx.get(processedRef) : Promise.resolve(null),
    ]);
    const customerMapping = customerSnap?.exists ? (customerSnap.data() || {}) : null;
    const subscriptionMapping = subscriptionSnap?.exists ? (subscriptionSnap.data() || {}) : null;
    const identity = paystack.resolveIdentity({
      metadata,
      subscription: { ...subscription, mapping: subscriptionMapping },
      customer: customerMapping,
      plans: PAYSTACK_PLANS,
    });

    if (!identity.uid) {
      const error = new Error("Unable to safely map Paystack event to a Kriptiek UID.");
      error.code = "unmapped-paystack-event";
      error.paystackContext = {
        eventType,
        customerCode: redactedPaystackCode(customerCode),
        subscriptionCode: redactedPaystackCode(subscription.code),
        reference: redactedPaystackCode(paymentReference),
      };
      throw error;
    }

    const supporterRef = db.collection("supportersPublic").doc(identity.uid);
    const supporterSnap = updatesPaidBoundary ? await tx.get(supporterRef) : null;
    const existingSupporter = supporterSnap?.exists ? (supporterSnap.data() || {}) : {};
    const status = lifecycleStatus(eventType, subscription) || subscriptionMapping?.status || "active";
    const planCode = identity.planCode || subscriptionMapping?.planCode || customerMapping?.planCode ||
      (identity.planKey ? PAYSTACK_PLANS[identity.planKey]?.code : null);
    const planKey = identity.planKey || subscriptionMapping?.planKey || customerMapping?.planKey || null;
    const mappingBase = {
      uid: identity.uid,
      planKey: planKey || null,
      planCode: planCode || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    };

    if (customerRef) {
      tx.set(customerRef, {
        ...mappingBase,
        customerCode,
        nextPaymentMs: subscription.nextPaymentMs || customerMapping?.nextPaymentMs || null,
      }, { merge: true });
    }
    if (subscriptionRef) {
      tx.set(subscriptionRef, {
        ...mappingBase,
        customerCode: customerCode || subscriptionMapping?.customerCode || null,
        subscriptionCode: subscription.code,
        status,
        nextPaymentMs: subscription.nextPaymentMs || subscriptionMapping?.nextPaymentMs || null,
      }, { merge: true });
    }

    if (!updatesPaidBoundary) {
      // Lifecycle/failure events are diagnostic only: they never revoke paid or manual time.
      return { status: "recorded", uid: identity.uid, eventType };
    }

    if (isPayment && processedSnap?.exists) {
      return { status: "duplicate", uid: identity.uid, eventType };
    }

    const paidAtMs = paystack.safeMillis(data.paid_at || data.transaction_date || data.created_at) || nowMs;
    const knownNextPaymentMs = subscription.nextPaymentMs || subscriptionMapping?.nextPaymentMs ||
      customerMapping?.nextPaymentMs || null;
    const untilMs = paystack.paidThroughMs({
      existingUntilMs: existingSupporter.untilMs,
      paidAtMs,
      nextPaymentMs: knownNextPaymentMs,
      planKey,
      nowMs,
    });
    if (untilMs == null) {
      const error = new Error("Mapped Paystack payment has neither a billing boundary nor a known plan.");
      error.code = "missing-paid-through-boundary";
      throw error;
    }

    const active = paystack.supporterActive({
      untilMs,
      manualActive: existingSupporter.manualActive,
      manualUntilMs: existingSupporter.manualUntilMs,
      nowMs,
    });
    tx.set(supporterRef, {
      active,
      untilMs,
      provider: "paystack",
      ...(planKey ? { plan: planKey } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });
    if (isPayment) {
      tx.set(processedRef, {
        reference: paymentReference,
        uid: identity.uid,
        eventType,
        planKey: planKey || null,
        planCode: planCode || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAtMs: nowMs,
      });
    }

    return { status: "applied", uid: identity.uid, eventType, untilMs };
  });
}

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
      const handledEvents = new Set([
        "charge.success",
        "subscription.create",
        "invoice.update",
        "invoice.payment_failed",
        "subscription.not_renew",
        "subscription.disable",
      ]);

      logger.info("Paystack webhook received", {
        event: eventType,
        reference: redactedPaystackCode(paystack.stablePaymentReference(data)),
        hasMetadataUid: !!metadata.uid,
        hasMetadataPlan: !!metadata.plan,
      });

      if (handledEvents.has(eventType)) {
        const out = await processPaystackWebhookEvent(eventType, event);
        logger.info("Paystack supporter event processed", {
          event: eventType,
          status: out.status,
          uidSuffix: redactedPaystackCode(out.uid),
          untilMs: out.untilMs || null,
        });
      }

      res.status(200).send("OK");
    } catch (e) {
      logger.error("Paystack webhook failed", {
        error: (e && e.message) || String(e),
        code: e?.code || null,
        context: e?.paystackContext || null,
      });
      // A non-2xx response asks Paystack to retry; do not acknowledge an event
      // that could not be safely mapped or applied.
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

const ZA_TIME_ZONE = "Africa/Johannesburg";
const DERIVED_BS_PLAYABLE_STATUSES = new Set([
  "scheduled",
  "active",
  "published",
]);

function parseZaGameDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", "gameDate must use YYYY-MM-DD.");
  }

  const date = DateTime.fromFormat(value, "yyyy-LL-dd", {
    zone: ZA_TIME_ZONE,
    locale: "en-US",
  });

  if (!date.isValid || date.toFormat("yyyy-LL-dd") !== value) {
    throw new HttpsError("invalid-argument", "gameDate is not a valid calendar date.");
  }

  return date.startOf("day");
}

function legacyBsWord(data, gameType) {
  if (!data || typeof data !== "object") return "";

  const fields = gameType === "SLIMSTIEK"
    ? ["target", "targetWord", "word", "solution", "answer", "slimstiek"]
    : ["word", "target", "targetWord", "solution", "answer"];

  for (const field of fields) {
    if (typeof data[field] !== "string") continue;
    const word = data[field].trim().toUpperCase();
    if (word) return word;
  }
  return "";
}

async function readBsScheduleRecord(collectionName, gameDate) {
  const preferredRef = db.doc(`${collectionName}/Game${gameDate}`);
  const preferredSnap = await preferredRef.get();
  if (preferredSnap.exists) return preferredSnap;

  // Older B&S records may have used YYYY-MM-DD rather than GameYYYY-MM-DD.
  return db.doc(`${collectionName}/${gameDate}`).get();
}

async function readDilemmaPrivateWord(sourceDilemmaDate) {
  const preferredRef = db.doc(
    `games/Game${sourceDilemmaDate}/private/data`
  );
  const preferredSnap = await preferredRef.get();
  const privateSnap = preferredSnap.exists ? preferredSnap : await db.doc(
    `games/${sourceDilemmaDate}/private/data`
  ).get();

  const word = String(privateSnap.exists ? privateSnap.data()?.word || "" : "")
    .trim()
    .toUpperCase();
  if (!word) {
    throw new HttpsError(
      "failed-precondition",
      "The source DILEMMA word is unavailable."
    );
  }
  return word;
}

exports.resolveDerivedBsTargetWord = onCall(
  { region: REGION },
  async (req) => {
    const gameType = String(req.data?.gameType || "").trim().toUpperCase();
    if (gameType !== "BLITSTIEK" && gameType !== "SLIMSTIEK") {
      throw new HttpsError("invalid-argument", "Invalid B&S game type.");
    }

    const gameDate = parseZaGameDate(req.data?.gameDate);
    const today = DateTime.now().setZone(ZA_TIME_ZONE).startOf("day");
    if (gameDate > today) {
      throw new HttpsError(
        "failed-precondition",
        "A future B&S game is not playable yet."
      );
    }

    const gameDateKey = gameDate.toFormat("yyyy-LL-dd");
    const sourceDilemmaDate = gameDate.minus({ days: 1 }).toFormat("yyyy-LL-dd");
    const collectionName = gameType === "BLITSTIEK"
      ? "blitstiekGames"
      : "slimstiekGames";
    const scheduleSnap = await readBsScheduleRecord(collectionName, gameDateKey);

    if (!scheduleSnap.exists) {
      throw new HttpsError("not-found", "B&S game not found for this date.");
    }

    const schedule = scheduleSnap.data() || {};
    const hasV2SourceLinkMetadata =
      schedule.schemaVersion === 2 ||
      Object.prototype.hasOwnProperty.call(schedule, "targetSource") ||
      Object.prototype.hasOwnProperty.call(schedule, "sourceDilemmaDate");

    if (hasV2SourceLinkMetadata) {
      if (schedule.enabled === false) {
        throw new HttpsError("failed-precondition", "This B&S game is disabled.");
      }

      const status = String(schedule.status || "").trim().toLowerCase();
      if (!DERIVED_BS_PLAYABLE_STATUSES.has(status)) {
        throw new HttpsError("failed-precondition", "This B&S game is not playable.");
      }

      if (
        schedule.targetSource !== "dilemma-private-v1" ||
        schedule.sourceDilemmaDate !== sourceDilemmaDate
      ) {
        throw new HttpsError("failed-precondition", "Invalid DILEMMA source linkage.");
      }

      return {
        word: await readDilemmaPrivateWord(sourceDilemmaDate),
        gameDate: gameDateKey,
        sourceDilemmaDate,
        source: "dilemma-private-v1",
      };
    }

    // A record was required above: never use legacy data to invent a B&S game.
    let word = legacyBsWord(schedule, gameType);
    if (!word && gameType === "SLIMSTIEK") {
      const dailySnap = await db.doc(`daily_words/${gameDateKey}`).get();
      word = dailySnap.exists ? legacyBsWord(dailySnap.data() || {}, gameType) : "";
    }

    if (!word) {
      throw new HttpsError(
        "failed-precondition",
        "No legacy B&S target word is available for this date."
      );
    }

    return {
      word,
      gameDate: gameDateKey,
      sourceDilemmaDate,
      source: "legacy",
    };
  }
);

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
// DILEMMA JOURNEY ACHIEVEMENTS — V2
// ----------------------

const DILEMMA_JOURNEY_RULE_VERSION = "journey-v2";
const DILEMMA_JOURNEY_ACHIEVEMENTS = [
  { id: "dilemma_completed_1", metric: "completed", threshold: 1 },
  { id: "dilemma_completed_10", metric: "completed", threshold: 10 },
  { id: "dilemma_completed_25", metric: "completed", threshold: 25 },
  { id: "dilemma_completed_50", metric: "completed", threshold: 50 },
  { id: "dilemma_completed_100", metric: "completed", threshold: 100 },
  { id: "dilemma_completed_250", metric: "completed", threshold: 250 },
  { id: "dilemma_completed_500", metric: "completed", threshold: 500 },
  { id: "dilemma_completed_1000", metric: "completed", threshold: 1000 },
  { id: "dilemma_solved_10", metric: "solved", threshold: 10 },
  { id: "dilemma_solved_25", metric: "solved", threshold: 25 },
  { id: "dilemma_solved_50", metric: "solved", threshold: 50 },
  { id: "dilemma_solved_100", metric: "solved", threshold: 100 },
  { id: "dilemma_solved_250", metric: "solved", threshold: 250 },
  { id: "dilemma_solved_500", metric: "solved", threshold: 500 },
  { id: "dilemma_streak_5", metric: "streak", threshold: 5 },
  { id: "dilemma_streak_10", metric: "streak", threshold: 10 },
  { id: "dilemma_streak_25", metric: "streak", threshold: 25 },
  { id: "dilemma_streak_50", metric: "streak", threshold: 50 },
  { id: "dilemma_streak_100", metric: "streak", threshold: 100 },
  { id: "dilemma_first_guess_1", metric: "firstGuess", threshold: 1 },
  { id: "dilemma_first_guess_5", metric: "firstGuess", threshold: 5 },
  { id: "dilemma_first_guess_10", metric: "firstGuess", threshold: 10 },
  { id: "dilemma_first_guess_25", metric: "firstGuess", threshold: 25 },
];

const DILEMMA_JOURNEY_ACHIEVEMENT_ALIASES = {
  dilemma_completed_1: ["dilemma-first"],
  dilemma_completed_25: ["dilemma-played-25"],
  dilemma_completed_50: ["dilemma-played-50"],
  dilemma_completed_100: ["dilemma-played-100"],
  dilemma_streak_5: ["dilemma-streak-5"],
  dilemma_streak_10: ["dilemma-streak-10"],
};

function dilemmaJourneyAchievementIsQualified(achievement, counts) {
  if (achievement.metric === "completed") {
    return counts.totalCompleted >= achievement.threshold;
  }
  if (achievement.metric === "solved") {
    return counts.totalWins >= achievement.threshold;
  }
  if (achievement.metric === "streak") {
    return counts.bestWinStreak >= achievement.threshold;
  }
  if (achievement.metric === "firstGuess") {
    return counts.totalFirstGuessWins >= achievement.threshold;
  }
  return false;
}

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

    const userRef = db.collection("users").doc(uid);
    const playsRef = db.collection("userGames").doc(uid).collection("plays");
    const sourcePlayRef = playsRef.doc(gameId);
    const achievementPlans = DILEMMA_JOURNEY_ACHIEVEMENTS.map((achievement) => ({
      achievement,
      canonicalRef: db.doc(`users/${uid}/achievements/${achievement.id}`),
      aliasRefs: (DILEMMA_JOURNEY_ACHIEVEMENT_ALIASES[achievement.id] || []).map((legacyId) => ({
        legacyId,
        ref: db.doc(`users/${uid}/achievements/${legacyId}`),
      })),
    }));

    const result = await db.runTransaction(async (tx) => {
      const [sourcePlaySnap, historySnap] = await Promise.all([
        tx.get(sourcePlayRef),
        tx.get(playsRef),
      ]);

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

      const plays = [];
      historySnap.forEach((playSnap) => {
        const play = playSnap.data() || {};
        if (play.result !== "win" && play.result !== "loss") return;

        const guessesValue = play.guesses == null ? null : Number(play.guesses);
        const guesses = Number.isFinite(guessesValue) ?
          Math.trunc(guessesValue) : null;

        plays.push({
          gameId: playSnap.id,
          result: play.result,
          guesses,
          chronologyMs: dilemmaJourneyChronologyMs(playSnap, play),
        });
      });

      plays.sort((a, b) =>
        (a.chronologyMs - b.chronologyMs) || a.gameId.localeCompare(b.gameId)
      );

      const totalCompleted = plays.length;
      const totalWins = plays.filter((play) => play.result === "win").length;
      const totalFirstGuessWins = plays.filter(
        (play) => play.result === "win" && play.guesses === 1
      ).length;
      let currentWinStreak = 0;
      let bestWinStreak = 0;

      for (const play of plays) {
        currentWinStreak = play.result === "win" ? currentWinStreak + 1 : 0;
        bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
      }

      const successRate = totalCompleted > 0 ?
        Math.round((totalWins / totalCompleted) * 100) : 0;
      const journeyStatistics = {
        totalCompleted,
        totalWins,
        successRate,
        currentWinStreak,
        bestWinStreak,
      };
      const achievementCounts = {
        totalCompleted,
        totalWins,
        totalFirstGuessWins,
        currentWinStreak,
        bestWinStreak,
      };
      const qualifiedIds = new Set(
        DILEMMA_JOURNEY_ACHIEVEMENTS
          .filter((achievement) => dilemmaJourneyAchievementIsQualified(
            achievement,
            achievementCounts
          ))
          .map((achievement) => achievement.id)
      );
      const sourceGuessesValue = sourcePlay.guesses == null ?
        null : Number(sourcePlay.guesses);
      const sourceGuesses = Number.isFinite(sourceGuessesValue) ?
        Math.trunc(sourceGuessesValue) : null;
      const achievementStates = await Promise.all(
        achievementPlans.map(async (plan) => {
          const canonicalSnap = await tx.get(plan.canonicalRef);
          const aliasSnaps = await Promise.all(
            plan.aliasRefs.map(async (aliasPlan) => ({
              legacyId: aliasPlan.legacyId,
              snap: await tx.get(aliasPlan.ref),
            }))
          );
          const existingAlias = aliasSnaps.find((aliasSnap) => aliasSnap.snap.exists) || null;
          return {
            ...plan,
            canonicalSnap,
            existingAlias,
          };
        })
      );
      const earnedAchievementIds = [];
      const newlyAwardedAchievementIds = [];

      achievementStates.forEach((state) => {
        const { achievement, canonicalRef, canonicalSnap, existingAlias } = state;
        if (canonicalSnap.exists) {
          earnedAchievementIds.push(achievement.id);
          return;
        }

        if (existingAlias) {
          const legacyData = existingAlias.snap.data() || {};
          const legacyEvidence = legacyData.evidence &&
            typeof legacyData.evidence === "object" ?
            legacyData.evidence : {};
          tx.create(canonicalRef, {
            achievementId: achievement.id,
            awardedAt: legacyData.awardedAt || admin.firestore.FieldValue.serverTimestamp(),
            ruleVersion: DILEMMA_JOURNEY_RULE_VERSION,
            sourceGameId: legacyData.sourceGameId || gameId,
            sourceResult: legacyData.sourceResult || sourcePlay.result,
            sourceGuesses: legacyData.sourceGuesses == null ? sourceGuesses : legacyData.sourceGuesses,
            evidence: {
              ...legacyEvidence,
              totalCompleted,
              totalWins,
              totalFirstGuessWins,
              currentWinStreak,
              bestWinStreak,
            },
            migratedFromAchievementId: existingAlias.legacyId,
          });

          earnedAchievementIds.push(achievement.id);
          return;
        }

        if (!qualifiedIds.has(achievement.id)) return;

        tx.create(canonicalRef, {
          achievementId: achievement.id,
          awardedAt: admin.firestore.FieldValue.serverTimestamp(),
          ruleVersion: DILEMMA_JOURNEY_RULE_VERSION,
          sourceGameId: gameId,
          sourceResult: sourcePlay.result,
          sourceGuesses,
          evidence: {
            totalCompleted,
            totalWins,
            totalFirstGuessWins,
            currentWinStreak,
            bestWinStreak,
          },
        });

        earnedAchievementIds.push(achievement.id);
        newlyAwardedAchievementIds.push(achievement.id);
      });

      tx.set(userRef, {
        journeyDilemmaTotalCompleted: totalCompleted,
        journeyDilemmaTotalWins: totalWins,
        journeyDilemmaTotalFirstGuessWins: totalFirstGuessWins,
        journeyDilemmaSuccessRate: successRate,
        journeyDilemmaCurrentWinStreak: currentWinStreak,
        journeyDilemmaBestWinStreak: bestWinStreak,
        journeyDilemmaStatsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        journeyStatistics,
        earnedAchievementIds,
        newlyAwardedAchievementIds,
      };
    });

    return result;
  }
);
