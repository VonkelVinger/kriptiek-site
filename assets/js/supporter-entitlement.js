function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

export function supporterValueToMillis(value) {
  if (value == null || value === "") return null;

  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toDate === "function") {
    const millis = value.toDate()?.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
    const nanos = Number(value.nanoseconds || 0);
    return Math.trunc(Number(value.seconds) * 1000 + nanos / 1000000);
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() !== "" && Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function hasMeaningfulSupporterEntitlement(publicSupporter) {
  if (!publicSupporter || typeof publicSupporter !== "object") return false;

  return ["manualActive", "manualUntilMs", "untilMs", "active"]
    .some((key) => hasOwn(publicSupporter, key));
}

function resolveCanonicalSupporterEntitlement(publicSupporter, now) {
  const manualActive = publicSupporter?.manualActive === true;
  const manualUntilMs = supporterValueToMillis(publicSupporter?.manualUntilMs);
  const untilMs = supporterValueToMillis(publicSupporter?.untilMs);
  const hasManualUntil = hasOwn(publicSupporter, "manualUntilMs");
  const hasManualInfo = hasOwn(publicSupporter, "manualActive") || hasManualUntil;
  const hasExpiryInfo = hasOwn(publicSupporter, "untilMs");

  if (manualActive && (!hasManualUntil || publicSupporter?.manualUntilMs == null || manualUntilMs > now)) {
    return true;
  }

  if (untilMs != null && untilMs > now) return true;

  // Compatibility only: an old cache-only record has no expiry or manual data.
  if (!hasManualInfo && !hasExpiryInfo && publicSupporter?.active === true) return true;

  return false;
}

function resolveLegacyUserEntitlement(legacyUser, now) {
  const user = legacyUser || {};
  const support = user.support || {};
  const expiryValues = [
    user.supporterUntil,
    user.paidUntil,
    support.paidUntil
  ];
  const hasFutureExpiry = expiryValues
    .map(supporterValueToMillis)
    .some((millis) => millis != null && millis > now);
  const hasLegacyFlag = user.supporterActive === true ||
    user.isPaid === true ||
    user.isSupporter === true ||
    support.isPaid === true;

  return hasLegacyFlag || hasFutureExpiry;
}

/**
 * Calculates supporter entitlement without Firebase dependencies.
 * A meaningful supportersPublic record always takes precedence over legacy user fields.
 */
export function resolveSupporterEntitlement({ publicSupporter, legacyUser, now = Date.now() } = {}) {
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();

  if (hasMeaningfulSupporterEntitlement(publicSupporter)) {
    return resolveCanonicalSupporterEntitlement(publicSupporter, currentTime);
  }

  return resolveLegacyUserEntitlement(legacyUser, currentTime);
}
