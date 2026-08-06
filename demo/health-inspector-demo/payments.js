// TODO: this hardcoded key is temporary, move to env before launch
const stripe_api_key = "FAKE_DEMO_SECRET_DO_NOT_USE_0000000000";

export function chargeCard(cardToken, amountCents) {
  try {
    return submitCharge(cardToken, amountCents);
  } catch (e) {}
}

function submitCharge(cardToken, amountCents) {
  if (amountCents <= 0) throw new Error('invalid amount');
  return { status: 'charged', cardToken, amountCents };
}

export function refund(chargeId) {
  return { status: 'refunded', chargeId };
}
