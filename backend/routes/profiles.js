const express = require('express');
const { body, validationResult } = require('express-validator');
const { users } = require('../config/firebase');
const { authenticateToken } = require('../middleware/auth');
const openaiService = require('../services/openai');

const router = express.Router();

// Get potential matches based on preferences
router.get('/discover', authenticateToken, async (req, res) => {
  try {
    const currentUser = await users.doc(req.user.id).get();
    const userData = currentUser.data();
    const preferences = userData.preferences || {};

    // Build query based on preferences
    let query = users.where('isActive', '==', true);

    // Filter by gender preference
    if (preferences.showMe && preferences.showMe !== 'all') {
      query = query.where('gender', '==', preferences.showMe);
    }

    // Get all potential matches
    const potentialMatches = await query.get();
    const matches = [];

    potentialMatches.forEach(doc => {
      const profile = doc.data();
      const profileId = doc.id;

      // Don't include current user
      if (profileId === req.user.id) return;

      // Check age range
      if (preferences.ageRange) {
        if (profile.age < preferences.ageRange.min || profile.age > preferences.ageRange.max) {
          return;
        }
      }

      // Check tribe preferences
      if (preferences.tribes && preferences.tribes.length > 0) {
        if (!preferences.tribes.includes(profile.tribe)) {
          return;
        }
      }

      // Check religion preferences
      if (preferences.religions && preferences.religions.length > 0) {
        if (!preferences.religions.includes(profile.religion)) {
          return;
        }
      }

      // Remove sensitive data
      delete profile.password;
      delete profile.email;

      matches.push({
        id: profileId,
        ...profile
      });
    });

    // Shuffle and limit results
    const shuffledMatches = matches.sort(() => 0.5 - Math.random()).slice(0, 20);

    res.json({ matches: shuffledMatches });

  } catch (error) {
    console.error('Discover matches error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get specific profile
router.get('/:profileId', authenticateToken, async (req, res) => {
  try {
    const { profileId } = req.params;

    const profileDoc = await users.doc(profileId).get();
    if (!profileDoc.exists) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profileData = profileDoc.data();

    // Check if profile is active
    if (!profileData.isActive) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Increment profile views
    await users.doc(profileId).update({
      'stats.profileViews': (profileData.stats?.profileViews || 0) + 1
    });

    // Remove sensitive data
    delete profileData.password;
    delete profileData.email;

    res.json({
      profile: {
        id: profileId,
        ...profileData
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search profiles
router.get('/search/:query', authenticateToken, async (req, res) => {
  try {
    const { query } = req.params;
    const searchTerm = query.toLowerCase();

    // Get all active profiles
    const allProfiles = await users.where('isActive', '==', true).get();
    const results = [];

    allProfiles.forEach(doc => {
      const profile = doc.data();
      const profileId = doc.id;

      // Don't include current user
      if (profileId === req.user.id) return;

      // Search in name, tribe, location, interests
      const searchableText = `${profile.name} ${profile.tribe} ${profile.location} ${profile.interests} ${profile.bio}`.toLowerCase();

      if (searchableText.includes(searchTerm)) {
        delete profile.password;
        delete profile.email;

        results.push({
          id: profileId,
          ...profile
        });
      }
    });

    res.json({ results: results.slice(0, 20) });

  } catch (error) {
    console.error('Search profiles error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate new AI bio
router.post('/generate-bio', authenticateToken, async (req, res) => {
  try {
    const userDoc = await users.doc(req.user.id).get();
    const userData = userDoc.data();

    const newBio = await openaiService.generateDatingBio({
      name: userData.name,
      age: userData.age,
      tribe: userData.tribe,
      location: userData.location,
      religion: userData.religion,
      familyValues: userData.familyValues,
      interests: userData.interests,
      education: userData.education
    });

    res.json({ bio: newBio });

  } catch (error) {
    console.error('Generate bio error:', error);
    res.status(500).json({ error: 'Failed to generate bio' });
  }
});

// Update profile picture
router.post('/upload-picture', authenticateToken, async (req, res) => {
  try {
    const { profilePicture } = req.body;

    if (!profilePicture) {
      return res.status(400).json({ error: 'Profile picture is required' });
    }

    await users.doc(req.user.id).update({
      profilePicture,
      updatedAt: new Date()
    });

    res.json({ message: 'Profile picture updated successfully' });

  } catch (error) {
    console.error('Upload picture error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update preferences
router.put('/preferences', authenticateToken, [
  body('ageRange.min').optional().isInt({ min: 18, max: 99 }),
  body('ageRange.max').optional().isInt({ min: 18, max: 99 }),
  body('maxDistance').optional().isInt({ min: 1, max: 500 }),
  body('showMe').optional().isIn(['male', 'female', 'all'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ageRange, maxDistance, tribes, religions, showMe } = req.body;

    const preferences = {};
    if (ageRange) preferences.ageRange = ageRange;
    if (maxDistance) preferences.maxDistance = maxDistance;
    if (tribes) preferences.tribes = tribes;
    if (religions) preferences.religions = religions;
    if (showMe) preferences.showMe = showMe;

    await users.doc(req.user.id).update({
      preferences,
      updatedAt: new Date()
    });

    res.json({ message: 'Preferences updated successfully' });

  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get profile statistics
router.get('/stats/me', authenticateToken, async (req, res) => {
  try {
    const userDoc = await users.doc(req.user.id).get();
    const userData = userDoc.data();

    const stats = userData.stats || {
      profileViews: 0,
      likes: 0,
      matches: 0,
      conversations: 0
    };

    res.json({ stats });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Hide profile from discovery
router.post('/hide', authenticateToken, async (req, res) => {
  try {
    await users.doc(req.user.id).update({
      isActive: false,
      updatedAt: new Date()
    });

    res.json({ message: 'Profile hidden from discovery' });

  } catch (error) {
    console.error('Hide profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Show profile in discovery
router.post('/show', authenticateToken, async (req, res) => {
  try {
    await users.doc(req.user.id).update({
      isActive: true,
      updatedAt: new Date()
    });

    res.json({ message: 'Profile shown in discovery' });

  } catch (error) {
    console.error('Show profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;