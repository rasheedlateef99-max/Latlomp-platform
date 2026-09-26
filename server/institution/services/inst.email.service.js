/* ============================================
   LATLOMP INSTITUTION — EMAIL SERVICE
   
   Centralised email sending for all institution
   events. All templates live here.
   
   Events handled:
   - Teacher invitation
   - Welcome (after onboarding)
   - Subscription confirmed
   - Subscription expiry warning (3 days)
   - Subscription expired
   - Results released (student notification)
============================================ */

const sgMail = require('@sendgrid/mail');

/* Initialise once */
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

var FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@latlomp.com';
var APP_URL    = process.env.APP_URL             || 'https://latlompsystem.up.railway.app';
var EMAIL_ON   = process.env.EMAIL_ENABLED === 'true';
/* Currency-aware amount formatter for email templates.
   No NGN assumption — if currency missing, shows bare number.
   Format: "150,000.00 NGN" — code-before-number avoids
   symbol encoding issues across email clients. */
function fmtEmailAmount(amount, currency) {
  var num = Number(amount || 0).toLocaleString('en', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  if (!currency) { return num; }
  return num + '\u00a0' + currency.toUpperCase().trim();
}

/* ============================================
   CORE SEND WRAPPER
   Fails silently in dev — never crashes the app
============================================ */
async function sendEmail(to, subject, html) {
  if (!EMAIL_ON) {
    console.log('[Email DISABLED] Would send to:', to, '|', subject);
    return { sent: false, reason: 'EMAIL_DISABLED' };
  }

  try {
    await sgMail.send({ to, from: FROM_EMAIL, subject, html });
    console.log('[Email] Sent:', subject, '→', to);
    return { sent: true };
  } catch (err) {
    console.error('[Email] Failed:', subject, '→', to, '|', err.message);
    return { sent: false, error: err.message };
  }
}

/* ============================================
   SHARED BASE TEMPLATE
============================================ */
function baseTemplate(content, footerNote) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f0f0f5; font-family: Inter, -apple-system, sans-serif; padding: 40px 20px; }
    .wrapper { max-width: 560px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #6c63ff, #574fd6);
      border-radius: 16px 16px 0 0;
      padding: 28px 32px;
      display: flex; align-items: center; gap: 12px;
    }
    .header-logo { font-size: 28px; }
    .header-text { color: #fff; }
    .header-text h1 { font-size: 20px; font-weight: 800; margin: 0; }
    .header-text p  { font-size: 12px; opacity: 0.8; margin: 2px 0 0; }
    .body { background: #fff; padding: 32px; }
    .footer {
      background: #f8f8ff;
      border-radius: 0 0 16px 16px;
      padding: 18px 32px;
      font-size: 12px;
      color: #999;
      border-top: 1px solid #eee;
      line-height: 1.6;
    }
    h2 { font-size: 22px; font-weight: 800; color: #1a1a2e; margin-bottom: 12px; }
    p  { font-size: 15px; color: #444; line-height: 1.7; margin-bottom: 16px; }
    .btn {
      display: inline-block;
      padding: 14px 28px;
      background: linear-gradient(135deg, #6c63ff, #574fd6);
      color: #fff !important;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      margin: 8px 0 20px;
    }
    .btn-green { background: linear-gradient(135deg, #43e97b, #38f9d7); color: #0f0f1a !important; }
    .info-box  { background: #f8f8ff; border-left: 4px solid #6c63ff; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 14px; color: #333; line-height: 1.7; }
    .info-box.warning { border-color: #ffa500; background: #fffaf0; }
    .info-box.danger  { border-color: #ff6584; background: #fff5f7; }
    .info-box.success { border-color: #43e97b; background: #f0fff6; }
    .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    .code-box {
      background: #1a1a2e; color: #a78bfa; font-family: monospace;
      font-size: 28px; font-weight: 900; letter-spacing: 8px;
      padding: 18px; border-radius: 10px; text-align: center;
      margin: 16px 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">⚡</div>
      <div class="header-text">
        <h1>LatLomp Schools</h1>
        <p>Educational Management Platform</p>
      </div>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      ${footerNote || 'This email was sent by LatLomp Schools. If you did not expect this, you can safely ignore it.'}
      <br/>© ${new Date().getFullYear()} LatLomp Platform · <a href="${APP_URL}" style="color:#6c63ff;">latlompsystem.up.railway.app</a>
    </div>
  </div>
</body>
</html>`;
}

/* ============================================
   1. TEACHER INVITATION
============================================ */
async function sendTeacherInvite({ toEmail, toName, schoolName, inviterName, role, inviteUrl, expiresAt }) {
  var roleName  = role === 'vice_principal' ? 'Vice Principal' : 'Teacher';
  var expiryStr = expiresAt ? new Date(expiresAt).toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' }) : '7 days';

  var content = `
    <h2>You're invited to join ${schoolName}! 🎉</h2>
    <p>Hi ${toName || 'there'},</p>
    <p><strong>${inviterName}</strong> has invited you to join <strong>${schoolName}</strong> on LatLomp Schools as a <strong>${roleName}</strong>.</p>

    <div class="info-box success">
      With this role you will be able to:<br/>
      • Create and manage CBT examinations<br/>
      • Add and edit questions with multiple types<br/>
      • View and grade student submissions<br/>
      • Monitor exam results and performance
    </div>

    <p>Click the button below to accept your invitation. You'll need to sign in with your Google account.</p>
    <a href="${inviteUrl}" class="btn">Accept Invitation →</a>

    <hr class="divider" />
    <p style="font-size:13px; color:#999;">This invitation expires on <strong>${expiryStr}</strong>. If the button doesn't work, paste this link into your browser:</p>
    <p style="font-size:12px; word-break:break-all; color:#6c63ff;">${inviteUrl}</p>
  `;

  return sendEmail(
    toEmail,
    `You're invited to join ${schoolName} on LatLomp Schools`,
    baseTemplate(content, `Invitation sent by ${inviterName} at ${schoolName}.`)
  );
}

/* ============================================
   2. SCHOOL WELCOME (after onboarding)
============================================ */
async function sendSchoolWelcome({ toEmail, schoolName, principalName, trialExpiry, dashboardUrl }) {
  var expiryStr = trialExpiry
    ? new Date(trialExpiry).toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' })
    : '7 days from now';

  var content = `
    <h2>Welcome to LatLomp Schools, ${principalName}! 🏫</h2>
    <p>Your school <strong>${schoolName}</strong> has been successfully set up. Your 7-day free trial has started!</p>

    <div class="info-box success">
      <strong>🎁 Free Trial Active</strong><br/>
      Your trial gives you full access to all features until <strong>${expiryStr}</strong>.
      No credit card was required to start.
    </div>

    <p>Here's what you can do right now:</p>
    <div class="info-box">
      ✅ Invite your teachers from the Teachers section<br/>
      ✅ Teachers can create exams and add questions<br/>
      ✅ Students access exams using the 8-character access code<br/>
      ✅ View and release results from your dashboard
    </div>

    <a href="${dashboardUrl || APP_URL + '/institution/school/dashboard.html'}" class="btn btn-green">Go to Dashboard →</a>

    <hr class="divider" />
    <p style="font-size:13px; color:#666;">To keep access after your trial, visit the Subscription section in your dashboard to choose a plan.</p>
  `;

  return sendEmail(
    toEmail,
    `Welcome to LatLomp Schools — ${schoolName} is ready! 🎉`,
    baseTemplate(content)
  );
}

/* ============================================
   3. SUBSCRIPTION CONFIRMED
============================================ */
async function sendSubscriptionConfirmed({ toEmail, schoolName, planName, amount, expiryDate, reference }) {
  var expiryStr = new Date(expiryDate).toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' });

  var content = `
    <h2>Subscription Activated ✅</h2>
    <p>Hi, your subscription for <strong>${schoolName}</strong> has been successfully activated.</p>

    <div class="info-box success">
      <strong>Plan:</strong> ${planName}<br/>
      <strong>Amount Paid:</strong> ₦${Number(amount).toLocaleString()}<br/>
      <strong>Access Until:</strong> ${expiryStr}<br/>
      <strong>Reference:</strong> ${reference || '—'}
    </div>

    <a href="${APP_URL}/institution/school/dashboard.html" class="btn btn-green">Go to Dashboard →</a>

    <p style="font-size:13px; color:#999; margin-top:16px;">Keep this email as your receipt. If you have any issues with your subscription, please contact support with the reference number above.</p>
  `;

  return sendEmail(
    toEmail,
    `Payment confirmed — ${planName} activated for ${schoolName}`,
    baseTemplate(content)
  );
}

/* ============================================
   4. SUBSCRIPTION EXPIRY WARNING
============================================ */
async function sendExpiryWarning({ toEmail, schoolName, daysLeft, expiryDate, renewUrl }) {
  var expiryStr = new Date(expiryDate).toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' });
  var isUrgent  = daysLeft <= 1;

  var content = `
    <h2>${isUrgent ? '🚨 Last chance!' : '⚠️ Subscription expiring soon'}</h2>
    <p>Hi, this is a reminder that your subscription for <strong>${schoolName}</strong> 
    will expire in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> on <strong>${expiryStr}</strong>.</p>

    <div class="info-box ${isUrgent ? 'danger' : 'warning'}">
      When your subscription expires:<br/>
      • School admin login will be disabled<br/>
      • Teachers will lose dashboard access<br/>
      • Students will not be able to take exams<br/>
      • Your data remains safe and will be restored on renewal
    </div>

    <p>Renew now to avoid any interruption to your school's operations.</p>
    <a href="${renewUrl || APP_URL + '/institution/school/dashboard.html#subscription'}" class="btn">Renew Subscription →</a>
  `;

  return sendEmail(
    toEmail,
    `${isUrgent ? '🚨 URGENT: ' : ''}Your LatLomp subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
    baseTemplate(content)
  );
}

/* ============================================
   5. SUBSCRIPTION EXPIRED
============================================ */
async function sendSubscriptionExpired({ toEmail, schoolName, renewUrl }) {
  var content = `
    <h2>Your subscription has expired 😔</h2>
    <p>Your subscription for <strong>${schoolName}</strong> has expired. Access has been automatically suspended.</p>

    <div class="info-box danger">
      Your school data is <strong>safe and stored</strong>. Everything will be restored the moment you renew.
    </div>

    <p>Renew now to restore access for your school, teachers, and students immediately.</p>
    <a href="${renewUrl || APP_URL + '/institution/school/dashboard.html#subscription'}" class="btn">Renew Now →</a>

    <hr class="divider" />
    <p style="font-size:13px; color:#999;">If you believe this is an error or need assistance, please contact our support team.</p>
  `;

  return sendEmail(
    toEmail,
    `Action required: Your LatLomp subscription for ${schoolName} has expired`,
    baseTemplate(content)
  );
}

/* ============================================
   6. RESULTS RELEASED NOTIFICATION
============================================ */
async function sendResultsReleased({ toEmail, studentName, examTitle, schoolName, scorePercent, isPassed }) {
  var color   = isPassed ? '#43e97b' : '#ff6584';
  var message = isPassed
    ? `Congratulations — you passed with ${scorePercent}%!`
    : `You scored ${scorePercent}%. Keep studying and try again!`;

  var content = `
    <h2>Your exam results are ready! 📊</h2>
    <p>Hi ${studentName},</p>
    <p>Your results for <strong>${examTitle}</strong> at <strong>${schoolName}</strong> have been released.</p>

    <div style="text-align:center; background: #f8f8ff; border-radius: 12px; padding: 24px; margin: 16px 0;">
      <div style="font-size:48px; font-weight:900; color:${color};">${scorePercent}%</div>
      <div style="font-size:16px; font-weight:700; color:#333; margin-top:8px;">${message}</div>
    </div>

    <a href="${APP_URL}/institution/student/exam.html" class="btn ${isPassed ? 'btn-green' : ''}">View Portal →</a>
  `;

  return sendEmail(
    toEmail,
    `Your results for ${examTitle} are ready — ${scorePercent}%`,
    baseTemplate(content, `This result notification was sent by ${schoolName} via LatLomp Schools.`)
  );
}

/* ============================================
   R2: FEE PAYMENT CONFIRMATION EMAIL
============================================ */
async function sendFeePaymentConfirmed({
  toEmail, parentName, studentName, feeName,
  schoolName, amount, currency, totalCharged,
  platformFeeAmount, receiptNumber, paidAt
}) {
  var amountStr   = fmtEmailAmount(amount,                   currency);
  var totalStr    = fmtEmailAmount(totalCharged,             currency);
  var platformStr = fmtEmailAmount(platformFeeAmount || 0,   currency);
  var dateStr     = paidAt
    ? new Date(paidAt).toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : new Date().toLocaleDateString('en-NG');

  var content = `
    <h2>Fee Payment Confirmed ✅</h2>
    <p>Hi ${parentName || 'Parent'},</p>
    <p>Your fee payment for <strong>${studentName}</strong> at <strong>${schoolName}</strong> has been successfully processed.</p>

    <div class="info-box success">
      <strong>Student:</strong> ${studentName}<br/>
      <strong>Fee:</strong> ${feeName || 'School Fee'}<br/>
      <strong>School Fee:</strong> ${amountStr}<br/>
      <strong>LatLomp Service Fee:</strong> ${platformStr}<br/>
      <strong>Total Paid:</strong> ${totalStr}<br/>
      <strong>Receipt No:</strong> ${receiptNumber}<br/>
      <strong>Date:</strong> ${dateStr}
    </div>

    <p>You can view this receipt and your payment history from the Parent Portal.</p>
    <a href="${APP_URL}/institution/parent/dashboard.html" class="btn btn-green">View Parent Portal →</a>
  `;

  return sendEmail(
    toEmail,
    'Fee payment confirmed — ' + receiptNumber + ' | ' + schoolName,
    baseTemplate(content, 'Fee payment receipt for ' + schoolName + ' via LatLomp Schools.')
  );
}

/* ============================================
   P10-A: PAYMENT CLAIM NOTIFICATION FUNCTIONS

   All four are called as fire-and-forget in
   inst.fee.routes.js (P4) and inst.finance.routes.js
   (P5) with try/catch wrappers. They never throw
   errors that reach the request handler.

   Currency uses fmtEmailAmount() — no NGN assumption.
   Payer portal link adapts to payerType where provided.
============================================ */

/* ============================================
   7. PAYMENT CLAIM RECEIVED (to Finance staff)
   Triggered: POST /fee/claims (P4)
   Recipient: school.financeEmail || school.email
   Purpose:   Finance team is notified a new claim
              is waiting for their verification.
============================================ */
async function sendPaymentClaimReceived({
  toEmail,
  schoolName,
  payerName,
  payerType,
  amount,
  currency,
  reference,
  claimId
}) {
  if (!toEmail) { return { sent: false, reason: 'NO_RECIPIENT' }; }

  var amountStr  = fmtEmailAmount(amount, currency);
  var payerLabel = {
    parent:       'Parent / Guardian',
    student:      'Student',
    alumni:       'Alumni',
    staff:        'Staff',
    external:     'External Payer',
    organisation: 'Organisation'
  }[payerType] || (payerType || 'Payer');

  var financeUrl = APP_URL + '/institution/school/finance.html';

  var content = `
    <h2>New Payment Claim — Action Required 📨</h2>
    <p>A new payment claim has been submitted at <strong>${schoolName}</strong> and is awaiting Finance verification.</p>

    <div class="info-box">
      <strong>Payer:</strong> ${payerName || '—'}<br/>
      <strong>Payer Type:</strong> ${payerLabel}<br/>
      <strong>Amount Claimed:</strong> <strong style="color:#6c63ff;">${amountStr}</strong><br/>
      ${reference ? '<strong>Reference:</strong> ' + reference + '<br/>' : ''}
      <strong>Status:</strong> Awaiting Verification
    </div>

    <p>Please log in to Finance and verify whether this transfer appears in the school's bank records before confirming or rejecting the claim.</p>
    <a href="${financeUrl}" class="btn">Review in Finance →</a>

    <hr class="divider" />
    <p style="font-size:13px;color:#999;">
      Do not confirm a payment claim unless you have independently verified
      it in the school's actual bank records. A confirmed claim creates an
      authoritative financial transaction.
    </p>
  `;

  return sendEmail(
    toEmail,
    'New payment claim awaiting verification — ' + schoolName,
    baseTemplate(
      content,
      'Finance notification from ' + schoolName + ' via LatLomp Schools.'
    )
  );
}

/* ============================================
   8. CLAIM VERIFIED (to payer)
   Triggered: POST /finance/claims/:id/verify (P5)
   Recipient: claim.payerEmail
   Purpose:   Payer is told their transfer was confirmed
              by Finance and an official receipt is available.
============================================ */
async function sendClaimVerified({
  toEmail,
  payerName,
  payerType,
  amount,
  currency,
  reference,
  receiptNumber,
  schoolName
}) {
  if (!toEmail) { return { sent: false, reason: 'NO_RECIPIENT' }; }

  var amountStr = fmtEmailAmount(amount, currency);

  /* Resolve portal link by payer type */
  var portalLinks = {
    parent:   APP_URL + '/institution/parent/dashboard.html',
    student:  APP_URL + '/institution/student/portal.html',
    alumni:   APP_URL + '/institution/alumni/portal.html'
  };
  var portalUrl   = portalLinks[payerType] || portalLinks.parent;
  var portalLabel = payerType === 'student' ? 'Student Portal'
                  : payerType === 'alumni'  ? 'Alumni Portal'
                  :                            'Parent Portal';

  var content = `
    <h2>Payment Confirmed ✅</h2>
    <p>Hi ${payerName || 'there'},</p>
    <p>Your bank transfer to <strong>${schoolName}</strong> has been verified by the Finance team. Your payment is now confirmed.</p>

    <div class="info-box success">
      <strong>School:</strong> ${schoolName}<br/>
      <strong>Amount Verified:</strong> <strong style="color:#43e97b;">${amountStr}</strong><br/>
      ${reference     ? '<strong>Bank Reference:</strong> ' + reference     + '<br/>' : ''}
      ${receiptNumber ? '<strong>Receipt Number:</strong> <span style="font-family:monospace;font-weight:700;">' + receiptNumber + '</span><br/>' : ''}
      <strong>Status:</strong> ✅ Verified & Confirmed
    </div>

    <p>Your fee balance has been updated. You can view your progress and download your official receipt from the portal.</p>
    <a href="${portalUrl}" class="btn btn-green">View ${portalLabel} →</a>

    <hr class="divider" />
    <p style="font-size:13px;color:#999;">
      Please keep your receipt number for your records.
      If you believe this confirmation is incorrect, contact ${schoolName} directly.
    </p>
  `;

  return sendEmail(
    toEmail,
    'Payment confirmed — ' + (receiptNumber || amountStr) + ' | ' + schoolName,
    baseTemplate(
      content,
      'Payment confirmation from ' + schoolName + ' via LatLomp Schools.'
    )
  );
}

/* ============================================
   9. CLAIM REJECTED (to payer)
   Triggered: POST /finance/claims/:id/reject (P5)
   Recipient: claim.payerEmail
   Purpose:   Payer is told their claim was rejected
              and why, so they can investigate.
============================================ */
async function sendClaimRejected({
  toEmail,
  payerName,
  payerType,
  amount,
  currency,
  reference,
  rejectionReason,
  schoolName
}) {
  if (!toEmail) { return { sent: false, reason: 'NO_RECIPIENT' }; }

  var amountStr = fmtEmailAmount(amount, currency);

  var portalLinks = {
    parent:  APP_URL + '/institution/parent/dashboard.html',
    student: APP_URL + '/institution/student/portal.html',
    alumni:  APP_URL + '/institution/alumni/portal.html'
  };
  var portalUrl = portalLinks[payerType] || portalLinks.parent;

  var content = `
    <h2>Payment Claim Not Confirmed ❌</h2>
    <p>Hi ${payerName || 'there'},</p>
    <p>The Finance team at <strong>${schoolName}</strong> was unable to confirm your payment claim.</p>

    <div class="info-box danger">
      <strong>Claimed Amount:</strong> ${amountStr}<br/>
      ${reference ? '<strong>Reference:</strong> ' + reference + '<br/>' : ''}
      <strong>Status:</strong> ❌ Rejected<br/><br/>
      <strong>Reason from Finance:</strong><br/>
      ${rejectionReason || 'No reason provided. Please contact the school directly.'}
    </div>

    <p>
      If you believe your transfer was made correctly, please check your bank
      records and contact <strong>${schoolName}</strong> directly with your
      proof of payment.
    </p>
    <p>
      If you have not yet made the transfer, please disregard this notification.
    </p>
    <a href="${portalUrl}" class="btn">View Your Claims →</a>

    <hr class="divider" />
    <p style="font-size:13px;color:#999;">
      A rejected claim does not mean your money has been taken.
      It means the school Finance team could not match a transfer to your claim.
      Please verify directly with your bank and with ${schoolName}.
    </p>
  `;

  return sendEmail(
    toEmail,
    'Payment claim not confirmed — action required | ' + schoolName,
    baseTemplate(
      content,
      'Finance notification from ' + schoolName + ' via LatLomp Schools.'
    )
  );
}

/* ============================================
   10. CLAIM NEEDS CORRECTION (to payer)
   Triggered: POST /finance/claims/:id/request-correction (P5)
   Recipient: claim.payerEmail
   Purpose:   Finance found an issue with the claim
              details and needs the payer to correct
              and resubmit.
============================================ */
async function sendClaimNeedsCorrection({
  toEmail,
  payerName,
  payerType,
  amount,
  currency,
  correctionNote,
  schoolName
}) {
  if (!toEmail) { return { sent: false, reason: 'NO_RECIPIENT' }; }

  var amountStr = fmtEmailAmount(amount, currency);

  var portalLinks = {
    parent:  APP_URL + '/institution/parent/dashboard.html',
    student: APP_URL + '/institution/student/portal.html',
    alumni:  APP_URL + '/institution/alumni/portal.html'
  };
  var portalUrl   = portalLinks[payerType] || portalLinks.parent;
  var portalLabel = payerType === 'student' ? 'Student Portal'
                  : payerType === 'alumni'  ? 'Alumni Portal'
                  :                            'Parent Portal';

  var content = `
    <h2>Update Required on Your Payment Claim 🔧</h2>
    <p>Hi ${payerName || 'there'},</p>
    <p>The Finance team at <strong>${schoolName}</strong> has reviewed your payment claim and needs you to update some details before they can verify it.</p>

    <div class="info-box warning">
      <strong>Claimed Amount:</strong> ${amountStr}<br/>
      <strong>Status:</strong> 🔧 Needs Correction<br/><br/>
      <strong>What Finance needs you to fix:</strong><br/>
      ${correctionNote || 'Please contact the school Finance team for details.'}
    </div>

    <p>
      Please log in to the portal, find this claim in your
      <strong>My Claims</strong> section, update the details
      as requested, and resubmit.
    </p>
    <a href="${portalUrl}" class="btn">Update Your Claim →</a>

    <hr class="divider" />
    <p style="font-size:13px;color:#999;">
      Updating your claim does not create a new payment.
      Once you have corrected the information, Finance will review it again.
      Contact ${schoolName} directly if you need help.
    </p>
  `;

  return sendEmail(
    toEmail,
    'Action required: update your payment claim | ' + schoolName,
    baseTemplate(
      content,
      'Finance notification from ' + schoolName + ' via LatLomp Schools.'
    )
  );
}
module.exports = {
  sendTeacherInvite,
  sendSchoolWelcome,
  sendSubscriptionConfirmed,
  sendExpiryWarning,
  sendSubscriptionExpired,
  sendResultsReleased,
  sendFeePaymentConfirmed,     /* existing — NGN fallback fixed */
  sendPaymentClaimReceived,    /* P10-A: Finance notified of new claim */
  sendClaimVerified,           /* P10-A: Payer notified of verification */
  sendClaimRejected,           /* P10-A: Payer notified of rejection */
  sendClaimNeedsCorrection     /* P10-A: Payer notified of required correction */
};