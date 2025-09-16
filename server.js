const express = require("express")
const cors = require("cors")
const fetch = require("node-fetch")
const nodemailer = require("nodemailer")
const crypto = require("crypto")
require("dotenv").config()

const app = express()

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "http://localhost:8081",
      "http://127.0.0.1:8080",
      "https://geosubcribers.web.app",
    ], // Vue dev server URLs
    credentials: true,
  }),
)
app.use(express.json())

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

// EXISTING: Semaphore configuration
const SEMAPHORE_CONFIG = {
  apiKey: process.env.SEMAPHORE_API_KEY,
  baseUrl: "https://api.semaphore.co/api/v4/messages",
  senderName: process.env.SEMAPHORE_SENDER_NAME || "SEMAPHORE",
}

// Email configuration
const EMAIL_CONFIG = {
  service: process.env.EMAIL_SERVICE || "gmail",
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS,
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
}

// OTP storage only (removed email transporter)
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
      "/api/notify-receipt-approved", // NEW
      "/api/notify-receipt-rejected",
      "/api/send-sms-otp",
      "/api/verify-otp",
      "/api/send-advisory-email",
      "/api/get-user-emails",
      "/api/send-contact-email",
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

// Send Advisory Email endpoint
app.post("/api/send-advisory-email", async (req, res) => {
  try {
    const { title, content, type, emails, userEmails } = req.body

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Title and content are required",
      })
    }

    if (!transporter) {
      return res.status(500).json({
        success: false,
        error: "Email service not configured",
      })
    }

    let emailList = []

    if (type === "all") {
      if (userEmails && Array.isArray(userEmails)) {
        const filteredUsers = userEmails.filter((user) => user.email && user.emailVerified && user.role === "User")
        emailList = filteredUsers.map((user) => user.email)
        console.log(`📧 Sending to ${emailList.length} regular users (excluding admins)`)
      } else {
        return res.status(400).json({
          success: false,
          error: "User emails not provided",
        })
      }
    } else if (type === "custom" && emails) {
      emailList = emails
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email)
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid email type or missing email addresses",
      })
    }

    if (emailList.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No email addresses found",
      })
    }

    console.log(`📧 Sending advisory email to ${emailList.length} recipients`)

    const mailOptions = {
      from: `"Tamaraw Vision Network, Inc. (TVNET)" <${EMAIL_CONFIG.from}>`,
      subject: `Advisory: ${title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #cd3a04 0%, #f7931e 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">System Advisory</h1>
          </div>
          
          <div style="background: #f8fafc; padding: 30px; border-radius: 10px; margin-bottom: 30px;">
            <h2 style="color: #1f2937; margin-top: 0; font-size: 24px;">${title}</h2>
            
            <div style="background: white; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 5px;">
              <div style="color: #374151; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${content}</div>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                📅 Sent on: ${new Date().toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
          
          <div style="text-align: center; color: #9ca3af; font-size: 12px;">
            <p>This is an automated system advisory. Please do not reply to this email.</p>
            <p>If you have questions, please contact your system administrator.</p>
          </div>
        </div>
      `,
      text: `
System Advisory: ${title}

${content}

---
Sent on: ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}

This is an automated system advisory. Please do not reply to this email.
      `,
    }

    // Send emails in batches
    const batchSize = 10
    let successCount = 0
    let failureCount = 0
    const failures = []

    for (let i = 0; i < emailList.length; i += batchSize) {
      const batch = emailList.slice(i, i + batchSize)

      try {
        await transporter.sendMail({
          ...mailOptions,
          bcc: batch,
        })

        successCount += batch.length
        console.log(`✅ Sent advisory email to batch ${Math.floor(i / batchSize) + 1} (${batch.length} recipients)`)

        if (i + batchSize < emailList.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      } catch (error) {
        console.error(`❌ Failed to send to batch ${Math.floor(i / batchSize) + 1}:`, error.message)
        failureCount += batch.length
        failures.push(...batch)
      }
    }

    console.log(`📊 Advisory email results: ${successCount} sent, ${failureCount} failed`)

    if (successCount > 0) {
      res.json({
        success: true,
        message: "Advisory emails sent successfully",
        emailCount: successCount,
        failureCount: failureCount,
        failures: failures.length > 0 ? failures : undefined,
      })
    } else {
      res.status(500).json({
        success: false,
        error: "Failed to send any emails",
        failures: failures,
      })
    }
  } catch (error) {
    console.error("❌ Error sending advisory email:", error)
    res.status(500).json({
      success: false,
      error: "Failed to send advisory emails: " + error.message,
    })
  }
})

// FIXED: Enhanced Contact Form Email with Inquiry Type Display
app.post("/api/send-contact-email", async (req, res) => {
  try {
    const { name, email, message, inquiryType, timestamp } = req.body

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and message are required",
      })
    }

    if (!transporter) {
      return res.status(500).json({
        success: false,
        error: "Email service not configured",
      })
    }

    console.log(
      `📧 Forwarding contact form message from ${name} (${email}) - Inquiry Type: ${formatInquiryType(inquiryType)}`,
    )

    const formattedDate = new Date(timestamp).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })

    const inquiryTypeFormatted = formatInquiryType(inquiryType)
    const inquiryTypeColor = getInquiryTypeColor(inquiryType)

    // ENHANCED: Professional Contact Form Email Template with Inquiry Type
    const mailOptions = {
      from: `"TVNET Customer Support" <${EMAIL_CONFIG.from}>`,
      to: EMAIL_CONFIG.from,
      replyTo: email,
      subject: `New ${inquiryTypeFormatted}: ${name}`,
      html: `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Customer Inquiry - ${inquiryTypeFormatted}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #334155;">
      
      <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        
        <!-- Header -->
        <div style="background: #1e293b; padding: 24px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 20px; font-weight: 600;">Customer Inquiry</h1>
          <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">Tamaraw Vision Network, Inc.</p>
        </div>

        <!-- Inquiry Type Badge -->
        <div style="padding: 16px 32px 0 32px;">
          <div style="display: inline-block; background: ${inquiryTypeColor}; color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            📋 ${inquiryTypeFormatted}
          </div>
        </div>

        <!-- Content -->
        <div style="padding: 16px 32px 32px 32px;">
          
          <!-- Customer Info -->
          <div style="margin-bottom: 32px;">
            <h2 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Customer Information</h2>
            
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: 500; color: #64748b; width: 120px;">Name:</td>
                <td style="padding: 8px 0; color: #1e293b;">${name}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: 500; color: #64748b;">Email:</td>
                <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #3b82f6; text-decoration: none;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: 500; color: #64748b;">Inquiry Type:</td>
                <td style="padding: 8px 0;">
                  <span style="background: ${inquiryTypeColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                    ${inquiryTypeFormatted}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: 500; color: #64748b;">Date:</td>
                <td style="padding: 8px 0; color: #1e293b;">${formattedDate}</td>
              </tr>
            </table>
          </div>

          <!-- Message -->
          <div style="margin-bottom: 32px;">
            <h2 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Message</h2>
            <div style="background: #f8fafc; border-left: 4px solid ${inquiryTypeColor}; padding: 16px; border-radius: 4px;">
              <p style="margin: 0; line-height: 1.6; white-space: pre-wrap; color: #374151;">${message}</p>
            </div>
          </div>

          <!-- Priority Notice (for urgent inquiry types) -->
          ${
            inquiryType === "technical-support"
              ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #dc2626; font-size: 18px;">⚠️</span>
              <strong style="color: #dc2626; font-size: 14px;">URGENT - Technical Support Request</strong>
            </div>
            <p style="margin: 8px 0 0 0; color: #7f1d1d; font-size: 13px;">This customer may be experiencing service interruption. Please prioritize this inquiry.</p>
          </div>
          `
              : ""
          }

          <!-- Action -->
          <div style="text-align: center; padding: 24px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 16px 0; color: #64748b; font-size: 14px;">To respond to this inquiry:</p>
            <a href="mailto:${email}?subject=${encodeURIComponent(`Re: ${inquiryTypeFormatted} - TVNET Response`).replace(/%20/g, " ")}" 
              style="display: inline-block; background: ${inquiryTypeColor}; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px;">
              Reply to Customer
            </a>
          </div>

        </div>

        <!-- Footer -->
        <div style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.5;">
            This email was sent from the TVNET website contact form.<br>
            <strong>TVNET</strong> • customercare.tvnet@gmail.com • 0916-594-3229
          </p>
        </div>

      </div>
      
    </body>
    </html>
  `,
      text: `
NEW CONTACT FORM SUBMISSION

Inquiry Type: ${inquiryTypeFormatted}

Customer Information:
Name: ${name}
Email: ${email}
Date: ${formattedDate}

Message:
${message}

${inquiryType === "technical-support" ? "\n⚠️ URGENT - Technical Support Request\nThis customer may be experiencing service interruption. Please prioritize this inquiry.\n" : ""}

---

To reply: Simply reply to this email or contact ${email} directly.

This message was sent through the TVNET website contact form.

TVNET • customercare.tvnet@gmail.com • 0916-594-3229
  `,
    }

    await transporter.sendMail(mailOptions)

    console.log(`✅ Professional contact form email sent successfully from ${name} - ${inquiryTypeFormatted}`)

    res.json({
      success: true,
      message: "Message sent successfully to admin",
    })
  } catch (error) {
    console.error("❌ Error forwarding contact form message:", error)
    res.status(500).json({
      success: false,
      error: "Failed to send message: " + error.message,
    })
  }
})

// Send SMS OTP endpoint using Semaphore
app.post("/api/send-sms-otp", async (req, res) => {
  try {
    const { phoneNumber, name } = req.body

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

    console.log(`✅ SMS OTP verified successfully for ${otpData.phoneNumber}`)

    res.json({
      success: true,
      message: "Phone number verified successfully",
      phoneNumber: otpData.phoneNumber,
    })
  } catch (error) {
    console.error("❌ Error verifying OTP:", error)
    res.status(500).json({
      success: false,
      error: "Failed to verify code",
    })
  }
})

// SMS notification helper function
const sendSMSNotification = async (phoneNumber, message) => {
  try {
    if (!SEMAPHORE_CONFIG.apiKey) {
      throw new Error("SMS service not configured. API key is missing.")
    }

    console.log("Sending notification SMS to:", phoneNumber)
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
      throw new Error(`SMS service error: ${textResponse}`)
    }

    if (response.ok && result) {
      console.log("Notification SMS sent successfully:", result)
      return { success: true, data: result }
    } else {
      console.error("Notification SMS sending failed:", result)
      throw new Error(result?.message || result?.error || "Failed to send SMS")
    }
  } catch (error) {
    console.error("Error sending notification SMS:", error)
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

// Server startup
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🚀 SMS & Email Backend server running on port ${PORT}`)
  console.log(`📱 SMS API available at: https://my-node-backend-production-2ebf.up.railway.app:${PORT}/api/send-sms`)
  console.log(`📧 OTP API available at: https://my-node-backend-production-2ebf.up.railway.app:${PORT}/api/send-otp`)
  console.log(
    `📮 Advisory Email API available at: https://my-node-backend-production-2ebf.up.railway.app:${PORT}/api/send-advisory-email`,
  )
  console.log(`🔔 Notification APIs available`)
  console.log(`🔑 SMS API Key configured: ${SEMAPHORE_CONFIG.apiKey ? "Yes" : "No"}`)
  console.log(`📬 Email configured: ${EMAIL_CONFIG.user && EMAIL_CONFIG.pass ? "Yes" : "No"}`)
  console.log(`🌐 Health check: https://my-node-backend-production-2ebf.up.railway.app:${PORT}/`)
  console.log(`🧪 Test endpoint: https://my-node-backend-production-2ebf.up.railway.app:${PORT}/api/test`)
})
