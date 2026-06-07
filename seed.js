require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ✅ Correct path: ./src/models/User
const User = require('./src/models/User');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
};

// Seed admin function
const seedAdmin = async () => {
  try {
    // Change these to your desired admin credentials
    const adminEmail = 'admin@wixcapital.com';
    const adminName = 'Admin User';
    const adminPassword = 'Admin123!'; // Change this!

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('⚠️ Admin already exists:', adminEmail);
      return;
    }

    // Create admin user
    const admin = new User({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      isVerified: true,
      kycStatus: 'verified',
    });

    await admin.save();
    console.log(`✅ Admin created successfully!`);
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log(`   Role: ${admin.role}`);

  } catch (err) {
    console.error('❌ Error seeding admin:', err);
  }
};

// Run everything
const run = async () => {
  await connectDB();
  await seedAdmin();
  process.exit(0);
};

run();