const mongoose = require('mongoose');

const futuresSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pair: { type: String, required: true },
  position: { type: String, enum: ['long', 'short'], required: true },
  leverage: { type: Number, required: true },
  margin: { type: Number, required: true },
  size: { type: Number, required: true },
  entryPrice: { type: Number, required: true },
  liquidationPrice: { type: Number, required: true },
  status: { type: String, enum: ['open', 'closed', 'liquidated'], default: 'open' },
  pnl: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
});

module.exports = mongoose.model('Futures', futuresSchema);