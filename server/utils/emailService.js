/* ============================================

LATLOMP PLATFORM — EMAIL SERVICE

Uses SendGrid API

============================================ */

const sgMail = require('@sendgrid/mail');

function getCleanAppUrl() {

const raw   = process.env.APP_URL || 'http://localhost:5000';

let   clean = raw.split(' ')[0].trim().replace(/\/$/, '');

if (!clean.startsWith('http')) return 'http://localhost:5000';

return clean;

}

const appUrl = getCleanAppUrl();

/* Warn if APP_URL is wrong */

if (process.env.NODE_ENV === 'production' &&

(appUrl.includes('localhost') || appUrl.includes('127.0.0.1'))) {

console.error('❌ CRITICAL: APP_URL is localhost in production!');

console.error('   Verification links will NOT work for users.');

console.error('   Fix: Set APP_URL=https://your-railway-url in Railway variables');

}

async function sendVerificationEmail(

toEmail,

toName,

token,

role    = 'student',

otpCode = null

) {

try {

const appUrl     = getCleanAppUrl();

const verifyLink = `${appUrl}/verify-email.html?token=${token}`;

const fromName   = process.env.EMAIL_FROM_NAME  || 'LatLomp Platform';

const fromEmail  = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM;

const expiryMs   = parseInt(process.env.VERIFY_TOKEN_EXPIRES) || 300000;

const expireMins = Math.round(expiryMs / 60000);

const otpSecs    = parseInt(process.env.OTP_EXPIRY) || 120;

const roleLabel  = role === 'teacher' ? 'Teacher' : 'Student';

const roleColor  = role === 'teacher' ? '#43e97b' : '#6c63ff';



/* ---- DEVELOPMENT MODE ---- */

if (process.env.EMAIL_ENABLED !== 'true') {

  console.log('\n');

  console.log('='.repeat(60));

  console.log('  📧 EMAIL VERIFICATION (Development Mode)');

  console.log('='.repeat(60));

  console.log(`  To:       ${toEmail}`);

  console.log(`  Name:     ${toName}`);

  console.log(`  Role:     ${role}`);

  console.log(`  Link:     ${verifyLink}`);

  console.log(`  Expires:  ${expireMins} minutes`);

  if (otpCode) {

    console.log(`  OTP Code: ${otpCode}`);

    console.log(`  OTP Exp:  ${otpSecs} seconds`);

  }

  console.log('='.repeat(60));

  console.log('\n');

  return { success: true, mode: 'development', link: verifyLink };

}



/* ---- PRODUCTION MODE ---- */

if (!process.env.SENDGRID_API_KEY) {

  console.error('❌ SENDGRID_API_KEY missing');

  return { success: false, error: 'SendGrid API key missing' };

}



if (!fromEmail) {

  console.error('❌ SENDGRID_FROM_EMAIL missing');

  return { success: false, error: 'From email missing' };

}



sgMail.setApiKey(process.env.SENDGRID_API_KEY);



console.log(`📧 Sending from: ${fromEmail}`);

console.log(`📧 Sending to:   ${toEmail}`);



await sgMail.send({

  to:      toEmail,

  from: {

    email: fromEmail,

    name:  fromName

  },

  replyTo: fromEmail,

  subject: `✅ Verify Your Email — ${fromName}`,

  html: `

<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#0f0f1a;font-family:Arial,sans-serif;">  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;"><tr>

  <td align="center">

    <table width="100%" cellpadding="0" cellspacing="0"

      style="max-width:520px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">

      <tr>

        <td style="background:linear-gradient(135deg,${roleColor},#f5576c);padding:32px;text-align:center;">

          <div style="font-size:40px;margin-bottom:8px;">⚡</div>

          <h1 style="margin:0;font-size:22px;font-weight:800;color:white;">${fromName}</h1>

          <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">

            ${roleLabel} Account Verification

          </p>

        </td>

      </tr>

      <tr>

        <td style="padding:32px;">

          <p style="font-size:17px;font-weight:700;color:#fff;margin:0 0 12px;">

            Hello ${toName}! 👋

          </p>

          <p style="font-size:14px;color:#a0a0c0;line-height:1.7;margin:0 0 24px;">

            Please verify your email to activate your

            <strong style="color:${roleColor};">${roleLabel}</strong> account.

          </p>

          <div style="text-align:center;margin:0 0 24px;">

            <a href="${verifyLink}"

              style="display:inline-block;background:linear-gradient(135deg,${roleColor},#38f9d7);color:#0f0f1a;font-size:15px;font-weight:800;padding:14px 36px;border-radius:10px;text-decoration:none;">

              ✅ Verify My Email

            </a>

          </div>

          ${otpCode ? `

          <div style="background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.2);border-radius:10px;padding:20px;margin:0 0 20px;text-align:center;">

            <p style="font-size:13px;color:#a0a0c0;margin:0 0 8px;font-weight:600;">

              Or enter this code on the verification page:

            </p>

            <div style="font-size:38px;font-weight:900;letter-spacing:10px;color:${roleColor};font-family:monospace;margin:6px 0;">

              ${otpCode}

            </div>

            <p style="font-size:12px;color:#6b6b8a;margin:0;">

              Expires in ${otpSecs} seconds

            </p>

          </div>` : ''}

          <div style="background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.2);border-radius:8px;padding:12px 16px;margin:0 0 20px;">

            <p style="margin:0;font-size:13px;color:#ffa500;font-weight:600;">

              ⏰ Link expires in ${expireMins} minutes

            </p>

          </div>

          <p style="font-size:12px;color:#6b6b8a;margin:0 0 6px;">

            If button does not work, copy this link:

          </p>

          <p style="font-size:11px;color:#6c63ff;word-break:break-all;background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.15);border-radius:6px;padding:10px;margin:0;">

            ${verifyLink}

          </p>

        </td>

      </tr>

      <tr>

        <td style="background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06);padding:16px;text-align:center;">

          <p style="margin:0;font-size:12px;color:#6b6b8a;">

            © 2025 ${fromName} · Built for Nigeria 🇳🇬

          </p>

        </td>

      </tr>

    </table>

  </td>

</tr>

  </table></body></html>`});



console.log(`✅ Verification email sent to ${toEmail} via SendGrid`);

return { success: true, mode: 'production' };

} catch (err) {

console.error('❌ SendGrid email failed:', err.message);

if (err.response && err.response.body && err.response.body.errors) {

  err.response.body.errors.forEach(e => {

    console.error('   SendGrid error:', e.message);

  });

}

return { success: false, error: err.message };

}

}

async function sendPasswordResetEmail(toEmail, toName, token) {

try {

const appUrl    = getCleanAppUrl();

const resetLink = `${appUrl}/reset-password.html?token=${token}`;

const fromName  = process.env.EMAIL_FROM_NAME     || 'LatLomp Platform';

const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM;



if (process.env.EMAIL_ENABLED !== 'true') {

  console.log('\n');

  console.log('='.repeat(60));

  console.log('  🔑 PASSWORD RESET (Development Mode)');

  console.log('='.repeat(60));

  console.log(`  To:   ${toEmail}`);

  console.log(`  Link: ${resetLink}`);

  console.log('='.repeat(60));

  console.log('\n');

  return { success: true, mode: 'development', link: resetLink };

}



if (!process.env.SENDGRID_API_KEY) {

  return { success: false, error: 'SendGrid API key missing' };

}



sgMail.setApiKey(process.env.SENDGRID_API_KEY);



await sgMail.send({

  to:   toEmail,

  from: { email: fromEmail, name: fromName },

  subject: `🔑 Password Reset — ${fromName}`,

  html: `

  from: {

email: 'onboarding@resend.dev',  // NO — wrong service

}

<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#0f0f1a;padding:40px 20px;">  <div style="max-width:500px;margin:0 auto;background:#1a1a2e;border-radius:16px;padding:40px;border:1px solid rgba(255,255,255,0.08);"><h2 style="color:#6c63ff;margin:0 0 16px;">🔑 Password Reset</h2>

<p style="color:#fff;">Hello ${toName},</p>

<p style="color:#a0a0c0;line-height:1.7;">Click below to reset your password:</p>

<div style="text-align:center;margin:28px 0;">

  <a href="${resetLink}"

    style="background:linear-gradient(135deg,#6c63ff,#574fd6);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">

    Reset My Password

  </a>

</div>

<p style="color:#888;font-size:13px;">Expires in 15 minutes.</p>

<p style="color:#888;font-size:12px;word-break:break-all;">

  Or paste: <a href="${resetLink}" style="color:#6c63ff;">${resetLink}</a>

</p>

  </div></body></html>`});



console.log(`✅ Reset email sent to ${toEmail} via SendGrid`);

return { success: true };

} catch (err) {

console.error('❌ SendGrid reset email failed:', err.message);

if (err.response && err.response.body && err.response.body.errors) {

  err.response.body.errors.forEach(e => {

    console.error('   SendGrid error:', e.message);

  });

}

return { success: false, error: err.message };

}

}

module.exports = {

sendVerificationEmail,

sendPasswordResetEmail
};