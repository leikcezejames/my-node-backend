// Alternative: Firebase Cloud Functions approach
const functions = require("firebase-functions")
const fetch = require("node-fetch")

// Semaphore configuration
const SEMAPHORE_CONFIG = {
  apiKey: functions.config().semaphore.api_key, // Set via: firebase functions:config:set semaphore.api_key="YOUR_API_KEY"
  baseUrl: "https://api.semaphore.co/api/v4/messages",
  senderName: functions.config().semaphore.sender_name || "SEMAPHORE",
}

exports.sendSMS = functions.https.onCall(async (data, context) => {
  try {
    const { phoneNumber, message } = data

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

    const result = await response.json()

    if (response.ok) {
      console.log("SMS sent successfully:", result)
      return { success: true, data: result }
    } else {
      console.error("SMS sending failed:", result)
      throw new functions.https.HttpsError("internal", result.message || "Failed to send SMS")
    }
  } catch (error) {
    console.error("Error sending SMS:", error)
    throw new functions.https.HttpsError("internal", error.message)
  }
})
