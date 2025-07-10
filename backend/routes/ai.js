const express = require('express');
const { body, validationResult } = require('express-validator');
const { users } = require('../config/firebase');
const { authenticateToken } = require('../middleware/auth');
const openaiService = require('../services/openai');

const router = express.Router();

// Generate icebreakers for a match
router.post('/icebreakers/:profileId', authenticateToken, async (req, res) => {
  try {
    const { profileId } = req.params;
    const userId = req.user.id;

    // Get current user profile
    const currentUserDoc = await users.doc(userId).get();
    if (!currentUserDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Get target profile
    const targetUserDoc = await users.doc(profileId).get();
    if (!targetUserDoc.exists || !targetUserDoc.data().isActive) {
      return res.status(404).json({ error: 'Target profile not found' });
    }

    const currentUserData = currentUserDoc.data();
    const targetUserData = targetUserDoc.data();

    // Generate icebreakers
    const icebreakers = await openaiService.generateIcebreakers(
      currentUserData,
      targetUserData
    );

    res.json({ icebreakers });

  } catch (error) {
    console.error('Generate icebreakers error:', error);
    res.status(500).json({ error: 'Failed to generate icebreakers' });
  }
});

// Get dating advice from AI coach
router.post('/dating-advice', authenticateToken, [
  body('message').trim().isLength({ min: 1, max: 500 }),
  body('context').optional().trim().isLength({ max: 200 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { message, context = 'general dating advice' } = req.body;

    const advice = await openaiService.provideDatingAdvice(context, message);

    res.json({ advice });

  } catch (error) {
    console.error('Dating advice error:', error);
    res.status(500).json({ error: 'Failed to provide dating advice' });
  }
});

// Suggest date ideas
router.post('/date-ideas/:profileId', authenticateToken, async (req, res) => {
  try {
    const { profileId } = req.params;
    const { location } = req.body;
    const userId = req.user.id;

    // Get current user profile
    const currentUserDoc = await users.doc(userId).get();
    if (!currentUserDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Get target profile
    const targetUserDoc = await users.doc(profileId).get();
    if (!targetUserDoc.exists || !targetUserDoc.data().isActive) {
      return res.status(404).json({ error: 'Target profile not found' });
    }

    const currentUserData = currentUserDoc.data();
    const targetUserData = targetUserDoc.data();

    const dateIdea = await openaiService.suggestDateIdea(
      currentUserData,
      targetUserData,
      location || currentUserData.location
    );

    res.json({ dateIdea });

  } catch (error) {
    console.error('Date ideas error:', error);
    res.status(500).json({ error: 'Failed to suggest date ideas' });
  }
});

// Help reply to a message
router.post('/help-reply', authenticateToken, [
  body('originalMessage').trim().isLength({ min: 1, max: 500 }),
  body('context').optional().trim().isLength({ max: 200 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { originalMessage, context = 'responding to a dating app message' } = req.body;

    const helpMessage = `I received this message: "${originalMessage}". Can you help me craft a thoughtful response?`;
    
    const suggestion = await openaiService.provideDatingAdvice(context, helpMessage);

    res.json({ suggestion });

  } catch (error) {
    console.error('Help reply error:', error);
    res.status(500).json({ error: 'Failed to help with reply' });
  }
});

// Generate conversation starters
router.get('/conversation-starters', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user profile for context
    const userDoc = await users.doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const userData = userDoc.data();

    // Generate general conversation starters based on user's culture
    const starters = await openaiService.provideDatingAdvice(
      'conversation starters for South Sudanese dating',
      `I'm ${userData.name} from ${userData.tribe} tribe, living in ${userData.location}. What are some good conversation starters I can use?`
    );

    res.json({ starters });

  } catch (error) {
    console.error('Conversation starters error:', error);
    res.status(500).json({ error: 'Failed to generate conversation starters' });
  }
});

module.exports = router;