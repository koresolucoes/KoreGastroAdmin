export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

export function isEntitledSubscriptionStatus(status) {
  return ENTITLED_SUBSCRIPTION_STATUSES.includes(String(status || ''));
}

export function isCurrentPeriodEntitled(currentPeriodEnd, now = Date.now()) {
  if (!currentPeriodEnd) return true;
  const parsed = Date.parse(currentPeriodEnd);
  return Number.isFinite(parsed) && parsed > now;
}

export function isSubscriptionEntitled(subscription, now = Date.now()) {
  if (!subscription) return false;
  return isEntitledSubscriptionStatus(subscription.status)
    && isCurrentPeriodEntitled(subscription.current_period_end, now);
}
