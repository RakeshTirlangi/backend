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
      
      // ✅ DEBUGGING: Log message read status
      console.log(`📊 Message ${message._id}: isRead=${message.isRead}, readAt=${message.readAt}, deliveredAt=${message.deliveredAt}, isMe=${isMe}`);
      
      // ✅ FIXED: Correct status calculation based on user perspective
      let status;
      if (isMe) {
        // For messages I sent: check if receiver read it
        // The message.isRead field indicates if the RECEIVER read it
        status = message.isRead ? 'read' : (message.deliveredAt ? 'delivered' : 'sent');
        console.log(`📤 Sent message status: ${status} (isRead: ${message.isRead})`);
      } else {
        // For messages I received: check if I (current user) read it
        // Since I'm loading the messages, they are at least delivered to me
        status = 'delivered'; // For now, received messages show as delivered
        console.log(`📥 Received message status: ${status}`);
      }
      
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
        deliveredAt: message.deliveredAt,
        status: status
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
      return next(new Error('User not found'));
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

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 User connected: ${socket.userInfo.fullName} (${socket.userId})`);

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

      // Create and save message
      const message = new Message({
        chatId: chat._id,
        sender: socket.userId,
        receiver: receiverId,
        content: content.trim(),
        deliveredAt: new Date() // Mark as delivered when saved
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
        status: 'sent' // Add status for WhatsApp-like indicators
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
          status: 'delivered' // Mark as delivered when sent to recipient
        };
        
        receiverSocket.emit('new_message', messageData);
        console.log(`✅ Message delivered to receiver in real-time:`, messageData);
      } else {
        console.log(`📱 Receiver ${receiverId} not online - message saved for later`);
      }

      // Also send to sender for confirmation (optional)
      socket.emit('message_delivered', {
        messageId: message._id.toString(),
        chatId: chat._id.toString(),
        content: message.content, // Add content for temp ID mapping
        delivered: !!receiverSocket,
        status: receiverSocket ? 'delivered' : 'sent' // Update status based on delivery
      });

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('message_sent', {
        success: false,
        error: 'Failed to send message'
      });
    }
  });

  // Handle message read status
  socket.on('message_read', async (data) => {
    try {
      const { messageId, chatId } = data;
      
      console.log(`👁️ Message read by ${socket.userInfo.fullName}: ${messageId}`);
      
      // Find sender's socket to notify them that their message was read
      // First, find the message to get the sender ID
      const message = await Message.findById(messageId);
      if (!message) {
        console.log('❌ Message not found for read status');
        return;
      }
      
      // ✅ NEW: Persist read status to database (WhatsApp-like behavior)
      if (!message.isRead) {
        console.log(`💾 Updating message ${messageId} read status in database...`);
        const updatedMessage = await Message.findByIdAndUpdate(messageId, {
          isRead: true,
          readAt: new Date()
        }, { new: true });
        console.log(`✅ Message marked as read in database: ${messageId}`);
        console.log(`📊 Updated message status - isRead: ${updatedMessage.isRead}, readAt: ${updatedMessage.readAt}`);
        console.log(`📊 Original message - sender: ${message.sender}, receiver: ${message.receiver}`);
      } else {
        console.log(`ℹ️ Message ${messageId} was already marked as read`);
      }
      
      // Notify the sender that their message was read
      const senderSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.userId === message.sender.toString());
        
      if (senderSocket) {
        console.log(`✅ Notifying sender that message was read: ${message.sender}`);
        senderSocket.emit('message_read', {
          messageId: messageId,
          chatId: chatId,
          readerId: socket.userId,
          readerName: socket.userInfo.fullName,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`📱 Sender not online to receive read notification`);
      }
      
    } catch (error) {
      console.error('Error handling message read:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${socket.userInfo.fullName} (${socket.userId})`);
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