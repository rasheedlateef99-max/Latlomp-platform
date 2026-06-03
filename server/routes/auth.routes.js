/* ============================================
   LATLOMP PLATFORM — AUTH ROUTES
   
   Email Auth:
     POST /api/auth/register
     POST /api/auth/login
     POST /api/auth/verify-otp
     POST /api/auth/resend-verification
     POST /api/auth/forgot-password
     POST /api/auth/reset-password
     GET  /api/auth/me
   
   Teacher Auth:
     POST /api/auth/register-teacher
   
   Phone Auth:
     POST /api/auth/phone-send-otp
     POST /api/auth/phone-verify-otp
     POST /api/auth/phone-login
     POST /api/auth/phone-forgot-password
     POST /api/auth/phone-reset-password
   
   Google Auth:
     POST /api/auth/google
   
   ⚠️  SMS SECURITY FIX:
     When Twilio is configured (keys present):
       - SMS fails → return 500 error. NEVER fall
         through to dev mode. NEVER expose OTP.
     When Twilio is NOT configured (no keys):
       - Dev mode only. OTP logged to console.
         devOtp returned in response ONLY when
         NODE_ENV is not 'production'.
============================================ */

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const User = require("../models/User.model");
const { protect } = require("../middleware/auth.middleware");
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require("../utils/emailService");

/* ============================================
   HELPERS
   ============================================ */

/* Sign a JWT for a user */
function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

/* Generate a random N-digit OTP */
function generateOtp(digits) {
  digits = digits || 6;
  var min = Math.pow(10, digits - 1);
  var max = Math.pow(10, digits) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

/* OTP expiry in milliseconds */
function otpExpiryMs() {
  /* OTP_EXPIRY env is in SECONDS, convert to ms */
  var seconds = parseInt(process.env.OTP_EXPIRY || "120", 10);
  return seconds * 1000;
}

/* ⚠️  KEY HELPER: Is Twilio fully configured? */
function twilioIsConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

/* Get Twilio client — only called when twilioIsConfigured() === true */
function getTwilioClient() {
  var twilio = require("twilio");
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/* ============================================
   ⚠️  SECURE SMS SENDER
   
   THE FIX IS HERE.
   
   Before this fix, the code pattern was:
   
     try {
       await twilio.messages.create(...)
     } catch (smsError) {
       console.error(smsError)
       // FALLS THROUGH — exposes devOtp
     }
     return res.json({ devOtp: otp })   // SECURITY BUG
   
   With this fix:
   
   Case 1: Twilio configured + SMS succeeds  → return null (no error)
   Case 2: Twilio configured + SMS fails     → return Error (caller returns 500)
   Case 3: Twilio not configured             → return null + log otp for dev
   
   The caller ALWAYS checks the return value.
   devOtp is NEVER sent to the client when Twilio keys exist.
   ============================================ */
async function sendSmsOtp(phone, otp, purpose) {
  purpose = purpose || "verification";

  var messages = {
    verification:
      "Your LatLomp verification code is: " +
      otp +
      ". Valid for " +
      Math.ceil(parseInt(process.env.OTP_EXPIRY || "120") / 60) +
      " minutes. Do not share this code.",
    reset:
      "Your LatLomp password reset code is: " +
      otp +
      ". Valid for " +
      Math.ceil(parseInt(process.env.OTP_EXPIRY || "120") / 60) +
      " minutes. Do not share this code.",
  };

  var body = messages[purpose] || messages.verification;

  if (twilioIsConfigured()) {
    /* ---- PRODUCTION PATH: Twilio is set up ---- */
    try {
      var client = getTwilioClient();
      await client.messages.create({
        body: body,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });

      console.log("✅ SMS OTP sent to " + phone);
      return null; /* null = success, no error */
    } catch (smsError) {
      /*
         Twilio threw an error.
         Common causes:
         - Trial account: unverified number
         - Invalid phone number format
         - Twilio account issue
         
         ⚠️  CRITICAL: We return an Error object.
         The caller MUST return a 500 to the client.
         We NEVER fall through to dev mode here.
         We NEVER expose the OTP in the response.
      */
      console.error(
        "❌ Twilio SMS failed for " + phone + ":",
        smsError.message,
      );
      console.error("   Twilio code:", smsError.code || "N/A");

      return new Error(
        smsError.code === 21608
          ? "This number is not verified in our SMS system. Please contact support."
          : "Failed to send SMS verification code. Please try again or contact support.",
      );
    }
  } else {
    /* ---- DEV/LOCAL PATH: No Twilio keys configured ---- */
    console.log("");
    console.log("📱 ===== DEV MODE SMS OTP =====");
    console.log("   Phone:   " + phone);
    console.log("   OTP:     " + otp);
    console.log("   Purpose: " + purpose);
    console.log("==============================");
    console.log("");
    return null; /* null = success (dev mode, no real SMS) */
  }
}

/* ============================================
   POST /api/auth/phone-send-otp
   
   Called when a NEW user wants to register
   with their phone number.
   
   1. Check phone not already registered
   2. Generate OTP
   3. Store OTP hash in DB (or temp user)
   4. Send SMS
   5. Return success (NEVER return OTP when Twilio active)
   ============================================ */
router.post("/phone-send-otp", async function (req, res) {
  try {
    var phone = (req.body.phone || "").trim();
    var name = (req.body.name || "").trim();

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Your name is required.",
      });
    }

    /* Check if phone already registered and verified */
    var existingUser = await User.findOne({ phone: phone });

    if (existingUser && existingUser.isVerified && existingUser.isActive) {
      return res.status(400).json({
        success: false,
        alreadyExists: true,
        message:
          "This phone number is already registered. Please login instead.",
      });
    }

    /* Generate OTP */
    var otp = generateOtp(6);
    var otpExpiry = new Date(Date.now() + otpExpiryMs());

    /* Upsert: create or update pending user with OTP */
    var userUpdate = {
      name: name,
      phone: phone,
      otpCode: otp,
      otpExpiry: otpExpiry,
      otpAttempts: 0,
      isVerified: false,
      role: req.body.role || "student",
    };

    /* Set a temporary password if not already set */
    if (req.body.password) {
      var salt = await bcrypt.genSalt(12);
      userUpdate.password = await bcrypt.hash(req.body.password, salt);
    }

    await User.findOneAndUpdate(
      { phone: phone },
      { $set: userUpdate },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    /* ⚠️  SEND SMS — using secure sender */
    var smsError = await sendSmsOtp(phone, otp, "verification");

    if (smsError) {
      /*
         Twilio is configured but failed.
         DO NOT expose OTP. Return error to user.
      */
      return res.status(500).json({
        success: false,
        message: smsError.message,
      });
    }

    /* ---- Success response ---- */
    var response = {
      success: true,
      message:
        "Verification code sent to " +
        phone +
        ". Enter it to complete registration.",
    };

    /*
       devOtp is ONLY included when:
       - Twilio is NOT configured (local dev without Twilio)
       - AND we are not in production
       
       When Twilio IS configured, devOtp is NEVER sent.
    */
    if (!twilioIsConfigured() && process.env.NODE_ENV !== "production") {
      response.devOtp = otp;
      response.devNote = true;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("phone-send-otp error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/phone-verify-otp
   
   User enters the 6-digit OTP they received.
   If correct: activate account, return JWT.
   ============================================ */
router.post("/phone-verify-otp", async function (req, res) {
  try {
    var phone = (req.body.phone || "").trim();
    var otp = (req.body.otp || "").trim();

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP code are required.",
      });
    }

    var user = await User.findOne({ phone: phone });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No registration found for this phone. Please start over.",
      });
    }

    /* Too many wrong attempts */
    if (user.otpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        tooManyAttempts: true,
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }

    /* OTP expired */
    if (!user.otpExpiry || new Date() > user.otpExpiry) {
      return res.status(400).json({
        success: false,
        expired: true,
        message: "Verification code has expired. Please request a new one.",
      });
    }

    /* Wrong OTP */
    if (user.otpCode !== otp) {
      await User.findByIdAndUpdate(user._id, {
        $inc: { otpAttempts: 1 },
      });

      var remaining = 4 - (user.otpAttempts || 0);

      return res.status(400).json({
        success: false,
        message:
          "Incorrect code. " +
          (remaining > 0
            ? remaining + " attempt(s) remaining."
            : "No attempts remaining."),
      });
    }

    /* ✅ OTP is correct — activate account */
    var updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          isVerified: true,
          isActive: true,
          otpCode: null,
          otpExpiry: null,
          otpAttempts: 0,
        },
      },
      { new: true },
    );

    var token = signToken(updatedUser._id);

    return res.status(200).json({
      success: true,
      message: "Phone verified! Welcome to LatLomp.",
      token: token,
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        phone: updatedUser.phone,
        role: updatedUser.role,
      },
    });
  } catch (err) {
    console.error("phone-verify-otp error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/phone-login
   
   For EXISTING verified phone users.
   Direct login with phone + password.
   NO OTP required here.
   
   ⚠️  MUST use .select('+password') —
       password field has select:false in schema.
   ============================================ */
router.post("/phone-login", async function (req, res) {
  try {
    var phone = (req.body.phone || "").trim();
    var password = req.body.password || "";

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone number and password are required.",
      });
    }

    /* ⚠️  .select('+password') is CRITICAL */
    var user = await User.findOne({ phone: phone }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Phone number not registered. Please sign up first.",
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        message:
          "This account is not yet verified. Please complete OTP verification.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated. Please contact support.",
      });
    }

    /* Check password */
    if (!user.password) {
      return res.status(401).json({
        success: false,
        message:
          "No password set for this account. Please use the forgot password option.",
      });
    }

    var passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password. Please try again.",
      });
    }

    var token = signToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token: token,
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("phone-login error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/phone-forgot-password
   
   User enters their phone to get a reset OTP.
   
   ⚠️  SAME SMS SECURITY FIX APPLIED HERE.
       Twilio configured + fails → 500 error.
       Never expose OTP in production.
   ============================================ */
router.post("/phone-forgot-password", async function (req, res) {
  try {
    var phone = (req.body.phone || "").trim();

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    var user = await User.findOne({ phone: phone });

    /*
       Security: don't reveal whether phone exists.
       Return same message either way.
    */
    if (!user || !user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "If this number is registered, a reset code has been sent.",
      });
    }

    /* Generate reset OTP */
    var otp = generateOtp(6);
    var otpExpiry = new Date(Date.now() + otpExpiryMs());

    await User.findByIdAndUpdate(user._id, {
      $set: {
        otpCode: otp,
        otpExpiry: otpExpiry,
        otpAttempts: 0,
        otpPurpose: "reset",
      },
    });

    /* ⚠️  SEND SMS — using secure sender */
    var smsError = await sendSmsOtp(phone, otp, "reset");

    if (smsError) {
      /*
         Twilio configured but failed.
         DO NOT expose OTP. Return error.
      */
      return res.status(500).json({
        success: false,
        message: smsError.message,
      });
    }

    /* ---- Success response ---- */
    var response = {
      success: true,
      message:
        "Password reset code sent to " +
        phone +
        ". Enter it to reset your password.",
    };

    /* devOtp ONLY when no Twilio AND not production */
    if (!twilioIsConfigured() && process.env.NODE_ENV !== "production") {
      response.devOtp = otp;
      response.devNote = true;
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("phone-forgot-password error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/phone-reset-password
   
   User enters their OTP + new password.
   ============================================ */
router.post("/phone-reset-password", async function (req, res) {
  try {
    var phone = (req.body.phone || "").trim();
    var otp = (req.body.otp || "").trim();
    var newPassword = req.body.newPassword || "";

    if (!phone || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Phone, OTP code, and new password are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    var user = await User.findOne({ phone: phone });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Phone number not found.",
      });
    }

    if (user.otpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        tooManyAttempts: true,
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }

    if (!user.otpExpiry || new Date() > user.otpExpiry) {
      return res.status(400).json({
        success: false,
        expired: true,
        message: "Reset code has expired. Please request a new one.",
      });
    }

    if (user.otpCode !== otp) {
      await User.findByIdAndUpdate(user._id, { $inc: { otpAttempts: 1 } });
      return res.status(400).json({
        success: false,
        message: "Incorrect code. Please check and try again.",
      });
    }

    /* ✅ OTP correct — set new password */
    var salt = await bcrypt.genSalt(12);
    var hashedPw = await bcrypt.hash(newPassword, salt);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        password: hashedPw,
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
        otpPurpose: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. You can now login.",
    });
  } catch (err) {
    console.error("phone-reset-password error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/register
   Email + password registration
   ============================================ */
router.post("/register", async function (req, res) {
  try {
    var name = (req.body.name || "").trim();
    var email = (req.body.email || "").trim().toLowerCase();
    var password = req.body.password || "";
    var role = req.body.role || "student";

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    var existing = await User.findOne({ email: email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    var salt = await bcrypt.genSalt(12);
    var hashedPw = await bcrypt.hash(password, salt);

    var otp = generateOtp(6);
    var otpExp = new Date(
      Date.now() + parseInt(process.env.VERIFY_TOKEN_EXPIRES || "300000", 10),
    );

    var user = await User.create({
      name: name,
      email: email,
      password: hashedPw,
      role: role,
      isVerified: false,
      isActive: true,
      otpCode: otp,
      otpExpiry: otpExp,
      otpAttempts: 0,
    });

    /* Send verification email */
    var appUrl = (process.env.APP_URL || "http://localhost:3000")
      .split(" ")[0]
      .trim()
      .replace(/\/$/, "");

    var verifyLink =
      appUrl +
      "/verify-email.html?token=" +
      otp +
      "&email=" +
      encodeURIComponent(email);

    var emailSent = false;
    try {
      await sendVerificationEmail(user, otp, verifyLink);
      emailSent = true;
    } catch (emailErr) {
      console.error("Verification email error:", emailErr.message);
    }

    var response = {
      success: true,
      message: emailSent
        ? "Account created! Check your email to verify your account."
        : "Account created! Verification email could not be sent — please contact support.",
    };

    if (!emailSent || process.env.NODE_ENV !== "production") {
      response.devNote = true;
      if (process.env.NODE_ENV !== "production") {
        console.log("📧 DEV Verification OTP for", email, ":", otp);
      }
    }

    return res.status(201).json(response);
  } catch (err) {
    console.error("register error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/register-teacher
   Teacher registration (email + password)
   ============================================ */
router.post("/register-teacher", async function (req, res) {
  try {
    var name = (req.body.name || "").trim();
    var email = (req.body.email || "").trim().toLowerCase();
    var password = req.body.password || "";

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    var existing = await User.findOne({ email: email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    var salt = await bcrypt.genSalt(12);
    var hashedPw = await bcrypt.hash(password, salt);

    var otp = generateOtp(6);
    var otpExp = new Date(
      Date.now() + parseInt(process.env.VERIFY_TOKEN_EXPIRES || "300000", 10),
    );

    var user = await User.create({
      name: name,
      email: email,
      password: hashedPw,
      role: "teacher",
      isVerified: false,
      isActive: true,
      otpCode: otp,
      otpExpiry: otpExp,
      otpAttempts: 0,
    });

    var appUrl = (process.env.APP_URL || "http://localhost:3000")
      .split(" ")[0]
      .trim()
      .replace(/\/$/, "");
    var verifyLink =
      appUrl +
      "/verify-email.html?token=" +
      otp +
      "&email=" +
      encodeURIComponent(email);

    var emailSent = false;
    try {
      await sendVerificationEmail(user, otp, verifyLink);
      emailSent = true;
    } catch (emailErr) {
      console.error("Teacher verification email error:", emailErr.message);
    }

    var response = {
      success: true,
      message: emailSent
        ? "Teacher account created! Check your email for a verification link."
        : "Account created! Verification email could not be sent — please contact support.",
    };

    if (process.env.NODE_ENV !== "production") {
      response.devNote = true;
      console.log("📧 DEV Teacher OTP for", email, ":", otp);
    }

    return res.status(201).json(response);
  } catch (err) {
    console.error("register-teacher error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/login
   Email + password login
   ============================================ */
router.post("/login", async function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();
    var password = req.body.password || "";

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    /* ⚠️  Must use .select('+password') */
    var user = await User.findOne({ email: email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        message: "Please verify your email before logging in.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated. Please contact support.",
      });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message:
          'This account uses Google sign in. Please use "Sign in with Google".',
      });
    }

    var match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    var token = signToken(user._id);

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token: token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/verify-otp
   Verify email OTP (from registration email)
   ============================================ */
router.post("/verify-otp", async function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();
    var otp = (req.body.otp || "").trim();

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP code are required.",
      });
    }

    var user = await User.findOne({ email: email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email.",
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "Email already verified. You can log in.",
      });
    }

    if (user.otpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        tooManyAttempts: true,
        message: "Too many incorrect attempts. Please register again.",
      });
    }

    if (!user.otpExpiry || new Date() > user.otpExpiry) {
      return res.status(400).json({
        success: false,
        expired: true,
        message: "Verification code has expired. Please request a new one.",
      });
    }

    if (user.otpCode !== otp) {
      await User.findByIdAndUpdate(user._id, { $inc: { otpAttempts: 1 } });
      return res.status(400).json({
        success: false,
        message: "Incorrect code. Please try again.",
      });
    }

    /* ✅ Verified */
    await User.findByIdAndUpdate(user._id, {
      $set: {
        isVerified: true,
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully! You can now log in.",
    });
  } catch (err) {
    console.error("verify-otp error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Verification failed. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/resend-verification
   ============================================ */
router.post("/resend-verification", async function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    var user = await User.findOne({ email: email });

    if (!user) {
      /* Don't reveal if email exists */
      return res.status(200).json({
        success: true,
        message:
          "If this email is registered, a new verification code has been sent.",
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "This email is already verified. You can log in.",
      });
    }

    var otp = generateOtp(6);
    var otpExp = new Date(
      Date.now() + parseInt(process.env.VERIFY_TOKEN_EXPIRES || "300000", 10),
    );

    await User.findByIdAndUpdate(user._id, {
      $set: { otpCode: otp, otpExpiry: otpExp, otpAttempts: 0 },
    });

    var appUrl = (process.env.APP_URL || "http://localhost:3000")
      .split(" ")[0]
      .trim()
      .replace(/\/$/, "");
    var verifyLink =
      appUrl +
      "/verify-email.html?token=" +
      otp +
      "&email=" +
      encodeURIComponent(email);

    var emailSent = false;
    try {
      await sendVerificationEmail(user, otp, verifyLink);
      emailSent = true;
    } catch (emailErr) {
      console.error("Resend verification email error:", emailErr.message);
    }

    var response = {
      success: true,
      message: "A new verification code has been sent to " + email,
    };

    if (process.env.NODE_ENV !== "production") {
      response.devNote = true;
      console.log("📧 DEV Resend OTP for", email, ":", otp);
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("resend-verification error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/forgot-password
   Email forgot password
   ============================================ */
router.post("/forgot-password", async function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    var user = await User.findOne({ email: email });

    /* Don't reveal if email exists */
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If this email is registered, a reset link has been sent.",
      });
    }

    var otp = generateOtp(6);
    var otpExp = new Date(
      Date.now() + parseInt(process.env.VERIFY_TOKEN_EXPIRES || "300000", 10),
    );

    await User.findByIdAndUpdate(user._id, {
      $set: { otpCode: otp, otpExpiry: otpExp, otpAttempts: 0 },
    });

    var appUrl = (process.env.APP_URL || "http://localhost:3000")
      .split(" ")[0]
      .trim()
      .replace(/\/$/, "");
    var resetLink =
      appUrl +
      "/reset-password.html?token=" +
      otp +
      "&email=" +
      encodeURIComponent(email);

    var emailSent = false;
    try {
      await sendPasswordResetEmail(user, otp, resetLink);
      emailSent = true;
    } catch (emailErr) {
      console.error("Forgot password email error:", emailErr.message);
    }

    var response = {
      success: true,
      message: emailSent
        ? "Password reset link sent to " + email + ". Check your inbox."
        : "Password reset email could not be sent. Please try again or contact support.",
    };

    if (process.env.NODE_ENV !== "production") {
      response.devNote = true;
      console.log("📧 DEV Reset OTP for", email, ":", otp);
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error("forgot-password error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/reset-password
   ============================================ */
router.post("/reset-password", async function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();
    var otp = (req.body.token || req.body.otp || "").trim();
    var newPassword = req.body.newPassword || req.body.password || "";

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, reset code, and new password are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    var user = await User.findOne({ email: email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (!user.otpExpiry || new Date() > user.otpExpiry) {
      return res.status(400).json({
        success: false,
        expired: true,
        message: "Reset link has expired. Please request a new one.",
      });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset code. Please use the link from your email.",
      });
    }

    var salt = await bcrypt.genSalt(12);
    var hashedPw = await bcrypt.hash(newPassword, salt);

    await User.findByIdAndUpdate(user._id, {
      $set: {
        password: hashedPw,
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
      },
    });

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (err) {
    console.error("reset-password error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

/* ============================================
   POST /api/auth/google
   Google OAuth sign in / register
   ============================================ */
router.post("/google", async function (req, res) {
  try {
    var credential = req.body.credential;
    var role = req.body.role || "student";

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required.",
      });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        message: "Google sign in is not configured on this server.",
      });
    }

    var client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    var ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    var payload = ticket.getPayload();
    var googleId = payload.sub;
    var email = (payload.email || "").toLowerCase();
    var name = payload.name || payload.given_name || "User";
    var picture = payload.picture || "";

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Could not retrieve email from Google account.",
      });
    }

    /* Find or create user */
    var user = await User.findOne({
      $or: [{ googleId: googleId }, { email: email }],
    });

    if (user) {
      /* Existing user — update Google info */
      if (!user.googleId) {
        await User.findByIdAndUpdate(user._id, {
          $set: { googleId: googleId, isVerified: true },
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "This account has been deactivated.",
        });
      }

      var token = signToken(user._id);

      return res.status(200).json({
        success: true,
        message: "Signed in with Google.",
        token: token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } else {
      /* New user — create account */
      var newUser = await User.create({
        name: name,
        email: email,
        googleId: googleId,
        picture: picture,
        role: role,
        isVerified: true,
        isActive: true,
      });

      var token = signToken(newUser._id);

      return res.status(201).json({
        success: true,
        message: "Account created with Google.",
        token: token,
        user: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
      });
    }
  } catch (err) {
    console.error("google auth error:", err.message);
    return res.status(401).json({
      success: false,
      message: "Google sign in failed. Please try again.",
    });
  }
});

/* ============================================
   GET /api/auth/me
   Verify JWT and return current user
   ============================================ */
router.get("/me", protect, async function (req, res) {
  try {
    var user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        isActive: user.isActive,
      },
    });
  } catch (err) {
    console.error("me error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
});

/* ============================================
   POST /api/auth/admin-login
   
   Validates ONLY against ENV variables.
   No Google. No phone. No public registration.
   Completely isolated from user auth system.
============================================ */
router.post("/admin-login", async function (req, res) {
  try {
    var email = (req.body.email || "").trim().toLowerCase();
    var password = (req.body.password || "").trim();

    var adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    var adminPassword = (process.env.ADMIN_PASSWORD || "").trim();

    /* ENV not configured */
    if (!adminEmail || !adminPassword) {
      return res.status(503).json({
        success: false,
        message:
          "Admin system not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in Railway.",
      });
    }

    /* Wrong credentials — artificial delay prevents brute force */
    if (email !== adminEmail || password !== adminPassword) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 1200);
      });
      return res.status(401).json({
        success: false,
        message: "❌ Invalid admin credentials.",
      });
    }

    /* Credentials match — find user in DB for JWT */
    var user = await User.findOne({ email: adminEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "Admin account not found in database. Please run: node server/config/seeder.js",
      });
    }

    if (user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Account found but does not have admin role. Run seeder to fix.",
      });
    }

    var token = signToken(user._id);

    console.log("✅ Admin login: " + email);

    return res.status(200).json({
      success: true,
      message: "Admin login successful.",
      token: token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("admin-login error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Server error. Please try again." });
  }
});

module.exports = router;
