'use strict';
/* ============================================
   LATLOMP INSTITUTION — TRANSCRIPT SIGNING (E5)

   REAL cryptographic signing using ECDSA P-256.
   Node.js built-in crypto — no new npm dependency.

   IMPORTANT DISTINCTION:
   - hashDocument() (from E3): SHA-256 of PDF bytes.
     Proves document has not been modified.
   - signData() below: ECDSA private-key signature
     over the canonical data hash.
     Proves issuance by the platform (issuer trust).

   "Verified" only displays when BOTH are valid.
   If signing keys are not configured, the system
   honestly reports: integrityStatus=DATA_HASH_ONLY.

   KEY MANAGEMENT:
     Keys are PEM-encoded, stored as base64 in env vars.
     Never committed to source code.
     Key rotation: update TRANSCRIPT_SIGNING_KEY_ID
     and deploy new keys. Old key references remain
     in existing TranscriptRequest.signingKeyId for
     historical audit.

   ONE-TIME SETUP:
     Run generateSigningKeyPair() once, set env vars.
     See instructions in the returned object.
============================================ */
'use strict';

const crypto = require('crypto');

/* ---- Key retrieval ---- */
function getPrivateKey() {
  var encoded = process.env.TRANSCRIPT_SIGNING_PRIVATE_KEY;
  if (!encoded || !encoded.trim()) { return null; }
  try { return Buffer.from(encoded.trim(), 'base64').toString('utf8'); }
  catch (e) { console.error('[TranscriptSigning] Invalid TRANSCRIPT_SIGNING_PRIVATE_KEY:', e.message); return null; }
}

function getPublicKey() {
  var encoded = process.env.TRANSCRIPT_SIGNING_PUBLIC_KEY;
  if (!encoded || !encoded.trim()) { return null; }
  try { return Buffer.from(encoded.trim(), 'base64').toString('utf8'); }
  catch (e) { console.error('[TranscriptSigning] Invalid TRANSCRIPT_SIGNING_PUBLIC_KEY:', e.message); return null; }
}

function getKeyId() {
  return (process.env.TRANSCRIPT_SIGNING_KEY_ID || 'not-configured').trim();
}

function isSigningConfigured() {
  return !!(getPrivateKey() && getPublicKey());
}

/* ============================================
   signData(canonicalJsonString) → { signature, keyId, algorithm, configured }

   REAL ECDSA-P256-SHA256 signature.
   Returns { configured: false } if keys not set.
   Never throws — errors reported cleanly.
============================================ */
function signData(canonicalJsonString) {
  var privateKey = getPrivateKey();
  if (!privateKey) {
    console.warn('[TranscriptSigning] No signing key configured. Transcript will be unsigned.');
    return { signature: null, keyId: null, algorithm: null, configured: false };
  }

  try {
    var sign = crypto.createSign('SHA256');
    sign.update(canonicalJsonString, 'utf8');
    sign.end();

    /* createSign with EC key produces ECDSA signature in DER format */
    var signature = sign.sign(privateKey, 'base64');

    return {
      signature,
      keyId:     getKeyId(),
      algorithm: 'ECDSA-P256-SHA256',
      configured: true
    };
  } catch (err) {
    console.error('[TranscriptSigning] Signing failed:', err.message);
    return { signature: null, keyId: null, algorithm: null, configured: false, error: err.message };
  }
}

/* ============================================
   verifySignature(canonicalJsonString, signature, keyId)
   → { valid, integrityStatus, signatureStatus, reason }

   integrityStatus:  'DATA_HASH_ONLY' | 'SIGNATURE_VALID' | 'SIGNATURE_INVALID'
   signatureStatus:  'CONFIGURED' | 'UNSIGNED' | 'VALID' | 'INVALID' | 'ERROR'
============================================ */
function verifySignature(canonicalJsonString, signature, keyId) {
  var publicKey = getPublicKey();

  /* No signing configured on this deployment */
  if (!publicKey) {
    return {
      valid:           null,
      integrityStatus: 'SIGNING_NOT_CONFIGURED',
      signatureStatus: 'NOT_CONFIGURED',
      reason:          'This deployment does not have transcript signing keys configured.'
    };
  }

  /* Transcript was not signed when issued */
  if (!signature) {
    return {
      valid:           null,
      integrityStatus: 'DATA_HASH_ONLY',
      signatureStatus: 'UNSIGNED',
      reason:          'This transcript was issued before signing was configured.'
    };
  }

  try {
    var verify = crypto.createVerify('SHA256');
    verify.update(canonicalJsonString, 'utf8');
    verify.end();

    var valid = verify.verify(publicKey, signature, 'base64');

    return {
      valid,
      integrityStatus: valid ? 'SIGNATURE_VALID'   : 'SIGNATURE_INVALID',
      signatureStatus: valid ? 'VALID'              : 'INVALID',
      reason:          valid ? 'Signature verified.' : 'Signature does not match. Document may have been altered or issued by a different key.'
    };
  } catch (err) {
    console.error('[TranscriptSigning] Verification error:', err.message);
    return {
      valid:           false,
      integrityStatus: 'SIGNATURE_ERROR',
      signatureStatus: 'ERROR',
      reason:          'Signature verification encountered an error.'
    };
  }
}

/* ============================================
   generateSigningKeyPair()
   One-time utility for platform setup.
   Run manually: node -e "require('./transcript.signing.service').generateSigningKeyPair()"
   Then set the printed env vars.
============================================ */
function generateSigningKeyPair() {
  var pair = crypto.generateKeyPairSync('ec', {
    namedCurve:          'P-256',
    publicKeyEncoding:   { type: 'spki',   format: 'pem' },
    privateKeyEncoding:  { type: 'pkcs8',  format: 'pem' }
  });

  var privateB64 = Buffer.from(pair.privateKey).toString('base64');
  var publicB64  = Buffer.from(pair.publicKey).toString('base64');
  var keyId      = 'v1-' + new Date().getFullYear();

  console.log('\n========== TRANSCRIPT SIGNING KEY PAIR ==========');
  console.log('Set these environment variables in your deployment:');
  console.log('');
  console.log('TRANSCRIPT_SIGNING_PRIVATE_KEY=' + privateB64);
  console.log('TRANSCRIPT_SIGNING_PUBLIC_KEY='  + publicB64);
  console.log('TRANSCRIPT_SIGNING_KEY_ID='      + keyId);
  console.log('');
  console.log('IMPORTANT: Keep TRANSCRIPT_SIGNING_PRIVATE_KEY secret.');
  console.log('NEVER commit keys to source code or expose in API responses.');
  console.log('=================================================\n');

  return { privateB64, publicB64, keyId, configured: true };
}

/* ============================================
   deterministicJSON(obj) → string
   Stable, canonical JSON for any object.
   Same data always produces same string regardless
   of object property insertion order.
   Arrays are sorted by JSON.stringify of each element.
   Dates serialized to ISO-8601.
============================================ */
function deterministicJSON(obj) {
  if (obj === null || obj === undefined) { return 'null'; }
  if (obj instanceof Date) { return JSON.stringify(obj.toISOString()); }
  if (typeof obj === 'number' || typeof obj === 'boolean') { return JSON.stringify(obj); }
  if (typeof obj === 'string') { return JSON.stringify(obj); }
  if (Array.isArray(obj)) {
    var items = obj.map(deterministicJSON);
    items.sort(); /* deterministic array order */
    return '[' + items.join(',') + ']';
  }
  if (typeof obj === 'object') {
    var keys = Object.keys(obj).sort();
    var pairs = keys.map(function(k) {
      return JSON.stringify(k) + ':' + deterministicJSON(obj[k]);
    });
    return '{' + pairs.join(',') + '}';
  }
  return JSON.stringify(obj);
}

/* ============================================
   hashCanonicalData(deterministicJsonString) → hex
============================================ */
function hashCanonicalData(deterministicJsonString) {
  return crypto.createHash('sha256').update(deterministicJsonString, 'utf8').digest('hex');
}

module.exports = {
  isSigningConfigured,
  signData,
  verifySignature,
  generateSigningKeyPair,
  deterministicJSON,
  hashCanonicalData
};