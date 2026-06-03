/* ============================================
   LATLOMP PLATFORM — GAME MODEL
   ============================================ */

const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type: {
      type: String,
      enum: ['quiz', 'wordgame', 'mathblitz', 'memory', 'other'],
      default: 'quiz'
    },
    subject:    { type: String, default: 'General' },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium'
    },
    isActive: { type: Boolean, default: true },

    // Game statistics
    totalPlays: { type: Number, default: 0 },
    highScore:  { type: Number, default: 0 },

    // Leaderboard entries
    leaderboard: [
      {
        userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        userName:  String,
        score:     Number,
        playedAt:  { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

const Game = mongoose.model('Game', gameSchema);
module.exports = Game;