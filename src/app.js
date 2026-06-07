require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

// ─── Import Models ──────────────────────────────────────────────
const User = require('./models/User');
const Deposit = require('./models/Deposit');
const Withdrawal = require('./models/Withdrawal');
const Trade = require('./models/Trade');
const { InvestmentPlan, UserInvestment } = require('./models/Investment');
const Futures = require('./models/Futures');
const Transaction = require('./models/Transaction');



// ─── Initialize App ──────────────────────────────────────────────
const app = express();

// ─── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static('uploads'));

// ─── File Upload Setup ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// ─── JWT Helper ──────────────────────────────────────────────────
const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admins only.' });
  }
  next();
};

// ─── Controllers ──────────────────────────────────────────────────

// ─── AUTH ────────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    const user = new User({ name, email, password, referredBy });
    await user.save();

    if (referredBy) {
      await User.findByIdAndUpdate(referredBy, {
        $inc: { totalReferrals: 1, referralEarnings: 10 }
      });
      await Transaction.create({
        user: referredBy,
        type: 'referral',
        amount: 10,
        description: `Referral bonus from ${user.name}`,
      });
    }

    const token = generateToken(user._id, user.role);
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        referralCode: user.referralCode,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id, user.role);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        referralCode: user.referralCode,
        role: user.role,       // ✅ ADDED THIS
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── DASHBOARD ────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const recentTransactions = await Transaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        bonus: user.bonus,
        profit: user.profit,
        totalDeposited: user.totalDeposited,
        totalWithdrawn: user.totalWithdrawn,
        referralEarnings: user.referralEarnings,
        totalReferrals: user.totalReferrals,
        isVerified: user.isVerified,
        kycStatus: user.kycStatus,
        referralCode: user.referralCode,
        createdAt: user.createdAt,
      },
      recentTransactions,
      stats: {
        totalReferrals: user.totalReferrals,
        referralEarnings: user.referralEarnings,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── DEPOSITS ─────────────────────────────────────────────────────
const createDeposit = async (req, res) => {
  try {
    const { amount, payment_method } = req.body;
    const userId = req.user.userId;

    const deposit = new Deposit({
      user: userId,
      amount: parseFloat(amount),
      paymentMethod: payment_method,
      status: 'pending',
    });
    await deposit.save();

    await Transaction.create({
      user: userId,
      type: 'deposit',
      amount: parseFloat(amount),
      description: `Deposit via ${payment_method}`,
      status: 'pending',
      reference: deposit._id,
    });

    res.status(201).json({ message: 'Deposit created', deposit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getDeposits = async (req, res) => {
  try {
    const deposits = await Deposit.find({ user: req.user.userId }).sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── WITHDRAWALS ──────────────────────────────────────────────────
const createWithdrawal = async (req, res) => {
  try {
    const { amount, method, details, wcCode } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const fee = parseFloat(amount) * 0.10;
    const totalCost = parseFloat(amount) + fee;

    if (totalCost > user.balance) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const withdrawal = new Withdrawal({
      user: userId,
      amount: parseFloat(amount),
      method,
      details,
      wcCode,
      fee,
      status: 'pending',
    });
    await withdrawal.save();

    user.balance -= totalCost;
    user.totalWithdrawn += parseFloat(amount);
    await user.save();

    await Transaction.create({
      user: userId,
      type: 'withdrawal',
      amount: -parseFloat(amount),
      description: `Withdrawal via ${method}`,
      status: 'pending',
      reference: withdrawal._id,
    });

    res.status(201).json({ message: 'Withdrawal created', withdrawal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getWithdrawals = async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ user: req.user.userId }).sort({ createdAt: -1 });
    res.json(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── TRADES ──────────────────────────────────────────────────────
const createTrade = async (req, res) => {
  try {
    const { symbol, type, amount, price } = req.body;
    const userId = req.user.userId;

    const total = parseFloat(amount) * parseFloat(price);
    const fee = total * 0.001;

    const trade = new Trade({
      user: userId,
      symbol,
      type,
      amount: parseFloat(amount),
      price: parseFloat(price),
      total,
      fee,
      status: 'completed',
    });
    await trade.save();

    await Transaction.create({
      user: userId,
      type: 'trade',
      amount: type === 'buy' ? -total : total,
      description: `${type.toUpperCase()} ${amount} ${symbol}`,
      reference: trade._id,
    });

    res.status(201).json({ message: 'Trade executed', trade });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user.userId }).sort({ createdAt: -1 });
    res.json(trades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── INVESTMENT PLANS ─────────────────────────────────────────────
const getInvestmentPlans = async (req, res) => {
  try {
    const plans = await InvestmentPlan.find({ isActive: true });
    res.json(plans);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const investInPlan = async (req, res) => {
  try {
    const { planId, amount } = req.body;
    const userId = req.user.userId;

    const plan = await InvestmentPlan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    const user = await User.findById(userId);
    if (parseFloat(amount) > user.balance) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const investment = new UserInvestment({
      user: userId,
      planId: plan._id,
      amount: parseFloat(amount),
      dailyReturn: plan.daily,
      duration: plan.duration,
      totalReturn: plan.totalReturn,
      endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
    });
    await investment.save();

    user.balance -= parseFloat(amount);
    await user.save();

    await Transaction.create({
      user: userId,
      type: 'investment',
      amount: -parseFloat(amount),
      description: `Investment in ${plan.name} plan`,
      reference: investment._id,
    });

    res.status(201).json({ message: 'Investment successful', investment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getMyInvestments = async (req, res) => {
  try {
    const investments = await UserInvestment.find({ user: req.user.userId })
      .populate('planId')
      .sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── FUTURES ──────────────────────────────────────────────────────
const openFuturesPosition = async (req, res) => {
  try {
    const { pair, position, leverage, margin, size, entryPrice } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (parseFloat(margin) > user.balance) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const liquidationPrice = position === 'long'
      ? parseFloat(entryPrice) * (1 - 1 / parseFloat(leverage))
      : parseFloat(entryPrice) * (1 + 1 / parseFloat(leverage));

    const futures = new Futures({
      user: userId,
      pair,
      position,
      leverage: parseFloat(leverage),
      margin: parseFloat(margin),
      size: parseFloat(size),
      entryPrice: parseFloat(entryPrice),
      liquidationPrice,
    });
    await futures.save();

    user.balance -= parseFloat(margin);
    await user.save();

    res.status(201).json({ message: 'Futures position opened', futures });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

const getFuturesPositions = async (req, res) => {
  try {
    const positions = await Futures.find({ user: req.user.userId }).sort({ createdAt: -1 });
    res.json(positions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── TRANSACTIONS ─────────────────────────────────────────────────
const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user.userId })
      .sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── TRADING HISTORY (ROI) ───────────────────────────────────────
const getTradingHistory = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    const trades = await Trade.find({ user: req.user.userId }).sort({ createdAt: -1 });
    const investments = await UserInvestment.find({ user: req.user.userId })
      .populate('planId')
      .sort({ createdAt: -1 });

    const roiTransactions = await Transaction.find({
      user: req.user.userId,
      type: { $in: ['roi', 'bonus'] }
    }).sort({ createdAt: -1 });

    const totalReturns = user.profit + user.bonus;
    const lastReturn = roiTransactions.length > 0 ? roiTransactions[0].amount : 0;

    res.json({
      trades,
      investments,
      roiTransactions,
      stats: {
        totalReturns,
        lastReturn,
        totalTransactions: roiTransactions.length,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── SETTINGS ─────────────────────────────────────────────────────
const updateSettings = async (req, res) => {
  try {
    const { name, email, currency, language, twoFactorEnabled, notificationsEnabled, emailNotifications } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name) user.name = name;
    if (email) user.email = email;
    if (currency) user.currency = currency;
    if (language) user.language = language;
    if (twoFactorEnabled !== undefined) user.twoFactorEnabled = twoFactorEnabled;
    if (notificationsEnabled !== undefined) user.notificationsEnabled = notificationsEnabled;
    if (emailNotifications !== undefined) user.emailNotifications = emailNotifications;

    await user.save();
    res.json({ message: 'Settings updated', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── Routes ──────────────────────────────────────────────────────

// Public
app.post('/api/register', register);
app.post('/api/login', login);

// Protected
app.get('/api/dashboard', verifyToken, getDashboard);

// Deposits
app.post('/api/deposits/upload', verifyToken, upload.single('proof'), async (req, res) => {
  try {
    const { amount, payment_method } = req.body;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Create deposit with proof URL
    const deposit = new Deposit({
      user: req.user.userId,
      amount: parseFloat(amount),
      paymentMethod: payment_method,
      proofUrl: `/uploads/${file.filename}`,
      status: 'pending',
    });
    await deposit.save();

    // ✅ ADD THIS: Create a transaction record
    await Transaction.create({
      user: req.user.userId,
      type: 'deposit',
      amount: parseFloat(amount),
      description: `Deposit via ${payment_method}`,
      status: 'pending',
      reference: deposit._id,
    });

    res.status(201).json({ message: 'Deposit with proof submitted', deposit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/deposits', verifyToken, createDeposit);
app.get('/api/deposits', verifyToken, getDeposits);

// Withdrawals
app.post('/api/withdrawals', verifyToken, createWithdrawal);
app.get('/api/withdrawals', verifyToken, getWithdrawals);

// Trades
app.post('/api/trades', verifyToken, createTrade);
app.get('/api/trades', verifyToken, getTrades);

// Investment Plans
app.get('/api/investment-plans', verifyToken, getInvestmentPlans);
app.post('/api/invest', verifyToken, investInPlan);
app.get('/api/investments', verifyToken, getMyInvestments);

// Futures
app.post('/api/futures', verifyToken, openFuturesPosition);
app.get('/api/futures', verifyToken, getFuturesPositions);

// Transactions
app.get('/api/transactions', verifyToken, getAllTransactions);

// ─── TRANSACTIONS BY TYPE ──────────────────────────────────────────

// Get deposits (type = 'deposit')
app.get('/api/transactions/deposits', verifyToken, async (req, res) => {
  try {
    const deposits = await Transaction.find({ 
      user: req.user.userId, 
      type: 'deposit' 
    }).sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get withdrawals (type = 'withdrawal')
app.get('/api/transactions/withdrawals', verifyToken, async (req, res) => {
  try {
    const withdrawals = await Transaction.find({ 
      user: req.user.userId, 
      type: 'withdrawal' 
    }).sort({ createdAt: -1 });
    res.json(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get others (type = 'bonus', 'referral', 'investment', 'roi')
app.get('/api/transactions/others', verifyToken, async (req, res) => {
  try {
    const others = await Transaction.find({ 
      user: req.user.userId, 
      type: { $nin: ['deposit', 'withdrawal'] }
    }).sort({ createdAt: -1 });
    res.json(others);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Trading History
app.get('/api/trading-history', verifyToken, getTradingHistory);

// Settings
app.put('/api/settings', verifyToken, updateSettings);

// ─── ADMIN ROUTES ──────────────────────────────────────────────────

// Get all users (admin only)
app.get('/api/admin/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single user by ID (admin only)
app.get('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify user KYC (admin only)
app.put('/api/admin/users/:id/verify', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.kycStatus = 'verified';
    user.isVerified = true;
    await user.save();
    
    res.json({ message: 'User verified successfully', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle user admin role (admin only)
app.put('/api/admin/users/:id/role', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.role = user.role === 'admin' ? 'user' : 'admin';
    await user.save();
    
    res.json({ message: 'User role updated', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all deposits (admin only)
app.get('/api/admin/deposits', verifyToken, isAdmin, async (req, res) => {
  try {
    const deposits = await Deposit.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(deposits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Approve or reject deposit (admin only)
app.put('/api/admin/deposits/:id/status', verifyToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.body; // 'completed' or 'failed'
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) return res.status(404).json({ message: 'Deposit not found' });

    deposit.status = status;
    await deposit.save();

    if (status === 'completed') {
      // Add balance to user
      await User.findByIdAndUpdate(deposit.user, {
        $inc: { balance: deposit.amount, totalDeposited: deposit.amount }
      });
      
      // Update transaction
      await Transaction.findOneAndUpdate(
        { reference: deposit._id },
        { status: 'completed' }
      );
    }

    res.json({ message: `Deposit ${status}`, deposit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all withdrawals (admin only)
app.get('/api/admin/withdrawals', verifyToken, isAdmin, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Approve or reject withdrawal (admin only)
app.put('/api/admin/withdrawals/:id/status', verifyToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.body; // 'completed' or 'failed'
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });

    withdrawal.status = status;
    await withdrawal.save();

    if (status === 'failed') {
      // Refund balance to user (failed withdrawal)
      const refund = withdrawal.amount + withdrawal.fee;
      await User.findByIdAndUpdate(withdrawal.user, {
        $inc: { balance: refund }
      });
    }

    // Update transaction
    await Transaction.findOneAndUpdate(
      { reference: withdrawal._id },
      { status }
    );

    res.json({ message: `Withdrawal ${status}`, withdrawal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new investment plan (admin only)
app.post('/api/admin/investment-plans', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, min, max, daily, duration, bonus, totalReturn, features, color } = req.body;
    
    const plan = new InvestmentPlan({
      name, min, max, daily, duration, bonus, totalReturn, features, color
    });
    await plan.save();
    
    res.status(201).json({ message: 'Plan created', plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update investment plan (admin only)
app.put('/api/admin/investment-plans/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const plan = await InvestmentPlan.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    
    res.json({ message: 'Plan updated', plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete investment plan (admin only)
app.delete('/api/admin/investment-plans/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const plan = await InvestmentPlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


// ─── Export App ──────────────────────────────────────────────────
module.exports = app;