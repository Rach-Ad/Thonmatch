const express = require('express');
const { body, validationResult } = require('express-validator');
const { users, chats, messages, matches } = require('../config/firebase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user's conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's matches (which become conversations)
    const userMatches1 = await matches
      .where('user1Id', '==', userId)
      .where('isActive', '==', true)
      .get();

    const userMatches2 = await matches
      .where('user2Id', '==', userId)
      .where('isActive', '==', true)
      .get();

    const allMatches = [...userMatches1.docs, ...userMatches2.docs];
    const conversations = [];

    for (const matchDoc of allMatches) {
      const matchData = matchDoc.data();
      const otherUserId = matchData.user1Id === userId ? matchData.user2Id : matchData.user1Id;

      // Get other user's profile
      const otherUserDoc = await users.doc(otherUserId).get();
      if (!otherUserDoc.exists || !otherUserDoc.data().isActive) continue;

      const otherUserData = otherUserDoc.data();

      // Get last message in this conversation
      const lastMessage = await messages
        .where('matchId', '==', matchDoc.id)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      let lastMessageData = null;
      if (!lastMessage.empty) {
        lastMessageData = lastMessage.docs[0].data();
      }

      // Get unread message count
      const unreadMessages = await messages
        .where('matchId', '==', matchDoc.id)
        .where('receiverId', '==', userId)
        .where('isRead', '==', false)
        .get();

      conversations.push({
        matchId: matchDoc.id,
        otherUser: {
          id: otherUserId,
          name: otherUserData.name,
          profilePicture: otherUserData.profilePicture,
          isOnline: isUserOnline(otherUserData.lastSeen)
        },
        lastMessage: lastMessageData ? {
          content: lastMessageData.content,
          timestamp: lastMessageData.timestamp,
          senderId: lastMessageData.senderId,
          type: lastMessageData.type
        } : null,
        unreadCount: unreadMessages.size,
        matchedAt: matchData.createdAt
      });
    }

    // Sort by last message timestamp
    conversations.sort((a, b) => {
      const aTime = a.lastMessage ? a.lastMessage.timestamp : a.matchedAt;
      const bTime = b.lastMessage ? b.lastMessage.timestamp : b.matchedAt;
      return bTime - aTime;
    });

    res.json({ conversations });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get messages for a specific conversation
router.get('/conversation/:matchId', authenticateToken, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is part of this match
    const matchDoc = await matches.doc(matchId).get();
    if (!matchDoc.exists) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const matchData = matchDoc.data();
    if (matchData.user1Id !== userId && matchData.user2Id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }

    // Get messages with pagination
    const messagesQuery = await messages
      .where('matchId', '==', matchId)
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit))
      .get();

    const conversationMessages = messagesQuery.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })).reverse(); // Reverse to show oldest first

    // Mark messages as read
    const unreadMessages = await messages
      .where('matchId', '==', matchId)
      .where('receiverId', '==', userId)
      .where('isRead', '==', false)
      .get();

    const batch = messages.firestore.batch();
    unreadMessages.docs.forEach(doc => {
      batch.update(doc.ref, { isRead: true, readAt: new Date() });
    });
    
    if (!unreadMessages.empty) {
      await batch.commit();
    }

    res.json({ 
      messages: conversationMessages,
      hasMore: messagesQuery.size === parseInt(limit)
    });

  } catch (error) {
    console.error('Get conversation messages error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a message
router.post('/send', authenticateToken, [
  body('matchId').trim().isLength({ min: 1 }),
  body('content').trim().isLength({ min: 1, max: 1000 }),
  body('type').optional().isIn(['text', 'image', 'gif'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { matchId, content, type = 'text' } = req.body;
    const senderId = req.user.id;

    // Verify match exists and user is part of it
    const matchDoc = await matches.doc(matchId).get();
    if (!matchDoc.exists) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const matchData = matchDoc.data();
    if (matchData.user1Id !== senderId && matchData.user2Id !== senderId) {
      return res.status(403).json({ error: 'Not authorized to send message' });
    }

    if (!matchData.isActive) {
      return res.status(400).json({ error: 'Cannot send message to inactive match' });
    }

    const receiverId = matchData.user1Id === senderId ? matchData.user2Id : matchData.user1Id;

    // Create message
    const messageData = {
      matchId,
      senderId,
      receiverId,
      content,
      type,
      timestamp: new Date(),
      isRead: false,
      isEdited: false
    };

    const messageRef = await messages.add(messageData);

    // Update match with last message timestamp
    await matches.doc(matchId).update({
      lastMessageAt: new Date()
    });

    // Update conversation statistics
    const senderDoc = await users.doc(senderId).get();
    const senderStats = senderDoc.data().stats || {};
    
    await users.doc(senderId).update({
      'stats.conversations': Math.max(senderStats.conversations || 0, 1)
    });

    res.json({
      message: 'Message sent successfully',
      messageId: messageRef.id,
      timestamp: messageData.timestamp
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a message
router.delete('/message/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Get message
    const messageDoc = await messages.doc(messageId).get();
    if (!messageDoc.exists) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const messageData = messageDoc.data();

    // Verify user is the sender
    if (messageData.senderId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    // Check if message is recent (allow deletion within 24 hours)
    const now = new Date();
    const messageTime = messageData.timestamp.toDate();
    const hoursDifference = (now - messageTime) / (1000 * 60 * 60);

    if (hoursDifference > 24) {
      return res.status(400).json({ error: 'Cannot delete messages older than 24 hours' });
    }

    // Soft delete - mark as deleted instead of removing
    await messages.doc(messageId).update({
      isDeleted: true,
      deletedAt: new Date(),
      content: 'This message was deleted'
    });

    res.json({ message: 'Message deleted successfully' });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Report a conversation
router.post('/report/:matchId', authenticateToken, [
  body('reason').trim().isLength({ min: 1 }),
  body('details').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { matchId } = req.params;
    const { reason, details } = req.body;
    const reporterId = req.user.id;

    // Verify match exists and user is part of it
    const matchDoc = await matches.doc(matchId).get();
    if (!matchDoc.exists) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const matchData = matchDoc.data();
    if (matchData.user1Id !== reporterId && matchData.user2Id !== reporterId) {
      return res.status(403).json({ error: 'Not authorized to report this conversation' });
    }

    const reportedUserId = matchData.user1Id === reporterId ? matchData.user2Id : matchData.user1Id;

    // Create report
    const reportData = {
      reporterId,
      reportedUserId,
      matchId,
      reason,
      details: details || '',
      status: 'pending',
      createdAt: new Date()
    };

    const { reports } = require('../config/firebase');
    await reports.add(reportData);

    res.json({ message: 'Report submitted successfully' });

  } catch (error) {
    console.error('Report conversation error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Block a user
router.post('/block/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId: blockedUserId } = req.params;
    const blockerId = req.user.id;

    if (blockedUserId === blockerId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    // Find and deactivate any existing matches
    const userMatches1 = await matches
      .where('user1Id', '==', blockerId)
      .where('user2Id', '==', blockedUserId)
      .get();

    const userMatches2 = await matches
      .where('user1Id', '==', blockedUserId)
      .where('user2Id', '==', blockerId)
      .get();

    const allMatches = [...userMatches1.docs, ...userMatches2.docs];
    
    for (const matchDoc of allMatches) {
      await matches.doc(matchDoc.id).update({
        isActive: false,
        blockedAt: new Date(),
        blockedBy: blockerId
      });
    }

    // Add to blocked users list (you might want to create a separate collection for this)
    const blockerDoc = await users.doc(blockerId).get();
    const blockerData = blockerDoc.data();
    const blockedUsers = blockerData.blockedUsers || [];
    
    if (!blockedUsers.includes(blockedUserId)) {
      blockedUsers.push(blockedUserId);
      await users.doc(blockerId).update({
        blockedUsers,
        updatedAt: new Date()
      });
    }

    res.json({ message: 'User blocked successfully' });

  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper function to check if user is online
function isUserOnline(lastSeen) {
  if (!lastSeen) return false;
  const now = new Date();
  const lastSeenTime = lastSeen.toDate ? lastSeen.toDate() : lastSeen;
  const minutesDifference = (now - lastSeenTime) / (1000 * 60);
  return minutesDifference < 5; // Consider online if last seen within 5 minutes
}

module.exports = router;