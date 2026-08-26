'use strict';
/* ============================================
   PAYMENT PROVIDER REGISTRY INITIALIZER
   
   Import this ONCE at server startup (server.js).
   Registers all available payment provider adapters.
   
   Keeping registration here (not in payment.provider.js)
   prevents the circular require:
     payment.provider → paystack.fee.provider
     paystack.fee.provider → payment.provider (not ready yet)
   
   Adding a new provider = add one line here.
============================================ */

const { registerProvider } = require('./payment.provider');

/* ---- Paystack (first provider) ---- */
try {
  const PaystackFeeProvider = require('./paystack.fee.provider');
  registerProvider('paystack', new PaystackFeeProvider());
} catch (e) {
  console.warn('[PaymentRegistry] Paystack failed to register:', e.message);
}

/* ---- Future providers (uncomment when adapters exist):
   const FlutterwaveProvider = require('./flutterwave.fee.provider');
   registerProvider('flutterwave', new FlutterwaveProvider());
---- */