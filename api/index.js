// api/index.js
require('dotenv').config();
const mongoose = require('mongoose');
const app = require('../src/app');   // ← path adjusted (app.js is inside src)

// MongoDB connection (runs once)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ✅ Add a root route if not already defined in app.js
app.get('/', (req, res) => {
  res.json({ message: 'Wix Capital API is running 🚀' });
});

module.exports = app;