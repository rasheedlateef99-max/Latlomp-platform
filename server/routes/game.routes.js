/* ============================================
   LATLOMP PLATFORM — GAME ROUTES
   ============================================

   GET  /api/games              → List all games
   POST /api/games/:id/score    → Save a score
   GET  /api/games/:id/leaderboard → Top scores
   ============================================ */

const express = require('express');
const router  = express.Router();
const Game    = require('../models/Game.model');

/* ============================================
   OPTIONAL AUTH MIDDLEWARE
   Games work without login, but scores are only
   saved to leaderboard if user is logged in.
   ============================================ */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const jwt   = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
  } catch {
    // Token invalid or missing — that is fine for games
    req.user = null;
  }
  next();
};

/* ============================================
   GET /api/games
   Returns list of all active games
   ============================================ */
router.get('/', async (req, res) => {
  try {
    const games = await Game.find({ isActive: true })
      .select('-leaderboard')  // Don't send full leaderboard in list
      .sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: games.length,
      games
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching games.'
    });
  }
});

/* ============================================
   POST /api/games/:id/score
   Save a player's score after finishing a game.
   Only saves to leaderboard if user is logged in.
   ============================================ */
router.post('/:id/score', optionalAuth, async (req, res) => {
  try {
    const { score, playerName } = req.body;

    if (score === undefined || score === null) {
      return res.status(400).json({
        success: false,
        message: 'Score is required.'
      });
    }

    const game = await Game.findById(req.params.id);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found.'
      });
    }

    // Increment total plays
    game.totalPlays += 1;

    // Update high score if this is better
    if (score > game.highScore) {
      game.highScore = score;
    }

    // Only add to leaderboard if user is logged in
    if (req.user) {
      const name = playerName || req.user.name || 'Anonymous';

      // Check if user already has an entry
      const existingIdx = game.leaderboard.findIndex(
        entry => entry.userId && entry.userId.toString() === req.user.id
      );

      if (existingIdx !== -1) {
        // Update if new score is higher
        if (score > game.leaderboard[existingIdx].score) {
          game.leaderboard[existingIdx].score    = score;
          game.leaderboard[existingIdx].playedAt = new Date();
        }
      } else {
        // Add new entry
        game.leaderboard.push({
          userId:   req.user.id,
          userName: name,
          score,
          playedAt: new Date()
        });
      }

      // Keep only top 50 scores
      game.leaderboard.sort((a, b) => b.score - a.score);
      if (game.leaderboard.length > 50) {
        game.leaderboard = game.leaderboard.slice(0, 50);
      }
    }

    await game.save();

    // Calculate player's rank if they are logged in
    let rank = null;
    if (req.user) {
      const sorted = [...game.leaderboard].sort((a, b) => b.score - a.score);
      rank = sorted.findIndex(
        e => e.userId && e.userId.toString() === req.user.id
      ) + 1;
    }

    return res.status(200).json({
      success:    true,
      message:    req.user ? 'Score saved to leaderboard!' : 'Score recorded! Login to save to leaderboard.',
      score,
      highScore:  game.highScore,
      totalPlays: game.totalPlays,
      rank,
      savedToLeaderboard: !!req.user
    });

  } catch (error) {
    console.error('Save score error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error saving score.'
    });
  }
});

/* ============================================
   GET /api/games/:id/leaderboard
   Returns top 10 scores for a game
   ============================================ */
router.get('/:id/leaderboard', async (req, res) => {
  try {
    const game = await Game.findById(req.params.id)
      .select('title leaderboard highScore totalPlays');

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found.'
      });
    }

    // Sort and return top 10
    const top10 = [...game.leaderboard]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((entry, index) => ({
        rank:     index + 1,
        userName: entry.userName,
        score:    entry.score,
        playedAt: entry.playedAt
      }));

    return res.status(200).json({
      success:    true,
      gameTitle:  game.title,
      highScore:  game.highScore,
      totalPlays: game.totalPlays,
      leaderboard: top10
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching leaderboard.'
    });
  }
});

module.exports = router;