const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'both'], required: true },
  icon: { type: String }, // URL or path to icon image
  isActive: { type: Boolean, default: true },
  // For deposit methods
  depositDetails: {
    address: String,
    network: String,
    additionalInfo: String,
  },
  // For withdrawal methods
  withdrawalFields: [
    {
      label: String,
      name: String,
      type: { type: String, default: 'text' },
      placeholder: String,
      required: { type: Boolean, default: true },
    }
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);