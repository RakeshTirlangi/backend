const mongoose = require('mongoose');

const friendSchema = new mongoose.Schema({
  user1: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  user2: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure unique friendship (prevent duplicates)
friendSchema.index({ user1: 1, user2: 1 }, { unique: true });

// Helper method to check if two users are friends
friendSchema.statics.areFriends = async function(userId1, userId2) {
  const friendship = await this.findOne({
    $or: [
      { user1: userId1, user2: userId2 },
      { user1: userId2, user2: userId1 }
    ]
  });
  return !!friendship;
};

// Helper method to get all friends of a user
friendSchema.statics.getFriends = async function(userId) {
  const friendships = await this.find({
    $or: [
      { user1: userId },
      { user2: userId }
    ]
  }).populate('user1 user2', 'fullName userId email');

  // Return the other user in each friendship
  return friendships.map(friendship => {
    return friendship.user1._id.toString() === userId.toString() 
      ? friendship.user2 
      : friendship.user1;
  });
};

module.exports = mongoose.model('Friend', friendSchema);