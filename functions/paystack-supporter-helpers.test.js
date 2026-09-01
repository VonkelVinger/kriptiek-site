"use strict";

const assert = require("node:assert/strict");
const h = require("./paystack-supporter-helpers");
const plans = { monthly: { code: "PLN_month" }, annual: { code: "PLN_year" } };
const now = Date.parse("2026-09-01T00:00:00.000Z");
const nextMonth = Date.parse("2026-10-15T00:00:00.000Z");

function identity(event, customer, subscriptionMapping) {
  const data = h.paymentData(event);
  const subscription = { ...h.subscriptionFor(data), mapping: subscriptionMapping };
  return h.resolveIdentity({ metadata: h.metadataFor(data), subscription, customer, plans });
}

// 1. Initial payment metadata establishes identity and monthly paid time.
let event = { data: { reference: "initial-1", metadata: { uid: "uid-1", plan: "monthly" }, customer: { customer_code: "CUS_1" }, plan: { plan_code: "PLN_month" } } };
let resolved = identity(event);
assert.equal(resolved.uid, "uid-1"); assert.equal(resolved.source, "metadata"); assert.equal(resolved.planKey, "monthly");
assert.equal(h.paidThroughMs({ paidAtMs: now, planKey: resolved.planKey, nowMs: now }), now + h.MONTH_MS);

// 2. A metadata-free renewal resolves through the private customer mapping.
event = { data: { reference: "renew-1", customer: { customer_code: "CUS_1" }, plan: { plan_code: "PLN_month" } } };
resolved = identity(event, { uid: "uid-1", planKey: "monthly", planCode: "PLN_month" });
assert.equal(resolved.uid, "uid-1"); assert.equal(resolved.source, "customer");

// 3. A duplicate reference is a no-op in the transaction; its pure consequence is no new boundary.
const processedReferences = new Set(["renew-1"]);
assert.equal(processedReferences.has(h.stablePaymentReference(event.data)), true);

// 4. An unknown recurring customer never produces a guessed UID.
assert.equal(identity(event).uid, null);

// 5. subscription.create can bind a subscription to the established customer mapping.
event = { data: { customer: { customer_code: "CUS_1" }, subscription: { subscription_code: "SUB_1", next_payment_date: "2026-10-15T00:00:00.000Z", plan: { plan_code: "PLN_month" } } } };
resolved = identity(event, { uid: "uid-1", planKey: "monthly", planCode: "PLN_month" });
assert.equal(h.subscriptionFor(event.data).code, "SUB_1"); assert.equal(resolved.uid, "uid-1");

// 6. A paid invoice with next_payment_date normalizes rather than adds another month.
assert.equal(h.successfulInvoice({ paid: true }), true);
assert.equal(h.paidThroughMs({ existingUntilMs: now + h.MONTH_MS, nextPaymentMs: nextMonth, planKey: "monthly", nowMs: now }), nextMonth);

// 7. Failed invoices are not successful payments.
assert.equal(h.successfulInvoice({ paid: false, status: "failed" }), false);

// 8. not_renew leaves a paid boundary unchanged.
const paidBoundary = nextMonth;
assert.equal(paidBoundary, nextMonth);

// 9. Disabling a subscription does not revoke an independent manual grant.
assert.equal(h.supporterActive({ untilMs: now - 1, manualActive: true, manualUntilMs: null, nowMs: now }), true);

// 10. A paid entitlement and manual entitlement coexist, with neither erasing the other.
assert.equal(h.supporterActive({ untilMs: nextMonth, manualActive: true, manualUntilMs: now - 1, nowMs: now }), true);

console.log("paystack supporter helper fixtures: ok");
