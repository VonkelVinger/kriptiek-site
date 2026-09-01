"use strict";

const { safeMillis, planKeyFor, planDurationMs } = require("./paystack-supporter-helpers");

function redactEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1) || "…"}***@${domain}`;
}

function normalizeSubscription(raw = {}, plans = {}) {
  const planCode = raw.plan?.plan_code || raw.plan?.code || raw.plan_code ||
    (typeof raw.plan === "string" ? raw.plan : null);
  return {
    customerCode: raw.customer?.customer_code || raw.customer_code || null,
    customerId: raw.customer?.id || raw.customer_id || null,
    emailHint: redactEmail(raw.customer?.email || raw.email),
    subscriptionCode: raw.subscription_code || raw.code || null,
    planCode,
    planKey: planKeyFor(planCode, null, plans),
    status: raw.status || null,
    nextPaymentMs: safeMillis(raw.next_payment_date),
  };
}

function currentSubscription(status) {
  return ["active", "non-renewing", "attention"].includes(String(status || "").toLowerCase());
}

function historicalMetadata(transaction = {}) {
  transaction = transaction || {};
  const metadata = transaction.metadata && typeof transaction.metadata === "object" ? transaction.metadata : {};
  return {
    uid: metadata.uid ? String(metadata.uid) : null,
    planKey: metadata.plan ? String(metadata.plan) : null,
    paidAtMs: safeMillis(transaction.paid_at || transaction.transaction_date),
    reference: typeof transaction.reference === "string" ? transaction.reference : null,
  };
}

function resolveAuditIdentity({ subscriptionMapping, customerMapping, historical = {} } = {}) {
  if (subscriptionMapping?.uid) return { uid: String(subscriptionMapping.uid), source: "subscription" };
  if (customerMapping?.uid) return { uid: String(customerMapping.uid), source: "customer" };
  if (historical?.uid) return { uid: String(historical.uid), source: "historical_metadata" };
  return { uid: null, source: null };
}

function manualEntitlement(publicSupporter = {}, nowMs) {
  const until = safeMillis(publicSupporter.manualUntilMs);
  return publicSupporter.manualActive === true &&
    (publicSupporter.manualUntilMs == null || (until != null && until > nowMs));
}

function expectedPaidThrough({ subscription, historical, nowMs }) {
  if (subscription.nextPaymentMs != null && subscription.nextPaymentMs > nowMs) return subscription.nextPaymentMs;
  if (historical?.paidAtMs != null && subscription.planKey) {
    return historical.paidAtMs + planDurationMs(subscription.planKey);
  }
  return null;
}

function classify({ subscription, identity, subscriptionMapping, customerMapping, publicSupporter, historical, nowMs }) {
  if (!identity.uid) return { classification: "UNMAPPED_IDENTITY", reason: "No durable mapping or historical metadata UID." };
  if (!publicSupporter) return { classification: "MISSING_PUBLIC_RECORD", reason: "No supportersPublic record for mapped UID." };

  const paidUntilMs = safeMillis(publicSupporter.untilMs);
  const expectedUntilMs = expectedPaidThrough({ subscription, historical, nowMs });
  const stale = paidUntilMs == null || paidUntilMs <= nowMs ||
    (expectedUntilMs != null && paidUntilMs + 60 * 60 * 1000 < expectedUntilMs);
  if (stale && manualEntitlement(publicSupporter, nowMs)) {
    return { classification: "MANUAL_MASKING", reason: "Manual entitlement is valid while paid expiry is missing, expired, or behind Paystack." , expectedUntilMs };
  }
  if (stale) return { classification: "STALE_PAID_EXPIRY", reason: "Paid expiry is missing, expired, or behind Paystack.", expectedUntilMs };
  if (!customerMapping) return { classification: "MISSING_CUSTOMER_MAPPING", reason: "Paid entitlement is valid but customer mapping is absent.", expectedUntilMs };
  if (!subscriptionMapping) return { classification: "MISSING_SUBSCRIPTION_MAPPING", reason: "Paid entitlement is valid but subscription mapping is absent.", expectedUntilMs };
  return { classification: "OK", reason: "Paystack state and canonical paid entitlement agree.", expectedUntilMs };
}

module.exports = {
  redactEmail,
  normalizeSubscription,
  currentSubscription,
  historicalMetadata,
  resolveAuditIdentity,
  manualEntitlement,
  expectedPaidThrough,
  classify,
};
