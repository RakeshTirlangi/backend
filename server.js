const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const friendsRoutes = require('./routes/friends');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Parse JSON bodies

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/friends', friendsRoutes);

// Simple HTTP message sending endpoint (fallback for WebSocket)
app.post('/api/messages/send', async (req, res) => {
  try {
    // Extract token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const senderId = decoded.userId;

    const { receiverId, content } = req.body;

    console.log(`📤 HTTP message from ${senderId} to ${receiverId}: "${content}"`);

    // Basic validation
    if (!receiverId || !content) {
      return res.status(400).json({ success: false, message: 'Receiver ID and content are required' });
    }

    // Find or create chat between sender and receiver
    const chat = await Chat.findOrCreateChat(senderId, receiverId);

    // Create and save message
    const message = new Message({
      chatId: chat._id,
      sender: senderId,
      receiver: receiverId,
      content: content.trim()
    });

    await message.save();
    
    console.log(`✅ HTTP message saved to database - Chat: ${chat._id}`);

    res.json({
      success: true,
      message: 'Message sent successfully',
      messageId: message._id,
      chatId: chat._id
    });

  } catch (error) {
    console.error('❌ HTTP message error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// Delivery acknowledgment endpoint - Enhanced for better reliability
app.post('/api/messages/:id/delivered', async (req, res) => {
  try {
    // Extract token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const messageId = req.params.id;

    console.log(`📦 Manual delivery acknowledgment for message: ${messageId} by user: ${userId}`);

    // ✅ FIX: Only update if message is still in 'sent' status (avoid overwriting 'read' status)
    const updatedMessage = await Message.findOneAndUpdate(
      {
        _id: messageId,
        status: 'sent' // Only update if still in sent status
      },
      {
        status: 'delivered',
        deliveredAt: new Date()
      },
      { new: true }
    );

    if (!updatedMessage) {
      // Message might already be delivered or read, or doesn't exist
      const existingMessage = await Message.findById(messageId);
      if (!existingMessage) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }
      
      console.log(`📦 Message ${messageId} already has status: ${existingMessage.status}`);
      return res.json({
        success: true,
        message: 'Message status already updated',
        messageId: messageId,
        currentStatus: existingMessage.status
      });
    }

    // Notify sender about delivery status change
    const senderSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.userId === updatedMessage.sender.toString());

    if (senderSocket) {
      senderSocket.emit('message_delivered', {
        messageId: messageId,
        status: 'delivered',
        deliveredAt: updatedMessage.deliveredAt.toISOString()
      });
      console.log(`✅ Delivery status sent to sender: ${updatedMessage.sender}`);
    } else {
      console.log(`📱 Sender not online to receive delivery notification`);
    }

    res.json({
      success: true,
      message: 'Message marked as delivered',
      messageId: messageId,
      status: 'delivered'
    });

  } catch (error) {
    console.error('❌ Delivery acknowledgment error:', error);
    res.status(500).json({ success: false, message: 'Failed to acknowledge delivery' });
  }
});

// Get user's chats with last message info
app.get('/api/chats', async (req, res) => {
  try {
    // Extract token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    console.log(`📥 Getting chats for user: ${userId}`);

    // Find all chats where user is a participant
    const chats = await Chat.find({
      participants: userId
    }).populate('participants', 'fullName userId email');

    // Get last message for each chat
    const chatsWithMessages = await Promise.all(
      chats.map(async (chat) => {
        // Get the other participant (not current user)
        const otherParticipant = chat.participants.find(p => p._id.toString() !== userId);
        
        // Get last message for this chat
        const lastMessage = await Message.findOne({ chatId: chat._id })
          .sort({ timestamp: -1 })
          .populate('sender', 'fullName userId');

        return {
          id: chat._id.toString(),
          participant: otherParticipant ? {
            id: otherParticipant._id.toString(),
            name: otherParticipant.fullName,
            userId: otherParticipant.userId,
            avatar: otherParticipant.fullName.charAt(0).toUpperCase(),
            isOnline: false
          } : null,
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp,
            senderId: lastMessage.sender._id.toString(),
            senderName: lastMessage.sender.fullName
          } : null,
          updatedAt: chat.updatedAt
        };
      })
    );

    // Filter out chats without participants and sort by last activity
    const validChats = chatsWithMessages
      .filter(chat => chat.participant !== null)
      .sort((a, b) => {
        const aTime = a.lastMessage ? new Date(a.lastMessage.timestamp) : new Date(a.updatedAt);
        const bTime = b.lastMessage ? new Date(b.lastMessage.timestamp) : new Date(b.updatedAt);
        return bTime - aTime;
      });

    console.log(`✅ Found ${validChats.length} chats for user`);

    res.json({
      success: true,
      chats: validChats
    });

  } catch (error) {
    console.error('❌ Get chats error:', error);
    res.status(500).json({ success: false, message: 'Failed to get chats' });
  }
});

// Get messages for a specific chat
app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    // Extract token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const chatId = req.params.chatId;

    console.log(`📥 Getting messages for chat: ${chatId}, user: ${userId}`);

    // Verify user is participant in this chat
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ success: false, message: 'Access denied to this chat' });
    }

    // Get messages for this chat
    const messages = await Message.find({ chatId: chatId })
      .populate('sender', 'fullName userId')
      .sort({ timestamp: 1 }); // Oldest first

    // Format messages for frontend
    const formattedMessages = messages.map(message => {
      const isMe = message.sender._id.toString() === userId;
      
      return {
        id: message._id.toString(),
        content: message.content,
        senderId: message.sender._id.toString(),
        senderName: message.sender.fullName,
        timestamp: message.timestamp,
        isMe: isMe,
        messageType: 'text',
        chatId: chatId,
        // Include read status from database
        isRead: message.isRead || false,
        readAt: message.readAt,
      };
    });

    console.log(`✅ Found ${formattedMessages.length} messages for chat ${chatId}`);

    res.json({
      success: true,
      messages: formattedMessages,
      hasMore: false
    });

  } catch (error) {
    console.error('❌ Get messages error:', error);
    res.status(500).json({ success: false, message: 'Failed to get messages' });
  }
});

// Create or get chat between two users
app.post('/api/chats/create', async (req, res) => {
  try {
    // Extract token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;
    const { participantId } = req.body;

    console.log(`💬 Creating/getting chat between ${userId} and ${participantId}`);

    if (!participantId) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }

    // Find or create chat between these users
    const chat = await Chat.findOrCreateChat(userId, participantId);
    
    // Get the other participant info
    const otherUser = await User.findById(participantId).select('fullName userId email');
    
    console.log(`✅ Chat found/created: ${chat._id}`);

    res.json({
      success: true,
      chat: {
        id: chat._id.toString(),
        participant: {
          id: otherUser._id.toString(),
          name: otherUser.fullName,
          userId: otherUser.userId,
          avatar: otherUser.fullName.charAt(0).toUpperCase(),
          isOnline: false
        },
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Create chat error:', error);
    res.status(500).json({ success: false, message: 'Failed to create chat' });
  }
});

// Get online status endpoint
app.get('/api/users/:userId/status', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Check if user is in online users set
    const isOnline = global.onlineUsers ? global.onlineUsers.has(userId) : false;
    
    res.json({
      success: true,
      userId: userId,
      status: isOnline ? 'online' : 'offline',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Get user status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user status' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    console.log('🔐 WebSocket authentication attempt...');
    const token = socket.handshake.auth.token;
    
    if (!token) {
      console.log('❌ No token provided in WebSocket auth');
      return next(new Error('Authentication error: No token provided'));
    }

    console.log('🔑 Token received:', token.substring(0, 20) + '...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token decoded successfully, userId:', decoded.userId);
    
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      console.log('❌ User not found for ID:', decoded.userId);
      return next(new Error('User not found - please login again'));
    }

    socket.userId = user._id.toString();
    socket.userInfo = {
      id: user._id.toString(),
      fullName: user.fullName,
      userId: user.userId
    };
    
    console.log('✅ WebSocket authentication successful for:', user.fullName);
    next();
  } catch (error) {
    console.log('❌ WebSocket authentication error:', error.message);
    next(new Error('Authentication error: ' + error.message));
  }
});

// ✅ ENHANCED: Helper function when user comes online (simplified)
async function _updateUserOnlineStatus(userId) {
  try {
    console.log(`📦 User ${userId} came online`);
    // Store online users in memory (simple approach)
    if (!global.onlineUsers) {
      global.onlineUsers = new Set();
    }
    global.onlineUsers.add(userId);
    
    // Broadcast online status to other connected users
    io.emit('user_online', {
      userId: userId,
      status: 'online',
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ User online status updated for: ${userId}`);
  } catch (error) {
    console.error('❌ Error updating user online status:', error);
  }
}

// Helper function when user goes offline
async function _updateUserOfflineStatus(userId) {
  try {
    console.log(`📦 User ${userId} went offline`);
    // Remove from online users
    if (global.onlineUsers) {
      global.onlineUsers.delete(userId);
    }
    
    // Broadcast offline status to other connected users
    io.emit('user_offline', {
      userId: userId,
      status: 'offline',
      timestamp: new Date().toISOString()
    });
    
    console.log(`✅ User offline status updated for: ${userId}`);
  } catch (error) {
    console.error('❌ Error updating user offline status:', error);
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.userInfo.fullName} (${socket.userId})`);

  // ✅ ENHANCED: Update user status when they connect
  // This runs every time user connects/reconnects
  setTimeout(() => {
    _updateUserOnlineStatus(socket.userId);
  }, 1000); // Small delay to ensure connection is stable

  // Test connection handler
  socket.on('test_connection', (data) => {
    console.log(`🧪 Test connection from ${socket.userInfo.fullName}:`, data);
    socket.emit('test_response', { message: 'Connection test successful!' });
  });

  // Handle sending messages - WITH REAL-TIME DELIVERY
  socket.on('send_message', async (data) => {
    try {
      const { receiverId, content } = data;

      console.log(`📤 User ${socket.userInfo.fullName} sending message to: ${receiverId}`);

      // Basic validation
      if (!receiverId || !content) {
        console.log('❌ Invalid message data');
        return;
      }

      // Find or create chat between sender and receiver
      const chat = await Chat.findOrCreateChat(socket.userId, receiverId);

      // Create and save message with initial status
      const message = new Message({
        chatId: chat._id,
        sender: socket.userId,
        receiver: receiverId,
        content: content.trim(),
        status: 'sent'
      });

      await message.save();
      
      // Populate sender info for real-time delivery
      await message.populate('sender', 'fullName userId');
      
      console.log(`✅ Message saved to database - Chat: ${chat._id}`);

      // Send confirmation back to sender
      socket.emit('message_sent', {
        success: true,
        messageId: message._id,
        chatId: chat._id,
        content: message.content, // Add content for temp ID mapping
        timestamp: message.timestamp.toISOString() // Add timestamp for proper sorting
      });
      
      // Emit global chat update for sender's chat list
      socket.emit('chat_updated', {
        type: 'new_message',
        chatId: chat._id.toString(),
        senderId: socket.userId,
        senderName: socket.userInfo.fullName,
        lastMessage: message.content,
        timestamp: message.timestamp.toISOString()
      });
      // Find receiver's socket and send message in real-time
      const receiverSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.userId === receiverId);

      if (receiverSocket) {
        console.log(`📥 Delivering message to receiver: ${receiverId}`);
        
        const messageData = {
          id: message._id.toString(),
          content: message.content,
          senderId: socket.userId,
          senderName: socket.userInfo.fullName,
          // Send timestamp in ISO format with UTC timezone for consistency
          timestamp: message.timestamp.toISOString(),
          chatId: chat._id.toString(),
          receiverId: receiverId,
        };
        
        receiverSocket.emit('new_message', {...messageData, status: 'sent'});
        console.log(`✅ Message delivered to receiver in real-time`);
        
        // ✅ FIX: Automatically mark message as delivered since it reached the recipient's device
        try {
          await Message.findByIdAndUpdate(message._id, {
            status: 'delivered',
            deliveredAt: new Date()
          });
          console.log(`📦 Message automatically marked as delivered: ${message._id}`);
          
          // Notify sender about delivery status change
          socket.emit('message_delivered', {
            messageId: message._id.toString(),
            status: 'delivered',
            deliveredAt: new Date().toISOString()
          });
          console.log(`✅ Delivery notification sent to sender: ${socket.userId}`);
        } catch (deliveryError) {
          console.error('❌ Error updating delivery status:', deliveryError);
        }
      } else {
        console.log(`📱 Receiver ${receiverId} not online - message saved for later`);
      }

      // Also send to sender for confirmation (optional)
      socket.emit('message_sent', {
        messageId: message._id.toString(),
        chatId: chat._id.toString(),
        content: message.content, // Add content for temp ID mapping
        success: true,
        timestamp: message.timestamp.toISOString() // Add timestamp for proper sorting
      });

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message_sent', {
        success: false,
        error: 'Failed to send message'
      });
    }
  });

  // Handle message read status - Enhanced with better status management
  socket.on('message_read', async (data) => {
    try {
      const { chatId } = data;
      
      console.log(`👁️ Chat opened by ${socket.userInfo.fullName}: marking messages as read for chat ${chatId}`);
      
      // ✅ FIX: Update all delivered messages in this chat to read status (don't touch sent messages)
      const result = await Message.updateMany(
        {
          chatId: chatId,
          receiver: socket.userId,
          status: 'delivered' // Only update delivered messages to read
        },
        {
          status: 'read',
          readAt: new Date()
        }
      );
      
      console.log(`✅ Marked ${result.modifiedCount} delivered messages as read in chat ${chatId}`);
      
      // ✅ FIX: Also get recently sent messages that might need to be marked as delivered first
      const recentSentMessages = await Message.find({
        chatId: chatId,
        receiver: socket.userId,
        status: 'sent',
        timestamp: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
      });
      
      if (recentSentMessages.length > 0) {
        console.log(`📦 Found ${recentSentMessages.length} recent sent messages, marking as delivered then read`);
        
        // First mark as delivered
        await Message.updateMany(
          {
            chatId: chatId,
            receiver: socket.userId,
            status: 'sent',
            timestamp: { $gte: new Date(Date.now() - 60000) }
          },
          {
            status: 'delivered',
            deliveredAt: new Date()
          }
        );
        
        // Then immediately mark as read
        await Message.updateMany(
          {
            chatId: chatId,
            receiver: socket.userId,
            status: 'delivered',
            deliveredAt: { $gte: new Date(Date.now() - 5000) } // Just delivered
          },
          {
            status: 'read',
            readAt: new Date()
          }
        );
        
        console.log(`✅ Updated ${recentSentMessages.length} recent messages from sent -> delivered -> read`);
      }
      
      // Notify sender about read status change for all affected messages
      // Find all updated messages to get sender IDs
      const updatedMessages = await Message.find({
        chatId: chatId,
        receiver: socket.userId,
        status: 'read'
      }).sort({ timestamp: -1 }).limit(100); // Limit to recent messages
      
      // Group by sender to avoid duplicate notifications
      const senderIds = [...new Set(updatedMessages.map(msg => msg.sender.toString()))];
      
      for (const senderId of senderIds) {
        const senderSocket = Array.from(io.sockets.sockets.values())
          .find(s => s.userId === senderId);
          
        if (senderSocket) {
          senderSocket.emit('message_read', {
            chatId: chatId,
            readerId: socket.userId,
            readerName: socket.userInfo.fullName,
            timestamp: new Date().toISOString(),
            messageCount: updatedMessages.filter(msg => msg.sender.toString() === senderId).length
          });
          console.log(`✅ Read status sent to sender: ${senderId}`);
        }
      }
      
    } catch (error) {
      console.error('Error handling message read:', error);
    }
  });
  
  // Read receipt endpoint - Enhanced with better status management
  app.post('/api/messages/read', async (req, res) => {
    try {
      // Extract token from Authorization header
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
      }
  
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId;
      const { chatId } = req.body;
  
      console.log(`👁️ HTTP Read receipt for chat: ${chatId} by user: ${userId}`);
  
      // ✅ FIX: First mark recent sent messages as delivered, then mark delivered messages as read
      
      // Step 1: Mark recent sent messages as delivered
      const recentSentResult = await Message.updateMany(
        {
          chatId: chatId,
          receiver: userId,
          status: 'sent',
          timestamp: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
        },
        {
          status: 'delivered',
          deliveredAt: new Date()
        }
      );
      
      console.log(`📦 Marked ${recentSentResult.modifiedCount} recent sent messages as delivered`);
      
      // Step 2: Mark all delivered messages as read
      const readResult = await Message.updateMany(
        {
          chatId: chatId,
          receiver: userId,
          status: 'delivered'
        },
        {
          status: 'read',
          readAt: new Date()
        }
      );
  
      console.log(`✅ Marked ${readResult.modifiedCount} delivered messages as read in chat ${chatId}`);
  
      // Find the chat to get sender info and notify
      const chat = await Chat.findById(chatId);
      if (chat) {
        // Get the other participant (sender)
        const senderId = chat.participants.find(p => p.toString() !== userId);
        
        if (senderId) {
          // Notify sender about read status change
          const senderSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === senderId.toString());
            
          if (senderSocket) {
            senderSocket.emit('message_read', {
              chatId: chatId,
              readerId: userId,
              timestamp: new Date().toISOString(),
              messageCount: readResult.modifiedCount + recentSentResult.modifiedCount
            });
            console.log(`✅ Read status sent to sender: ${senderId}`);
          }
        }
      }
  
      res.json({
        success: true,
        message: `Marked ${readResult.modifiedCount + recentSentResult.modifiedCount} messages as read`,
        deliveredCount: recentSentResult.modifiedCount,
        readCount: readResult.modifiedCount,
        totalCount: readResult.modifiedCount + recentSentResult.modifiedCount
      });
  
    } catch (error) {
      console.error('❌ Read receipt error:', error);
      res.status(500).json({ success: false, message: 'Failed to mark messages as read' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.userInfo.fullName} (${socket.userId})`);
    // Update offline status when user disconnects
    _updateUserOfflineStatus(socket.userId);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    
    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔌 Socket.IO enabled for messaging`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });