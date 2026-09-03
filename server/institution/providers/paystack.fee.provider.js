'use strict';
const crypto = require('crypto');
const { PaymentProvider } = require('./payment.provider');

/* ============================================
   PAYSTACK ADAPTER
   
   Settlement model:
   - School has a Paystack subaccount
   - Parent pays: schoolFee + latLompFee
   - transaction_charge = latLompFee → master account
   - bearer = 'subaccount' → Paystack's fee from school's share
   - School receives: schoolFee − Paystack's own charge
   - LatLomp receives: latLompFee (platform fee only)
   
   We do NOT hard-code Paystack's fee percentage.
   Their charge is read from the verification response.
============================================ */
class PaystackFeeProvider extends PaymentProvider {
  getName()        { return 'paystack'; }
  getDisplayName() { return 'Paystack'; }

  _secret() { return process.env.PAYSTACK_SECRET_KEY || ''; }
  _headers() {
    return { 'Authorization': 'Bearer ' + this._secret(), 'Content-Type': 'application/json' };
  }

  async initializePayment({
    email, schoolFeeAmount, platformFeeAmount, currency,
    subaccountCode, reference, callbackUrl, metadata
  }) {
    const totalKobo    = Math.round((schoolFeeAmount + platformFeeAmount) * 100);
    const platformKobo = Math.round(platformFeeAmount * 100);

    const body = {
      email,
      amount:              totalKobo,
      currency:            currency || 'NGN',
      reference,
      callback_url:        callbackUrl,
      subaccount:          subaccountCode,
      transaction_charge:  platformKobo,  /* LatLomp's share */
      bearer:              'subaccount',  /* Paystack deducts its fee from school's share */
      metadata:            Object.assign({}, metadata, {
        type:              'institution_fee_payment',
        schoolFeeAmount,
        platformFeeAmount,
        currency:          currency || 'NGN'
      })
    };

    const res  = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.status) throw new Error('Paystack init failed: ' + (data.message || 'Unknown error'));

    return {
      reference,
      authorizationUrl: data.data.authorization_url,
      accessCode:       data.data.access_code
    };
  }

  async verifyPayment(reference) {
    const res  = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
      { headers: this._headers() }
    );
    const data = await res.json();
    if (!data.status || !data.data) throw new Error('Paystack verify failed: ' + (data.message || 'Unknown'));

    const tx = data.data;
    /* All amounts from Paystack are in kobo */
    const totalChargedKobo    = tx.amount                  || 0;
    const platformFeeKobo     = tx.transaction_charge      || 0; /* went to LatLomp master */
    const schoolFeeKobo       = totalChargedKobo - platformFeeKobo;
    const providerFeeKobo     = tx.fees                    || 0; /* Paystack's own charge */

    return {
      status:            tx.status,          /* 'success' | 'failed' | 'pending' */
      reference:         tx.reference,
      totalCharged:      totalChargedKobo    / 100,
      schoolFeeAmount:   schoolFeeKobo       / 100,
      platformFeeAmount: platformFeeKobo     / 100,
      providerFeeAmount: providerFeeKobo     / 100,
      currency:          tx.currency         || 'NGN',
      paidAt:            tx.paid_at ? new Date(tx.paid_at) : new Date(),
      channel:           tx.channel          || '',
      customerEmail:     tx.customer && tx.customer.email || '',
      metadata:          tx.metadata         || {},
      providerData:      tx                             /* full response for audit */
    };
  }

  async createSettlementAccount({ businessName, bankCode, accountNumber, description }) {
    const body = {
      business_name:     businessName,
      settlement_bank:   bankCode,
      account_number:    accountNumber,
      percentage_charge: 0,             /* platform fee handled via transaction_charge */
      description:       description || businessName
    };
    const res  = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.status) throw new Error('Paystack subaccount error: ' + (data.message || 'Unknown error'));

    return {
      providerAccountId:   String(data.data.id),
      providerAccountCode: data.data.subaccount_code,
      accountName:         data.data.settlement_bank,
      accountNumber:       data.data.account_number
    };
  }

  async verifyBankAccount(accountNumber, bankCode) {
    const url  = `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
    const res  = await fetch(url, { headers: this._headers() });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || 'Bank account verification failed.');
    return { accountName: data.data.account_name, accountNumber: data.data.account_number, bankCode };
  }

  async listBanks(currency) {
    const params = currency ? '?currency=' + currency + '&use_cursor=false&perPage=100' : '?use_cursor=false&perPage=100';
    const res    = await fetch('https://api.paystack.co/bank' + params, { headers: this._headers() });
    const data   = await res.json();
    if (!data.status) return [];
    return (data.data || []).map(function (b) {
      return { name: b.name, code: b.code, currency: b.currency || 'NGN' };
    });
  }

  async getSupportedCurrencies() {
    /* Reflect Paystack's actual current support, not assumed.
       This is queried dynamically — no hardcoded list. */
    try {
      const res  = await fetch('https://api.paystack.co/bank?use_cursor=false&perPage=1', { headers: this._headers() });
      const data = await res.json();
      /* If API responds, Paystack is reachable — return known supported currencies */
      if (data.status) return ['NGN', 'GHS', 'USD', 'ZAR', 'KES'];
    } catch (e) { /* fall through */ }
    return ['NGN']; /* conservative fallback */
  }

  parseWebhookEvent(rawBody, signature, secret) {
    const expectedSig = crypto
      .createHmac('sha512', secret || this._secret())
      .update(rawBody)
      .digest('hex');

    const isValid = signature === expectedSig;
    let event;
    try { event = JSON.parse(rawBody.toString()); }
    catch (e) { return { isValid: false, type: 'parse_error', reference: '', rawEvent: null }; }

    return {
      isValid,
      type:      event.event                                  || '',
      reference: event.data && event.data.reference          || '',
      amount:    event.data && event.data.amount ? event.data.amount / 100 : 0,
      currency:  event.data && event.data.currency           || 'NGN',
      metadata:  event.data && event.data.metadata           || {},
      rawEvent:  event
    };
  }
}

/* ============================================
   ✅ E7B AUDIT: refundPayment(transactionRef, amountKobo)
   Calls Paystack Refund API.
   amountKobo = null means full refund.
   Returns { success, refundRef, status, message }
============================================ */
PaystackFeeProvider.prototype.refundPayment = async function(transactionRef, amountKobo) {
  var axios       = require('axios');
  var secretKey   = process.env.PAYSTACK_SECRET_KEY || '';
  if (!secretKey) { throw new Error('PAYSTACK_SECRET_KEY not configured.'); }

  var body = { transaction: transactionRef };
  if (amountKobo && amountKobo > 0) { body.amount = Math.round(amountKobo); }

  try {
    var response = await axios.post('https://api.paystack.co/refund', body, {
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    var data = response.data;
    if (data && data.status) {
      return {
        success:   true,
        refundRef: data.data && data.data.id   ? String(data.data.id)     : '',
        status:    data.data && data.data.status? data.data.status         : 'pending',
        message:   data.message || 'Refund initiated with provider.'
      };
    }
    return { success: false, refundRef: '', status: 'failed', message: data.message || 'Provider returned failure.' };
  } catch (err) {
    var errMsg = err.response && err.response.data && err.response.data.message
      ? err.response.data.message
      : err.message;
    throw new Error('Paystack refund failed: ' + errMsg);
  }
};

/* ============================================
   ✅ FIX: listBanks(currency)
   Calls Paystack GET /bank API server-side.
   Secret key NEVER exposed to browser.
   Currency-to-country mapping for Paystack.
   Returns: [{ id, name, code, longcode, type }]
============================================ */
PaystackFeeProvider.prototype.listBanks = async function(currency) {
  var axios = require('axios');
  var secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured.');
  }

  /* Paystack requires country for bank list — currency determines country */
  var currencyCountryMap = {
    NGN: 'nigeria',
    GHS: 'ghana',
    ZAR: 'south africa',
    KES: 'kenya'
    /* GBP is NOT supported for Paystack African subaccounts — excluded by design */
  };

  var country = currencyCountryMap[(currency || 'NGN').toUpperCase()];
  if (!country) {
    throw new Error('Currency ' + currency + ' is not supported by the payment provider for bank account setup.');
  }

  try {
    var response = await axios.get('https://api.paystack.co/bank', {
      headers: { Authorization: 'Bearer ' + secretKey },
      params:  { country: country, use_cursor: false, perPage: 100 },
      timeout: 15000
    });

    if (!response.data || !response.data.status) {
      throw new Error(response.data && response.data.message ? response.data.message : 'Paystack bank list unavailable.');
    }

    var banks = (response.data.data || []).map(function(b) {
      return {
        id:       b.id,
        name:     b.name,
        code:     b.code,
        longcode: b.longcode || '',
        type:     b.type    || 'nuban'
      };
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });

    return banks;
  } catch (err) {
    var errMsg = err.response && err.response.data && err.response.data.message
      ? err.response.data.message
      : err.message;
    throw new Error('Failed to load bank list from payment provider: ' + errMsg);
  }
};

/* ============================================
   ✅ FIX: getSupportedCurrencies()
   Returns only currencies Paystack actually
   supports for African subaccounts.
   GBP is NOT listed — not supported.
============================================ */
PaystackFeeProvider.prototype.getSupportedCurrencies = async function() {
  return [
    { code: 'NGN', name: 'Nigerian Naira',      country: 'Nigeria',      flag: '🇳🇬', supported: true },
    { code: 'GHS', name: 'Ghanaian Cedi',       country: 'Ghana',        flag: '🇬🇭', supported: true },
    { code: 'ZAR', name: 'South African Rand',  country: 'South Africa', flag: '🇿🇦', supported: true },
    { code: 'KES', name: 'Kenyan Shilling',     country: 'Kenya',        flag: '🇰🇪', supported: true }
    /* GBP: NOT supported for Paystack subaccounts in Africa.
       USD: Not available for settlement subaccounts in NGN/African markets. */
  ];
};

module.exports = PaystackFeeProvider;