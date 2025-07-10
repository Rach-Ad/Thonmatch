const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { users } = require('../config/firebase');
const { authenticateToken } = require('../middleware/auth');
const openaiService = require('../services/openai');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// Registration
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 }),
  body('age').isInt({ min: 18, max: 99 }),
  body('gender').isIn(['male', 'female', 'non-binary']),
  body('tribe').trim().isLength({ min: 2 }),
  body('location').trim().isLength({ min: 2 }),
  body('religion').trim().isLength({ min: 2 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      email,
      password,
      name,
      age,
      gender,
      tribe,
      location,
      religion,
      familyValues,
      interests,
      education,
      occupation,
      profilePicture
    } = req.body;

    // Check if user already exists
    const existingUser = await users.where('email', '==', email).get();
    if (!existingUser.empty) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate AI bio
    const aiGeneratedBio = await openaiService.generateDatingBio({
      name,
      age,
      tribe,
      location,
      religion,
      familyValues,
      interests,
      education
    });

    // Create user document
    const userData = {
      email,
      password: hashedPassword,
      name,
      age: parseInt(age),
      gender,
      tribe,
      location,
      religion,
      familyValues: familyValues || '',
      interests: interests || '',
      education: education || '',
      occupation: occupation || '',
      profilePicture: profilePicture || '',
      bio: aiGeneratedBio,
      isProfileComplete: true,
      isVerified: false,
      isActive: true,
      isPremium: false,
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        ageRange: { min: Math.max(18, age - 10), max: age + 10 },
        maxDistance: 50,
        tribes: [],
        religions: [],
        showMe: gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'all'
      },
      stats: {
        profileViews: 0,
        likes: 0,
        matches: 0,
        conversations: 0
      }
    };

    const userRef = await users.add(userData);
    const token = generateToken(userRef.id);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userRef.id,
        name: userData.name,
        email: userData.email,
        bio: userData.bio,
        isProfileComplete: userData.isProfileComplete
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user by email
    const userQuery = await users.where('email', '==', email).get();
    if (userQuery.empty) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();

    // Check password
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check if account is active
    if (!userData.isActive) {
      return res.status(400).json({ error: 'Account has been deactivated' });
    }

    // Update last seen
    await users.doc(userDoc.id).update({
      lastSeen: new Date()
    });

    const token = generateToken(userDoc.id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: userDoc.id,
        name: userData.name,
        email: userData.email,
        profilePicture: userData.profilePicture,
        isProfileComplete: userData.isProfileComplete,
        isPremium: userData.isPremium
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userDoc = await users.doc(req.user.id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    // Remove password from response
    delete userData.password;

    res.json({
      user: {
        id: req.user.id,
        ...userData
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update profile
router.put('/profile', authenticateToken, [
  body('name').optional().trim().isLength({ min: 2 }),
  body('age').optional().isInt({ min: 18, max: 99 }),
  body('bio').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const allowedUpdates = [
      'name', 'age', 'bio', 'tribe', 'location', 'religion', 'familyValues',
      'interests', 'education', 'occupation', 'profilePicture', 'preferences'
    ];

    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    updates.updatedAt = new Date();

    await users.doc(req.user.id).update(updates);

    res.json({ message: 'Profile updated successfully' });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Change password
router.put('/password', authenticateToken, [
  body('currentPassword').exists(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    const userDoc = await users.doc(req.user.id).get();
    const userData = userDoc.data();

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, userData.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    await users.doc(req.user.id).update({
      password: hashedNewPassword,
      updatedAt: new Date()
    });

    res.json({ message: 'Password updated successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deactivate account
router.delete('/deactivate', authenticateToken, async (req, res) => {
  try {
    await users.doc(req.user.id).update({
      isActive: false,
      updatedAt: new Date()
    });

    res.json({ message: 'Account deactivated successfully' });

  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;