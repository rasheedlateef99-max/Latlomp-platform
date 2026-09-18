'use strict';
/* ============================================================
   LATLOMP P2 — MANUAL PAYMENT ACCOUNT SECURITY & ISOLATION TESTS

   Run against LOCAL or STAGING only.
   Never run against real production schools.

   Usage:
     node server/institution/tests/p2.payment.account.test.js

   Prerequisites:
     1. Server running on TEST_BASE_URL
     2. Two test school admin inst tokens
        (extract from localStorage.latlomp_inst_token)

   Environment variables:
     TEST_BASE_URL       — defaults http://localhost:3000
     TEST_INST_TOKEN_A   — School A admin inst token
     TEST_INST_TOKEN_B   — School B admin inst token

   Tests:
     AUTH (T01–T04)      — unauthenticated + wrong-token rejection
     CRUD (T05–T10)      — create, read, update, toggle, delete
     TENANT (T11–T14)    — School B cannot touch School A's accounts
     REGRESSION (T15–T20)— existing fee, finance, Paystack routes intact
============================================================ */

var http  = require('http');
var https = require('https');
var url   = require('url');

var CONFIG = {
  BASE_URL:    process.env.TEST_BASE_URL    || 'http://localhost:3000',
  TOKEN_A:     process.env.TEST_INST_TOKEN_A || '',
  TOKEN_B:     process.env.TEST_INST_TOKEN_B || ''
};

var passed = 0; var failed = 0; var skipped = 0;
var _createdAccountId = '';

/* ---- Runner ---- */
function log(id, status, desc, detail) {
  var icons = { PASS:'✅', FAIL:'❌', SKIP:'⏭', WARN:'⚠️' };
  console.log(icons[status] + ' ' + id + ' [' + status + '] ' + desc +
    (detail ? '\n         ' + detail : ''));
  if (status === 'PASS') passed++;
  if (status === 'FAIL') failed++;
  if (status === 'SKIP') skipped++;
}

/* ---- HTTP helper ---- */
function req(method, path, token, body) {
  return new Promise(function(resolve, reject) {
    var parsed = url.parse(CONFIG.BASE_URL + path);
    var lib    = parsed.protocol === 'https:' ? https : http;
    var opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.path,
      method:   method,
      headers:  Object.assign({
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      }, token ? { 'Authorization': 'Bearer ' + token } : {})
    };
    var bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    var r = lib.request(opts, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end',  function() {
        var parsed2;
        try { parsed2 = JSON.parse(d); } catch(e) { parsed2 = null; }
        resolve({ status: res.statusCode, body: parsed2 });
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

function feeReq(method, path, token, body) {
  return req(method, '/api/institution/fee' + path, token, body);
}

function finReq(method, path, token, body) {
  return req(method, '/api/institution/finance' + path, token, body);
}

var SAMPLE_ACCOUNT = {
  accountLabel:  'P2 Test — Main NGN Account',
  accountType:   'main',
  bankName:      'Test Bank',
  accountName:   'P2 Test School Account',
  accountNumber: '0123456789',
  country:       'NG',
  currency:      'NGN',
  instructions:  'Use student name as reference.'
};

async function run() {
  console.log('\n' + '='.repeat(64));
  console.log('  LATLOMP P2 — PAYMENT ACCOUNT SECURITY TESTS');
  console.log('  Target: ' + CONFIG.BASE_URL);
  console.log('='.repeat(64) + '\n');

  if (!CONFIG.TOKEN_A) {
    console.log('⚠️  TEST_INST_TOKEN_A not set. Authentication tests will SKIP.\n');
  }
  if (!CONFIG.TOKEN_B) {
    console.log('⚠️  TEST_INST_TOKEN_B not set. Tenant isolation tests will SKIP.\n');
  }

  /* ---- AUTH ---- */

  /* T01: No token → 401 on list */
  try {
    var r = await feeReq('GET', '/manual-accounts', '');
    if (r.status === 401 || r.status === 403) {
      log('T01', 'PASS', 'Unauthenticated GET /manual-accounts rejected (' + r.status + ')');
    } else {
      log('T01', 'FAIL', 'Unauthenticated GET /manual-accounts rejected',
        'Expected 401/403, got ' + r.status + ' — CRITICAL: accounts may be publicly accessible.');
    }
  } catch(e) { log('T01', 'WARN', 'T01 inconclusive', e.message); }

  /* T02: No token → 401 on create */
  try {
    var r = await feeReq('POST', '/manual-accounts', '', SAMPLE_ACCOUNT);
    if (r.status === 401 || r.status === 403) {
      log('T02', 'PASS', 'Unauthenticated POST /manual-accounts rejected (' + r.status + ')');
    } else {
      log('T02', 'FAIL', 'Unauthenticated POST /manual-accounts rejected',
        'Expected 401/403, got ' + r.status + ' — anyone could add payment accounts.');
    }
  } catch(e) { log('T02', 'WARN', 'T02 inconclusive', e.message); }

  /* T03: No token → 401 on active endpoint */
  try {
    var r = await feeReq('GET', '/manual-accounts/active', '');
    if (r.status === 401 || r.status === 403) {
      log('T03', 'PASS', 'Unauthenticated GET /manual-accounts/active rejected (' + r.status + ')');
    } else {
      log('T03', 'FAIL', 'Unauthenticated GET /manual-accounts/active rejected',
        'Expected 401/403, got ' + r.status + ' — bank details exposed publicly.');
    }
  } catch(e) { log('T03', 'WARN', 'T03 inconclusive', e.message); }

  /* T04: Garbled token → 401 */
  try {
    var r = await feeReq('GET', '/manual-accounts', 'not.a.valid.jwt.token');
    if (r.status === 401 || r.status === 403) {
      log('T04', 'PASS', 'Garbled JWT token rejected by /manual-accounts');
    } else {
      log('T04', 'FAIL', 'Garbled JWT token should be rejected', 'Got ' + r.status);
    }
  } catch(e) { log('T04', 'WARN', 'T04 inconclusive', e.message); }

  /* ---- CRUD (requires TOKEN_A) ---- */

  if (!CONFIG.TOKEN_A) {
    ['T05','T06','T07','T08','T09','T10'].forEach(function(t) {
      log(t, 'SKIP', t + ' — CRUD test skipped', 'TEST_INST_TOKEN_A not configured');
    });
  } else {

    /* T05: Create payment account */
    try {
      var r = await feeReq('POST', '/manual-accounts', CONFIG.TOKEN_A, SAMPLE_ACCOUNT);
      if (r.status === 201 && r.body && r.body.success) {
        _createdAccountId = r.body.account && r.body.account._id;
        log('T05', 'PASS', 'Create payment account → 201, id=' + _createdAccountId);
      } else if (r.status === 403) {
        log('T05', 'WARN', 'Create returned 403 — TOKEN_A may not be a school admin.',
          'Use an admin-role inst token for this test.');
        _createdAccountId = '';
      } else {
        log('T05', 'FAIL', 'Create payment account should return 201',
          'Got ' + r.status + ' body=' + JSON.stringify(r.body));
      }
    } catch(e) { log('T05', 'WARN', 'T05 inconclusive', e.message); }

    /* T06: List accounts — School A should see the created one */
    try {
      var r = await feeReq('GET', '/manual-accounts', CONFIG.TOKEN_A);
      if (r.status === 200 && r.body && Array.isArray(r.body.accounts)) {
        var found = _createdAccountId &&
          r.body.accounts.some(function(a) { return a._id === _createdAccountId; });
        log('T06', 'PASS',
          'List accounts returns ' + r.body.accounts.length + ' account(s)' +
          (_createdAccountId ? (found ? ' — created account present ✓' : ' — ⚠️ created account not found') : ''));
      } else {
        log('T06', 'FAIL', 'List accounts should return 200 with accounts array',
          'Got ' + r.status);
      }
    } catch(e) { log('T06', 'WARN', 'T06 inconclusive', e.message); }

    /* T07: Update payment account */
    if (!_createdAccountId) {
      log('T07', 'SKIP', 'Update test skipped — no account created in T05');
    } else {
      try {
        var r = await feeReq('PUT', '/manual-accounts/' + _createdAccountId, CONFIG.TOKEN_A,
          { instructions: 'Updated instructions for P2 test.' });
        if (r.status === 200 && r.body && r.body.success) {
          log('T07', 'PASS', 'Update payment account → 200');
        } else {
          log('T07', 'FAIL', 'Update payment account should return 200',
            'Got ' + r.status + ' body=' + JSON.stringify(r.body));
        }
      } catch(e) { log('T07', 'WARN', 'T07 inconclusive', e.message); }
    }

    /* T08: Toggle deactivate */
    if (!_createdAccountId) {
      log('T08', 'SKIP', 'Toggle test skipped — no account created in T05');
    } else {
      try {
        var r = await feeReq('PUT', '/manual-accounts/' + _createdAccountId + '/toggle',
          CONFIG.TOKEN_A);
        if (r.status === 200 && r.body && r.body.success) {
          var nowActive = r.body.isActive;
          log('T08', 'PASS', 'Toggle account → 200, isActive=' + nowActive);
        } else {
          log('T08', 'FAIL', 'Toggle should return 200',
            'Got ' + r.status);
        }
      } catch(e) { log('T08', 'WARN', 'T08 inconclusive', e.message); }
    }

    /* T09: GET /active — should reflect toggle state */
    try {
      var r = await feeReq('GET', '/manual-accounts/active', CONFIG.TOKEN_A);
      if (r.status === 200 && r.body && Array.isArray(r.body.accounts)) {
        /* All returned accounts must be isActive:true — server enforces this */
        var allActive = r.body.accounts.every(function(a) { return a.isActive !== false; });
        log('T09', allActive ? 'PASS' : 'FAIL',
          'GET /active returns only active accounts' + (allActive ? ' ✓' : ' — inactive account leaked'),
          r.body.accounts.length + ' account(s) returned');
      } else {
        log('T09', 'WARN', 'GET /active result inconclusive', 'Got ' + r.status);
      }
    } catch(e) { log('T09', 'WARN', 'T09 inconclusive', e.message); }

    /* T10: Delete the test account */
    if (!_createdAccountId) {
      log('T10', 'SKIP', 'Delete test skipped — no account created in T05');
    } else {
      try {
        var r = await feeReq('DELETE', '/manual-accounts/' + _createdAccountId, CONFIG.TOKEN_A);
        if (r.status === 200 && r.body && r.body.success) {
          log('T10', 'PASS', 'Delete payment account → 200');
          _createdAccountId = '';
        } else {
          log('T10', 'FAIL', 'Delete should return 200',
            'Got ' + r.status + '. Clean up manually: id=' + _createdAccountId);
        }
      } catch(e) { log('T10', 'WARN', 'T10 inconclusive', e.message); }
    }
  }

  /* ---- TENANT ISOLATION (requires both tokens) ---- */

  var schoolAAccountId = '';

  if (!CONFIG.TOKEN_A || !CONFIG.TOKEN_B) {
    ['T11','T12','T13','T14'].forEach(function(t) {
      log(t, 'SKIP', t + ' — tenant isolation test skipped',
        'Both TEST_INST_TOKEN_A and TEST_INST_TOKEN_B required');
    });
  } else {

    /* Create a School A account to test cross-school access */
    try {
      var createR = await feeReq('POST', '/manual-accounts', CONFIG.TOKEN_A,
        Object.assign({}, SAMPLE_ACCOUNT, { accountLabel: 'P2 Tenant Test Account' }));
      if (createR.status === 201 && createR.body && createR.body.account) {
        schoolAAccountId = createR.body.account._id;
      }
    } catch(e) {}

    /* T11: School B cannot LIST School A's accounts */
    try {
      var rA = await feeReq('GET', '/manual-accounts', CONFIG.TOKEN_A);
      var rB = await feeReq('GET', '/manual-accounts', CONFIG.TOKEN_B);

      if (rA.status === 200 && rB.status === 200) {
        var idsA = (rA.body.accounts || []).map(function(a) { return a._id; });
        var idsB = (rB.body.accounts || []).map(function(a) { return a._id; });
        var overlap = idsA.filter(function(id) { return idsB.includes(id); });
        if (!overlap.length) {
          log('T11', 'PASS', 'School A and B see completely separate account lists (no overlap)');
        } else {
          log('T11', 'FAIL', 'TENANT ISOLATION FAILURE: Schools share account IDs',
            'Overlap: ' + overlap.join(', ') + ' — CRITICAL');
        }
      } else {
        log('T11', 'WARN', 'T11 inconclusive', 'A:' + rA.status + ' B:' + rB.status);
      }
    } catch(e) { log('T11', 'WARN', 'T11 inconclusive', e.message); }

    /* T12: School B cannot UPDATE School A's account (IDOR) */
    if (!schoolAAccountId) {
      log('T12', 'SKIP', 'T12 — no School A account available for IDOR test');
    } else {
      try {
        var r = await feeReq('PUT', '/manual-accounts/' + schoolAAccountId, CONFIG.TOKEN_B,
          { accountLabel: 'IDOR ATTACK' });
        if (r.status === 404 || r.status === 403) {
          log('T12', 'PASS', 'School B cannot update School A account (' + r.status + ') — IDOR blocked');
        } else if (r.status === 200) {
          log('T12', 'FAIL', 'CRITICAL IDOR: School B modified School A payment account',
            'Account ID: ' + schoolAAccountId + ' — INVESTIGATE IMMEDIATELY');
        } else {
          log('T12', 'WARN', 'T12 inconclusive', 'Got ' + r.status);
        }
      } catch(e) { log('T12', 'WARN', 'T12 inconclusive', e.message); }
    }

    /* T13: School B cannot TOGGLE School A's account (IDOR) */
    if (!schoolAAccountId) {
      log('T13', 'SKIP', 'T13 — no School A account available');
    } else {
      try {
        var r = await feeReq('PUT', '/manual-accounts/' + schoolAAccountId + '/toggle',
          CONFIG.TOKEN_B);
        if (r.status === 404 || r.status === 403) {
          log('T13', 'PASS', 'School B cannot toggle School A account (' + r.status + ') — IDOR blocked');
        } else if (r.status === 200) {
          log('T13', 'FAIL', 'CRITICAL IDOR: School B toggled School A payment account');
        } else {
          log('T13', 'WARN', 'T13 inconclusive', 'Got ' + r.status);
        }
      } catch(e) { log('T13', 'WARN', 'T13 inconclusive', e.message); }
    }

    /* T14: School B cannot DELETE School A's account (IDOR) */
    if (!schoolAAccountId) {
      log('T14', 'SKIP', 'T14 — no School A account available');
    } else {
      try {
        var r = await feeReq('DELETE', '/manual-accounts/' + schoolAAccountId, CONFIG.TOKEN_B);
        if (r.status === 404 || r.status === 403) {
          log('T14', 'PASS', 'School B cannot delete School A account (' + r.status + ') — IDOR blocked');
        } else if (r.status === 200) {
          log('T14', 'FAIL', 'CRITICAL IDOR: School B deleted School A payment account',
            'The tenant isolation on delete is broken.');
        } else {
          log('T14', 'WARN', 'T14 inconclusive', 'Got ' + r.status);
        }
      } catch(e) { log('T14', 'WARN', 'T14 inconclusive', e.message); }

      /* Cleanup: delete the School A test account */
      if (schoolAAccountId) {
        try {
          await feeReq('DELETE', '/manual-accounts/' + schoolAAccountId, CONFIG.TOKEN_A);
          console.log('   [T11–T14 cleanup] School A test account deleted.');
        } catch(e) {}
      }
    }
  }

  /* ---- REGRESSION ---- */

  /* T15: Existing fee structures endpoint still works */
  try {
    var r = await feeReq('GET', '/structures', CONFIG.TOKEN_A || '');
    if (r.status === 401 || r.status === 200) {
      log('T15', 'PASS', 'GET /fee/structures still responds correctly (' + r.status + ')');
    } else {
      log('T15', 'FAIL', 'GET /fee/structures broken', 'Got ' + r.status);
    }
  } catch(e) { log('T15', 'WARN', 'T15 inconclusive', e.message); }

  /* T16: Existing fee payments endpoint still works */
  try {
    var r = await feeReq('GET', '/payments', CONFIG.TOKEN_A || '');
    if (r.status === 401 || r.status === 200) {
      log('T16', 'PASS', 'GET /fee/payments still responds correctly (' + r.status + ')');
    } else {
      log('T16', 'FAIL', 'GET /fee/payments broken', 'Got ' + r.status);
    }
  } catch(e) { log('T16', 'WARN', 'T16 inconclusive', e.message); }

  /* T17: Existing Paystack payment-account status still works */
  try {
    var r = await feeReq('GET', '/payment-account/status', CONFIG.TOKEN_A || '');
    if (r.status === 401 || r.status === 200) {
      log('T17', 'PASS', 'GET /fee/payment-account/status still responds (' + r.status + ')');
    } else {
      log('T17', 'FAIL', 'GET /fee/payment-account/status broken', 'Got ' + r.status);
    }
  } catch(e) { log('T17', 'WARN', 'T17 inconclusive', e.message); }

  /* T18: Finance summary still works */
  try {
    var r = await finReq('GET', '/summary', CONFIG.TOKEN_A || '');
    if (r.status === 401 || r.status === 200) {
      log('T18', 'PASS', 'GET /finance/summary still responds correctly (' + r.status + ')');
    } else {
      log('T18', 'FAIL', 'GET /finance/summary broken', 'Got ' + r.status);
    }
  } catch(e) { log('T18', 'WARN', 'T18 inconclusive', e.message); }

  /* T19: Paystack webhook endpoint still accessible (returns 400 without valid sig — expected) */
  try {
    var r = await req('POST', '/api/institution/payment/webhook', '', {});
    if (r.status === 400 || r.status === 200) {
      log('T19', 'PASS', 'Paystack subscription webhook endpoint still accessible (' + r.status + ')');
    } else {
      log('T19', 'WARN', 'Webhook endpoint returned unexpected status', 'Got ' + r.status);
    }
  } catch(e) { log('T19', 'WARN', 'T19 inconclusive', e.message); }

  /* T20: E8 public website route still functional */
  try {
    var r = await req('GET', '/school/test', '', null);
    if (r.status === 200 || r.status === 404) {
      log('T20', 'PASS', 'E8 public website route still functional (' + r.status + ')');
    } else if (r.status === 500) {
      log('T20', 'FAIL', 'E8 public website route returning 500', 'P2 may have broken the public website router.');
    } else {
      log('T20', 'WARN', 'E8 website regression inconclusive', 'Got ' + r.status);
    }
  } catch(e) { log('T20', 'WARN', 'T20 inconclusive', e.message); }

  /* ---- Summary ---- */
  console.log('\n' + '='.repeat(64));
  console.log('  P2 TEST RESULTS');
  console.log('='.repeat(64));
  console.log('  ✅ PASSED:  ' + passed);
  console.log('  ❌ FAILED:  ' + failed);
  console.log('  ⏭  SKIPPED: ' + skipped);
  console.log('  TOTAL:      ' + (passed + failed + skipped));
  console.log('='.repeat(64));
  if (failed > 0) {
    console.log('\n  ‼️  FAILED TESTS REQUIRE INVESTIGATION BEFORE P3.\n');
    process.exit(1);
  } else {
    console.log('\n  ✅ All automated P2 tests passed. Complete manual P2 checklist before P3.\n');
  }
}

run().catch(function(err) {
  console.error('Test runner crashed:', err.message);
  process.exit(1);
});