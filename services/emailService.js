const sgMail = require('@sendgrid/mail');
require('dotenv').config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Generate 5-digit OTP
const generateOTP = () => {
  return Math.floor(10000 + Math.random() * 90000).toString();
};

// Send OTP email
const sendOTP = async (email, otp, fullName) => {
  const msg = {
    to: email,
    from: process.env.EMAIL_FROM,
    subject: 'Foru - Verify Your Email',
    text: `Hi ${fullName},\n\nYour verification code is: ${otp}\n\nThis code will expire in 5 minutes.\n\nBest regards,\nForu Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ec4899; margin: 0;">Foru 😊</h1>
          <p style="color: #666; margin: 5px 0;">Connect & Chat</p>
        </div>
        
        <div style="background: #f9fafb; padding: 30px; border-radius: 10px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 20px;">Verify Your Email</h2>
          <p style="color: #666; margin-bottom: 30px;">Hi ${fullName},</p>
          <p style="color: #666; margin-bottom: 30px;">Your verification code is:</p>
          
          <div style="background: linear-gradient(135deg, #ec4899, #8b5cf6); color: white; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 8px; letter-spacing: 5px; margin: 20px 0;">
            ${otp}
          </div>
          
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            This code will expire in <strong>5 minutes</strong>
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
          <p>This email was sent from Foru. Please do not reply to this email.</p>
        </div>
      </div>
    `
  };

  try {
    await sgMail.send(msg);
    console.log(`OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Email sending failed:', error);
    return false;
  }
};

// Send Password Reset OTP email
const sendPasswordResetOTP = async (email, otp, fullName) => {
  const msg = {
    to: email,
    from: process.env.EMAIL_FROM,
    subject: 'Foru - Reset Your Password',
    text: `Hi ${fullName},\n\nYour password reset code is: ${otp}\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this, please ignore this email.\n\nBest regards,\nForu Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ec4899; margin: 0;">Foru 😊</h1>
          <p style="color: #666; margin: 5px 0;">Connect & Chat</p>
        </div>
        
        <div style="background: #f9fafb; padding: 30px; border-radius: 10px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 20px;">Reset Your Password</h2>
          <p style="color: #666; margin-bottom: 30px;">Hi ${fullName},</p>
          <p style="color: #666; margin-bottom: 30px;">Your password reset code is:</p>
          
          <div style="background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 8px; letter-spacing: 5px; margin: 20px 0;">
            ${otp}
          </div>
          
          <p style="color: #666; font-size: 14px; margin-top: 30px;">
            This code will expire in <strong>5 minutes</strong>
          </p>
          
          <p style="color: #999; font-size: 12px; margin-top: 20px;">
            If you didn't request this password reset, please ignore this email.
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
          <p>This email was sent from Foru. Please do not reply to this email.</p>
        </div>
      </div>
    `
  };

  try {
    await sgMail.send(msg);
    console.log(`Password reset OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Password reset email sending failed:', error);
    return false;
  }
};

module.exports = {
  generateOTP,
  sendOTP,
  sendPasswordResetOTP
};