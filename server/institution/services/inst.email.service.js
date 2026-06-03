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

module.exports = {
  sendTeacherInvite,
  sendSchoolWelcome,
  sendSubscriptionConfirmed,
  sendExpiryWarning,
  sendSubscriptionExpired,
  sendResultsReleased
};