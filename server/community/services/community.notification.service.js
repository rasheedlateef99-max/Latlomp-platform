'use strict';
/* ============================================
   LATLOMP COMMUNITY — NOTIFICATION SERVICE (E9H)

   Self-contained email notification layer.
   Does NOT depend on inst.email.service.js internals.

   Provider detection (from env vars):
     SENDGRID_API_KEY → @sendgrid/mail
     RESEND_API_KEY   → resend
     SMTP_HOST        → nodemailer
     else             → console.log (dev mode)

   All exported functions are fire-and-forget:
     call them without await; errors are logged,
     never propagated to user-facing routes.

   Member email lookup:
     Reads from the authoritative identity model
     based on membership.memberType + memberRef.
     Only email — no other private data.

   schoolId: ALWAYS from authenticated token context
   (passed through from route handler, never from body).

   EMAIL_FROM is required in production.
   Set COMMUNITY_EMAIL_FROM or EMAIL_FROM env var.
============================================ */
'use strict';

var mongoose = require('mongoose');

/* ---- Env config ---- */
var EMAIL_FROM       = process.env.COMMUNITY_EMAIL_FROM || process.env.EMAIL_FROM || 'community@latlomp.com';
var SENDGRID_API_KEY = process.env.SENDGRID_API_KEY     || '';
var RESEND_API_KEY   = process.env.RESEND_API_KEY       || '';
var SMTP_HOST        = process.env.SMTP_HOST            || '';
var APP_URL          = process.env.APP_URL              || 'https://latlomp.com';

/* ============================================
   PROVIDER: sendEmail(to, subject, html)
   Internal — wraps whichever provider is configured.
============================================ */
async function sendEmail(to, subject, html) {
  if (!to || !to.includes('@')) {
    /* No valid email address — skip silently */
    return;
  }

  if (SENDGRID_API_KEY) {
    /* ---- SendGrid ---- */
    try {
      var sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(SENDGRID_API_KEY);
      await sgMail.send({ to, from: EMAIL_FROM, subject, html });
    } catch(e) {
      console.warn('[community-notify] SendGrid error:', e.message);
    }
    return;
  }

  if (RESEND_API_KEY) {
    /* ---- Resend ---- */
    try {
      var { Resend } = require('resend');
      var resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
    } catch(e) {
      console.warn('[community-notify] Resend error:', e.message);
    }
    return;
  }

  if (SMTP_HOST) {
    /* ---- Nodemailer (SMTP) ---- */
    try {
      var nodemailer = require('nodemailer');
      var transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || ''
        } : undefined
      });
      await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
    } catch(e) {
      console.warn('[community-notify] Nodemailer error:', e.message);
    }
    return;
  }

  /* ---- Dev fallback: log to console ---- */
  if (process.env.NODE_ENV !== 'production') {
    console.log('[community-notify] DEV EMAIL ─────────────────────');
    console.log('  To:      ', to);
    console.log('  Subject: ', subject);
    console.log('  (Set SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST for real delivery)');
    console.log('────────────────────────────────────────────────────');
  }
}

/* ============================================
   getMemberEmail(memberType, memberRef)
   Looks up the email for a community member.
   Returns '' if not found or not accessible.
   Never throws — caller uses fire-and-forget.
============================================ */
async function getMemberEmail(memberType, memberRef) {
  if (!memberRef || !mongoose.isValidObjectId(memberRef)) return '';
  try {
    var email = '';
    switch(memberType) {
      case 'admin':
      case 'staff': {
        var SchoolUser = require('../../institution/models/SchoolUser.model');
        var u = await SchoolUser.findById(memberRef).select('email').lean();
        email = (u && u.email) || '';
        break;
      }
      case 'student': {
        var SchoolStudent = require('../../institution/models/SchoolStudent.model');
        var s = await SchoolStudent.findById(memberRef).select('email contactEmail').lean();
        email = (s && (s.email || s.contactEmail)) || '';
        break;
      }
      case 'parent': {
        var SchoolParent = require('../../institution/models/SchoolParent.model');
        var p = await SchoolParent.findById(memberRef).select('email').lean();
        email = (p && p.email) || '';
        break;
      }
      case 'alumni': {
        var AlumniProfile = require('../../institution/models/AlumniProfile.model');
        var a = await AlumniProfile.findById(memberRef).select('email').lean();
        email = (a && a.email) || '';
        break;
      }
    }
    return email || '';
  } catch(e) {
    console.warn('[community-notify] getMemberEmail error:', e.message);
    return '';
  }
}

/* ============================================
   SHARED: checkNotificationsEnabled(schoolId)
   Returns true if notifications are on for this school.
============================================ */
async function checkNotificationsEnabled(schoolId) {
  try {
    var CommunitySettings = require('../models/CommunitySettings.model');
    var settings = await CommunitySettings.findOne({ schoolId }).select('notificationsEnabled').lean();
    /* Default to true if no setting record yet */
    if (!settings) return true;
    return settings.notificationsEnabled !== false;
  } catch(e) {
    return true; /* fail open — don't block notifications on settings error */
  }
}

/* ============================================
   HTML EMAIL TEMPLATE
   Minimal, mobile-friendly, dark-on-light.
============================================ */
function emailTemplate(opts) {
  var title       = opts.title       || 'LatLomp Community';
  var preheader   = opts.preheader   || '';
  var heading     = opts.heading     || title;
  var body        = opts.body        || '';
  var ctaUrl      = opts.ctaUrl      || (APP_URL + '/community/');
  var ctaText     = opts.ctaText     || 'View in Community';
  var communityName = opts.communityName || 'School Community';

  return [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
    '<title>' + title + '</title>',
    '</head>',
    '<body style="margin:0;padding:0;background:#f4f4f8;font-family:Inter,Arial,sans-serif;">',
    preheader ? '<div style="display:none;max-height:0;overflow:hidden;color:#f4f4f8;">' + preheader + '</div>' : '',
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 16px;">',
    '<tr><td align="center">',
    '<table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">',
    /* Header */
    '<tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">',
    '<div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">' + escHtml(communityName) + '</div>',
    '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px;">LatLomp Community</div>',
    '</td></tr>',
    /* Body */
    '<tr><td style="padding:32px;">',
    '<h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1a2e;">' + escHtml(heading) + '</h2>',
    '<div style="font-size:14px;color:#4a4a5a;line-height:1.7;">' + body + '</div>',
    /* CTA */
    ctaUrl ? [
      '<table cellpadding="0" cellspacing="0" style="margin-top:24px;">',
      '<tr><td style="background:#1a1a2e;border-radius:8px;padding:0;">',
      '<a href="' + ctaUrl + '" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">' + escHtml(ctaText) + '</a>',
      '</td></tr></table>'
    ].join('') : '',
    '</td></tr>',
    /* Footer */
    '<tr><td style="background:#f8f8fc;padding:16px 32px;text-align:center;border-top:1px solid #ebebef;">',
    '<p style="margin:0;font-size:11px;color:#999;line-height:1.6;">',
    'You are receiving this because you are a member of your school\'s community on LatLomp.<br>',
    'Visit your <a href="' + APP_URL + '/community/" style="color:#6b6bff;text-decoration:none;">community page</a> to manage your notification preferences.',
    '</p>',
    '</td></tr>',
    '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

/* ---- Escape HTML for template ---- */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================
   NOTIFICATION 1: notifyNewComment
   Fires when a new top-level comment is added to a post.
   Notifies the post author (not the commenter themselves).

   @param {Object} opts.post      — CommunityPost document (lean)
   @param {Object} opts.comment   — CommunityComment document (lean)
   @param {Object} opts.settings  — CommunitySettings (lean) — for community name
============================================ */
async function notifyNewComment(opts) {
  try {
    var post    = opts.post;
    var comment = opts.comment;
    if (!post || !comment) return;

    /* Don't notify if commenter IS the post author */
    if (post.authorId && comment.authorId &&
        post.authorId.toString() === comment.authorId.toString()) return;

    /* Check notifications enabled */
    if (!(await checkNotificationsEnabled(post.schoolId))) return;

    /* Get post author's email */
    var authorMembership = await require('../models/CommunityMembership.model').findById(post.authorId)
      .select('memberType memberRef memberName').lean();
    if (!authorMembership) return;

    var email = await getMemberEmail(authorMembership.memberType, authorMembership.memberRef);
    if (!email) return;

    var communityName = (opts.settings && opts.settings.communityName) || 'School Community';
    var preview       = (comment.content || '').substring(0, 80) + ((comment.content || '').length > 80 ? '…' : '');
    var postPreview   = (post.content   || '').substring(0, 60) + ((post.content   || '').length > 60 ? '…' : '');

    var subject = (comment.authorName || 'Someone') + ' commented on your post';
    var html = emailTemplate({
      communityName,
      title:     subject,
      preheader: comment.authorName + ' left a comment on your community post.',
      heading:   'New comment on your post',
      body: [
        '<p>Hi ' + escHtml(authorMembership.memberName || 'there') + ',</p>',
        '<p><strong>' + escHtml(comment.authorName || 'A community member') + '</strong> commented on your post:</p>',
        '<div style="background:#f4f4f8;border-left:3px solid #6b6bff;border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;font-style:italic;color:#4a4a5a;">',
        '"' + escHtml(postPreview) + '"',
        '</div>',
        '<p>Their comment:</p>',
        '<div style="background:#f0f0ff;border-radius:8px;padding:12px 16px;margin:8px 0;color:#1a1a2e;">',
        escHtml(preview),
        '</div>'
      ].join(''),
      ctaUrl:  APP_URL + '/community/',
      ctaText: 'View Comment'
    });

    await sendEmail(email, subject, html);
  } catch(e) {
    console.warn('[community-notify] notifyNewComment error:', e.message);
  }
}

/* ============================================
   NOTIFICATION 2: notifyReplyToComment
   Fires when a reply is added to a comment.
   Notifies the original commenter (not the replier).

   @param {Object} opts.parentComment — CommunityComment (lean)
   @param {Object} opts.reply         — CommunityComment (lean, the reply)
   @param {Object} opts.settings      — CommunitySettings (lean)
============================================ */
async function notifyReplyToComment(opts) {
  try {
    var parentComment = opts.parentComment;
    var reply         = opts.reply;
    if (!parentComment || !reply) return;

    /* Don't notify if replier IS the original commenter */
    if (parentComment.authorId && reply.authorId &&
        parentComment.authorId.toString() === reply.authorId.toString()) return;

    if (!(await checkNotificationsEnabled(reply.schoolId))) return;

    /* Get parent comment author's membership */
    var parentMembership = await require('../models/CommunityMembership.model').findById(parentComment.authorId)
      .select('memberType memberRef memberName').lean();
    if (!parentMembership) return;

    var email = await getMemberEmail(parentMembership.memberType, parentMembership.memberRef);
    if (!email) return;

    var communityName = (opts.settings && opts.settings.communityName) || 'School Community';
    var preview = (reply.content || '').substring(0, 80) + ((reply.content || '').length > 80 ? '…' : '');

    var subject = (reply.authorName || 'Someone') + ' replied to your comment';
    var html = emailTemplate({
      communityName,
      title:     subject,
      preheader: reply.authorName + ' replied to your community comment.',
      heading:   'New reply to your comment',
      body: [
        '<p>Hi ' + escHtml(parentMembership.memberName || 'there') + ',</p>',
        '<p><strong>' + escHtml(reply.authorName || 'A community member') + '</strong> replied to your comment:</p>',
        '<div style="background:#f0f0ff;border-radius:8px;padding:12px 16px;margin:8px 0;color:#1a1a2e;">',
        escHtml(preview),
        '</div>'
      ].join(''),
      ctaUrl:  APP_URL + '/community/',
      ctaText: 'View Reply'
    });

    await sendEmail(email, subject, html);
  } catch(e) {
    console.warn('[community-notify] notifyReplyToComment error:', e.message);
  }
}

/* ============================================
   NOTIFICATION 3: notifyPostApproved
   Fires when a moderator approves a pending post.
   Notifies the post author.
============================================ */
async function notifyPostApproved(opts) {
  try {
    var post = opts.post;
    if (!post) return;
    if (!(await checkNotificationsEnabled(post.schoolId))) return;

    var authorMembership = await require('../models/CommunityMembership.model').findById(post.authorId)
      .select('memberType memberRef memberName').lean();
    if (!authorMembership) return;

    var email = await getMemberEmail(authorMembership.memberType, authorMembership.memberRef);
    if (!email) return;

    var communityName = (opts.settings && opts.settings.communityName) || 'School Community';
    var preview = (post.content || '').substring(0, 80) + ((post.content || '').length > 80 ? '…' : '');

    var html = emailTemplate({
      communityName,
      title:     'Your post has been approved',
      preheader: 'Your community post is now live.',
      heading:   '✅ Post Approved',
      body: [
        '<p>Hi ' + escHtml(authorMembership.memberName || 'there') + ',</p>',
        '<p>Great news! Your post in the community has been reviewed and is now live for all members to see.</p>',
        '<div style="background:#f0fff0;border-left:3px solid #22c55e;border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;font-style:italic;color:#4a4a5a;">',
        '"' + escHtml(preview) + '"',
        '</div>'
      ].join(''),
      ctaUrl:  APP_URL + '/community/',
      ctaText: 'View Your Post'
    });

    await sendEmail(email, 'Your community post has been approved', html);
  } catch(e) {
    console.warn('[community-notify] notifyPostApproved error:', e.message);
  }
}

/* ============================================
   NOTIFICATION 4: notifyPostRejected
   Fires when a moderator rejects a pending post.
   Notifies the post author with the reason (if provided).
============================================ */
async function notifyPostRejected(opts) {
  try {
    var post   = opts.post;
    var reason = opts.reason || '';
    if (!post) return;
    if (!(await checkNotificationsEnabled(post.schoolId))) return;

    var authorMembership = await require('../models/CommunityMembership.model').findById(post.authorId)
      .select('memberType memberRef memberName').lean();
    if (!authorMembership) return;

    var email = await getMemberEmail(authorMembership.memberType, authorMembership.memberRef);
    if (!email) return;

    var communityName = (opts.settings && opts.settings.communityName) || 'School Community';
    var preview = (post.content || '').substring(0, 80) + ((post.content || '').length > 80 ? '…' : '');

    var html = emailTemplate({
      communityName,
      title:     'Your post was not approved',
      preheader: 'A moderator reviewed your community post.',
      heading:   'Post Not Approved',
      body: [
        '<p>Hi ' + escHtml(authorMembership.memberName || 'there') + ',</p>',
        '<p>A community moderator has reviewed your post and was unable to approve it at this time.</p>',
        '<div style="background:#f4f4f8;border-left:3px solid #ef4444;border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;font-style:italic;color:#4a4a5a;">',
        '"' + escHtml(preview) + '"',
        '</div>',
        reason ? '<p><strong>Reason:</strong> ' + escHtml(reason) + '</p>' : '',
        '<p>If you believe this is an error, please contact your community moderator.</p>'
      ].join(''),
      ctaUrl:  APP_URL + '/community/',
      ctaText: 'Visit Community'
    });

    await sendEmail(email, 'Your community post was not approved', html);
  } catch(e) {
    console.warn('[community-notify] notifyPostRejected error:', e.message);
  }
}

/* ============================================
   NOTIFICATION 5: notifyContentRemoved
   Fires when a report is actioned and content is removed.
   Notifies the content's original author.
============================================ */
async function notifyContentRemoved(opts) {
  try {
    var targetAuthorId   = opts.targetAuthorId;
    var targetType       = opts.targetType || 'post';
    var reason           = opts.reason     || '';
    var schoolId         = opts.schoolId;
    if (!targetAuthorId || !schoolId) return;
    if (!(await checkNotificationsEnabled(schoolId))) return;

    var authorMembership = await require('../models/CommunityMembership.model').findById(targetAuthorId)
      .select('memberType memberRef memberName').lean();
    if (!authorMembership) return;

    var email = await getMemberEmail(authorMembership.memberType, authorMembership.memberRef);
    if (!email) return;

    var communityName = (opts.settings && opts.settings.communityName) || 'School Community';
    var contentLabel  = targetType === 'comment' ? 'comment' : 'post';

    var html = emailTemplate({
      communityName,
      title:     'Community ' + contentLabel + ' removed',
      preheader: 'A moderator has reviewed and removed your ' + contentLabel + '.',
      heading:   'Content Removed',
      body: [
        '<p>Hi ' + escHtml(authorMembership.memberName || 'there') + ',</p>',
        '<p>A community moderator has reviewed a report on your ' + contentLabel + ' and removed it from the community.',
        reason ? ' <strong>Reason:</strong> ' + escHtml(reason) : '',
        '</p>',
        '<p>If you have questions, please contact your school\'s community moderator.</p>'
      ].join(''),
      ctaUrl:  APP_URL + '/community/',
      ctaText: 'Visit Community'
    });

    await sendEmail(email, 'Your community ' + contentLabel + ' has been removed', html);
  } catch(e) {
    console.warn('[community-notify] notifyContentRemoved error:', e.message);
  }
}

module.exports = {
  notifyNewComment,
  notifyReplyToComment,
  notifyPostApproved,
  notifyPostRejected,
  notifyContentRemoved
};