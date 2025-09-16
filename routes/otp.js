// const express = require('express');
// const nodemailer = require('nodemailer');
// const cors = require('cors');
// require('dotenv').config();

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Store OTP sessions (use Redis in production)
// const otpSessions = new Map();

// // Email transporter setup
// const transporter = nodemailer.createTransporter({
//   service: 'gmail', // or your email service
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS // App password for Gmail
//   }
// });

// // Send OTP endpoint
// app.post('/api/send-otp', async (req, res) => {
//   try {
//     const { email, name, type } = req.body;
    
//     // Generate 6-digit OTP
//     const otp = Math.floor(100000 + Math.random() * 900000).toString();
//     const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
//     // Store OTP session (expires in 5 minutes)
//     otpSessions.set(sessionId, {
//       otp,
//       email,
//       createdAt: Date.now(),
//       expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
//     });
    
//     // Email template
//     const mailOptions = {
//       from: process.env.EMAIL_USER,
//       to: email,
//       subject: 'Email Verification Code',
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2 style="color: #3b82f6;">Email Verification</h2>
//           <p>Hi ${name},</p>
//           <p>Thank you for registering! Please use the following verification code to complete your registration:</p>
//           <div style="background: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
//             <h1 style="color: #3b82f6; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
//           </div>
//           <p>This code will expire in 5 minutes.</p>
//           <p>If you didn't request this verification, please ignore this email.</p>
//           <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
//           <p style="color: #6b7280; font-size: 12px;">This is an automated message, please do not reply.</p>
//         </div>
//       `
//     };
    
//     await transporter.sendMail(mailOptions);
    
//     res.json({ 
//       success: true, 
//       sessionId,
//       message: 'OTP sent successfully' 
//     });
    
//   } catch (error) {
//     console.error('Error sending OTP:', error);
//     res.status(500).json({ 
//       success: false, 
//       message: 'Failed to send OTP' 
//     });
//   }
// });

// // Verify OTP endpoint
// app.post('/api/verify-otp', async (req, res) => {
//   try {
//     const { sessionId, otp, email } = req.body;
    
//     const session = otpSessions.get(sessionId);
    
//     if (!session) {
//       return res.status(400).json({ 
//         valid: false, 
//         message: 'Invalid or expired session' 
//       });
//     }
    
//     if (Date.now() > session.expiresAt) {
//       otpSessions.delete(sessionId);
//       return res.status(400).json({ 
//         valid: false, 
//         message: 'OTP has expired' 
//       });
//     }
    
//     if (session.otp !== otp || session.email !== email) {
//       return res.status(400).json({ 
//         valid: false, 
//         message: 'Invalid OTP' 
//       });
//     }
    
//     // OTP is valid, remove session
//     otpSessions.delete(sessionId);
    
//     res.json({ 
//       valid: true, 
//       message: 'OTP verified successfully' 
//     });
    
//   } catch (error) {
//     console.error('Error verifying OTP:', error);
//     res.status(500).json({ 
//       valid: false, 
//       message: 'Verification failed' 
//     });
//   }
// });

// const PORT = process.env.PORT || 3001;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });