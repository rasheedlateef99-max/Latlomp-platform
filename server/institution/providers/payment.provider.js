'use strict';

/* ============================================
   LATLOMP — PAYMENT PROVIDER INTERFACE + REGISTRY
   
   Paystack = first adapter. Others added later
   by implementing this interface.
   
   Core fee system (assignments, receipts, balance)
   communicates ONLY through this abstraction.
   Swapping providers = swap the adapter, nothing else.
============================================ */

class PaymentProvider {
  getName()        { throw new Error('getName() not implemented'); }
  getDisplayName() { throw new Error('getDisplayName() not implemented'); }

  /* Initialize a payment → { reference, authorizationUrl, accessCode } */
  async initializePayment(params)            { throw new Error('initializePayment() not implemented'); }

  /* Verify payment → { status, amounts, currency, paidAt, channel, providerData } */
  async verifyPayment(reference)             { throw new Error('verifyPayment() not implemented'); }

  /* Create provider settlement account → { providerAccountId, providerAccountCode, accountName } */
  async createSettlementAccount(params)      { throw new Error('createSettlementAccount() not implemented'); }

  /* Verify bank account → { accountName, accountNumber, bankCode } */
  async verifyBankAccount(accountNumber, bankCode) { throw new Error('verifyBankAccount() not implemented'); }

  /* List banks → [{ name, code, currency }] */
  async listBanks(currency)                  { throw new Error('listBanks() not implemented'); }

  /* Supported currencies → string[] */
  async getSupportedCurrencies()             { throw new Error('getSupportedCurrencies() not implemented'); }

  /* Parse webhook event → { isValid, type, reference, amount, currency, metadata, rawEvent } */
  parseWebhookEvent(rawBody, signature, secret) { throw new Error('parseWebhookEvent() not implemented'); }
}

/* ---- Registry ---- */
const _registry = {};

function registerProvider(name, provider) {
  if (!(provider instanceof PaymentProvider)) {
    throw new Error('Provider must extend PaymentProvider');
  }
  _registry[name] = provider;
  console.log('[PaymentProvider] Registered:', name);
}

function getProvider(name) {
  const p = _registry[name];
  if (!p) throw new Error('Provider not found: ' + name + '. Available: ' + Object.keys(_registry).join(', '));
  return p;
}

function getAvailableProviders() {
  return Object.keys(_registry).map(function (n) {
    return { name: n, displayName: _registry[n].getDisplayName() };
  });
}

/* ---- Providers are registered externally to avoid circular requires.
   See server/institution/providers/registry.js ---- */

module.exports = { PaymentProvider, registerProvider, getProvider, getAvailableProviders };