'use strict';
const express              = require('express');
const router               = express.Router();
const mongoose             = require('mongoose');
const SchoolPaymentAccount = require('../models/SchoolPaymentAccount.model');
const SchoolFeeAssignment  = require('../models/SchoolFeeAssignment.model');
const SchoolFeeAdjustment  = require('../models/SchoolFeeAdjustment.model');
const SchoolFeePayment     = require('../models/SchoolFeePayment.model');
const SchoolFeeStructure   = require('../models/SchoolFeeStructure.model');
const SchoolStudent        = require('../models/SchoolStudent.model');
const PlatformConfig       = require('../models/PlatformConfig.model');
const { getProvider }      = require('../providers/payment.provider');
/* P6: Required for deletion protection checks */
const SchoolPaymentClaimDel  = require('../models/SchoolPaymentClaim.model');
const SchoolFeePaymentDel    = require('../models/SchoolFeePayment.model');
const { getPlatformFeePercent } = require('../config/fee.config');
const {
  instProtect, schoolAdminOnly,
  teacherOrAdmin, canManageStudents, seniorStaffOrAdmin
} = require('../middleware/inst.auth');
const { requireActiveSubscription } = require('../middleware/inst.tenant');

/* ✅ R2 FIX: Use exported makeSchoolLimit from inst.rateLimit.js */
const { makeSchoolLimit } = require('../middleware/inst.rateLimit');

const paymentConnectLimit = makeSchoolLimit(15, 5,
  'Too many payment account connection attempts. Please wait 15 minutes.');
const bankVerifyLimit = makeSchoolLimit(5, 10,
  'Too many bank verification attempts. Please wait 5 minutes.');

var adminGuard       = [instProtect, schoolAdminOnly, requireActiveSubscription];
var seniorGuard      = [instProtect, seniorStaffOrAdmin, requireActiveSubscription];
var staffGuard       = [instProtect, teacherOrAdmin,  requireActiveSubscription];
var adjustmentGuard  = [instProtect, canManageStudents, requireActiveSubscription];

/* ============================================
   PAYMENT ACCOUNT SETUP
   Only school admin can connect/configure.
   Staff can view status.
============================================ */

/* GET /api/institution/fee/payment-account/status */
router.get('/payment-account/status', staffGuard, async (req, res) => {
  try {
    var account = await SchoolPaymentAccount.findOne({ schoolId: req.schoolId }).lean();

    if (!account) {
      return res.status(200).json({
        success:   true,
        connected: false,
        status:    'not_connected',
        account:   null
      });
    }

    /* Never expose providerAccountId raw to non-admin
       (it's not secret but no need to expose internals to all staff) */
    var safe = {
      provider:              account.provider,
      status:                account.status,
      onlinePaymentsEnabled: account.onlinePaymentsEnabled,
      currency:              account.currency,
      businessName:          account.businessName,
      settlementBankName:    account.settlementBankName,
      /* Mask account number — last 4 digits only */
      settlementAccountNumber: account.settlementAccountNumber
        ? '****' + account.settlementAccountNumber.slice(-4)
        : '',
      settlementAccountName:   account.settlementAccountName,
      verifiedAt:              account.verifiedAt,
      statusReason:            account.statusReason,
      connected:               account.status === 'active'
    };

    return res.status(200).json({ success: true, connected: account.status === 'active', account: safe });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/fee/payment-account/supported-countries
   Returns countries this school's provider supports.
   Used by the frontend country selector.
   No sensitive data exposed.
============================================ */
router.get('/payment-account/supported-countries', staffGuard, async (req, res) => {
  try {
    /* ✅ INTERNATIONAL ARCHITECTURE:
       Each school may eventually use a different provider.
       For now, all schools use Paystack.
       Future: look up school's configured provider here. */
    var provider  = getProvider('paystack');
    var countries = provider.getSupportedCountries();
    return res.status(200).json({ success: true, countries });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   GET /api/institution/fee/payment-account/banks?country=NG
   Returns bank list for a specific country.
   country: ISO country code (NG, GH, ZA, KE)
   Provider secret key used server-side only.
============================================ */
router.get('/payment-account/banks', staffGuard, async (req, res) => {
  try {
    var countryIso = (req.query.country || 'NG').toUpperCase();

    /* ✅ INTERNATIONAL ARCHITECTURE:
       Country → Provider capability → Institution list.
       Only show banks the provider actually supports. */
    var provider = getProvider('paystack');
    var banks    = await provider.listBanks(countryIso);

    return res.status(200).json({
      success: true,
      country: countryIso,
      count:   banks.length,
      banks
    });
  } catch (err) {
    console.error('[PaymentAccount/banks] error:', err.message);
    /* Return structured error so frontend can display properly */
    return res.status(422).json({
      success: false,
      message: err.message || 'Unable to load bank list from payment provider.'
    });
  }
});

/* POST /api/institution/fee/payment-account/verify-bank
   Step 1: Verify bank account before connecting.
   Returns the account name so admin can confirm.
*/
router.post('/payment-account/verify-bank', adminGuard, bankVerifyLimit, async (req, res) => {
  try {
    var { accountNumber, bankCode } = req.body;
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ success: false, message: 'Account number and bank code are required.' });
    }

    var provider = getProvider('paystack');
    var verified = await provider.verifyBankAccount(accountNumber, bankCode);

    return res.status(200).json({
      success:       true,
      accountName:   verified.accountName,
      accountNumber: verified.accountNumber,
      bankCode:      verified.bankCode
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Bank account verification failed. Please check the details.'
    });
  }
});

/* POST /api/institution/fee/payment-account/connect
   Step 2: Create provider subaccount + save account.
   Admin has already verified bank account in step 1.
*/
router.post('/payment-account/connect', adminGuard, paymentConnectLimit, async (req, res) => {
  try {
    var { bankCode, bankName, accountNumber, accountName, currency, businessName, provider } = req.body;

    if (!bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'Bank code, account number, and verified account name are required.'
      });
    }

    var providerName = provider || 'paystack';
    var payProvider  = getProvider(providerName);
    var school       = req.school;

    /* Create the provider settlement account */
    var providerResult = await payProvider.createSettlementAccount({
      businessName: businessName || school.name,
      bankCode,
      accountNumber,
      description: 'School fee collection — ' + school.name
    });

    /* Save/update the payment account */
    var account = await SchoolPaymentAccount.findOneAndUpdate(
      { schoolId: req.schoolId },
      {
        $set: {
          provider:                providerName,
          providerAccountId:       providerResult.providerAccountId,
          providerAccountCode:     providerResult.providerAccountCode,
          settlementBankCode:      bankCode,
          settlementBankName:      bankName || '',
          settlementAccountNumber: accountNumber,
          settlementAccountName:   accountName,
          currency:                currency || 'NGN',
          businessName:            businessName || school.name,
          status:                  'active',
          statusReason:            '',
          verifiedAt:              new Date(),
          onlinePaymentsEnabled:   true,
          connectedBy:             req.schoolUser._id
        }
      },
      { upsert: true, new: true }
    );

    /* ✅ FIX: Return success — the adjustment code below was incorrectly
       merged into this route during E7B implementation. It has been removed.
       Fee adjustment belongs in a separate /fee/assignments/:id/adjust route. */
    return res.status(201).json({
      success:  true,
      message:  'Payment account connected successfully. Online payments are now enabled.',
      account: {
        provider:              account.provider,
        status:                account.status,
        businessName:          account.businessName,
        settlementBankName:    account.settlementBankName,
        settlementAccountName: account.settlementAccountName,
        currency:              account.currency,
        onlinePaymentsEnabled: account.onlinePaymentsEnabled
      }
    });
  } catch (err) {
    console.error('[PaymentAccount/connect] error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/fee/payment-account/toggle
   Enable or disable online payments for this school.
*/
router.put('/payment-account/toggle', adminGuard, async (req, res) => {
  try {
    var account = await SchoolPaymentAccount.findOne({ schoolId: req.schoolId });
    if (!account || account.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'No active payment account found. Please connect a payment account first.'
      });
    }

    account.onlinePaymentsEnabled = !account.onlinePaymentsEnabled;
    await account.save();

    return res.status(200).json({
      success:  true,
      message:  'Online payments ' + (account.onlinePaymentsEnabled ? 'enabled' : 'disabled') + '.',
      onlinePaymentsEnabled: account.onlinePaymentsEnabled
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/fee/platform-fee
   Returns current platform fee percentage (safe to expose to institution staff).
*/
router.get('/platform-fee', staffGuard, async (req, res) => {
  try {
    var feePercent = await getPlatformFeePercent();
    return res.status(200).json({ success: true, platformFeePercent: feePercent });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ============================================
   FEE ADJUSTMENTS
   Adjustment layer only — never touches payments.
============================================ */

/* GET /api/institution/fee/adjustments/:assignmentId */
router.get('/adjustments/:assignmentId', staffGuard, async (req, res) => {
  try {
    var assignment = await SchoolFeeAssignment.findOne({
      _id: req.params.assignmentId, schoolId: req.schoolId
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found.' });
    }

    var adjustments = await SchoolFeeAdjustment.find({ assignmentId: req.params.assignmentId })
      .populate('madeBy', 'name email role')
      .sort({ createdAt: 1 });

    return res.status(200).json({ success: true, count: adjustments.length, adjustments });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/adjustments
   Body: { assignmentId, adjustmentType, adjustmentAmount, reason }
   adjustmentAmount: positive = increase obligation, negative = reduce
*/
router.post('/adjustments', adjustmentGuard, async (req, res) => {
  try {
    var { assignmentId, adjustmentType, adjustmentAmount, reason } = req.body;

    if (!assignmentId)    { return res.status(400).json({ success: false, message: 'Assignment ID is required.' }); }
    if (!adjustmentType)  { return res.status(400).json({ success: false, message: 'Adjustment type is required.' }); }
    if (!reason || !reason.trim()) { return res.status(400).json({ success: false, message: 'A reason is required for every adjustment.' }); }

    var validTypes = ['discount', 'waiver', 'increase', 'reduce', 'cancel', 'reinstate', 'other'];
    if (!validTypes.includes(adjustmentType)) {
      return res.status(400).json({ success: false, message: 'Invalid adjustment type.' });
    }

    var assignment = await SchoolFeeAssignment.findOne({
      _id: assignmentId, schoolId: req.schoolId
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Fee assignment not found.' });
    }

    /* Block adjustments on paid/waived/cancelled — except reinstate */
    if (['paid', 'waived', 'cancelled'].includes(assignment.status) && adjustmentType !== 'reinstate') {
      return res.status(400).json({
        success: false,
        message: 'Cannot adjust a fee that is already ' + assignment.status + '. Use "reinstate" to reopen a cancelled fee.'
      });
    }

    var originalAmountDue = assignment.amountDue;
    var amountPaid        = assignment.amountPaid || 0;
    var delta             = 0; /* how much to change amountDue */

    /* Calculate new amountDue based on adjustment type */
    switch (adjustmentType) {
      case 'discount':
      case 'reduce':
        /* adjustmentAmount should be positive (the reduction amount) */
        delta = -(Math.abs(parseFloat(adjustmentAmount) || 0));
        break;
      case 'increase':
        delta = Math.abs(parseFloat(adjustmentAmount) || 0);
        break;
      case 'waiver':
        /* Waive entire remaining balance */
        delta = -(assignment.balance || 0);
        break;
      case 'cancel':
        /* Cancel means obligation goes to 0 (if nothing paid) or to amountPaid */
        delta = -(Math.max(0, originalAmountDue - amountPaid));
        break;
      case 'reinstate':
        /* Restore the original fee structure amount */
        var structure = await SchoolFeeStructure.findById(assignment.feeStructureId).select('amount').lean();
        if (structure) {
          delta = structure.amount - originalAmountDue;
        }
        break;
      case 'other':
        delta = parseFloat(adjustmentAmount) || 0;
        break;
    }

    var newAmountDue      = Math.max(0, originalAmountDue + delta);
    var newBalance        = Math.max(0, newAmountDue - amountPaid);
    var isOverpaid        = amountPaid > newAmountDue;
    var overpaymentAmount = isOverpaid ? Math.round((amountPaid - newAmountDue) * 100) / 100 : 0;

    /* Update assignment */
    assignment.amountDue = newAmountDue;
    assignment.balance   = newBalance;
    assignment.discount  = (assignment.discount || 0) - delta; /* track cumulative discount */

    if (adjustmentType === 'waiver') {
      assignment.status     = 'waived';
      assignment.waivedBy   = req.schoolUser._id;
      assignment.waivedReason = reason.trim();
    } else if (adjustmentType === 'cancel') {
      assignment.status     = 'cancelled';
    } else if (adjustmentType === 'reinstate') {
      assignment.status     = amountPaid >= newAmountDue ? 'paid'
                             : amountPaid > 0             ? 'partial'
                             :                              'pending';
    } else if (isOverpaid) {
      /* Option C: mark overpaid, do not auto-refund */
      assignment.status          = 'overpaid';
      assignment.overpaymentAmount = overpaymentAmount;
    } else {
      assignment.status = amountPaid >= newAmountDue ? 'paid'
                        : amountPaid > 0              ? 'partial'
                        :                               'pending';
    }

    await assignment.save();

    /* Record adjustment audit trail */
    var adjustment = await SchoolFeeAdjustment.create({
      schoolId:               req.schoolId,
      assignmentId:           assignment._id,
      studentId:              assignment.studentId,
      feeStructureId:         assignment.feeStructureId,
      adjustmentType,
      currency:               assignment.currency || 'NGN',
      originalAmountDue,
      adjustmentAmount:       delta,
      newAmountDue,
      amountPaidAtAdjustment: amountPaid,
      balanceAfterAdjustment: newBalance,
      createdOverpayment:     isOverpaid,
      overpaymentAmount,
      reason:                 reason.trim(),
      madeBy:                 req.schoolUser._id,
      madeByName:             req.schoolUser.name || ''
    });

    var responseMessage = adjustmentType === 'cancel'   ? 'Fee cancelled.'
                        : adjustmentType === 'waiver'   ? 'Fee waived.'
                        : adjustmentType === 'reinstate'? 'Fee reinstated.'
                        : 'Fee adjusted.';

    if (isOverpaid) {
      responseMessage += ' Note: This student has an overpayment of ' +
        (assignment.currency || 'NGN') + ' ' + overpaymentAmount.toLocaleString() +
        '. Resolve manually in payment records.';
    }

    return res.status(201).json({
      success: true,
      message: responseMessage,
      adjustment,
      assignment: {
        _id:             assignment._id,
        amountDue:       assignment.amountDue,
        amountPaid:      assignment.amountPaid,
        balance:         assignment.balance,
        status:          assignment.status,
        overpaymentAmount: assignment.overpaymentAmount || 0
      }
    });
  } catch (err) {
    console.error('[FeeAdjustment] error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/fee/payment-account/supported-currencies */
router.get('/payment-account/supported-currencies', staffGuard, async (req, res) => {
  try {
    var provider    = getProvider('paystack');
    var currencies  = await provider.getSupportedCurrencies();
    return res.status(200).json({ success: true, currencies });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
/* ============================================
   P2 — SCHOOL MANUAL PAYMENT ACCOUNTS

   School-configured bank/payment methods.
   NO Paystack. NO provider calls. NO bank API.
   School admin manually enters their own details.
   LatLomp stores and displays them securely to payers.

   Tenant isolation: schoolId ALWAYS from req.schoolId
   (set by instProtect from JWT) — NEVER from body.

   Route summary:
     GET  /manual-accounts         — list all (admin)
     GET  /manual-accounts/active  — list active (staff)
     POST /manual-accounts         — create (admin)
     PUT  /manual-accounts/:id     — update (admin)
     PUT  /manual-accounts/:id/toggle — activate/deactivate (admin)
     DELETE /manual-accounts/:id   — delete if no references (admin)
============================================ */

/* GET /api/institution/fee/manual-accounts
   Full account list for admin management.
   adminGuard — shows complete account details.
*/
router.get('/manual-accounts', adminGuard, async function(req, res) {
  try {
    var accounts = await SchoolManualPaymentAccount.find({
      schoolId: req.schoolId          /* TENANT SCOPE — from JWT */
    })
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

    return res.json({ success: true, count: accounts.length, accounts });
  } catch(err) {
    console.error('[manual-accounts] GET /manual-accounts:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* GET /api/institution/fee/manual-accounts/active
   Active accounts only — safe for portal display.
   staffGuard — consumed by parent/student portals in P9.
   Returns complete account details for payers who need
   to know where to send money.
   NOTE: Must be declared BEFORE /manual-accounts/:id
   so Express matches this literal route correctly.
*/
router.get('/manual-accounts/active', staffGuard, async function(req, res) {
  try {
    var accounts = await SchoolManualPaymentAccount.find({
      schoolId: req.schoolId,         /* TENANT SCOPE — from JWT */
      isActive: true
    })
    .select('accountLabel accountType bankName accountName accountNumber currency country instructions displayOrder')
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();

    return res.json({ success: true, count: accounts.length, accounts });
  } catch(err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* POST /api/institution/fee/manual-accounts
   Create a new manual payment account.
   adminGuard — configuration is admin-only.
   schoolId: ALWAYS from req.schoolId — NEVER from body.
*/
router.post('/manual-accounts', adminGuard, async function(req, res) {
  try {
    var {
      accountLabel, accountType, bankName, accountName,
      accountNumber, country, currency, instructions, displayOrder
    } = req.body;

    /* Required field validation */
    if (!accountLabel || !accountLabel.trim()) {
      return res.status(400).json({ success: false, message: 'Account label is required.' });
    }
    if (!bankName || !bankName.trim()) {
      return res.status(400).json({ success: false, message: 'Bank name is required.' });
    }
    if (!accountName || !accountName.trim()) {
      return res.status(400).json({ success: false, message: 'Account name is required.' });
    }
    if (!accountNumber || !accountNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Account number is required.' });
    }

    /* Reasonable cap — prevents abuse without blocking legitimate use */
    var existingCount = await SchoolManualPaymentAccount.countDocuments({
      schoolId: req.schoolId
    });
    if (existingCount >= 20) {
      return res.status(400).json({
        success: false,
        message: 'Maximum of 20 payment accounts per school. ' +
                 'Please deactivate or remove an existing account first.'
      });
    }

    var account = await SchoolManualPaymentAccount.create({
      schoolId:      req.schoolId,           /* TENANT SCOPE — from JWT only */
      accountLabel:  accountLabel.trim(),
      accountType:   accountType             || 'main',
      bankName:      bankName.trim(),
      accountName:   accountName.trim(),
      accountNumber: accountNumber.trim(),
      country:       (country      || 'NG').trim(),
      currency:      (currency     || 'NGN').trim().toUpperCase(),
      instructions:  (instructions || '').trim(),
      displayOrder:  parseInt(displayOrder)  || 0,
      isActive:      true,
      createdBy:     req.schoolUser._id,
      createdByName: req.schoolUser.name     || ''
    });

    logAudit({
      req,
      action:     'institution.payment_account.manual.created',
      resource:   'SchoolManualPaymentAccount',
      resourceId: account._id.toString(),
      success:    true,
      message:    'Manual payment account created: "' + account.accountLabel +
                  '" currency=' + account.currency +
                  ' bank=' + account.bankName +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    return res.status(201).json({
      success: true,
      message: '"' + account.accountLabel + '" payment account created.',
      account
    });
  } catch(err) {
    console.error('[manual-accounts] POST:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/fee/manual-accounts/:id
   Update an existing manual payment account.
   adminGuard only. Tenant scope verified by { schoolId } query.
   Allowed fields whitelist prevents mass-assignment.
*/
router.put('/manual-accounts/:id', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid account ID.' });
    }

    /* Whitelist — only these fields may be updated */
    var ALLOWED = [
      'accountLabel', 'accountType', 'bankName', 'accountName',
      'accountNumber', 'country', 'currency', 'instructions',
      'displayOrder', 'isActive'
    ];
    var updates = {};
    ALLOWED.forEach(function(f) {
      if (req.body[f] !== undefined) {
        updates[f] = typeof req.body[f] === 'string' ? req.body[f].trim() : req.body[f];
      }
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'No valid fields provided for update.' });
    }

    /* Normalise */
    if (updates.currency)      updates.currency      = updates.currency.toUpperCase();
    if (updates.displayOrder !== undefined) {
      updates.displayOrder = parseInt(updates.displayOrder) || 0;
    }

    /* Audit trail — who last changed this */
    updates.updatedBy     = req.schoolUser._id;
    updates.updatedByName = req.schoolUser.name || '';

    var account = await SchoolManualPaymentAccount.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId }, /* TENANT SCOPE + IDOR prevention */
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!account) {
      return res.status(404).json({ success: false, message: 'Payment account not found.' });
    }

    logAudit({
      req,
      action:     'institution.payment_account.manual.updated',
      resource:   'SchoolManualPaymentAccount',
      resourceId: account._id.toString(),
      success:    true,
      message:    'Manual payment account updated: "' + account.accountLabel +
                  '" fields=' + Object.keys(updates).filter(function(k) {
                    return k !== 'updatedBy' && k !== 'updatedByName';
                  }).join(',') +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    return res.json({ success: true, message: 'Payment account updated.', account });
  } catch(err) {
    console.error('[manual-accounts] PUT /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* PUT /api/institution/fee/manual-accounts/:id/toggle
   Activate or deactivate a payment account.
   adminGuard only.
   Inactive accounts stop appearing in portal displays immediately.
   Does NOT delete payment history — only controls visibility.
*/
router.put('/manual-accounts/:id/toggle', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid account ID.' });
    }

    /* Read then save to get the toggled value — prevents flip-flop on concurrent requests */
    var account = await SchoolManualPaymentAccount.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId      /* TENANT SCOPE + IDOR prevention */
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Payment account not found.' });
    }

    account.isActive      = !account.isActive;
    account.updatedBy     = req.schoolUser._id;
    account.updatedByName = req.schoolUser.name || '';
    await account.save();

    var action = account.isActive ? 'activated' : 'deactivated';

    logAudit({
      req,
      action:     'institution.payment_account.manual.toggled',
      resource:   'SchoolManualPaymentAccount',
      resourceId: account._id.toString(),
      success:    true,
      message:    'Manual payment account ' + action +
                  ': "' + account.accountLabel + '"' +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    return res.json({
      success:  true,
      message:  '"' + account.accountLabel + '" ' + action + '.',
      isActive: account.isActive,
      account
    });
  } catch(err) {
    console.error('[manual-accounts] PUT /:id/toggle:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* DELETE /api/institution/fee/manual-accounts/:id
   Delete a manual payment account.
   adminGuard only. Tenant scope enforced by query.

   P6 HOOK: When SchoolPaymentClaim and SchoolFeePayment gain
   a paymentAccountId field (P4/P6), add reference checks here
   to prevent deletion of accounts with payment claim history.
   For P2, no payment records yet reference manual accounts.
*/
router.delete('/manual-accounts/:id', adminGuard, async function(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid account ID.' });
    }

    /* Confirm account exists and belongs to this school — TENANT SCOPE + IDOR */
    var account = await SchoolManualPaymentAccount.findOne({
      _id:      req.params.id,
      schoolId: req.schoolId
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Payment account not found.' });
    }

    /* ---- P6: Deletion protection —
       Block deletion if any claims or verified payments reference this account.
       Deactivating (toggle) is always the safer alternative.             ---- */
    var [claimCount, paymentCount] = await Promise.all([
      SchoolPaymentClaimDel.countDocuments({
        paymentAccountId: req.params.id,
        schoolId:         req.schoolId,         /* TENANT SCOPE */
        status:           { $in: ['awaiting_verification', 'verified', 'needs_correction'] }
      }),
      SchoolFeePaymentDel.countDocuments({
        paymentAccountId: req.params.id,
        schoolId:         req.schoolId,         /* TENANT SCOPE */
        status:           'confirmed'
      })
    ]);

    if (claimCount > 0 || paymentCount > 0) {
      var detail = [];
      if (claimCount  > 0) detail.push(claimCount  + ' active claim(s)');
      if (paymentCount > 0) detail.push(paymentCount + ' verified payment(s)');
      return res.status(400).json({
        success: false,
        message: 'Cannot delete: ' + detail.join(' and ') + ' reference this account. ' +
                 'Deactivate it instead — this hides it from payers while preserving payment history.'
      });
    }

    var deletedLabel    = account.accountLabel;
    var deletedCurrency = account.currency;
    var deletedBank     = account.bankName;

    await SchoolManualPaymentAccount.findByIdAndDelete(account._id);

    logAudit({
      req,
      action:     'institution.payment_account.manual.deleted',
      resource:   'SchoolManualPaymentAccount',
      resourceId: req.params.id,
      success:    true,
      message:    'Manual payment account deleted: "' + deletedLabel +
                  '" currency=' + deletedCurrency +
                  ' bank=' + deletedBank +
                  ' by=' + (req.schoolUser.name || req.schoolUser.email || 'unknown')
    });

    return res.json({
      success: true,
      message: '"' + deletedLabel + '" has been deleted.'
    });
  } catch(err) {
    console.error('[manual-accounts] DELETE /:id:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;