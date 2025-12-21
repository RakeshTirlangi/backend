const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const OTP = require('../models/OTP');
const FriendRequest = require('../models/FriendRequest');
const Friend = require('../models/Friend');
const { generateOTP, sendOTP, sendPasswordResetOTP } = require('../services/emailService');

const router = express.Router();

// Helper function to validate email
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Signup endpoint - Send OTP
router.post('/signup', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    // Check for missing fields
    if (!fullName || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email already exists' 
      });
    }

    // Generate OTP
    const otp = generateOTP();

    // Hash password for temporary storage
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Delete any existing OTP for this email
    await OTP.deleteMany({ email });

    // Store OTP temporarily
    const otpRecord = new OTP({
      email,
      otp,
      fullName,
      password: hashedPassword
    });
    await otpRecord.save();

    // Send OTP email
    const emailSent = await sendOTP(email, otp, fullName);
    
    if (!emailSent) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to send OTP email' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'OTP sent to your email. Please verify to complete registration.' 
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Verify OTP (first step - just verify OTP, don't create user yet)
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Check for missing fields
    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    // Find OTP record
    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired OTP' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'OTP verified successfully. Please choose a username.' 
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Check user ID availability
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body; // Frontend still sends 'username' but we treat it as userId

    if (!username) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required' 
      });
    }

    // Validate user ID format
    const userIdRegex = /^[a-zA-Z0-9_]+$/;
    if (!userIdRegex.test(username) || username.length < 3 || username.length > 30) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID must be 3-30 characters and contain only letters, numbers, and underscores' 
      });
    }

    // Check if user ID already exists
    const existingUser = await User.findOne({ userId: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is already taken' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'User ID is available' 
    });

  } catch (error) {
    console.error('Check user ID error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Complete registration with user ID
router.post('/complete-registration', async (req, res) => {
  try {
    const { email, otp, username } = req.body; // Frontend sends 'username' but we treat it as userId

    // Check for missing fields
    if (!email || !otp || !username) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, OTP, and user ID are required' 
      });
    }

    // Validate user ID format
    const userIdRegex = /^[a-zA-Z0-9_]+$/;
    if (!userIdRegex.test(username) || username.length < 3 || username.length > 30) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID must be 3-30 characters and contain only letters, numbers, and underscores' 
      });
    }

    // Find OTP record
    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired OTP' 
      });
    }

    // Check if user ID is still available
    const existingUser = await User.findOne({ userId: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is already taken' 
      });
    }

    // Create user in database
    const user = new User({
      fullName: otpRecord.fullName,
      userId: username.toLowerCase(),
      email: otpRecord.email,
      password: otpRecord.password // Already hashed
    });

    // Save user without re-hashing password
    user.isModified = () => false; // Prevent re-hashing
    await user.save();

    // Delete OTP record
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate JWT token for the new user
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '30d' }
    );

    console.log('✅ Account created successfully for user:', user.fullName, `(@${user.userId})`);

    res.status(201).json({ 
      success: true, 
      message: 'Account created successfully!',
      token: token
    });

  } catch (error) {
    console.error('Complete registration error:', error);
    if (error.code === 11000) {
      // Duplicate key error
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is already taken' 
      });
    }
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Login endpoint - accepts User ID or Email
router.post('/login', async (req, res) => {
  console.log('🎯 LOGIN ROUTE HIT - This confirms we are in the correct endpoint');
  try {
    const { email, password } = req.body; // 'email' field can contain either email or userId

    console.log('🚀 LOGIN REQUEST RECEIVED');
    console.log('📧 Raw input:', email);
    console.log('🔑 Password provided:', !!password);

    // Check for missing fields
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'CUSTOM LOGIN ERROR: User ID/Email and password are required' 
      });
    }

    let user = null;
    const loginInput = email.trim().toLowerCase();
    console.log('🔍 Processed input:', loginInput);

    // Determine if input is email or userId
    if (isValidEmail(loginInput)) {
      // Input is an email
      console.log('🔍 Login attempt with email:', loginInput);
      user = await User.findOne({ email: loginInput });
    } else {
      // Input is a userId
      console.log('🔍 Login attempt with user ID:', loginInput);
      user = await User.findOne({ userId: loginInput });
    }

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '30d' }
    );

    console.log('✅ Login successful for user:', user.fullName, `(@${user.userId})`);

    res.json({ 
      success: true, 
      message: 'Login successful',
      token 
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Check for missing email
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'No account found with this email address' 
      });
    }

    // Generate OTP for password reset
    const otp = generateOTP();

    // Delete any existing password reset OTP for this email
    await OTP.deleteMany({ email, type: 'password-reset' });

    // Store OTP for password reset (different from signup OTP)
    const otpRecord = new OTP({
      email,
      otp,
      fullName: user.fullName,
      password: '', // Not needed for password reset
      type: 'password-reset' // Add type to distinguish from signup OTP
    });
    await otpRecord.save();

    // Send OTP email for password reset
    const emailSent = await sendPasswordResetOTP(email, otp, user.fullName);
    
    if (!emailSent) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to send password reset email' 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Password reset code sent to your email' 
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Verify Password Reset OTP
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Check for missing fields
    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and OTP are required' 
      });
    }

    // Find password reset OTP record
    const otpRecord = await OTP.findOne({ 
      email, 
      otp, 
      type: 'password-reset' 
    });
    
    if (!otpRecord) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired OTP' 
      });
    }

    // OTP is valid, but don't delete it yet (needed for password reset)
    res.status(200).json({ 
      success: true, 
      message: 'OTP verified successfully. You can now reset your password.' 
    });

  } catch (error) {
    console.error('Password reset OTP verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Check for missing fields
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, OTP, and new password are required' 
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Find and verify password reset OTP record
    const otpRecord = await OTP.findOne({ 
      email, 
      otp, 
      type: 'password-reset' 
    });
    
    if (!otpRecord) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired OTP' 
      });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Update user password (will be hashed by the pre-save middleware)
    user.password = newPassword;
    await user.save();

    // Delete the password reset OTP record
    await OTP.deleteOne({ _id: otpRecord._id });

    res.status(200).json({ 
      success: true, 
      message: 'Password reset successfully' 
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access denied. No token provided.' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};

// Get User Profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    // Find user by ID from token (excluding password)
    const user = await User.findById(req.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({ 
      success: true, 
      user: {
        id: user._id,
        fullName: user.fullName,
        userId: user.userId,
        email: user.email,
        dateOfBirth: user.dateOfBirth,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Logout endpoint (clears token on client side)
router.post('/logout', (req, res) => {
  // Since JWT tokens are stateless, we just send a success response
  // The client should clear the token from storage
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
});

// Get All Users with pagination and search
router.get('/users', verifyToken, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    
    // Parse pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;
    
    console.log(`👥 Fetching users - Page: ${pageNum}, Limit: ${limitNum}, Search: "${search || 'none'}"`);
    
    // Build search query - exclude current user and optionally filter by search term
    let query = { _id: { $ne: req.userId } }; // Exclude current user
    
    if (search && search.trim()) {
      // Search by full name, user ID, or email (case insensitive)
      query.$or = [
        { fullName: { $regex: search.trim(), $options: 'i' } },
        { userId: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // Get total count for pagination info
    const totalUsers = await User.countDocuments(query);
    
    // Find users with pagination (excluding password field)
    const users = await User.find(query)
      .select('-password')
      .sort({ fullName: 1 }) // Sort by name alphabetically
      .skip(skip)
      .limit(limitNum);

    // Get friends count for each user using the same method as profile screen
    const transformedUsers = await Promise.all(users.map(async (user) => {
      // Use the same Friend.getFriends method that works in profile screen
      const friends = await Friend.getFriends(user._id);
      const friendsCount = friends.length;

      return {
        id: user._id,
        fullName: user.fullName, // Use consistent naming
        userId: user.userId, // Use consistent naming
        email: user.email,
        avatar: user.fullName.charAt(0), // First letter of name as avatar
        isOnline: false, // For now, set all as offline (can be enhanced later)
        createdAt: user.createdAt,
        friendsCount: friendsCount
      };
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(totalUsers / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({ 
      success: true, 
      users: transformedUsers,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalUsers,
        hasNextPage,
        hasPrevPage,
        limit: limitNum
      },
      count: transformedUsers.length // For backward compatibility
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Test endpoint to verify PUT route is working
router.put('/profile/test', (req, res) => {
  console.log('🧪 PUT /profile/test route hit');
  res.json({ success: true, message: 'PUT route is working!' });
});

// Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  console.log('🎯 PUT /profile route hit');
  console.log('📝 Request body:', req.body);
  try {
    const { fullName, userId, dateOfBirth } = req.body;
    
    // Validate input
    if (!fullName || fullName.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Full name is required' 
      });
    }

    // Validate userId if provided
    if (userId) {
      const userIdRegex = /^[a-zA-Z0-9_]+$/;
      if (!userIdRegex.test(userId) || userId.length < 3 || userId.length > 30) {
        return res.status(400).json({ 
          success: false, 
          message: 'User ID must be 3-30 characters and contain only letters, numbers, and underscores' 
        });
      }

      // Check if userId is already taken by another user
      const existingUser = await User.findOne({ 
        userId: userId.toLowerCase(),
        _id: { $ne: req.userId } // Exclude current user
      });
      
      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: 'User ID is already taken' 
        });
      }
    }

    // Validate date of birth if provided
    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid date of birth format' 
        });
      }
      
      // Check if user is at least 13 years old
      const today = new Date();
      const age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      
      if (age < 13 || (age === 13 && monthDiff < 0) || 
          (age === 13 && monthDiff === 0 && today.getDate() < dob.getDate())) {
        return res.status(400).json({ 
          success: false, 
          message: 'You must be at least 13 years old' 
        });
      }
    }

    // Update user profile
    const updateData = {
      fullName: fullName.trim(),
      ...(userId && { userId: userId.toLowerCase() }),
      ...(dateOfBirth && { dateOfBirth: new Date(dateOfBirth) })
    };

    console.log('📝 Update data to be applied:', updateData);
    console.log('👤 Updating user with ID:', req.userId);

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console.log('✅ Profile updated successfully for user:', updatedUser.fullName);
    console.log('🆔 Updated userId:', updatedUser.userId);
    console.log('📧 Updated email:', updatedUser.email);

    res.json({ 
      success: true, 
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        fullName: updatedUser.fullName,
        userId: updatedUser.userId,
        email: updatedUser.email,
        dateOfBirth: updatedUser.dateOfBirth,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// ==================== FRIEND REQUEST ENDPOINTS ====================

// Send friend request
router.post('/friend-request', verifyToken, async (req, res) => {
  try {
    const { receiverId, message = '' } = req.body;
    const senderId = req.userId;

    console.log('👥 Friend request - Sender:', senderId, 'Receiver:', receiverId);

    // Validate input
    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID is required'
      });
    }

    // Check if receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is trying to send request to themselves
    if (senderId === receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send friend request to yourself'
      });
    }

    // Check if friend request already exists
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId }
      ]
    });

    if (existingRequest) {
      if (existingRequest.sender.toString() === senderId) {
        return res.status(400).json({
          success: false,
          message: 'Friend request already sent'
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'This user has already sent you a friend request'
        });
      }
    }

    // Create new friend request
    const friendRequest = new FriendRequest({
      sender: senderId,
      receiver: receiverId,
      message: message.trim(),
      status: 'pending'
    });

    await friendRequest.save();

    console.log('✅ Friend request created successfully');

    res.status(201).json({
      success: true,
      message: 'Friend request sent successfully',
      friendRequest: {
        id: friendRequest._id,
        sender: senderId,
        receiver: receiverId,
        message: friendRequest.message,
        status: friendRequest.status,
        createdAt: friendRequest.createdAt
      }
    });

  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get relationship status with another user
router.get('/relationship-status/:userId', verifyToken, async (req, res) => {
  try {
    const currentUserId = req.userId;
    const otherUserId = req.params.userId;

    console.log('🔍 Checking relationship status between:', currentUserId, 'and', otherUserId);

    // Import Friend model
    const Friend = require('../models/Friend');

    // First check if they are already friends
    const areFriends = await Friend.areFriends(currentUserId, otherUserId);
    
    let relationshipStatus = 'none';

    if (areFriends) {
      relationshipStatus = 'friends';
    } else {
      // Check if there's a pending friend request between these users
      const friendRequest = await FriendRequest.findOne({
        $or: [
          { sender: currentUserId, receiver: otherUserId },
          { sender: otherUserId, receiver: currentUserId }
        ],
        status: 'pending' // Only check pending requests
      });

      if (friendRequest) {
        if (friendRequest.sender.toString() === currentUserId) {
          relationshipStatus = 'request_sent';
        } else {
          relationshipStatus = 'request_received';
        }
      }
    }

    console.log('✅ Relationship status:', relationshipStatus);

    // Only include friendRequest data if there's a pending request
    const responseData = {
      success: true,
      relationshipStatus: relationshipStatus
    };

    // Add friendRequest data only if it exists and is pending
    if (relationshipStatus === 'request_sent' || relationshipStatus === 'request_received') {
      const friendRequest = await FriendRequest.findOne({
        $or: [
          { sender: currentUserId, receiver: otherUserId },
          { sender: otherUserId, receiver: currentUserId }
        ],
        status: 'pending'
      });

      if (friendRequest) {
        responseData.friendRequest = {
          id: friendRequest._id,
          status: friendRequest.status,
          createdAt: friendRequest.createdAt
        };
      }
    }

    res.json(responseData);

  } catch (error) {
    console.error('Get relationship status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get sent friend requests
router.get('/sent-friend-requests', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;

    console.log('📤 Getting sent friend requests for user:', userId);

    // Find all pending friend requests sent by this user
    const sentRequests = await FriendRequest.find({
      sender: userId,
      status: 'pending'
    })
    .populate('receiver', 'fullName userId email')
    .sort({ createdAt: -1 }); // Most recent first

    console.log('✅ Found', sentRequests.length, 'sent friend requests');

    // Transform the data for frontend
    const transformedRequests = sentRequests.map(request => ({
      id: request._id,
      receiver: {
        id: request.receiver._id,
        fullName: request.receiver.fullName,
        userId: request.receiver.userId,
        email: request.receiver.email,
        avatar: request.receiver.fullName.charAt(0).toUpperCase()
      },
      message: request.message,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    }));

    res.json({
      success: true,
      requests: transformedRequests,
      count: transformedRequests.length
    });

  } catch (error) {
    console.error('Get sent friend requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get received friend requests
router.get('/received-friend-requests', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;

    console.log('📥 Getting received friend requests for user:', userId);

    // Find all pending friend requests received by this user
    const receivedRequests = await FriendRequest.find({
      receiver: userId,
      status: 'pending'
    })
    .populate('sender', 'fullName userId email')
    .sort({ createdAt: -1 }); // Most recent first

    console.log('✅ Found', receivedRequests.length, 'received friend requests');

    // Transform the data for frontend
    const transformedRequests = receivedRequests.map(request => ({
      id: request._id,
      sender: {
        id: request.sender._id,
        fullName: request.sender.fullName,
        userId: request.sender.userId,
        email: request.sender.email,
        avatar: request.sender.fullName.charAt(0).toUpperCase()
      },
      message: request.message,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    }));

    res.json({
      success: true,
      requests: transformedRequests,
      count: transformedRequests.length
    });

  } catch (error) {
    console.error('Get received friend requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Accept friend request
router.post('/accept-friend-request/:requestId', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const requestId = req.params.requestId;

    console.log('✅ Accepting friend request:', requestId, 'by user:', userId);

    // Find the friend request
    const friendRequest = await FriendRequest.findById(requestId);

    if (!friendRequest) {
      return res.status(404).json({
        success: false,
        message: 'Friend request not found'
      });
    }

    // Verify that the current user is the receiver of this request
    if (friendRequest.receiver.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only accept requests sent to you'
      });
    }

    // Check if request is still pending
    if (friendRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This friend request is no longer pending'
      });
    }

    // Import Friend model
    const Friend = require('../models/Friend');

    // Check if they're already friends (shouldn't happen, but safety check)
    const alreadyFriends = await Friend.areFriends(friendRequest.sender, friendRequest.receiver);
    if (alreadyFriends) {
      return res.status(400).json({
        success: false,
        message: 'You are already friends with this user'
      });
    }

    // Create friendship (always put smaller ObjectId first for consistency)
    const user1 = friendRequest.sender.toString() < friendRequest.receiver.toString() 
      ? friendRequest.sender 
      : friendRequest.receiver;
    const user2 = friendRequest.sender.toString() < friendRequest.receiver.toString() 
      ? friendRequest.receiver 
      : friendRequest.sender;

    const friendship = new Friend({
      user1: user1,
      user2: user2
    });

    await friendship.save();

    // Update friend request status to accepted
    friendRequest.status = 'accepted';
    friendRequest.updatedAt = new Date();
    await friendRequest.save();

    console.log('✅ Friend request accepted and friendship created');

    res.json({
      success: true,
      message: 'Friend request accepted successfully',
      friendship: {
        id: friendship._id,
        createdAt: friendship.createdAt
      }
    });

  } catch (error) {
    console.error('Accept friend request error:', error);
    
    // Handle duplicate friendship error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You are already friends with this user'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Cancel friend request
router.delete('/friend-request/:requestId', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const requestId = req.params.requestId;

    console.log('🚫 Cancelling friend request:', requestId, 'by user:', userId);

    // Find the friend request
    const friendRequest = await FriendRequest.findById(requestId);

    if (!friendRequest) {
      return res.status(404).json({
        success: false,
        message: 'Friend request not found'
      });
    }

    // Check if the current user is the sender of this request
    if (friendRequest.sender.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own friend requests'
      });
    }

    // Check if the request is still pending
    if (friendRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Can only cancel pending friend requests'
      });
    }

    // Delete the friend request
    await FriendRequest.findByIdAndDelete(requestId);

    console.log('✅ Friend request cancelled successfully');

    res.json({
      success: true,
      message: 'Friend request cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel friend request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get friends list
router.get('/friends', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;

    console.log('👥 Getting friends list for user:', userId);

    // Import Friend model
    const Friend = require('../models/Friend');

    // Get all friends of the user
    const friends = await Friend.getFriends(userId);

    console.log('✅ Found', friends.length, 'friends');

    // Transform the data for frontend
    const transformedFriends = friends.map(friend => ({
      id: friend._id,
      fullName: friend.fullName,
      userId: friend.userId,
      email: friend.email,
      avatar: friend.fullName.charAt(0).toUpperCase(),
      isOnline: false // TODO: Add online status later
    }));

    res.json({
      success: true,
      friends: transformedFriends,
      count: transformedFriends.length
    });

  } catch (error) {
    console.error('Get friends list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;