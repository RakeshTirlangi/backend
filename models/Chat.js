const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
chatSchema.index({ participants: 1 });

// Update the updatedAt field before saving
chatSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find or create chat between two users
chatSchema.statics.findOrCreateChat = async function(user1Id, user2Id) {
  // Look for existing chat between these users
  let chat = await this.findOne({
    participants: { $all: [user1Id, user2Id], $size: 2 }
  });

  if (!chat) {
    // Create new chat
    chat = new this({
      participants: [user1Id, user2Id]
    });
    await chat.save();
  }

  return chat;
};

module.exports = mongoose.model('Chat', chatSchema);