"use strict";

const { safeMillis } = require("./paystack-supporter-helpers");
const { manualEntitlement } = require("./paystack-reconciliation-helpers");

function eligibleStatus(status) {
  return ["active", "non-renewing"].includes(String(status || "").toLowerCase());
}

function legitimateKriptiekAccount({ usersExists, registrationExists }) {
  return usersExists === true || registrationExists === true;
}

function mappingAction(existing, desired) {
  if (!existing) return "CREATE";
  return ["uid", "customerCode", "subscriptionCode", "planCode", "planKey", "nextPaymentMs", "status"]
    .some((key) => desired[key] != null && existing[key] !== desired[key]) ? "UPDATE" : "NO_CHANGE";
}

function buildRepairPlan({ subscription, identity, overrideUid, publicSupporter, customerMapping, subscriptionMapping, excluded, nowMs }) {
  if (excluded) return { result: "EXCLUDED_TEST", reason: "Explicitly excluded test subscription.", finalUntilMs: null };
  if (!eligibleStatus(subscription.status)) return { result: "INELIGIBLE_STATUS", reason: "Only active or non-renewing subscriptions may be repaired.", finalUntilMs: null };
  const uid = identity?.uid || overrideUid || null;
  if (!uid) return { result: "UNMAPPED", reason: "No durable, historical, or approved UID mapping.", finalUntilMs: null };
  const boundary = safeMillis(subscription.nextPaymentMs);
  if (boundary == null || boundary <= nowMs) return { result: "ERROR", reason: "No current Paystack paid-through boundary is available.", finalUntilMs: null };
  const currentUntilMs = safeMillis(publicSupporter?.untilMs);
  const finalUntilMs = Math.max(currentUntilMs != null && currentUntilMs > nowMs ? currentUntilMs : 0, boundary);
  const desiredCustomer = { uid, customerCode: subscription.customerCode, planKey: subscription.planKey, planCode: subscription.planCode, nextPaymentMs: boundary };
  const desiredSubscription = { ...desiredCustomer, subscriptionCode: subscription.subscriptionCode, status: subscription.status };
  const customerMappingAction = mappingAction(customerMapping, desiredCustomer);
  const subscriptionMappingAction = mappingAction(subscriptionMapping, desiredSubscription);
  const supporterNeedsUpdate = currentUntilMs !== finalUntilMs || publicSupporter?.provider !== "paystack" || publicSupporter?.plan !== subscription.planKey;
  const mappingNeedsUpdate = customerMappingAction !== "NO_CHANGE" || subscriptionMappingAction !== "NO_CHANGE";
  return {
    result: supporterNeedsUpdate ? "WOULD_REPAIR" : mappingNeedsUpdate ? "WOULD_CREATE_MAPPINGS" : "NO_CHANGE",
    reason: supporterNeedsUpdate ? "Canonical paid entitlement will be aligned to Paystack." : "Mappings and paid entitlement already agree.",
    uid,
    currentUntilMs,
    paystackPaidThroughMs: boundary,
    finalUntilMs,
    manualEntitlement: manualEntitlement(publicSupporter || {}, nowMs),
    customerMappingAction,
    subscriptionMappingAction,
    supporterEntitlementAction: supporterNeedsUpdate ? "UPDATE" : "NO_CHANGE",
  };
}

module.exports = { eligibleStatus, legitimateKriptiekAccount, mappingAction, buildRepairPlan };
