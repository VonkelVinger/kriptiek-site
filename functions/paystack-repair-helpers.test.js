"use strict";
const assert = require("node:assert/strict");
const { buildRepairPlan, legitimateKriptiekAccount } = require("./paystack-repair-helpers");
const now = Date.parse("2026-09-01T00:00:00.000Z");
const next = Date.parse("2026-10-01T00:00:00.000Z");
const annualNext = Date.parse("2027-09-01T00:00:00.000Z");
const base = { customerCode: "CUS_1", subscriptionCode: "SUB_1", planKey: "monthly", planCode: "PLN_month", status: "active", nextPaymentMs: next };
const mapped = { uid: "uid-1" };
function plan(overrides = {}) { return buildRepairPlan({ subscription: { ...base, ...overrides }, identity: mapped, publicSupporter: {}, customerMapping: null, subscriptionMapping: null, nowMs: now, ...overrides }); }

// 1 healthy annual needs mappings only; 2 stale monthly repairs; 3 manual remains independent.
let out = plan({ planKey: "annual", planCode: "PLN_year", nextPaymentMs: annualNext, publicSupporter: { untilMs: annualNext, provider: "paystack", plan: "annual" } });
assert.equal(out.supporterEntitlementAction, "NO_CHANGE"); assert.equal(out.customerMappingAction, "CREATE");
assert.equal(out.result, "WOULD_CREATE_MAPPINGS");
assert.equal(plan({ publicSupporter: { untilMs: now - 1 } }).finalUntilMs, next);
out = plan({ publicSupporter: { untilMs: now - 1, manualActive: true, manualUntilMs: null } }); assert.equal(out.manualEntitlement, true);
// 4 non-renewing preserves paid boundary; 5 override; 6 unmapped; 7 excluded; 8 disabled.
assert.equal(plan({ status: "non-renewing" }).result, "WOULD_REPAIR");
assert.equal(buildRepairPlan({ subscription: base, identity: null, overrideUid: "approved", publicSupporter: {}, nowMs: now }).uid, "approved");
assert.equal(legitimateKriptiekAccount({ usersExists: false, registrationExists: true }), true, "approved UID may be backed only by registrations/{uid}");
assert.equal(buildRepairPlan({ subscription: base, identity: null, publicSupporter: {}, nowMs: now }).result, "UNMAPPED");
assert.equal(plan({ excluded: true }).result, "EXCLUDED_TEST");
assert.equal(plan({ status: "disabled" }).result, "INELIGIBLE_STATUS");
// 9 rerun no change; 10 never shorten; 11 identity does not inspect email; 12 manual fields remain outside desired patch.
out = plan({ publicSupporter: { untilMs: next, provider: "paystack", plan: "monthly" }, customerMapping: { ...mapped, ...base }, subscriptionMapping: { ...mapped, ...base } }); assert.equal(out.result, "NO_CHANGE");
assert.equal(plan({ publicSupporter: { untilMs: annualNext } }).finalUntilMs, annualNext);
assert.equal(plan({ email: "different@example.com" }).uid, "uid-1");
assert.equal(plan({ publicSupporter: { manualActive: true, manualUntilMs: null } }).manualEntitlement, true);
console.log("paystack repair helper fixtures: ok");
