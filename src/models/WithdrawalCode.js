const mongoose = require('mongoose');

const withdrawalCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = any user
  amountLimit: { type: Number, default: null }, // max withdrawal amount this code can cover (null = unlimited)
  status: { type: String, enum: ['active', 'used', 'expired'], default: 'active' },
  expiresAt: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  usedAt: { type: Date },
  usedForWithdrawal: { type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WithdrawalCode', withdrawalCodeSchema);