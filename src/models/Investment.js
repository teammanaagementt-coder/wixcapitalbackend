const mongoose = require('mongoose');

const investmentPlanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  daily: { type: Number, required: true },
  duration: { type: Number, required: true },
  bonus: { type: Number, default: 0 },
  totalReturn: { type: Number, required: true },
  features: [{ type: String }],
  color: { type: String },
  isActive: { type: Boolean, default: true },
});

const userInvestmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'InvestmentPlan', required: true },
  amount: { type: Number, required: true },
  dailyReturn: { type: Number, required: true },
  duration: { type: Number, required: true },
  totalReturn: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
  totalPaid: { type: Number, default: 0 },
  lastPayout: { type: Date },
});

module.exports = {
  InvestmentPlan: mongoose.model('InvestmentPlan', investmentPlanSchema),
  UserInvestment: mongoose.model('UserInvestment', userInvestmentSchema),
};