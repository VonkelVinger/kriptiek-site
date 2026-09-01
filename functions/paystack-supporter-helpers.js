"use strict";

const MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

function safeMillis(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() && Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function planDurationMs(planKey) {
  return planKey === "annual" ? YEAR_MS : MONTH_MS;
}

function planKeyFor(planCode, metadataPlan, plans) {
  if (metadataPlan && plans[metadataPlan]) return metadataPlan;
  return Object.entries(plans).find(([, plan]) => plan.code === planCode)?.[0] || null;
}

function paymentData(event = {}) {
  return event.data || {};
}

function metadataFor(data = {}) {
  return data.metadata && typeof data.metadata === "object" ? data.metadata : {};
}

function customerCodeFor(data = {}) {
  return data.customer?.customer_code || data.customer?.code || data.customer_code || null;
}

function subscriptionFor(data = {}) {
  const subscription = data.subscription && typeof data.subscription === "object" ? data.subscription : {};
  return {
    code: subscription.subscription_code || subscription.code || data.subscription_code || null,
    customerCode: customerCodeFor(data) || subscription.customer?.customer_code || subscription.customer_code || null,
    planCode: data.plan?.plan_code || data.plan?.code || subscription.plan?.plan_code || subscription.plan_code || data.plan_code || null,
    nextPaymentMs: safeMillis(subscription.next_payment_date || data.next_payment_date),
    status: subscription.status || data.status || null,
  };
}

function successfulInvoice(data = {}) {
  return data.paid === true || data.status === "success" || data.transaction?.status === "success";
}

function stablePaymentReference(data = {}) {
  const reference = data.transaction?.reference || data.reference || data.transaction_reference || null;
  return typeof reference === "string" && reference.trim() ? reference.trim() : null;
}

function resolveIdentity({ metadata = {}, subscription = {}, customer = null, plans = {} } = {}) {
  const mappedSubscription = subscription.mapping || null;
  const mappedCustomer = customer || null;
  const metadataUid = metadata.uid ? String(metadata.uid) : null;
  const metadataPlan = metadata.plan ? String(metadata.plan) : null;
  const uid = mappedSubscription?.uid || mappedCustomer?.uid || metadataUid || null;
  const planCode = subscription.planCode || mappedSubscription?.planCode || mappedCustomer?.planCode || null;
  const planKey = subscription.planKey || mappedSubscription?.planKey || mappedCustomer?.planKey ||
    planKeyFor(planCode, metadataPlan, plans);

  return {
    uid,
    planCode,
    planKey,
    source: mappedSubscription?.uid ? "subscription" : mappedCustomer?.uid ? "customer" : metadataUid ? "metadata" : null,
  };
}

function paidThroughMs({ existingUntilMs, paidAtMs, nextPaymentMs, planKey, nowMs }) {
  const existing = safeMillis(existingUntilMs) || 0;
  const paidAt = safeMillis(paidAtMs) || nowMs;
  const nextPayment = safeMillis(nextPaymentMs);
  // A stored boundary from an older billing cycle must not suppress a later
  // successful renewal. Only a boundary after this payment is authoritative.
  if (nextPayment != null && nextPayment > paidAt) return Math.max(existing, nextPayment);
  if (!planKey) return null;
  return Math.max(existing, paidAt, nowMs) + planDurationMs(planKey);
}

function supporterActive({ untilMs, manualActive, manualUntilMs, nowMs }) {
  const paid = safeMillis(untilMs);
  const manualUntil = safeMillis(manualUntilMs);
  return (paid != null && paid > nowMs) ||
    (manualActive === true && (manualUntilMs == null || (manualUntil != null && manualUntil > nowMs)));
}

module.exports = {
  MONTH_MS,
  YEAR_MS,
  safeMillis,
  planDurationMs,
  planKeyFor,
  paymentData,
  metadataFor,
  customerCodeFor,
  subscriptionFor,
  successfulInvoice,
  stablePaymentReference,
  resolveIdentity,
  paidThroughMs,
  supporterActive,
};
