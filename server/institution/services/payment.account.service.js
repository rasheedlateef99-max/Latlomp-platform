'use strict';
const mongoose                   = require('mongoose');
const SchoolManualPaymentAccount = require('../models/SchoolManualPaymentAccount.model');
const SchoolFeeStructure         = require('../models/SchoolFeeStructure.model');
const SchoolDonationCampaign     = require('../models/SchoolDonationCampaign.model');

/* ============================================
   LATLOMP — PAYMENT ACCOUNT RESOLUTION SERVICE
   P9-A

   Shared service consumed by:
     Parent portal routes  (P9-A)
     Student portal routes (P9-B)
     Alumni portal routes  (future)
     School website        (future)

   Portal routes handle: auth, IDOR, tenant extraction.
   This service handles: business logic, account
   resolution, currency validation.

   NEVER TRUST CLIENT-SUPPLIED ACCOUNT IDs OR CURRENCY.
   schoolId must always come from the JWT chain,
   passed in by the route, never from req.body.
============================================ */

/* ============================================
   resolvePaymentAccounts(context)

   Returns the applicable SchoolManualPaymentAccount
   records for a given payment context.

   CONTEXT-AWARE RESOLUTION:
     If the fee structure or campaign specifies a
     particular payment account, only that account
     is returned (the school has configured a specific
     account for this payment type).

     If no specific account is configured, all active
     school accounts are returned and the payer selects.

   @param {Object} context
     context.schoolId       ObjectId|string  (required, from JWT chain)
     context.feeStructureId ObjectId|string  (optional, from fee assignment)
     context.campaignId     ObjectId|string  (optional)

   @returns {Promise<Array>} SchoolManualPaymentAccount[]
   Always returns records belonging to context.schoolId.
   Never returns accounts from another school.
============================================ */
async function resolvePaymentAccounts(context) {
  var schoolId       = context.schoolId;
  var feeStructureId = context.feeStructureId || null;
  var campaignId     = context.campaignId     || null;

  /* Base filter: always scoped to this school, always active only */
  var baseFilter = { schoolId: schoolId, isActive: true };

  /* ---- Path 1: Fee structure specifies an account ---- */
  if (feeStructureId && mongoose.isValidObjectId(feeStructureId)) {
    var feeStructure = await SchoolFeeStructure.findOne({
      _id:      feeStructureId,
      schoolId: schoolId          /* double tenant scope */
    }).select('paymentAccountId').lean();

    if (feeStructure && feeStructure.paymentAccountId) {
      /* School configured a specific account for this fee */
      var specificAccount = await SchoolManualPaymentAccount.findOne({
        _id:      feeStructure.paymentAccountId,
        schoolId: schoolId,       /* IDOR: must belong to this school */
        isActive: true
      }).lean();

      if (specificAccount) {
        return [specificAccount];
        /* If the configured account has since been deactivated,
           fall through to return all active accounts below.
           This prevents a locked state where no accounts are shown. */
      }
    }
  }

  /* ---- Path 2: Campaign specifies an account ---- */
  if (campaignId && mongoose.isValidObjectId(campaignId)) {
    var campaign = await SchoolDonationCampaign.findOne({
      _id:      campaignId,
      schoolId: schoolId          /* double tenant scope */
    }).select('paymentAccountId').lean();

    if (campaign && campaign.paymentAccountId) {
      var specificCampaignAccount = await SchoolManualPaymentAccount.findOne({
        _id:      campaign.paymentAccountId,
        schoolId: schoolId,       /* IDOR */
        isActive: true
      }).lean();

      if (specificCampaignAccount) {
        return [specificCampaignAccount];
      }
    }
  }

  /* ---- Path 3: No specific account configured
         Return all active accounts for this school ---- */
  var accounts = await SchoolManualPaymentAccount.find(baseFilter)
    .sort({ displayOrder: 1, createdAt: 1 })
    .lean();

  return accounts;
}

/* ============================================
   validateClaimCurrency(paymentAccountId, claimedCurrency, schoolId)

   Validates the currency a payer claims against the
   authoritative currency of the selected payment account.

   The account's currency is always authoritative.
   The client-supplied currency is validated against it
   and then discarded — the server always uses the
   account's own currency when creating the claim.

   @param {ObjectId|string} paymentAccountId  Selected account
   @param {string}          claimedCurrency   From client (to validate)
   @param {ObjectId|string} schoolId          From JWT chain (tenant)

   @returns {Promise<Object>}
     { valid: true,  accountCurrency: 'NGN' }
     { valid: false, accountCurrency?: string, message: string }
============================================ */
async function validateClaimCurrency(paymentAccountId, claimedCurrency, schoolId) {
  if (!paymentAccountId || !mongoose.isValidObjectId(paymentAccountId)) {
    return { valid: false, message: 'A valid payment account must be selected.' };
  }

  var account = await SchoolManualPaymentAccount.findOne({
    _id:      paymentAccountId,
    schoolId: schoolId           /* IDOR: account must belong to this school */
  }).select('currency isActive accountLabel').lean();

  if (!account) {
    return {
      valid:   false,
      message: 'The selected payment account was not found or does not belong to this school.'
    };
  }

  if (!account.isActive) {
    return {
      valid:   false,
      message: 'Payment account "' + (account.accountLabel || 'selected') +
               '" is no longer active. Please contact the school for current payment details.'
    };
  }

  var accountCurrency  = (account.currency || '').toUpperCase().trim();
  var suppliedCurrency = (claimedCurrency  || '').toUpperCase().trim();

  /* If client did not supply a currency, accept the account's currency
     without error — the server will set it authoritatively */
  if (!suppliedCurrency) {
    return { valid: true, accountCurrency: accountCurrency };
  }

  if (accountCurrency !== suppliedCurrency) {
    return {
      valid:           false,
      accountCurrency: accountCurrency,
      message:         'Currency mismatch. The selected payment account operates in ' +
                       accountCurrency + ' but the claim specifies ' + suppliedCurrency +
                       '. Please verify you have selected the correct payment account.'
    };
  }

  return { valid: true, accountCurrency: accountCurrency };
}

module.exports = { resolvePaymentAccounts, validateClaimCurrency };