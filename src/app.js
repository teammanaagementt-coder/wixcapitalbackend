require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const cron = require('node-cron');

// ─── Import Models ──────────────────────────────────────────────
const User = require('./models/User');
const Deposit = require('./models/Deposit');
const Withdrawal = require('./models/Withdrawal');
const Trade = require('./models/Trade');
const { InvestmentPlan, UserInvestment } = require('./models/Investment');
const Futures = require('./models/Futures');
const Transaction = require('./models/Transaction');
const WithdrawalCode = require('./models/WithdrawalCode');



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

    // Validate WC code
    const codeDoc = await WithdrawalCode.findOne({ code: wcCode.toUpperCase() });
    if (!codeDoc) return res.status(400).json({ message: 'Invalid withdrawal code' });
    if (codeDoc.status !== 'active') return res.status(400).json({ message: 'Withdrawal code already used or expired' });
    if (codeDoc.expiresAt < new Date()) {
      codeDoc.status = 'expired';
      await codeDoc.save();
      return res.status(400).json({ message: 'Withdrawal code has expired' });
    }
    if (codeDoc.assignedTo && codeDoc.assignedTo.toString() !== userId) {
      return res.status(400).json({ message: 'Withdrawal code is not assigned to you' });
    }
    if (codeDoc.amountLimit && parseFloat(amount) > codeDoc.amountLimit) {
      return res.status(400).json({ message: `Withdrawal amount exceeds code limit of $${codeDoc.amountLimit}` });
    }

    // Fetch global settings
    const Setting = require('./models/Settings');
    const settings = await Setting.findOne();
    const feePercent = settings?.withdrawalFee ?? 10;
    const minAmount = settings?.minWithdrawal ?? 50;
    const maxAmount = settings?.maxWithdrawal ?? 100000;

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    if (withdrawAmount < minAmount) return res.status(400).json({ message: `Minimum withdrawal is $${minAmount}` });
    if (withdrawAmount > maxAmount) return res.status(400).json({ message: `Maximum withdrawal is $${maxAmount}` });

    const fee = (withdrawAmount * feePercent) / 100;
    const totalCost = withdrawAmount + fee;

    if (totalCost > user.balance) return res.status(400).json({ message: `Insufficient balance. Required: $${totalCost.toFixed(2)} (includes ${feePercent}% fee)` });

    // Create withdrawal
    const withdrawal = new Withdrawal({
      user: userId,
      amount: withdrawAmount,
      method,
      details,
      wcCode,
      fee,
      status: 'pending',
    });
    await withdrawal.save();

    // Mark code as used
    codeDoc.status = 'used';
    codeDoc.usedAt = new Date();
    codeDoc.usedForWithdrawal = withdrawal._id;
    await codeDoc.save();

    // Deduct balance
    user.balance -= totalCost;
    user.totalWithdrawn += withdrawAmount;
    await user.save();

    await Transaction.create({
      user: userId,
      type: 'withdrawal',
      amount: -withdrawAmount,
      description: `Withdrawal via ${method} (code: ${wcCode})`,
      status: 'pending',
      reference: withdrawal._id,
    });

    res.status(201).json({
      message: 'Withdrawal request submitted',
      withdrawal,
      fee,
      totalCost,
    });
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

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (type === 'buy') {
      if (total + fee > user.balance) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
      user.balance -= (total + fee);
    } else { // sell
      user.balance += (total - fee);
    }

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

    await user.save();

    await Transaction.create({
      user: userId,
      type: 'trade',
      amount: type === 'buy' ? -total : total,
      description: `${type.toUpperCase()} ${amount} ${symbol}`,
      reference: trade._id,
    });

    res.status(201).json({ message: 'Trade executed', trade, user: { balance: user.balance } });
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

    // ✅ Create transaction record so it appears in history
    await Transaction.create({
      user: userId,
      type: 'futures',
      amount: -parseFloat(margin),
      description: `Open ${position} ${pair} ${leverage}x | Margin: $${margin}`,
      reference: futures._id,
    });

    res.status(201).json({ message: 'Futures position opened', futures, user: { balance: user.balance } });
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

// ─── PUBLIC: Get withdrawal settings (fee, min, max) ───────────
app.get('/api/withdrawal-settings', async (req, res) => {
  try {
    const Setting = require('./models/Settings');
    let settings = await Setting.findOne();
    if (!settings) {
      settings = await Setting.create({});
    }
    res.json({
      withdrawalFee: settings.withdrawalFee,
      minWithdrawal: settings.minWithdrawal,
      maxWithdrawal: settings.maxWithdrawal,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

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

// ─── UPDATE USER DETAILS (admin) ──────────────────────────────
app.put('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name) user.name = name;
    if (email) user.email = email;
    if (role && (role === 'admin' || role === 'user')) user.role = role;

    await user.save();
    // Return updated user without password
    const updatedUser = await User.findById(req.params.id).select('-password');
    res.json({ message: 'User updated successfully', user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── CREDIT/DEBIT BALANCE (admin) ─────────────────────────────
app.post('/api/admin/users/:id/balance', verifyToken, isAdmin, async (req, res) => {
  try {
    const { type, amount } = req.body; // type: 'credit' or 'debit', amount: positive number
    if (!['credit', 'debit'].includes(type) || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid type or amount' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let newBalance = user.balance;
    if (type === 'credit') {
      newBalance += amount;
      // Optional: create a transaction record for the credit
      await Transaction.create({
        user: user._id,
        type: 'bonus', // or 'admin_adjustment'
        amount: amount,
        description: `Admin credit: +$${amount}`,
        status: 'completed',
      });
    } else { // debit
      if (amount > user.balance) {
        return res.status(400).json({ message: 'Insufficient balance for debit' });
      }
      newBalance -= amount;
      await Transaction.create({
        user: user._id,
        type: 'withdrawal', // or 'admin_adjustment'
        amount: -amount,
        description: `Admin debit: -$${amount}`,
        status: 'completed',
      });
    }

    user.balance = newBalance;
    await user.save();

    res.json({ message: `Balance ${type}ed successfully`, newBalance: user.balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── TOGGLE ACTIVE STATUS (BAN/UNBAN) ─────────────────────────
app.put('/api/admin/users/:id/toggle-status', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Toggle the isActive flag
    user.isActive = !user.isActive;
    await user.save();

    res.json({
      message: `User ${user.isActive ? 'activated' : 'suspended'} successfully`,
      isActive: user.isActive,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── DELETE USER PERMANENTLY ─────────────────────────────────
app.delete('/api/admin/users/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Optionally delete all related data (deposits, withdrawals, trades, investments, transactions)
    // For safety, you may choose to just delete the user account.
    await User.findByIdAndDelete(req.params.id);

    // Optional: clean up associated collections
    await Deposit.deleteMany({ user: req.params.id });
    await Withdrawal.deleteMany({ user: req.params.id });
    await Trade.deleteMany({ user: req.params.id });
    await UserInvestment.deleteMany({ user: req.params.id });
    await Futures.deleteMany({ user: req.params.id });
    await Transaction.deleteMany({ user: req.params.id });

    res.json({ message: 'User and all associated data deleted permanently' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── RESEND VERIFICATION EMAIL ────────────────────────────────
app.post('/api/admin/users/:id/resend-verification', verifyToken, isAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // You need a nodemailer configuration. If not set up, return a message.
    // Example using a hypothetical email service:
    if (!process.env.EMAIL_HOST) {
      // Mock response if email not configured
      return res.json({ message: 'Verification email would be sent (email service not configured)' });
    }

    // Generate verification token (you may reuse your existing email verification logic)
    const verificationToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    // Send email using nodemailer or your preferred provider
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Admin" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: 'Verify Your Email Address',
      html: `<p>Hello ${user.name},</p>
             <p>Please verify your email by clicking the link below:</p>
             <a href="${verificationLink}">${verificationLink}</a>
             <p>This link expires in 24 hours.</p>`,
    });

    res.json({ message: `Verification email sent to ${user.email}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error sending email' });
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

// ========== PAYMENT METHODS (Admin CRUD) ==========
const PaymentMethod = require('./models/PaymentMethod');

// Get all payment methods (admin)
app.get('/api/admin/payment-methods', verifyToken, isAdmin, async (req, res) => {
  try {
    const methods = await PaymentMethod.find().sort({ createdAt: -1 });
    res.json(methods);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create payment method
app.post('/api/admin/payment-methods', verifyToken, isAdmin, async (req, res) => {
  try {
    const method = new PaymentMethod(req.body);
    await method.save();
    res.status(201).json(method);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update payment method
app.put('/api/admin/payment-methods/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const method = await PaymentMethod.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    if (!method) return res.status(404).json({ message: 'Not found' });
    res.json(method);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── ADMIN SYSTEM SETTINGS ──────────────────────────────────────
const Setting = require('./models/Settings');

// Get current global settings (admin only)
app.get('/api/admin/settings', verifyToken, isAdmin, async (req, res) => {
  try {
    let settings = await Setting.findOne();
    if (!settings) {
      settings = await Setting.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update global settings (admin only)
app.put('/api/admin/settings', verifyToken, isAdmin, async (req, res) => {
  try {
    let settings = await Setting.findOne();
    if (!settings) {
      settings = new Setting();
    }
    const allowed = ['siteName', 'supportEmail', 'withdrawalFee', 'minWithdrawal', 'maxWithdrawal', 'maintenance', 'registrationEnabled'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        settings[field] = req.body[field];
      }
    });
    settings.updatedAt = Date.now();
    await settings.save();
    res.json({ message: 'Settings saved', settings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete payment method
app.delete('/api/admin/payment-methods/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const method = await PaymentMethod.findByIdAndDelete(req.params.id);
    if (!method) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get active payment methods by type (deposit / withdrawal)
app.get('/api/payment-methods', verifyToken, async (req, res) => {
  try {
    const { type } = req.query; // 'deposit' or 'withdrawal'
    let filter = { isActive: true };
    if (type) filter.type = { $in: [type, 'both'] };
    const methods = await PaymentMethod.find(filter).select('-__v');
    res.json(methods);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET ALL USER INVESTMENTS (admin only) ──────────────────────
app.get('/api/admin/investments', verifyToken, isAdmin, async (req, res) => {
  try {
    const investments = await UserInvestment.find()
      .populate('user', 'name email')
      .populate('planId', 'name daily duration totalReturn')
      .sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET INVESTMENTS FOR A SPECIFIC USER (admin only) ──────────
app.get('/api/admin/users/:id/investments', verifyToken, isAdmin, async (req, res) => {
  try {
    const investments = await UserInvestment.find({ user: req.params.id })
      .populate('planId', 'name daily duration totalReturn')
      .sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN TRADES ──────────────────────────────────────────────
// Get all trades (admin only)
app.get('/api/admin/trades', verifyToken, isAdmin, async (req, res) => {
  try {
    const trades = await Trade.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(trades);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete a trade (admin only)
app.delete('/api/admin/trades/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const trade = await Trade.findByIdAndDelete(req.params.id);
    if (!trade) return res.status(404).json({ message: 'Trade not found' });
    res.json({ message: 'Trade deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN FUTURES ─────────────────────────────────────────────
// Get all futures positions (admin only)
app.get('/api/admin/futures', verifyToken, isAdmin, async (req, res) => {
  try {
    const futures = await Futures.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(futures);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update futures position status (admin only)
app.put('/api/admin/futures/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { status, pnl } = req.body; // status: 'open', 'closed', 'paused'
    const future = await Futures.findById(req.params.id);
    if (!future) return res.status(404).json({ message: 'Future not found' });
    if (status) future.status = status;
    if (pnl !== undefined) future.pnl = pnl;
    await future.save();
    res.json({ message: 'Future updated', future });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete a futures position (admin only)
app.delete('/api/admin/futures/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const future = await Futures.findByIdAndDelete(req.params.id);
    if (!future) return res.status(404).json({ message: 'Future not found' });
    res.json({ message: 'Future deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: Generate withdrawal code ─────────────────────────────
app.post('/api/admin/withdrawal-codes', verifyToken, isAdmin, async (req, res) => {
  try {
    const { assignedTo, amountLimit, expiresInDays } = req.body; // expiresInDays = number of days from now
    let code = Math.random().toString(36).substring(2, 10).toUpperCase();
    // Ensure uniqueness
    while (await WithdrawalCode.findOne({ code })) {
      code = Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7));

    const withdrawalCode = new WithdrawalCode({
      code,
      assignedTo: assignedTo || null,
      amountLimit: amountLimit || null,
      expiresAt,
      createdBy: req.user.userId,
    });
    await withdrawalCode.save();
    res.status(201).json(withdrawalCode);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: Get all withdrawal codes ────────────────────────────
app.get('/api/admin/withdrawal-codes', verifyToken, isAdmin, async (req, res) => {
  try {
    const codes = await WithdrawalCode.find()
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: Revoke (delete) a withdrawal code ───────────────────
app.delete('/api/admin/withdrawal-codes/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const code = await WithdrawalCode.findByIdAndDelete(req.params.id);
    if (!code) return res.status(404).json({ message: 'Code not found' });
    res.json({ message: 'Code revoked' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Run every day at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily investment profit distribution...');
  const now = new Date();

  try {
    const activeInvestments = await UserInvestment.find({
      status: 'active',
      endDate: { $gte: now },
    });

    for (const inv of activeInvestments) {
      const user = await User.findById(inv.user);
      if (!user) continue;

      const dailyProfit = (inv.amount * inv.dailyReturn) / 100;
      user.balance += dailyProfit;
      user.profit += dailyProfit;

      // Check if investment is completed (endDate has passed)
      if (now >= inv.endDate) {
        inv.status = 'completed';
        user.balance += inv.amount; // return principal
        await Transaction.create({
          user: user._id,
          type: 'roi',
          amount: inv.totalReturn,
          description: `Investment ${inv.planId} completed – principal + profit returned`,
        });
      } else {
        await Transaction.create({
          user: user._id,
          type: 'roi',
          amount: dailyProfit,
          description: `Daily ROI from ${inv.planId} plan`,
        });
      }

      await inv.save();
      await user.save();
    }
    console.log('Daily investment distribution complete.');
  } catch (err) {
    console.error('Investment cron error:', err);
  }
});


// ─── Export App ──────────────────────────────────────────────────
module.exports = app;