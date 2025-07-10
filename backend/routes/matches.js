const express = require('express');
const { users, likes, matches } = require('../config/firebase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Like a profile
router.post('/like/:profileId', authenticateToken, async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.user.id;

    // Check if profile exists and is active
    const profileDoc = await users.doc(profileId).get();
    if (!profileDoc.exists || !profileDoc.data().isActive) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if already liked
    const existingLike = await likes
      .where('fromUserId', '==', userId)
      .where('toUserId', '==', profileId)
      .get();

    if (!existingLike.empty) {
      return res.status(400).json({ error: 'Already liked this profile' });
    }

    // Create like record
    const likeData = {
      fromUserId: userId,
      toUserId: profileId,
      createdAt: new Date(),
      isMatch: false
    };

    const likeRef = await likes.add(likeData);

    // Check if it's a mutual like (match)
    const mutualLike = await likes
      .where('fromUserId', '==', profileId)
      .where('toUserId', '==', userId)
      .get();

    let isMatch = false;
    let matchId = null;

    if (!mutualLike.empty) {
      // It's a match!
      isMatch = true;

      // Create match record
      const matchData = {
        user1Id: userId < profileId ? userId : profileId,
        user2Id: userId > profileId ? userId : profileId,
        createdAt: new Date(),
        lastMessageAt: new Date(),
        isActive: true,
        user1Liked: true,
        user2Liked: true
      };

      const matchRef = await matches.add(matchData);
      matchId = matchRef.id;

      // Update both like records
      await likes.doc(likeRef.id).update({ isMatch: true, matchId });
      await likes.doc(mutualLike.docs[0].id).update({ isMatch: true, matchId });

      // Update user statistics
      const currentUserStats = req.user.stats || {};
      const otherUserDoc = await users.doc(profileId).get();
      const otherUserStats = otherUserDoc.data().stats || {};

      await users.doc(userId).update({
        'stats.matches': (currentUserStats.matches || 0) + 1,
        'stats.likes': (currentUserStats.likes || 0) + 1
      });

      await users.doc(profileId).update({
        'stats.matches': (otherUserStats.matches || 0) + 1
      });
    } else {
      // Just update like count
      const currentUserStats = req.user.stats || {};
      await users.doc(userId).update({
        'stats.likes': (currentUserStats.likes || 0) + 1
      });
    }

    res.json({
      message: isMatch ? 'It\'s a match!' : 'Profile liked',
      isMatch,
      matchId
    });

  } catch (error) {
    console.error('Like profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Pass (skip) a profile
router.post('/pass/:profileId', authenticateToken, async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.user.id;

    // Record the pass for future reference (optional)
    // This helps avoid showing the same profile again
    
    res.json({ message: 'Profile passed' });

  } catch (error) {
    console.error('Pass profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's matches
router.get('/my-matches', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get matches where user is involved
    const userMatches = await matches
      .where('user1Id', '==', userId)
      .where('isActive', '==', true)
      .get();

    const userMatches2 = await matches
      .where('user2Id', '==', userId)
      .where('isActive', '==', true)
      .get();

    const allMatches = [...userMatches.docs, ...userMatches2.docs];
    const matchProfiles = [];

    for (const matchDoc of allMatches) {
      const matchData = matchDoc.data();
      const otherUserId = matchData.user1Id === userId ? matchData.user2Id : matchData.user1Id;

      // Get other user's profile
      const otherUserDoc = await users.doc(otherUserId).get();
      if (otherUserDoc.exists && otherUserDoc.data().isActive) {
        const otherUserData = otherUserDoc.data();
        delete otherUserData.password;
        delete otherUserData.email;

        matchProfiles.push({
          matchId: matchDoc.id,
          user: {
            id: otherUserId,
            ...otherUserData
          },
          matchedAt: matchData.createdAt,
          lastMessageAt: matchData.lastMessageAt
        });
      }
    }

    // Sort by most recent
    matchProfiles.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    res.json({ matches: matchProfiles });

  } catch (error) {
    console.error('Get matches error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get users who liked you
router.get('/likes-me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user has premium access
    const userDoc = await users.doc(userId).get();
    const userData = userDoc.data();

    if (!userData.isPremium) {
      return res.status(403).json({ error: 'Premium subscription required to see who liked you' });
    }

    // Get likes directed to this user
    const likesReceived = await likes
      .where('toUserId', '==', userId)
      .where('isMatch', '==', false)
      .get();

    const likedByProfiles = [];

    for (const likeDoc of likesReceived.docs) {
      const likeData = likeDoc.data();
      const otherUserDoc = await users.doc(likeData.fromUserId).get();

      if (otherUserDoc.exists && otherUserDoc.data().isActive) {
        const otherUserData = otherUserDoc.data();
        delete otherUserData.password;
        delete otherUserData.email;

        likedByProfiles.push({
          likeId: likeDoc.id,
          user: {
            id: likeData.fromUserId,
            ...otherUserData
          },
          likedAt: likeData.createdAt
        });
      }
    }

    // Sort by most recent
    likedByProfiles.sort((a, b) => b.likedAt - a.likedAt);

    res.json({ likedBy: likedByProfiles });

  } catch (error) {
    console.error('Get likes error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get sent likes
router.get('/my-likes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const sentLikes = await likes
      .where('fromUserId', '==', userId)
      .get();

    const likedProfiles = [];

    for (const likeDoc of sentLikes.docs) {
      const likeData = likeDoc.data();
      const otherUserDoc = await users.doc(likeData.toUserId).get();

      if (otherUserDoc.exists && otherUserDoc.data().isActive) {
        const otherUserData = otherUserDoc.data();
        delete otherUserData.password;
        delete otherUserData.email;

        likedProfiles.push({
          likeId: likeDoc.id,
          user: {
            id: likeData.toUserId,
            ...otherUserData
          },
          likedAt: likeData.createdAt,
          isMatch: likeData.isMatch
        });
      }
    }

    res.json({ myLikes: likedProfiles });

  } catch (error) {
    console.error('Get my likes error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Unmatch
router.delete('/unmatch/:matchId', authenticateToken, async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.user.id;

    // Get match details
    const matchDoc = await matches.doc(matchId).get();
    if (!matchDoc.exists) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const matchData = matchDoc.data();

    // Verify user is part of this match
    if (matchData.user1Id !== userId && matchData.user2Id !== userId) {
      return res.status(403).json({ error: 'Not authorized to unmatch' });
    }

    // Deactivate the match
    await matches.doc(matchId).update({
      isActive: false,
      unmatchedAt: new Date(),
      unmatchedBy: userId
    });

    res.json({ message: 'Successfully unmatched' });

  } catch (error) {
    console.error('Unmatch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get match statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Count likes sent
    const sentLikes = await likes.where('fromUserId', '==', userId).get();
    
    // Count likes received
    const receivedLikes = await likes.where('toUserId', '==', userId).get();
    
    // Count matches
    const userMatches1 = await matches
      .where('user1Id', '==', userId)
      .where('isActive', '==', true)
      .get();
    
    const userMatches2 = await matches
      .where('user2Id', '==', userId)
      .where('isActive', '==', true)
      .get();

    const stats = {
      likesSent: sentLikes.size,
      likesReceived: receivedLikes.size,
      totalMatches: userMatches1.size + userMatches2.size,
      mutualLikes: sentLikes.docs.filter(doc => doc.data().isMatch).length
    };

    res.json({ stats });

  } catch (error) {
    console.error('Get match stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;