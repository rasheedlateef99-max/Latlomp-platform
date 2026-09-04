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

module.exports = router;