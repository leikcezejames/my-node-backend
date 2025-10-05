const express = require("express")
const cors = require("cors")
const fetch = require("node-fetch")
const nodemailer = require("nodemailer")
const crypto = require("crypto")
require("dotenv").config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// EXISTING: Semaphore configuration
const SEMAPHORE_CONFIG = {
  apiKey: process.env.SEMAPHORE_API_KEY,
  baseUrl: "https://api.semaphore.co/api/v4/messages",
  senderName: process.env.SEMAPHORE_SENDER_NAME || "TVNet",
}

// Email configuration (kept for other features)
const EMAIL_CONFIG = {
  service: process.env.EMAIL_SERVICE || "gmail",
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS,
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
}

// Email transporter (kept for other features)
let transporter
try {
  if (EMAIL_CONFIG.user && EMAIL_CONFIG.pass) {
    transporter = nodemailer.createTransport({
      service: EMAIL_CONFIG.service,
      auth: {
        user: EMAIL_CONFIG.user,
        pass: EMAIL_CONFIG.pass,
      },
    })
    console.log("✅ Email transporter configured")
  } else {
    console.log("⚠️ Email not configured - Email features will not work")
  }
} catch (error) {
  console.error("❌ Email configuration error:", error.message)
}

// OTP storage
const otpStore = new Map()

// Helper functions
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function generateSessionId() {
  return crypto.randomBytes(32).toString("hex")
}

function cleanExpiredOTPs() {
  const now = Date.now()
  for (const [sessionId, data] of otpStore.entries()) {
    if (now > data.expiresAt) {
      otpStore.delete(sessionId)
    }
  }
}

// Clean expired OTPs every 5 minutes
setInterval(cleanExpiredOTPs, 5 * 60 * 1000)

// Validate API key on startup
if (!SEMAPHORE_CONFIG.apiKey) {
  console.error("❌ SEMAPHORE_API_KEY is not set in environment variables")
  console.log("📝 Please add SEMAPHORE_API_KEY=your_api_key to your .env file")
} else {
  console.log("✅ SEMAPHORE_API_KEY is configured")
}

// Helper function to format inquiry type for display
function formatInquiryType(inquiryType) {
  const inquiryTypeMap = {
    "new-installation": "New Installation / Subscription",
    "billing-payment": "Billing & Payment Concerns",
    "technical-support": "Technical Support / No Internet",
    "plan-upgrade": "Plan Upgrade / Downgrade",
    "service-disconnection": "Service Disconnection / Relocation",
    "general-inquiries": "General Inquiries / Others",
  }

  return inquiryTypeMap[inquiryType] || inquiryType || "General Inquiry"
}

// Helper function to get inquiry type color for email styling
function getInquiryTypeColor(inquiryType) {
  const colorMap = {
    "new-installation": "#3b82f6",
    "billing-payment": "#f59e0b",
    "technical-support": "#ef4444",
    "plan-upgrade": "#10b981",
    "service-disconnection": "#8b5cf6",
    "general-inquiries": "#6b7280",
  }

  return colorMap[inquiryType] || "#6b7280"
}

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "SMS & Email Backend is running!",
    status: "OK",
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!SEMAPHORE_CONFIG.apiKey,
    emailConfigured: !!(EMAIL_CONFIG.user && EMAIL_CONFIG.pass),
    availableEndpoints: [
      "/api/send-sms",
      "/api/notify-application-approved",
      "/api/notify-application-declined",
      "/api/notify-documents-approved",
      "/api/notify-documents-rejected",
      "/api/notify-receipt-approved",
      "/api/notify-receipt-rejected",
      "/api/send-otp",
      "/api/verify-otp",
      "/api/send-advisory-email",
      "/api/get-user-emails",
      "/api/send-contact-email",
      "/api/notify-plan-activation-declined",
      "/api/set-due-date",
      "/api/reset-due-date",
      "/api/notify-due-date-reminder-3-days",
      "/api/notify-due-date-reminder",
      "/api/notify-disconnection-notice",
      "/api/check-email",
      "/api/send-sms-otp",
      "/api/send-advisory",
    ],
  })
})

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({
    message: "API is working!",
    status: "OK",
    timestamp: new Date().toISOString(),
  })
})

// Get user emails endpoint
app.post("/api/get-user-emails", async (req, res) => {
  try {
    const { userEmails } = req.body

    if (!userEmails || !Array.isArray(userEmails)) {
      return res.status(400).json({
        success: false,
        error: "User emails array is required",
      })
    }

    const filteredUsers = userEmails.filter((user) => user.email && user.emailVerified && user.role === "User")

    console.log(`📧 Filtered ${filteredUsers.length} users with role 'User' from ${userEmails.length} total users`)

    res.json({
      success: true,
      users: filteredUsers,
      count: filteredUsers.length,
    })
  } catch (error) {
    console.error("❌ Error filtering user emails:", error)
    res.status(500).json({
      success: false,
      error: "Failed to process user emails",
    })
  }
})

// Send OTP endpoint
app.post("/api/send-otp", async (req, res) => {
  try {
    const { email, name } = req.body

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      })
    }

    if (!transporter) {
      return res.status(500).json({
        success: false,
        error: "Email service not configured",
      })
    }

    const otp = generateOTP()
    const sessionId = generateSessionId()
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

    otpStore.set(sessionId, {
      otp,
      email,
      name,
      expiresAt,
      attempts: 0,
      maxAttempts: 3,
    })

    console.log(`📧 Sending OTP ${otp} to ${email}`)

    const mailOptions = {
      from: `"Tamaraw Vision Network, Inc. (TVNET)" <${EMAIL_CONFIG.from}>`,
      to: email,
      subject: "Email Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, rgb(255, 51, 51), rgb(51, 102, 255), rgb(255, 255, 255)); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Email Verification</h1>
          </div>
          
          <div style="background: #f8fafc; padding: 30px; border-radius: 10px; margin-bottom: 30px;">
            <h2 style="color: #1f2937; margin-top: 0;">Hello ${name || "there"}!</h2>
            <p style="color: #6b7280; font-size: 16px; line-height: 1.6;">
              Thank you for signing up! Please use the verification code below to complete your registration:
            </p>
            
            <div style="background: white; border: 2px dashed #3b82f6; border-radius: 10px; padding: 20px; text-align: center; margin: 30px 0;">
              <div style="font-size: 32px; font-weight: bold; color: #3b82f6; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            
            <p style="color: #ef4444; font-size: 14px; text-align: center; margin: 20px 0;">
              ⏰ This code will expire in 5 minutes
            </p>
            
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
              If you didn't request this verification code, please ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; color: #9ca3af; font-size: 12px;">
            <p>This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      `,
      text: `Hello ${name || "there"}! Your verification code is: ${otp}. This code will expire in 5 minutes.`,
    }

    await transporter.sendMail(mailOptions)

    console.log(`✅ OTP sent successfully to ${email}`)

    res.json({
      success: true,
      sessionId,
      message: "Verification code sent to your email",
    })
  } catch (error) {
    console.error("❌ Error sending OTP:", error)
    res.status(500).json({
      success: false,
      error: "Failed to send verification code",
    })
  }
})

// SMS notification helper function
const sendSMSNotification = async (phoneNumber, message) => {
  try {
    if (!SEMAPHORE_CONFIG.apiKey) {
      throw new Error("SMS service not configured. API key is missing.")
    }

    console.log(`📱 Sending SMS to: ${phoneNumber}`)

    const response = await fetch(SEMAPHORE_CONFIG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: SEMAPHORE_CONFIG.apiKey,
        number: phoneNumber,
        message: message,
        sendername: SEMAPHORE_CONFIG.senderName,
      }),
    })

    const contentType = response.headers.get("content-type")
    let result

    if (contentType && contentType.includes("application/json")) {
      result = await response.json()
    } else {
      const textResponse = await response.text()
      console.error("Non-JSON response from Semaphore API:", textResponse)

      // Check if it's a successful response despite being non-JSON
      if (response.ok && textResponse.includes("success")) {
        console.log(`✅ SMS sent successfully to ${phoneNumber} (non-JSON response)`)
        return { success: true, data: textResponse }
      }

      throw new Error(`SMS service error: ${textResponse}`)
    }

    if (response.ok && result) {
      console.log(`✅ SMS sent successfully to ${phoneNumber}:`, result)
      return { success: true, data: result }
    } else {
      console.error(`❌ SMS sending failed for ${phoneNumber}:`, result)
      throw new Error(result?.message || result?.error || "Failed to send SMS")
    }
  } catch (error) {
    console.error(`❌ Error sending SMS to ${phoneNumber}:`, error.message)
    throw error
  }
}

// NEW: SMS notification endpoint for Plan Activation Declined
app.post("/api/notify-plan-activation-declined", async (req, res) => {
  try {
    const { phoneNumber, applicantName, reason } = req.body
    console.log("📱 Received plan activation decline notification:", { phoneNumber, applicantName, reason })
    if (!phoneNumber || !reason) {
      return res.status(400).json({
        success: false,
        error: "Phone number and reason are required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_ACTIVATION_DECLINED(reason)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan activation decline notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan activation decline notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// SMS Messages - Updated to be more flexible
const SMS_MESSAGES = {
  APPLICATION_APPROVED: "Your application has been approved. Please submit the required documents.",
  APPLICATION_DECLINED: "We regret to inform you that your application has been declined.",
  DOCUMENTS_APPROVED:
    "Congratulations! Your submitted document has been approved. You are now a subscriber of TVNET. Please proceed to your payment.",
  DOCUMENTS_REJECTED: "Sorry, we regret to inform you that your submitted document was rejected.",

  // NEW: Plan Change/Stop SMS Messages
  PLAN_CHANGE_APPROVED: (planName) => `Your plan change request to ${planName} has been approved.`,
  PLAN_CHANGE_DECLINED: (reason) => `Your plan change request has been declined. Reason: ${reason}.`,
  PLAN_STOP_APPROVED: "Your plan stop request has been approved. Your service will be stopped.",
  PLAN_STOP_DECLINED: (reason) => `Your plan stop request has been declined. Reason: ${reason}.`,
  PLAN_ACTIVATION_REQUESTED: "Your plan activation request has been submitted and is awaiting review.", // NEW
  PLAN_ACTIVATED: "Your plan has been successfully activated. Welcome back!", // NEW
  PLAN_ACTIVATION_DECLINED: (reason) => `Your plan activation request has been declined. Reason: ${reason}.`, // NEW
  DUE_DATE_SET: (dueDate) => `Your subscription due date has been set to ${dueDate}.`,
  DUE_DATE_RESET: "Your subscription due date has been reset. Please check your account for details.",
  DUE_DATE_REMINDER_3_DAYS: (dueDate, amount, penalty) =>
    `Reminder: Your TVNET bill of P${amount} (plus P${penalty} penalty if applicable) is due in 3 days on ${dueDate}. Please settle promptly.`,
  DUE_DATE_REMINDER: (dueDate, amount, penalty) =>
    `Reminder: Your TVNET bill of P${amount} (plus P${penalty} penalty if applicable) is due today, ${dueDate}. Please settle promptly to avoid service interruption.`,
  DISCONNECTION_NOTICE: (dueDate, amount, penalty) =>
    `Final Notice: Your TVNET bill of P${amount} (plus P${penalty} penalty) due on ${dueDate} is still unpaid. Your service is subject to disconnection. Please pay immediately.`,
  RECEIPT_APPROVED: (monthYear, amount) =>
    `Your payment receipt for ${monthYear} amounting to ₱${amount} has been approved. Thank you for your payment!`,

  RECEIPT_REJECTED: (monthYear, reason) =>
    `Your payment receipt for ${monthYear} has been rejected. Reason: ${reason}. Please resubmit a valid receipt.`,
}

// SMS endpoints
app.post("/api/send-sms", async (req, res) => {
  try {
    const { phoneNumber, message } = req.body

    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        error: "Phone number and message are required",
      })
    }

    if (!SEMAPHORE_CONFIG.apiKey) {
      return res.status(500).json({
        success: false,
        error: "SMS service not configured. API key is missing.",
      })
    }

    console.log("Sending SMS to:", phoneNumber)
    console.log("Message:", message)

    const response = await fetch(SEMAPHORE_CONFIG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: SEMAPHORE_CONFIG.apiKey,
        number: phoneNumber,
        message: message,
        sendername: SEMAPHORE_CONFIG.senderName,
      }),
    })

    const contentType = response.headers.get("content-type")
    let result

    if (contentType && contentType.includes("application/json")) {
      result = await response.json()
    } else {
      const textResponse = await response.text()
      console.error("Non-JSON response from Semaphore API:", textResponse)

      return res.status(400).json({
        success: false,
        error: `API Error: ${textResponse}`,
        details: "The SMS service returned a non-JSON response. Please check your API key and account status.",
      })
    }

    if (response.ok && result) {
      console.log("SMS sent successfully:", result)
      res.json({ success: true, data: result })
    } else {
      console.error("SMS sending failed:", result)
      res.status(400).json({
        success: false,
        error: result?.message || result?.error || "Failed to send SMS",
        details: result,
      })
    }
  } catch (error) {
    console.error("Error sending SMS:", error)
    res.status(500).json({
      success: false,
      error: error.message,
      type: error.type || "unknown",
    })
  }
})

// NEW: SMS notification endpoint for Receipt Approved
app.post("/api/notify-receipt-approved", async (req, res) => {
  try {
    const { phoneNumber, applicantName, monthYear, amount } = req.body

    console.log("📱 Received receipt approval notification:", {
      phoneNumber,
      applicantName,
      monthYear,
      amount,
    })

    if (!phoneNumber || !monthYear || !amount) {
      return res.status(400).json({
        success: false,
        error: "Phone number, month/year, and amount are required",
      })
    }

    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.RECEIPT_APPROVED(monthYear, amount)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)

    console.log("✅ Receipt approval notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending receipt approval notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Receipt Rejected
app.post("/api/notify-receipt-rejected", async (req, res) => {
  try {
    const { phoneNumber, applicantName, monthYear, reason } = req.body

    console.log("📱 Received receipt rejection notification:", {
      phoneNumber,
      applicantName,
      monthYear,
      reason,
    })

    if (!phoneNumber || !monthYear) {
      return res.status(400).json({
        success: false,
        error: "Phone number and month/year are required",
      })
    }

    const rejectionReason = reason || "Receipt verification failed"
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.RECEIPT_REJECTED(monthYear, rejectionReason)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)

    console.log("✅ Receipt rejection notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending receipt rejection notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// SMS notification endpoints
app.post("/api/notify-application-approved", async (req, res) => {
  try {
    const { phoneNumber, applicantName } = req.body

    console.log("📱 Received approval notification request:", { phoneNumber, applicantName })

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }

    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.APPLICATION_APPROVED}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)

    console.log("✅ Approval notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending approval notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// FIXED: Application decline notification - now uses custom message
app.post("/api/notify-application-declined", async (req, res) => {
  try {
    const { phoneNumber, applicantName, reason, customMessage } = req.body

    console.log("📱 Received decline notification request:", { phoneNumber, applicantName, reason, customMessage })

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }

    // Use custom message if provided, otherwise use default
    let messageToSend
    if (customMessage) {
      messageToSend = customMessage
      console.log("📝 Using custom decline message:", customMessage)
    } else {
      messageToSend = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.APPLICATION_DECLINED}`
      console.log("📝 Using default decline message")
    }

    const result = await sendSMSNotification(phoneNumber, messageToSend)

    console.log("✅ Decline notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending decline notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

app.post("/api/notify-documents-approved", async (req, res) => {
  try {
    const { phoneNumber, applicantName } = req.body

    console.log("📱 Received document approval notification request:", { phoneNumber, applicantName })

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }

    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DOCUMENTS_APPROVED}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)

    console.log("✅ Document approval notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending document approval notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

app.post("/api/notify-documents-rejected", async (req, res) => {
  try {
    const { phoneNumber, applicantName } = req.body

    console.log("📱 Received document rejection notification request:", { phoneNumber, applicantName })

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }

    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DOCUMENTS_REJECTED}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)

    console.log("✅ Document rejection notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending document rejection notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Plan Change Approved
app.post("/api/notify-plan-change-approved", async (req, res) => {
  try {
    const { phoneNumber, applicantName, newPlanName } = req.body
    console.log("📱 Received plan change approval notification request:", { phoneNumber, applicantName, newPlanName })
    if (!phoneNumber || !newPlanName) {
      return res.status(400).json({
        success: false,
        error: "Phone number and new plan name are required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_CHANGE_APPROVED(newPlanName)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan change approval notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan change approval notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Plan Change Declined
app.post("/api/notify-plan-change-declined", async (req, res) => {
  try {
    const { phoneNumber, applicantName, reason } = req.body
    console.log("📱 Received plan change decline notification request:", { phoneNumber, applicantName, reason })
    if (!phoneNumber || !reason) {
      return res.status(400).json({
        success: false,
        error: "Phone number and reason are required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_CHANGE_DECLINED(reason)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan change decline notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan change decline notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Plan Stop Approved
app.post("/api/notify-plan-stop-approved", async (req, res) => {
  try {
    const { phoneNumber, applicantName } = req.body
    console.log("📱 Received plan stop approval notification request:", { phoneNumber, applicantName })
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_STOP_APPROVED}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan stop approval notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan stop approval notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Plan Stop Declined
app.post("/api/notify-plan-stop-declined", async (req, res) => {
  try {
    const { phoneNumber, applicantName, reason } = req.body
    console.log("📱 Received plan stop decline notification request:", { phoneNumber, applicantName, reason })
    if (!phoneNumber || !reason) {
      return res.status(400).json({
        success: false,
        error: "Phone number and reason are required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_STOP_DECLINED(reason)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan stop decline notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan stop decline notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Plan Activation Requested
app.post("/api/notify-plan-activation-requested", async (req, res) => {
  try {
    const { phoneNumber, applicantName } = req.body
    console.log("📱 Received plan activation request notification:", { phoneNumber, applicantName })
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_ACTIVATION_REQUESTED}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan activation request notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan activation request notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: SMS notification endpoint for Plan Activated
app.post("/api/notify-plan-activated", async (req, res) => {
  try {
    const { phoneNumber, applicantName } = req.body
    console.log("📱 Received plan activated notification:", { phoneNumber, applicantName })
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.PLAN_ACTIVATED}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Plan activated notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending plan activated notification:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: API endpoint to set due date
app.post("/api/set-due-date", async (req, res) => {
  try {
    const { phoneNumber, applicantName, applicationType, applicationId, newDueDate, reason, changedBy } = req.body
    console.log("Received set due date request:", { phoneNumber, applicantName, applicationId, newDueDate, reason })

    if (!phoneNumber || !applicationType || !applicationId || !newDueDate || !reason || !changedBy) {
      return res.status(400).json({
        success: false,
        error: "Phone number, application type, application ID, new due date, reason, and changedBy are required.",
      })
    }

    // In a real application, you would interact with your database (e.g., Firestore) here
    // to update the subscriber's document and add to a history subcollection.
    // For this example, we'll simulate the database interaction.
    console.log(`Simulating database update for subscriber ${applicationId}: setting due date to ${newDueDate}`)

    // Simulate adding to history
    console.log(
      `Simulating adding to due date history for ${applicationId}: Due date set to ${newDueDate} by ${changedBy} for reason: ${reason}`,
    )

    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DUE_DATE_SET(newDueDate)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Due date set notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error setting due date:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: API endpoint to reset due date
app.post("/api/reset-due-date", async (req, res) => {
  try {
    const { phoneNumber, applicantName, applicationType, applicationId, reason, changedBy } = req.body
    console.log("Received reset due date request:", { phoneNumber, applicantName, applicationId, reason })

    if (!phoneNumber || !applicationType || !applicationId || !reason || !changedBy) {
      return res.status(400).json({
        success: false,
        error: "Phone number, application type, application ID, reason, and changedBy are required.",
      })
    }

    // In a real application, you would interact with your database (e.g., Firestore) here
    // to update the subscriber's document (clearing the due date) and add to a history subcollection.
    // For this example, we'll simulate the database interaction.
    console.log(`Simulating database update for subscriber ${applicationId}: resetting due date.`)

    // Simulate adding to history
    console.log(
      `Simulating adding to due date history for ${applicationId}: Due date reset by ${changedBy} for reason: ${reason}`,
    )

    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DUE_DATE_RESET}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Due date reset notification sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error resetting due date:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: API endpoint for 3-day due date reminder
app.post("/api/notify-due-date-reminder-3-days", async (req, res) => {
  try {
    const { phoneNumber, applicantName, dueDate, amount, penalty } = req.body
    console.log("📱 Received 3-day due date reminder request:", {
      phoneNumber,
      applicantName,
      dueDate,
      amount,
      penalty,
    })
    if (!phoneNumber || !dueDate || amount === undefined || penalty === undefined) {
      return res.status(400).json({
        success: false,
        error: "Phone number, due date, amount, and penalty are required.",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DUE_DATE_REMINDER_3_DAYS(dueDate, amount, penalty)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ 3-day due date reminder sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending 3-day due date reminder:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: API endpoint for general due date reminder (on due date)
app.post("/api/notify-due-date-reminder", async (req, res) => {
  try {
    const { phoneNumber, applicantName, dueDate, amount, penalty } = req.body
    console.log("📱 Received due date reminder request:", { phoneNumber, applicantName, dueDate, amount, penalty })
    if (!phoneNumber || !dueDate || amount === undefined || penalty === undefined) {
      return res.status(400).json({
        success: false,
        error: "Phone number, due date, amount, and penalty are required.",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DUE_DATE_REMINDER(dueDate, amount, penalty)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Due date reminder sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending due date reminder:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: API endpoint for disconnection notice
app.post("/api/notify-disconnection-notice", async (req, res) => {
  try {
    const { phoneNumber, applicantName, dueDate, amount, penalty } = req.body
    console.log("📱 Received disconnection notice request:", { phoneNumber, applicantName, dueDate, amount, penalty })
    if (!phoneNumber || !dueDate || amount === undefined || penalty === undefined) {
      return res.status(400).json({
        success: false,
        error: "Phone number, due date, amount, and penalty are required.",
      })
    }
    const personalizedMessage = `Hi ${applicantName || "there"}! ${SMS_MESSAGES.DISCONNECTION_NOTICE(dueDate, amount, penalty)}`

    const result = await sendSMSNotification(phoneNumber, personalizedMessage)
    console.log("✅ Disconnection notice sent successfully")
    res.json(result)
  } catch (error) {
    console.error("❌ Error sending disconnection notice:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// NEW: Added endpoint to check if email already exists
app.post("/api/check-email", async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      })
    }

    // Here you would typically check your database for existing email
    // For now, we'll simulate the check
    console.log(`🔍 Checking if email exists: ${email}`)

    // Simulate database check - replace with actual database query
    const emailExists = false // Replace with actual database check

    res.json({
      success: true,
      exists: emailExists,
      message: emailExists ? "Email already exists" : "Email is available",
    })
  } catch (error) {
    console.error("❌ Error checking email:", error)
    res.status(500).json({
      success: false,
      error: "Failed to check email availability",
    })
  }
})

app.post("/api/send-sms-otp", async (req, res) => {
  try {
    const { phoneNumber, name, email } = req.body // Added email parameter

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      })
    }

    if (!SEMAPHORE_CONFIG.apiKey) {
      return res.status(500).json({
        success: false,
        error: "SMS service not configured. API key is missing.",
      })
    }

    // Format phone number for Philippines (+63)
    let formattedPhone = phoneNumber.replace(/\D/g, "") // Remove non-digits
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "63" + formattedPhone.substring(1) // Replace leading 0 with 63
    } else if (!formattedPhone.startsWith("63")) {
      formattedPhone = "63" + formattedPhone // Add PH country code
    }

    const otp = generateOTP()
    const sessionId = generateSessionId()
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

    otpStore.set(sessionId, {
      otp,
      phoneNumber: formattedPhone,
      email: email || null, // Store email for account creation
      name,
      expiresAt,
      attempts: 0,
      maxAttempts: 3,
    })

    console.log(`📱 Sending SMS OTP ${otp} to ${formattedPhone}`)

    const message = `Hello ${name || "there"}! Your TVNET verification code is: ${otp}. This code will expire in 5 minutes. Do not share this code with anyone.`

    const response = await fetch(SEMAPHORE_CONFIG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apikey: SEMAPHORE_CONFIG.apiKey,
        number: formattedPhone,
        message: message,
        sendername: SEMAPHORE_CONFIG.senderName,
      }),
    })

    const contentType = response.headers.get("content-type")
    let result

    if (contentType && contentType.includes("application/json")) {
      result = await response.json()
    } else {
      const textResponse = await response.text()
      console.error("Non-JSON response from Semaphore API:", textResponse)

      return res.status(400).json({
        success: false,
        error: `API Error: ${textResponse}`,
        details: "The SMS service returned a non-JSON response. Please check your API key and account status.",
      })
    }

    if (response.ok && result) {
      console.log(`✅ SMS OTP sent successfully to ${formattedPhone}:`, result)
      res.json({
        success: true,
        sessionId,
        message: "SMS verification code sent to your phone",
      })
    } else {
      console.error("SMS OTP sending failed:", result)
      res.status(400).json({
        success: false,
        error: result?.message || result?.error || "Failed to send SMS OTP",
        details: result,
      })
    }
  } catch (error) {
    console.error("❌ Error sending SMS OTP:", error)
    res.status(500).json({
      success: false,
      error: "Failed to send SMS verification code",
    })
  }
})

app.post("/api/verify-otp", async (req, res) => {
  try {
    const { sessionId, otp } = req.body

    if (!sessionId || !otp) {
      return res.status(400).json({
        success: false,
        error: "Session ID and OTP are required",
      })
    }

    const otpData = otpStore.get(sessionId)

    if (!otpData) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired session",
      })
    }

    if (Date.now() > otpData.expiresAt) {
      otpStore.delete(sessionId)
      return res.status(400).json({
        success: false,
        error: "Verification code has expired",
      })
    }

    if (otpData.attempts >= otpData.maxAttempts) {
      otpStore.delete(sessionId)
      return res.status(400).json({
        success: false,
        error: "Too many failed attempts",
      })
    }

    if (otpData.otp !== otp) {
      otpData.attempts++
      otpStore.set(sessionId, otpData)

      return res.status(400).json({
        success: false,
        error: "Invalid verification code",
        attemptsLeft: otpData.maxAttempts - otpData.attempts,
      })
    }

    otpStore.delete(sessionId)

    console.log(`✅ OTP verified successfully for ${otpData.phoneNumber || otpData.email}`)

    res.json({
      success: true,
      message: otpData.phoneNumber ? "Phone number verified successfully" : "Email verified successfully",
      phoneNumber: otpData.phoneNumber,
      email: otpData.email,
      name: otpData.name,
    })
  } catch (error) {
    console.error("❌ Error verifying OTP:", error)
    res.status(500).json({
      success: false,
      error: "Failed to verify code",
    })
  }
})

app.post("/api/send-advisory", async (req, res) => {
  try {
    const { title, message, recipients } = req.body
    console.log("📨 Received advisory SMS request:", {
      title,
      messageLength: message?.length || 0,
      recipientCount: recipients?.length || 0,
    })

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Advisory title is required and cannot be empty",
      })
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Advisory message content is required and cannot be empty",
      })
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Recipients array is required and cannot be empty",
      })
    }

    if (!SEMAPHORE_CONFIG.apiKey) {
      return res.status(500).json({
        success: false,
        error: "SMS service not configured. API key is missing.",
      })
    }

    const validRecipients = recipients
      .map((phone) => {
        if (!phone || typeof phone !== "string") return null

        // Clean and format phone number
        let cleanPhone = phone.replace(/\D/g, "")

        // Handle Philippine phone numbers
        if (cleanPhone.startsWith("0")) {
          cleanPhone = "63" + cleanPhone.substring(1)
        } else if (!cleanPhone.startsWith("63")) {
          cleanPhone = "63" + cleanPhone
        }

        // Validate Philippine mobile number format (Globe, Smart, Sun, etc.)
        // Should be 12 digits total: 63 + 9xxxxxxxxx or 63 + 8xxxxxxxxx
        if (cleanPhone.match(/^63(9\d{9}|8\d{9})$/)) {
          return cleanPhone
        }

        console.warn(`❌ Invalid phone number format: ${phone} -> ${cleanPhone}`)
        return null
      })
      .filter((phone) => phone !== null)

    if (validRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid Philippine mobile numbers found. Please check the phone number format (e.g., 09171234567)",
      })
    }

    const advisoryMessage = `ADVISORY: ${title.trim()}\n\n${message.trim()}\n\n- TVNET Management`
    console.log(
      `Sending advisory to ${validRecipients.length} recipients with message length: ${advisoryMessage.length}`,
    )

    const batchSize = 3 // Reduced batch size to prevent rate limiting
    const delay = 3000 // Increased delay between batches
    const results = []

    for (let i = 0; i < validRecipients.length; i += batchSize) {
      const batch = validRecipients.slice(i, i + batchSize)
      console.log(
        `📤 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validRecipients.length / batchSize)}`,
      )

      const batchResults = await Promise.all(
        batch.map(async (phoneNumber) => {
          try {
            const result = await sendSMSNotification(phoneNumber, advisoryMessage)
            console.log(`✅ Advisory sent to ${phoneNumber}`)
            return { phoneNumber, success: true, data: result.data }
          } catch (err) {
            console.error(`❌ Failed to send advisory to ${phoneNumber}:`, err.message)
            return { phoneNumber, success: false, error: err.message }
          }
        }),
      )

      results.push(...batchResults)

      // Add delay between batches to avoid rate limiting
      if (i + batchSize < validRecipients.length) {
        console.log(`⏳ Waiting ${delay}ms before next batch...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount

    console.log(`📊 SMS Summary - Total: ${results.length}, Success: ${successCount}, Failed: ${failCount}`)

    const response = {
      success: successCount > 0, // Consider success if at least one SMS was sent
      message:
        failCount === 0
          ? `All ${successCount} SMS sent successfully!`
          : `${successCount} SMS sent successfully, ${failCount} failed`,
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount,
        validRecipients: validRecipients.length,
        originalRecipients: recipients.length,
      },
      results: results,
    }

    // Return appropriate status code
    if (successCount === 0) {
      res.status(500).json(response)
    } else if (failCount > 0) {
      res.status(207).json(response) // 207 Multi-Status for partial success
    } else {
      res.json(response)
    }
  } catch (err) {
    console.error("❌ Error in /api/send-advisory:", err.message)
    res.status(500).json({
      success: false,
      error: "Internal server error: " + err.message,
    })
  }
})


app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})
