// due-date-reminder.js - Separate cron job file
const cron = require('node-cron');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
require('dotenv').config();

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

// Your backend API URL
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Helper functions
function getSubscriberName(payment) {
  if (payment.companyName) {
    return payment.companyName;
  }
  const first = payment.firstName || '';
  const middle = payment.middleName || '';
  const last = payment.lastName || '';
  return [last, first, middle].filter(Boolean).join(' ').trim() || 'Unknown';
}

function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}

function formatReadableDate(date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

async function sendSMSReminder(endpoint, data) {
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

// Main function to check and send due date reminders
async function checkDueDateReminders() {
  try {
    console.log('🔔 Starting due date reminder check at:', new Date().toISOString());
    
    const today = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(today.getDate() + 3);

    // Get global penalty setting
    let globalPenalty = 0;
    try {
      const penaltyDoc = await db.collection('settings').doc('penalty').get();
      globalPenalty = penaltyDoc.exists() ? penaltyDoc.data().value : 0;
    } catch (err) {
      console.warn('Could not fetch penalty setting, using 0');
    }

    // Get all approved payments with due dates
    const receiptsSnapshot = await db.collection('receipts')
      .where('status', '==', 'approved')
      .get();

    if (receiptsSnapshot.empty) {
      console.log('No approved payments found');
      return;
    }

    let threeDayReminders = 0;
    let dueTodayReminders = 0;
    let overdueNotices = 0;
    let errors = 0;

    for (const docSnap of receiptsSnapshot.docs) {
      const payment = { id: docSnap.id, ...docSnap.data() };
      
      // Skip if no due date or contact number
      if (!payment.dueDate || !payment.contactNumber) {
        continue;
      }

      const dueDate = payment.dueDate.toDate();
      const subscriberName = getSubscriberName(payment);
      const amount = payment.selectedPlan?.price || payment.amount || 0;
      const dueDateString = formatReadableDate(dueDate);

      // Calculate penalty for overdue payments
      const penalty = dueDate < today ? globalPenalty : 0;

      const messageData = {
        phoneNumber: payment.contactNumber,
        applicantName: subscriberName,
        dueDate: dueDateString,
        amount: amount,
        penalty: penalty
      };

      try {
        // 3-day reminder
        if (isSameDay(dueDate, threeDaysFromNow)) {
          console.log(`Sending 3-day reminder to ${subscriberName} (${payment.contactNumber})`);
          await sendSMSReminder('/api/notify-due-date-reminder-3-days', messageData);
          threeDayReminders++;
        }
        // Due today reminder
        else if (isSameDay(dueDate, today)) {
          console.log(`Sending due today reminder to ${subscriberName} (${payment.contactNumber})`);
          await sendSMSReminder('/api/notify-due-date-reminder', messageData);
          dueTodayReminders++;
        }
        // Overdue notice (3+ days past due)
        else if (dueDate < today) {
          const daysPastDue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
          if (daysPastDue >= 3) {
            console.log(`Sending overdue notice to ${subscriberName} (${payment.contactNumber}) - ${daysPastDue} days overdue`);
            await sendSMSReminder('/api/notify-disconnection-notice', messageData);
            overdueNotices++;
          }
        }

        // Add delay between SMS to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (smsError) {
        console.error(`Failed to send SMS to ${payment.contactNumber}:`, smsError);
        errors++;
      }
    }

    console.log('📊 Due date reminder summary:');
    console.log(`   3-day reminders sent: ${threeDayReminders}`);
    console.log(`   Due today reminders sent: ${dueTodayReminders}`);
    console.log(`   Overdue notices sent: ${overdueNotices}`);
    console.log(`   Errors: ${errors}`);
    console.log('✅ Due date reminder check completed at:', new Date().toISOString());

  } catch (error) {
    console.error('❌ Error in due date reminder check:', error);
  }
}

// Schedule cron jobs
console.log('🚀 Due Date Reminder Service Starting...');

// Run every day at 9:00 AM
cron.schedule('0 9 * * *', () => {
  console.log('🕘 Running scheduled due date reminder check...');
  checkDueDateReminders();
});

// Optional: Run every day at 6:00 PM for overdue notices
cron.schedule('0 18 * * *', () => {
  console.log('🕘 Running evening overdue check...');
  checkDueDateReminders();
});

console.log('📅 Cron jobs scheduled:');
console.log('   - 9:00 AM daily: Due date reminders');
console.log('   - 6:00 PM daily: Overdue notices');
console.log('⏰ Service is now running...');

// Manual trigger for testing
console.log('🧪 For manual testing, you can call: POST /api/check-due-date-reminders');

// Keep the process running
process.on('SIGINT', () => {
  console.log('👋 Due Date Reminder Service shutting down...');
  process.exit(0);
});