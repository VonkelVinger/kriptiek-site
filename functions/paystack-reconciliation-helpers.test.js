"use strict";

const assert = require("node:assert/strict");
const h = require("./paystack-reconciliation-helpers");
const now = Date.parse("2026-09-01T00:00:00.000Z");
const plans = { monthly: { code: "PLN_month" } };
const subscription = h.normalizeSubscription({ customer: { customer_code: "CUS_1", email: "paystack-address@example.com" }, subscription_code: "SUB_1", plan: { plan_code: "PLN_month" }, status: "active", next_payment_date: "2026-10-01T00:00:00.000Z" }, plans);
const mapped = { uid: "uid-1" };
const identity = h.resolveAuditIdentity({ subscriptionMapping: mapped });

assert.equal(h.redactEmail("paystack-address@example.com"), "p***@example.com");
assert.equal(subscription.customerCode, "CUS_1");
assert.equal(subscription.subscriptionCode, "SUB_1");
assert.equal(h.currentSubscription(subscription.status), true);

// Healthy, stale expiry, missing public record, and manual masking.
assert.equal(h.classify({ subscription, identity, subscriptionMapping: mapped, customerMapping: mapped, publicSupporter: { untilMs: subscription.nextPaymentMs }, nowMs: now }).classification, "OK");
assert.equal(h.classify({ subscription, identity, subscriptionMapping: mapped, customerMapping: mapped, publicSupporter: { untilMs: now - 1 }, nowMs: now }).classification, "STALE_PAID_EXPIRY");
assert.equal(h.classify({ subscription, identity, subscriptionMapping: mapped, customerMapping: mapped, publicSupporter: null, nowMs: now }).classification, "MISSING_PUBLIC_RECORD");
assert.equal(h.classify({ subscription, identity, subscriptionMapping: mapped, customerMapping: mapped, publicSupporter: { untilMs: now - 1, manualActive: true, manualUntilMs: null }, nowMs: now }).classification, "MANUAL_MASKING");

// Missing durable mappings and unmapped identities (email remains only a hint).
assert.equal(h.classify({ subscription, identity, subscriptionMapping: mapped, customerMapping: null, publicSupporter: { untilMs: subscription.nextPaymentMs }, nowMs: now }).classification, "MISSING_CUSTOMER_MAPPING");
assert.equal(h.classify({ subscription, identity, subscriptionMapping: null, customerMapping: mapped, publicSupporter: { untilMs: subscription.nextPaymentMs }, nowMs: now }).classification, "MISSING_SUBSCRIPTION_MAPPING");
assert.equal(h.classify({ subscription, identity: h.resolveAuditIdentity({}), subscriptionMapping: null, customerMapping: null, publicSupporter: null, nowMs: now }).classification, "UNMAPPED_IDENTITY");
assert.deepEqual(h.resolveAuditIdentity({ historical: h.historicalMetadata({ metadata: { uid: "historic-uid", plan: "monthly" } }) }), { uid: "historic-uid", source: "historical_metadata" });

console.log("paystack reconciliation helper fixtures: ok");
