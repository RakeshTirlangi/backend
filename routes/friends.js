const express = require('express');
const User = require('../models/User');
const Friend = require('../models/Friend');
const auth = require('../middleware/auth');

const router = express.Router();

// Search users by username or name
router.get('/search', auth, async (req, res) => {
  try {
    const { query } = req.query;
    const currentUserId = req.user.userId;

    if (!query || query.trim().length < 2) {
      return res.json({
        success: true,
        users: []
      });
    }

    // Search users by userId or fullName (case-insensitive)
    const searchRegex = new RegExp(query.trim(), 'i');
    
    const users = await User.find({
      _id: { $ne: currentUserId }, // Exclude current user
      $or: [
        { userId: searchRegex },
        { fullName: searchRegex }
      ]
    })
    .select('_id userId fullName email')
    .limit(20);

    // Format users for response with friends count using same method as profile screen
    const usersWithStatus = await Promise.all(users.map(async (user) => {
      // Use the same Friend.getFriends method that works in profile screen
      const friends = await Friend.getFriends(user._id);
      const friendsCount = friends.length;

      return {
        id: user._id,
        userId: user.userId,
        name: user.fullName,
        email: user.email,
        relationshipStatus: 'none', // Always none since we removed friend requests
        friendsCount: friendsCount
      };
    }));

    res.json({
      success: true,
      users: usersWithStatus
    });

  } catch (error) {
    console.error('❌ Error searching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users'
    });
  }
});

module.exports = router;