const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  siteName: { type: String, default: 'Wix Capital' },
  supportEmail: { type: String, default: 'support@wixcapital.com' },
  withdrawalFee: { type: Number, default: 10 },
  minWithdrawal: { type: Number, default: 50 },
  maxWithdrawal: { type: Number, default: 100000 },
  maintenance: { type: Boolean, default: false },
  registrationEnabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Setting', settingsSchema);