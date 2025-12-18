const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  otp: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: false // Not required for password reset OTPs
  },
  userId: {
    type: String,
    required: false // Will be added after OTP verification
  },
  type: {
    type: String,
    enum: ['signup', 'password-reset'],
    default: 'signup'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // Expires after 5 minutes (300 seconds)
  }
});

module.exports = mongoose.model('OTP', otpSchema);