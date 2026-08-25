'use strict';
/* ============================================
   LATLOMP — FEE CALCULATION HELPERS
   Platform fee read from PlatformConfig (DB).
   Never hard-coded. Admin changes it from admin.html.
   Historical payments retain their recorded percentage.
============================================ */
const DEFAULT_FEE_PERCENT = 0.5;

async function getPlatformFeePercent() {
  try {
    const PlatformConfig = require('../models/PlatformConfig.model');
    return await PlatformConfig.getValue('platform_fee_percent', DEFAULT_FEE_PERCENT);
  } catch (e) {
    console.warn('[FeeConfig] Using default fee:', e.message);
    return DEFAULT_FEE_PERCENT;
  }
}

/* Calculate full breakdown for a given school fee amount.
   Paystack's own fee is NOT calculated here — Paystack
   determines it per transaction. We only calculate our fee. */
async function calculateFeeBreakdown(schoolFeeAmount, currency) {
  const platformFeePercent = await getPlatformFeePercent();
  /* Round to 2 decimal places to avoid floating-point issues */
  const platformFeeAmount  = Math.round(schoolFeeAmount * platformFeePercent / 100 * 100) / 100;
  const totalCharged       = Math.round((schoolFeeAmount + platformFeeAmount) * 100) / 100;

  return {
    schoolFeeAmount,
    platformFeePercent,
    platformFeeAmount,
    totalCharged,
    currency:          currency || 'NGN',
    /* Paystack fee is determined by Paystack at checkout — shown as estimate only */
    providerFeeNote:   'Payment provider charges apply per their current pricing'
  };
}

module.exports = { getPlatformFeePercent, calculateFeeBreakdown };