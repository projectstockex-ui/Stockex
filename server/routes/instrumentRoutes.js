import express from 'express';
import mongoose from 'mongoose';
import Instrument from '../models/Instrument.js';
import Watchlist from '../models/Watchlist.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import marketDataService from '../services/marketDataService.js';
import { FOREX_PAIRS } from '../services/forexMarketService.js';
import { protectUser, protectAdmin, superAdminOnly } from '../middleware/auth.js';
import {
  ensureCryptoDerivativesInstruments,
  syncBinanceUsdtmPerpetualInstruments,
  upsertSyntheticCryptoOptionsInstruments
} from '../utils/ensureCryptoDerivatives.js';
import { sanitizeInstrumentTradingDefaultsCommission } from '../middleware/commissionValidation.js';
import { manualCheckExpiredInstruments } from '../services/instrumentExpiryService.js';
import {
  addActiveDerivExpiryToQuery,
  isExpiredDerivative,
  watchlistItemIsExpired
} from '../utils/derivativeExpiry.js';
import {
  applyTradingPanelVisibilityToQuery,
  sanitizeTradingPanelVisibilityBody,
} from '../utils/tradingPanelVisibility.js';
import {
  forcedCloseInstrumentsByIds,
  forcedOpenInstrumentsByIds
} from '../services/instrumentForcedCloseService.js';
import {
  attachLtpBracketForUser,
  sanitizeLtpBracketBody,
} from '../services/ltpBracketService.js';

/** Synthetic FX spot rows (DB) — client used to rely on hardcoded pairs only. */
async function ensureForexSpotTabIfEmpty() {
  const n = await Instrument.countDocuments({
    exchange: 'FOREX',
    isEnabled: true,
    displaySegment: { $in: ['FOREXFUT', 'FOREX'] },
    instrumentType: { $nin: ['OPTIONS'] }
  });
  if (n >= 12) return;
  for (const pair of FOREX_PAIRS) {
    const p = String(pair).toUpperCase();
    const label = p.length === 6 ? `${p.slice(0, 3)}/${p.slice(3)}` : p;
    await Instrument.updateOne(
      { token: p },
      {
        $setOnInsert: {
          token: p,
          symbol: p,
          name: `${label} (FX)`,
          exchange: 'FOREX',
          segment: 'CURRENCY',
          displaySegment: 'FOREXFUT',
          instrumentType: 'CURRENCY',
          category: 'FX',
          pair: p,
          lotSize: 1,
          isEnabled: true
        }
      },
      { upsert: true }
    );
  }
}

/** Synthetic FX vanilla options (DB) — same idea as CRYPTOOPT seed. */
async function ensureForexOptionsTabIfEmpty() {
  const n = await Instrument.countDocuments({
    exchange: 'FOREX',
    isEnabled: true,
    displaySegment: 'FOREXOPT',
    instrumentType: 'OPTIONS'
  });
  if (n >= 20) return;

  const expiry = new Date();
  expiry.setUTCMonth(expiry.getUTCMonth() + 1);
  expiry.setUTCDate(Math.min(28, expiry.getUTCDate()));
  const expKey = `${expiry.getUTCFullYear()}${String(expiry.getUTCMonth() + 1).padStart(2, '0')}${String(expiry.getUTCDate()).padStart(2, '0')}`;

  const chains = [
    { pair: 'EURUSD', label: 'EUR/USD', strikes: [1.04, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1, 1.11, 1.12], tickSize: 0.0001 },
    { pair: 'GBPUSD', label: 'GBP/USD', strikes: [1.22, 1.24, 1.26, 1.28, 1.3, 1.32, 1.34], tickSize: 0.0001 },
    { pair: 'USDJPY', label: 'USD/JPY', strikes: [140, 142, 144, 146, 148, 150, 152, 154, 156], tickSize: 0.01 }
  ];

  for (const c of chains) {
    for (const strike of c.strikes) {
      for (const ot of ['CE', 'PE']) {
        const strikeKey = String(strike).replace('.', 'p');
        const token = `FX_OPT_${c.pair}_${strikeKey}_${ot}_${expKey}`;
        const sym = `${c.pair}${strikeKey}${ot}`;
        const ltpScale = c.pair === 'USDJPY' ? 0.01 : 1;
        await Instrument.updateOne(
          { token },
          {
            $setOnInsert: {
              token,
              symbol: sym,
              tradingSymbol: `${c.pair} ${strike} ${ot} ${expKey}`,
              name: `${c.label} ${ot === 'CE' ? 'Call' : 'Put'} ${strike}`,
              exchange: 'FOREX',
              segment: 'CURRENCY',
              displaySegment: 'FOREXOPT',
              category: 'FX',
              instrumentType: 'OPTIONS',
              pair: c.pair,
              lotSize: 1,
              tickSize: c.tickSize,
              strike,
              optionType: ot,
              expiry,
              ltp: Math.max(
                0.0001,
                (ot === 'CE' ? strike * 0.002 : strike * 0.0015) * ltpScale
              ),
              isEnabled: true
            }
          },
          { upsert: true }
        );
      }
    }
  }
}

async function ensureCryptoDerivativesTabIfEmpty(displaySegment) {
  if (displaySegment === 'CRYPTOFUT') {
    const n = await Instrument.countDocuments({
      displaySegment: 'CRYPTOFUT',
      exchange: 'BINANCE',
      isEnabled: true
    });
    await syncBinanceUsdtmPerpetualInstruments({ force: n < 80 });
    return;
  }
  if (displaySegment === 'CRYPTOOPT') {
    const n = await Instrument.countDocuments({
      displaySegment: 'CRYPTOOPT',
      exchange: 'BINANCE',
      isEnabled: true
    });
    if (n < 40) await upsertSyntheticCryptoOptionsInstruments();
  }
}

/** MCX deny-picker / tabs: seed minimal commodity futures if DB has almost no MCX rows (same idea as FOREX/Binance ensures). */
async function ensureMcxRestrictionPickerSeedIfEmpty() {
  const n = await Instrument.countDocuments({ exchange: 'MCX' });
  if (n >= 5) return;

  const mcxSeed = [
    { token: '53523', symbol: 'GOLDM', name: 'Gold Mini', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 10, isFeatured: true, sortOrder: 1, isEnabled: true },
    { token: '53524', symbol: 'GOLD', name: 'Gold', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 100, isFeatured: true, sortOrder: 2, isEnabled: true },
    { token: '53525', symbol: 'SILVERM', name: 'Silver Mini', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5, sortOrder: 3, isEnabled: true },
    { token: '53526', symbol: 'SILVER', name: 'Silver', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 30, sortOrder: 4, isEnabled: true },
    { token: '53527', symbol: 'CRUDEOIL', name: 'Crude Oil', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 100, isFeatured: true, sortOrder: 5, isEnabled: true },
    { token: '53528', symbol: 'CRUDEOILM', name: 'Crude Oil Mini', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 10, sortOrder: 6, isEnabled: true },
    { token: '53529', symbol: 'NATURALGAS', name: 'Natural Gas', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 1250, sortOrder: 7, isEnabled: true },
    { token: '53530', symbol: 'COPPER', name: 'Copper', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 2500, sortOrder: 8, isEnabled: true },
    { token: '53531', symbol: 'ZINC', name: 'Zinc', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5000, sortOrder: 9, isEnabled: true },
    { token: '53532', symbol: 'ALUMINIUM', name: 'Aluminium', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5000, sortOrder: 10, isEnabled: true },
    { token: '53533', symbol: 'LEAD', name: 'Lead', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5000, sortOrder: 11, isEnabled: true },
    { token: '53534', symbol: 'NICKEL', name: 'Nickel', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 1500, sortOrder: 12, isEnabled: true }
  ];

  for (const inst of mcxSeed) {
    await Instrument.updateOne(
      { token: inst.token },
      { $setOnInsert: inst },
      { upsert: true }
    );
  }
}

const router = express.Router();

// ==================== PUBLIC ROUTES ====================

// Get all enabled instruments (for users)
router.get('/public', async (req, res) => {
  try {
    const { segment, category, search } = req.query;
    
    let query = { isEnabled: true };
    if (segment) query.segment = segment;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { symbol: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }
    addActiveDerivExpiryToQuery(query);

    // Get total count for stats
    const totalCount = await Instrument.countDocuments({});
    const enabledCount = await Instrument.countDocuments({ isEnabled: true });
    const disabledCount = await Instrument.countDocuments({ isEnabled: false });
    const featuredCount = await Instrument.countDocuments({ isFeatured: true });
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    
    const instruments = await Instrument.find(query)
      .select('token symbol name exchange segment displaySegment instrumentType optionType strike expiry lotSize ltp open high low close change changePercent volume lastUpdated category isFeatured sortOrder isEnabled lastBid lastAsk')
      .sort({ isFeatured: -1, category: 1, sortOrder: 1, symbol: 1 })
      .skip(skip)
      .limit(limit);
    
    // Return with pagination info and stats
    const queryCount = await Instrument.countDocuments(query);
    res.json({
      instruments,
      pagination: {
        page,
        limit,
        total: queryCount,
        pages: Math.ceil(queryCount / limit)
      },
      stats: {
        total: totalCount,
        enabled: enabledCount,
        disabled: disabledCount,
        featured: featuredCount
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/** User dashboard ticker: instruments disabled by Super Admin (locked) in the last 48h */
router.get('/closed-strip', async (req, res) => {
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const instruments = await Instrument.find({
      isEnabled: false,
      adminLockedClosed: true,
      updatedAt: { $gte: since }
    })
      .select('symbol name tradingSymbol displaySegment exchange updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.json({ instruments });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get instruments by exchange (for on-demand loading by segment)
router.get('/by-exchange/:exchange', protectUser, async (req, res) => {
  try {
    const { exchange } = req.params;
    const limit = parseInt(req.query.limit) || 500;
    const adminCode = req.user.adminCode;
    
    const visOr = [
      { visibleToAdmins: { $exists: false } },
      { visibleToAdmins: null },
      { visibleToAdmins: { $size: 0 } },
    ];
    if (adminCode != null && String(adminCode).trim() !== '') {
      visOr.push({ visibleToAdmins: adminCode });
    }

    const query = {
      isEnabled: true,
      exchange: exchange,
      $or: visOr,
    };
    addActiveDerivExpiryToQuery(query);

    const instruments = await Instrument.find(query)
      .select('token symbol name exchange segment displaySegment instrumentType lotSize ltp change changePercent category isFeatured tradingSymbol expiry strike optionType lastBid lastAsk')
      .sort({ isFeatured: -1, symbol: 1 })
      .limit(limit);
    
    res.json(instruments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Search instruments globally (across all exchanges)
router.get('/search', protectUser, async (req, res) => {
  try {
    const { q, limit = 100 } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }
    
    const adminCode = req.user.adminCode;
    const searchRegex = new RegExp(q, 'i');

    const searchQuery = {
      isEnabled: true,
      $or: [
        { symbol: searchRegex },
        { name: searchRegex },
        { tradingSymbol: searchRegex }
      ]
    };
    addActiveDerivExpiryToQuery(searchQuery);
    const instruments = await Instrument.find(searchQuery)
      .select('token symbol name exchange segment displaySegment instrumentType lotSize ltp change changePercent category tradingSymbol expiry strike optionType lastBid lastAsk')
      .sort({ isFeatured: -1, exchange: 1, symbol: 1 })
      .limit(parseInt(limit));
    
    res.json(instruments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/** Shared visibility + segment filters for `/user` and `/client/closed-search` (no isEnabled filter). */
function buildUserInstrumentListQuery(adminCode, { segment, category, search, displaySegment }) {
  const visibilityOr = [
    { visibleToAdmins: { $exists: false } },
    { visibleToAdmins: null },
    { visibleToAdmins: { $size: 0 } },
  ];
  if (adminCode != null && String(adminCode).trim() !== '') {
    visibilityOr.push({ visibleToAdmins: adminCode });
  }

  const query = {
    $or: visibilityOr,
    $and: [
      {
        $or: [
          { hiddenFromAdmins: { $exists: false } },
          { hiddenFromAdmins: null },
          { hiddenFromAdmins: { $size: 0 } },
          { hiddenFromAdmins: { $ne: adminCode } },
        ],
      },
    ],
  };

  if (segment) {
    if (segment === 'FOREXFUT' || segment === 'FOREXOPT') {
      query.exchange = 'FOREX';
      const forexDispOr =
        segment === 'FOREXOPT'
          ? [{ displaySegment: 'FOREXOPT' }, { displaySegment: 'FOREX', instrumentType: 'OPTIONS' }]
          : [
              { displaySegment: 'FOREXFUT' },
              { displaySegment: 'FOREX', instrumentType: { $ne: 'OPTIONS' } },
              { displaySegment: 'FOREX', instrumentType: { $exists: false } }
            ];
      query.$and.push({ $or: forexDispOr });
    } else if (segment === 'MCXFUT') {
      // Match admin Market Watch: displaySegment MCXFUT, or MCX commodities futures (Zerodha may use FUT / COMMODITY, not always "FUTURES")
      query.exchange = 'MCX';
      query.$and.push({
        $or: [
          { displaySegment: 'MCXFUT' },
          { instrumentType: { $in: ['FUTURES', 'COMMODITY', 'FUT'] } },
        ],
      });
    } else if (segment === 'MCXOPT') {
      query.exchange = 'MCX';
      query.$and.push({
        $or: [{ displaySegment: 'MCXOPT' }, { instrumentType: 'OPTIONS' }],
      });
    } else {
      const segmentMap = {
        NSEFUT: { exchange: 'NFO', instrumentType: 'FUTURES' },
        NSEOPT: { exchange: 'NFO', instrumentType: 'OPTIONS' },
        'NSE-EQ': { exchange: 'NSE' },
        'BSE-FUT': { exchange: 'BFO', instrumentType: 'FUTURES' },
        'BSE-OPT': { exchange: 'BFO', instrumentType: 'OPTIONS' },
        CRYPTOFUT: { exchange: 'BINANCE', instrumentType: 'FUTURES', displaySegment: 'CRYPTOFUT' },
        CRYPTOOPT: { exchange: 'BINANCE', instrumentType: 'OPTIONS', displaySegment: 'CRYPTOOPT' }
      };

      const segmentFilter = segmentMap[segment];
      if (segmentFilter) {
        if (segmentFilter.exchange) query.exchange = segmentFilter.exchange;
        if (segmentFilter.instrumentType) query.instrumentType = segmentFilter.instrumentType;
        if (segmentFilter.displaySegment) query.displaySegment = segmentFilter.displaySegment;
      } else {
        query.segment = segment;
      }
    }
  }
  if (displaySegment) {
    if (displaySegment === 'FOREXFUT' || displaySegment === 'FOREXOPT') {
      query.exchange = 'FOREX';
      const forexDispOr =
        displaySegment === 'FOREXOPT'
          ? [{ displaySegment: 'FOREXOPT' }, { displaySegment: 'FOREX', instrumentType: 'OPTIONS' }]
          : [
              { displaySegment: 'FOREXFUT' },
              { displaySegment: 'FOREX', instrumentType: { $ne: 'OPTIONS' } },
              { displaySegment: 'FOREX', instrumentType: { $exists: false } }
            ];
      query.$and.push({ $or: forexDispOr });
    } else {
      query.displaySegment = displaySegment;
    }
  }
  if (category) query.category = category;
  if (search) {
    query.$and.push({
      $or: [
        { symbol: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { tradingSymbol: { $regex: search, $options: 'i' } }
      ]
    });
  }
  addActiveDerivExpiryToQuery(query);
  applyTradingPanelVisibilityToQuery(query);
  return query;
}

async function ensureInstrumentTabsForUserSegment(segment, displaySegment) {
  if (segment === 'CRYPTOFUT' || segment === 'CRYPTOOPT') {
    await ensureCryptoDerivativesTabIfEmpty(segment);
  }
  if (segment === 'FOREXFUT' || displaySegment === 'FOREXFUT') {
    await ensureForexSpotTabIfEmpty();
  }
  if (segment === 'FOREXOPT' || displaySegment === 'FOREXOPT') {
    await ensureForexOptionsTabIfEmpty();
  }
  if (displaySegment === 'CRYPTOFUT' || displaySegment === 'CRYPTOOPT') {
    await ensureCryptoDerivativesTabIfEmpty(displaySegment);
  }
}

const CLIENT_OPEN_DURATION_DAYS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };

// Disabled instruments the user may ask to open temporarily (not admin-locked)
router.get('/client/closed-search', protectUser, async (req, res) => {
  try {
    const { segment, category, search, displaySegment } = req.query;
    if (!search || String(search).length < 2) {
      return res.json([]);
    }
    const adminCode = req.user.adminCode;
    await ensureInstrumentTabsForUserSegment(segment, displaySegment);
    const query = buildUserInstrumentListQuery(adminCode, { segment, category, search, displaySegment });
    query.isEnabled = false;
    query.adminLockedClosed = { $ne: true };

    const instruments = await Instrument.find(query)
      .select(
        'token symbol name exchange segment displaySegment instrumentType lotSize ltp open high low close change changePercent volume lastUpdated category isFeatured tradingSymbol expiry strike optionType adminLockedClosed clientTemporaryOpenUntil lastBid lastAsk'
      )
      .sort({ isFeatured: -1, exchange: 1, symbol: 1 })
      .limit(40);

    res.json(instruments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/client/request-open', protectUser, async (req, res) => {
  try {
    const { token, duration = '7d' } = req.body || {};
    const days = CLIENT_OPEN_DURATION_DAYS[duration];
    if (!token || days == null) {
      return res
        .status(400)
        .json({ message: 'token and valid duration (1d, 7d, 30d, 90d) are required' });
    }
    const inst = await Instrument.findOne({ token: String(token) });
    if (!inst) {
      return res.status(404).json({ message: 'Instrument not found' });
    }
    if (isExpiredDerivative({ instrumentType: inst.instrumentType, expiry: inst.expiry })) {
      return res.status(400).json({ message: 'This contract has expired' });
    }
    if (inst.adminLockedClosed) {
      return res.status(403).json({
        message: 'This symbol is closed by the administrator. Temporary access cannot be granted.'
      });
    }

    const proposed = new Date(Date.now() + days * 86400000);

    if (!inst.isEnabled) {
      inst.isEnabled = true;
      inst.clientTemporaryOpenUntil = proposed;
      await inst.save();
      return res.json({
        ok: true,
        until: inst.clientTemporaryOpenUntil,
        instrument: { token: inst.token, symbol: inst.symbol, name: inst.name }
      });
    }

    if (inst.clientTemporaryOpenUntil) {
      const cur = new Date(inst.clientTemporaryOpenUntil);
      const next = cur > proposed ? cur : proposed;
      inst.clientTemporaryOpenUntil = next;
      await inst.save();
      return res.json({
        ok: true,
        extended: true,
        until: inst.clientTemporaryOpenUntil,
        instrument: { token: inst.token, symbol: inst.symbol, name: inst.name }
      });
    }

    return res.json({
      ok: true,
      alreadyOpen: true,
      message: 'Instrument is already available',
      instrument: { token: inst.token, symbol: inst.symbol, name: inst.name }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get instruments for a specific user (respects admin visibility settings)
router.get('/user', protectUser, async (req, res) => {
  try {
    const { segment, category, search, displaySegment } = req.query;
    const adminCode = req.user.adminCode;

    await ensureInstrumentTabsForUserSegment(segment, displaySegment);
    const query = buildUserInstrumentListQuery(adminCode, { segment, category, search, displaySegment });
    // Match admin Market Watch: include Super Admin "forced close" rows (LIST TRADING off) so users still see the contract, not only enabled rows.
    if (!query.$and) query.$and = [];
    query.$and.push({
      $or: [
        { isEnabled: true },
        {
          adminLockedClosed: true,
          isEnabled: false,
        },
      ],
    });

    const instruments = await Instrument.find(query)
      .select(
        'token symbol name exchange segment displaySegment instrumentType lotSize ltp open high low close change changePercent volume lastUpdated category isFeatured tradingSymbol expiry strike optionType lastBid lastAsk isEnabled adminLockedClosed clientTemporaryOpenUntil ltpBracketPercentUp ltpBracketPercentDown'
      )
      .sort({ isFeatured: -1, exchange: 1, symbol: 1 });

    const userDoc = await User.findById(req.user._id).select('ltpBracketTokens').lean();
    res.json(attachLtpBracketForUser(instruments, userDoc));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== ADMIN ROUTES ====================

// Get all instruments (admin view)
router.get('/admin', protectAdmin, async (req, res) => {
  try {
    let {
      segment,
      category,
      search,
      enabled,
      optionType,
      displaySegment,
      expiryDate,
      expiryFrom,
      expiryTo,
      startDate,
      endDate,
      includeExpired,
    } = req.query;
    // UI historically sent segment=FOREXFUT; DB filter is on displaySegment
    if (!displaySegment && (segment === 'FOREXFUT' || segment === 'FOREXOPT')) {
      displaySegment = segment;
      segment = undefined;
    }

    let query = {};
    if (segment) query.segment = segment;
    if (displaySegment) {
      if (displaySegment === 'FOREXFUT' || displaySegment === 'FOREXOPT') {
        if (displaySegment === 'FOREXFUT') await ensureForexSpotTabIfEmpty();
        if (displaySegment === 'FOREXOPT') await ensureForexOptionsTabIfEmpty();
        const forexOr =
          displaySegment === 'FOREXOPT'
            ? [{ displaySegment: 'FOREXOPT' }, { displaySegment: 'FOREX', exchange: 'FOREX', instrumentType: 'OPTIONS' }]
            : [
                { displaySegment: 'FOREXFUT' },
                { displaySegment: 'FOREX', exchange: 'FOREX', instrumentType: { $ne: 'OPTIONS' } },
                { displaySegment: 'FOREX', exchange: 'FOREX', instrumentType: { $exists: false } }
              ];
        if (search) {
          const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          query.$and = [
            { $or: forexOr },
            { $or: [{ symbol: rx }, { name: rx }] }
          ];
        } else {
          query.$or = forexOr;
        }
      } else {
        // Backward-compatible segment filter:
        // prefer explicit displaySegment, but include legacy rows inferred by exchange/type.
        if (displaySegment === 'NSEFUT') {
          query.$or = [
            { displaySegment: 'NSEFUT' },
            { exchange: 'NFO', instrumentType: 'FUTURES' },
            { exchange: 'NFO', instrumentType: 'FUT' }
          ];
        } else if (displaySegment === 'NSEOPT') {
          query.$or = [
            { displaySegment: 'NSEOPT' },
            { exchange: 'NFO', instrumentType: 'OPTIONS' },
            { exchange: 'NFO', instrumentType: 'OPTION' }
          ];
        } else if (displaySegment === 'MCXFUT') {
          query.$or = [
            { displaySegment: 'MCXFUT' },
            { exchange: 'MCX', instrumentType: 'FUTURES' },
            { exchange: 'MCX', instrumentType: 'COMMODITY' },
            { exchange: 'MCX', instrumentType: 'FUT' }
          ];
        } else if (displaySegment === 'MCXOPT') {
          query.$or = [
            { displaySegment: 'MCXOPT' },
            { exchange: 'MCX', instrumentType: 'OPTIONS' },
            { exchange: 'MCX', instrumentType: 'OPTION' }
          ];
        } else if (displaySegment === 'BSE-FUT') {
          query.$or = [
            { displaySegment: 'BSE-FUT' },
            { exchange: 'BFO', instrumentType: 'FUTURES' },
            { exchange: 'BFO', instrumentType: 'FUT' }
          ];
        } else if (displaySegment === 'BSE-OPT') {
          query.$or = [
            { displaySegment: 'BSE-OPT' },
            { exchange: 'BFO', instrumentType: 'OPTIONS' },
            { exchange: 'BFO', instrumentType: 'OPTION' }
          ];
        } else {
          query.displaySegment = displaySegment;
        }
      }
    }
    if (category) query.category = category;
    if (enabled !== undefined) query.isEnabled = enabled === 'true';
    if (optionType) {
      if (optionType === 'FUT') {
        query.instrumentType = 'FUTURES';
      } else {
        query.optionType = optionType;
      }
    }
    if (search && !(displaySegment === 'FOREXFUT' || displaySegment === 'FOREXOPT')) {
      const searchOr = [
        { symbol: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
      if (query.$or) {
        if (!query.$and) query.$and = [];
        query.$and.push({ $or: searchOr });
      } else {
        query.$or = searchOr;
      }
    }
    
    // Filter by expiry date - show instruments expiring up to the selected date
    if (expiryDate) {
      const filterDate = new Date(expiryDate);
      if (!isNaN(filterDate.getTime())) {
        // Set to end of day to include instruments expiring on the selected date
        filterDate.setHours(23, 59, 59, 999);
        query.expiry = { $lte: filterDate };
      }
    }

    const rangeFrom = expiryFrom || startDate;
    const rangeTo = expiryTo || endDate;
    const hasExpiryRange = Boolean(rangeFrom || rangeTo);
    if (hasExpiryRange) {
      const expiryFilter = {};
      if (rangeFrom) {
        const fromDate = new Date(rangeFrom);
        if (!Number.isNaN(fromDate.getTime())) {
          fromDate.setHours(0, 0, 0, 0);
          expiryFilter.$gte = fromDate;
        }
      }
      if (rangeTo) {
        const toDate = new Date(rangeTo);
        if (!Number.isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          expiryFilter.$lte = toDate;
        }
      }
      if (Object.keys(expiryFilter).length > 0) {
        query.expiry = { ...(query.expiry || {}), ...expiryFilter };
      }
    }

    // Market Watch: hide rolled / past F&O (same as user lists). Opt out: ?includeExpired=true
    // Skip when expiry range filters are set — admin controls the window explicitly.
    if (!expiryDate && !hasExpiryRange && includeExpired !== 'true' && includeExpired !== '1') {
      addActiveDerivExpiryToQuery(query);
    }

    if (displaySegment === 'CRYPTOFUT' || displaySegment === 'CRYPTOOPT') {
      await ensureCryptoDerivativesTabIfEmpty(displaySegment);
    }
    
    // Get total counts for stats
    const totalCount = await Instrument.countDocuments({});
    const enabledCount = await Instrument.countDocuments({ isEnabled: true });
    const disabledCount = await Instrument.countDocuments({ isEnabled: false });
    const featuredCount = await Instrument.countDocuments({ isFeatured: true });
    
    // Pagination - default 100 per page, max 500
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
    const skip = (page - 1) * limit;
    
    const instruments = await Instrument.find(query)
      .sort({ category: 1, optionType: 1, strike: 1, sortOrder: 1, symbol: 1 })
      .skip(skip)
      .limit(limit);
    
    const queryCount = await Instrument.countDocuments(query);
    
    res.json({
      instruments,
      pagination: {
        page,
        limit,
        total: queryCount,
        pages: Math.ceil(queryCount / limit)
      },
      stats: {
        total: totalCount,
        enabled: enabledCount,
        disabled: disabledCount,
        featured: featuredCount
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * Super Admin → Restrictions: cascading dropdown data for hierarchical instrument deny-list.
 * - Without displaySegment: returns distinct displaySegment tabs for the exchange.
 * - With displaySegment: returns instruments for exchange + tab (includes expired when includeExpired=1).
 */
router.get('/admin/restriction-deny-picker', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const exchangeRaw = String(req.query.exchange || '').trim().toUpperCase();
    const displaySegmentRaw = String(req.query.displaySegment || '').trim();
    const allowedUiExchanges = ['NSE', 'BSE', 'NFO', 'MCX', 'CDS', 'BFO', 'BINANCE', 'FOREX'];
    if (!exchangeRaw || !allowedUiExchanges.includes(exchangeRaw)) {
      return res.status(400).json({ message: 'Missing or invalid exchange' });
    }

    const dbExchange = exchangeRaw;

    if (!displaySegmentRaw) {
      if (dbExchange === 'FOREX') {
        await ensureForexSpotTabIfEmpty();
        await ensureForexOptionsTabIfEmpty();
      }
      if (dbExchange === 'BINANCE') {
        await ensureCryptoDerivativesTabIfEmpty('CRYPTOFUT');
        await ensureCryptoDerivativesTabIfEmpty('CRYPTOOPT');
      }
      if (dbExchange === 'MCX') {
        await ensureMcxRestrictionPickerSeedIfEmpty();
      }
      const segments = await Instrument.distinct('displaySegment', { exchange: dbExchange });
      let cleaned = segments.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
      if (dbExchange === 'MCX') {
        const tabs = ['MCXFUT', 'MCXOPT'];
        cleaned = [...new Set([...cleaned, ...tabs])].sort((a, b) => String(a).localeCompare(String(b)));
      }
      return res.json({ segments: cleaned });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 8000);
    const includeExpired = req.query.includeExpired === '1' || req.query.includeExpired === 'true';

    let query = {};

    if (displaySegmentRaw === 'FOREXFUT' || displaySegmentRaw === 'FOREXOPT') {
      if (displaySegmentRaw === 'FOREXFUT') await ensureForexSpotTabIfEmpty();
      if (displaySegmentRaw === 'FOREXOPT') await ensureForexOptionsTabIfEmpty();
      const forexOr =
        displaySegmentRaw === 'FOREXOPT'
          ? [
              { displaySegment: 'FOREXOPT' },
              { displaySegment: 'FOREX', exchange: 'FOREX', instrumentType: 'OPTIONS' },
            ]
          : [
              { displaySegment: 'FOREXFUT' },
              { displaySegment: 'FOREX', exchange: 'FOREX', instrumentType: { $ne: 'OPTIONS' } },
              { displaySegment: 'FOREX', exchange: 'FOREX', instrumentType: { $exists: false } },
            ];
      query.$and = [{ exchange: 'FOREX' }, { $or: forexOr }];
    } else {
      if (displaySegmentRaw === 'CRYPTOFUT' || displaySegmentRaw === 'CRYPTOOPT') {
        await ensureCryptoDerivativesTabIfEmpty(displaySegmentRaw);
      }
      if (dbExchange === 'MCX' && (displaySegmentRaw === 'MCXFUT' || displaySegmentRaw === 'MCXOPT')) {
        await ensureMcxRestrictionPickerSeedIfEmpty();
      }
      if (dbExchange === 'MCX' && displaySegmentRaw === 'MCXFUT') {
        query.$and = [
          { exchange: 'MCX' },
          {
            $or: [
              { displaySegment: 'MCXFUT' },
              { instrumentType: { $in: ['FUTURES', 'COMMODITY', 'FUT'] } },
            ],
          },
        ];
      } else if (dbExchange === 'MCX' && displaySegmentRaw === 'MCXOPT') {
        query.$and = [
          { exchange: 'MCX' },
          {
            $or: [{ displaySegment: 'MCXOPT' }, { instrumentType: 'OPTIONS' }],
          },
        ];
      } else {
        query.exchange = dbExchange;
        query.displaySegment = displaySegmentRaw;
      }
    }

    if (!includeExpired) addActiveDerivExpiryToQuery(query);

    const instruments = await Instrument.find(query)
      .select('symbol tradingSymbol segment displaySegment name token exchange instrumentType expiry')
      .sort({ symbol: 1 })
      .limit(limit)
      .lean();

    res.json({ instruments });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add new instrument (Super Admin only)
router.post('/admin', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const instrument = await Instrument.create(req.body);
    res.status(201).json(instrument);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Bulk add instruments (Super Admin only)
router.post('/admin/bulk', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { instruments } = req.body;
    
    const result = await Instrument.insertMany(instruments, { ordered: false });
    res.status(201).json({ 
      message: `${result.length} instruments added`,
      count: result.length 
    });
  } catch (error) {
    if (error.writeErrors) {
      res.status(207).json({ 
        message: `Partial success: ${error.insertedDocs?.length || 0} added, ${error.writeErrors.length} failed`,
        errors: error.writeErrors.map(e => e.errmsg)
      });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Bulk toggle instruments (must be before /admin/:id to avoid route conflict)
router.put('/admin/bulk-toggle', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { ids, isEnabled } = req.body;
    const setDoc =
      isEnabled === true
        ? {
            isEnabled: true,
            adminLockedClosed: false,
            clientTemporaryOpenUntil: null,
            adminScheduledReopenAt: null
          }
        : {
            isEnabled: false,
            adminLockedClosed: true,
            clientTemporaryOpenUntil: null,
            adminScheduledReopenAt: null
          };

    await Instrument.updateMany({ _id: { $in: ids } }, { $set: setDoc });

    res.json({ message: `${ids.length} instruments updated` });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

/** Super Admin: apply the same `tradingDefaults` payload to many instruments (e.g. Market Watch sector). */
router.put(
  '/admin/bulk-trading-defaults',
  protectAdmin,
  superAdminOnly,
  sanitizeInstrumentTradingDefaultsCommission,
  async (req, res) => {
    try {
      if (req.admin.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ message: 'Only Super Admin can bulk-update trading defaults' });
      }
      const { ids, tradingDefaults: incomingTd } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'ids must be a non-empty array' });
      }
      if (!incomingTd || typeof incomingTd !== 'object') {
        return res.status(400).json({ message: 'tradingDefaults object is required' });
      }
      const MAX = 2500;
      if (ids.length > MAX) {
        return res.status(400).json({ message: `Maximum ${MAX} instruments per bulk request` });
      }
      const objectIds = ids
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)));
      if (objectIds.length === 0) {
        return res.status(400).json({ message: 'No valid instrument ids' });
      }

      const tradingDefaults = { ...incomingTd };
      tradingDefaults.enabled = true;

      const instruments = await Instrument.find({ _id: { $in: objectIds } })
        .select('tradingDefaults')
        .lean();

      const bulkOps = instruments.map((inst) => {
        const prevTd = inst.tradingDefaults || {};
        const merged = {
          ...tradingDefaults,
          enabled: true,
          blockTrading: !!prevTd.blockTrading,
          notes: typeof prevTd.notes === 'string' ? prevTd.notes : '',
        };
        return {
          updateOne: {
            filter: { _id: inst._id },
            update: { $set: { tradingDefaults: merged } },
          },
        };
      });

      if (bulkOps.length === 0) {
        return res.json({ message: 'No matching instruments', modifiedCount: 0 });
      }

      const result = await Instrument.bulkWrite(bulkOps, { ordered: false });
      res.json({
        message: `Updated trading defaults on ${result.modifiedCount} instrument(s)`,
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Toggle ALL instruments at once (must be before /admin/:id)
router.put('/admin/toggle-all', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { isEnabled } = req.body;
    const setDoc =
      isEnabled === true
        ? {
            isEnabled: true,
            adminLockedClosed: false,
            clientTemporaryOpenUntil: null,
            adminScheduledReopenAt: null
          }
        : {
            isEnabled: false,
            adminLockedClosed: true,
            clientTemporaryOpenUntil: null,
            adminScheduledReopenAt: null
          };

    const result = await Instrument.updateMany({}, { $set: setDoc });

    res.json({
      message: `All ${result.modifiedCount} instruments ${isEnabled ? 'enabled' : 'disabled'}`,
      count: result.modifiedCount
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

/** Super Admin: square off open + cancel pending, then disable & lock instruments */
router.post('/admin/forced-close', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { instrumentIds } = req.body || {};
    if (!Array.isArray(instrumentIds) || instrumentIds.length === 0) {
      return res.status(400).json({ message: 'instrumentIds (non-empty array) is required' });
    }
    if (instrumentIds.length > 2000) {
      return res.status(400).json({ message: 'Maximum 2000 instruments per request' });
    }
    const result = await forcedCloseInstrumentsByIds(instrumentIds);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/** Super Admin: re-enable instruments (no automatic trade reopen) */
router.post('/admin/forced-open', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const { instrumentIds } = req.body || {};
    if (!Array.isArray(instrumentIds) || instrumentIds.length === 0) {
      return res.status(400).json({ message: 'instrumentIds (non-empty array) is required' });
    }
    if (instrumentIds.length > 2000) {
      return res.status(400).json({ message: 'Maximum 2000 instruments per request' });
    }
    const result = await forcedOpenInstrumentsByIds(instrumentIds);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update instrument
router.put('/admin/:id', protectAdmin, sanitizeInstrumentTradingDefaultsCommission, async (req, res) => {
  try {
    // Regular admins can only toggle visibility for their users
    if (req.admin.role !== 'SUPER_ADMIN') {
      const { isEnabled } = req.body;
      if (isEnabled !== undefined) {
        // Add/remove from hiddenFromAdmins
        const instrument = await Instrument.findById(req.params.id);
        if (!instrument) return res.status(404).json({ message: 'Instrument not found' });
        
        if (!isEnabled) {
          if (!instrument.hiddenFromAdmins.includes(req.admin.adminCode)) {
            instrument.hiddenFromAdmins.push(req.admin.adminCode);
          }
        } else {
          instrument.hiddenFromAdmins = instrument.hiddenFromAdmins.filter(
            code => code !== req.admin.adminCode
          );
        }
        await instrument.save();
        return res.json(instrument);
      }
      return res.status(403).json({ message: 'Only Super Admin can modify instrument details' });
    }

    if (typeof req.body?.isEnabled === 'boolean') {
      req.body.adminLockedClosed = !req.body.isEnabled;
      req.body.clientTemporaryOpenUntil = null;
      if (req.body.isEnabled === true) {
        req.body.adminScheduledReopenAt = null;
      }
    }

    if (
      req.admin.role === 'SUPER_ADMIN' &&
      Object.prototype.hasOwnProperty.call(req.body, 'adminScheduledReopenAt')
    ) {
      const v = req.body.adminScheduledReopenAt;
      if (v === '' || v === null || v === undefined) {
        req.body.adminScheduledReopenAt = null;
      } else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: 'Invalid auto re-open date' });
        }
        if (d <= new Date()) {
          return res.status(400).json({ message: 'Auto re-open must be in the future' });
        }
        req.body.adminScheduledReopenAt = d;
      }
    }

    let setBody = { ...req.body };
    try {
      const panelFields = sanitizeTradingPanelVisibilityBody(req.body);
      setBody = { ...setBody, ...panelFields };
    } catch (panelErr) {
      return res.status(400).json({ message: panelErr.message });
    }
    try {
      const bracketFields = sanitizeLtpBracketBody(req.body);
      setBody = { ...setBody, ...bracketFields };
    } catch (bracketErr) {
      return res.status(400).json({ message: bracketErr.message });
    }

    // $set merges top-level fields only (avoids ambiguous replace semantics on nested docs).
    const instrument = await Instrument.findByIdAndUpdate(
      req.params.id,
      { $set: setBody },
      { new: true, runValidators: true }
    );
    
    if (!instrument) return res.status(404).json({ message: 'Instrument not found' });
    res.json(instrument);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Toggle instrument enabled status (Super Admin only)
router.put('/admin/:id/toggle', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const instrument = await Instrument.findById(req.params.id);
    if (!instrument) return res.status(404).json({ message: 'Instrument not found' });

    const enabling = !instrument.isEnabled;
    instrument.isEnabled = enabling;
    if (enabling) {
      instrument.adminLockedClosed = false;
      instrument.clientTemporaryOpenUntil = null;
      instrument.adminScheduledReopenAt = null;
    } else {
      instrument.adminLockedClosed = true;
      instrument.clientTemporaryOpenUntil = null;
    }
    await instrument.save();

    res.json(instrument);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete instrument (Super Admin only)
router.delete('/admin/:id', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const instrument = await Instrument.findByIdAndDelete(req.params.id);
    if (!instrument) return res.status(404).json({ message: 'Instrument not found' });
    res.json({ message: 'Instrument deleted' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ==================== SEED DEFAULT INSTRUMENTS ====================

router.post('/admin/seed-defaults', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const defaultInstruments = [
      // Indices (NSE-EQ)
      // Tokens = Zerodha Kite instrument_token (NSE indices) — must match WebSocket ticks
      { token: '256265', symbol: 'NIFTY', name: 'Nifty 50', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'INDEX', category: 'INDICES', lotSize: 1, isFeatured: true, sortOrder: 1 },
      { token: '260105', symbol: 'BANKNIFTY', name: 'Bank Nifty', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'INDEX', category: 'INDICES', lotSize: 1, isFeatured: true, sortOrder: 2 },
      { token: '257801', symbol: 'FINNIFTY', name: 'Fin Nifty', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'INDEX', category: 'INDICES', lotSize: 1, isFeatured: true, sortOrder: 3 },
      { token: '288009', symbol: 'MIDCPNIFTY', name: 'Midcap Nifty', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'INDEX', category: 'INDICES', lotSize: 1, sortOrder: 4 },
      
      // Popular Stocks (NSE-EQ)
      { token: '2885', symbol: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, isFeatured: true, sortOrder: 1 },
      { token: '3045', symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, isFeatured: true, sortOrder: 2 },
      { token: '1333', symbol: 'HDFCBANK', name: 'HDFC Bank', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, isFeatured: true, sortOrder: 3 },
      { token: '11536', symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 4 },
      { token: '1594', symbol: 'INFY', name: 'Infosys', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 5 },
      { token: '17963', symbol: 'ICICIBANK', name: 'ICICI Bank', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 6 },
      { token: '1922', symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 7 },
      { token: '3456', symbol: 'TATAMOTORS', name: 'Tata Motors', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 8 },
      { token: '11630', symbol: 'NTPC', name: 'NTPC Limited', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 9 },
      { token: '10999', symbol: 'MARUTI', name: 'Maruti Suzuki', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 10 },
      { token: '1660', symbol: 'ITC', name: 'ITC Limited', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 11 },
      { token: '3787', symbol: 'WIPRO', name: 'Wipro', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 12 },
      { token: '317', symbol: 'BAJFINANCE', name: 'Bajaj Finance', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 13 },
      { token: '16675', symbol: 'AXISBANK', name: 'Axis Bank', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 14 },
      { token: '2031', symbol: 'LT', name: 'Larsen & Toubro', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 15 },
      { token: '1348', symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', exchange: 'NSE', segment: 'EQUITY', displaySegment: 'NSE-EQ', instrumentType: 'STOCK', category: 'STOCKS', lotSize: 1, sortOrder: 16 },
      
      // MCX Commodities (MCXFUT)
      { token: '53523', symbol: 'GOLDM', name: 'Gold Mini', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 10, isFeatured: true, sortOrder: 1 },
      { token: '53524', symbol: 'GOLD', name: 'Gold', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 100, isFeatured: true, sortOrder: 2 },
      { token: '53525', symbol: 'SILVERM', name: 'Silver Mini', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5, isFeatured: true, sortOrder: 3 },
      { token: '53526', symbol: 'SILVER', name: 'Silver', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 30, sortOrder: 4 },
      { token: '53527', symbol: 'CRUDEOIL', name: 'Crude Oil', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 100, isFeatured: true, sortOrder: 5 },
      { token: '53528', symbol: 'CRUDEOILM', name: 'Crude Oil Mini', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 10, sortOrder: 6 },
      { token: '53529', symbol: 'NATURALGAS', name: 'Natural Gas', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 1250, sortOrder: 7 },
      { token: '53530', symbol: 'COPPER', name: 'Copper', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 2500, sortOrder: 8 },
      { token: '53531', symbol: 'ZINC', name: 'Zinc', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5000, sortOrder: 9 },
      { token: '53532', symbol: 'ALUMINIUM', name: 'Aluminium', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5000, sortOrder: 10 },
      { token: '53533', symbol: 'LEAD', name: 'Lead', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 5000, sortOrder: 11 },
      { token: '53534', symbol: 'NICKEL', name: 'Nickel', exchange: 'MCX', segment: 'MCX', displaySegment: 'MCXFUT', instrumentType: 'FUTURES', category: 'MCX', lotSize: 1500, sortOrder: 12 },
    ];
    
    let added = 0;
    let skipped = 0;
    
    for (const inst of defaultInstruments) {
      const exists = await Instrument.findOne({ token: inst.token });
      if (!exists) {
        await Instrument.create(inst);
        added++;
      } else {
        skipped++;
      }
    }
    
    res.json({ 
      message: `Seeded ${added} instruments, ${skipped} already existed`,
      added,
      skipped
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Seed F&O instruments with current expiry
router.post('/admin/seed-fno', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    // Calculate current and next month expiry (last Tuesday of month)
    const getLastTuesday = (year, month) => {
      const lastDay = new Date(year, month + 1, 0);
      const dayOfWeek = lastDay.getDay();
      const diff = (dayOfWeek >= 2) ? (dayOfWeek - 2) : (dayOfWeek + 5);
      return new Date(year, month + 1, -diff);
    };
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Get weekly expiry (next Tuesday)
    const getNextTuesday = () => {
      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysUntilTuesday = (2 - dayOfWeek + 7) % 7 || 7;
      const nextTue = new Date(today);
      nextTue.setDate(today.getDate() + daysUntilTuesday);
      return nextTue;
    };

    const weeklyExpiry = getNextTuesday();
    const monthlyExpiry = getLastTuesday(currentYear, currentMonth);
    const nextMonthExpiry = getLastTuesday(currentYear, currentMonth + 1);
    
    // Use weekly expiry if monthly has passed
    const currentExpiry = monthlyExpiry > now ? monthlyExpiry : weeklyExpiry;
    
    const formatExpiry = (date) => {
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      return `${date.getDate()}${months[date.getMonth()]}${date.getFullYear().toString().slice(-2)}`;
    };
    
    const expiryStr = formatExpiry(currentExpiry);
    const nextExpiryStr = formatExpiry(nextMonthExpiry);
    
    // NIFTY current price ~26250, BANKNIFTY ~60000
    const niftyStrikes = [25800, 25900, 26000, 26100, 26200, 26300, 26400, 26500, 26600, 26700];
    const bankniftyStrikes = [59000, 59200, 59400, 59600, 59800, 60000, 60200, 60400, 60600, 60800];
    
    const fnoInstruments = [];
    
    // NIFTY Futures
    fnoInstruments.push({
      token: `NFO_NIFTY_FUT_${expiryStr}`,
      symbol: `NIFTY${expiryStr}FUT`,
      name: `NIFTY ${expiryStr} FUT`,
      exchange: 'NFO',
      segment: 'FNO',
      displaySegment: 'NSEFUT',
      instrumentType: 'FUTURES',
      category: 'NIFTY',
      expiry: currentExpiry,
      lotSize: 25,
      isFeatured: true,
      sortOrder: 1
    });
    
    // NIFTY Next Month Future
    fnoInstruments.push({
      token: `NFO_NIFTY_FUT_${nextExpiryStr}`,
      symbol: `NIFTY${nextExpiryStr}FUT`,
      name: `NIFTY ${nextExpiryStr} FUT`,
      exchange: 'NFO',
      segment: 'FNO',
      displaySegment: 'NSEFUT',
      instrumentType: 'FUTURES',
      category: 'NIFTY',
      expiry: nextMonthExpiry,
      lotSize: 25,
      sortOrder: 2
    });
    
    // NIFTY Options (CE and PE)
    niftyStrikes.forEach((strike, idx) => {
      // Call Option
      fnoInstruments.push({
        token: `NFO_NIFTY_${strike}CE_${expiryStr}`,
        symbol: `NIFTY${expiryStr}${strike}CE`,
        name: `NIFTY ${expiryStr} ${strike} CE`,
        exchange: 'NFO',
        segment: 'FNO',
        displaySegment: 'NSEOPT',
        instrumentType: 'OPTIONS',
        optionType: 'CE',
        strike: strike,
        category: 'NIFTY',
        expiry: currentExpiry,
        lotSize: 25,
        sortOrder: 10 + idx
      });
      
      // Put Option
      fnoInstruments.push({
        token: `NFO_NIFTY_${strike}PE_${expiryStr}`,
        symbol: `NIFTY${expiryStr}${strike}PE`,
        name: `NIFTY ${expiryStr} ${strike} PE`,
        exchange: 'NFO',
        segment: 'FNO',
        displaySegment: 'NSEOPT',
        instrumentType: 'OPTIONS',
        optionType: 'PE',
        strike: strike,
        category: 'NIFTY',
        expiry: currentExpiry,
        lotSize: 25,
        sortOrder: 30 + idx
      });
    });
    
    // BANKNIFTY Futures
    fnoInstruments.push({
      token: `NFO_BANKNIFTY_FUT_${expiryStr}`,
      symbol: `BANKNIFTY${expiryStr}FUT`,
      name: `BANKNIFTY ${expiryStr} FUT`,
      exchange: 'NFO',
      segment: 'FNO',
      displaySegment: 'NSEFUT',
      instrumentType: 'FUTURES',
      category: 'BANKNIFTY',
      expiry: currentExpiry,
      lotSize: 15,
      isFeatured: true,
      sortOrder: 1
    });
    
    // BANKNIFTY Next Month Future
    fnoInstruments.push({
      token: `NFO_BANKNIFTY_FUT_${nextExpiryStr}`,
      symbol: `BANKNIFTY${nextExpiryStr}FUT`,
      name: `BANKNIFTY ${nextExpiryStr} FUT`,
      exchange: 'NFO',
      segment: 'FNO',
      displaySegment: 'NSEFUT',
      instrumentType: 'FUTURES',
      category: 'BANKNIFTY',
      expiry: nextMonthExpiry,
      lotSize: 15,
      sortOrder: 2
    });
    
    // BANKNIFTY Options (CE and PE)
    bankniftyStrikes.forEach((strike, idx) => {
      // Call Option
      fnoInstruments.push({
        token: `NFO_BANKNIFTY_${strike}CE_${expiryStr}`,
        symbol: `BANKNIFTY${expiryStr}${strike}CE`,
        name: `BANKNIFTY ${expiryStr} ${strike} CE`,
        exchange: 'NFO',
        segment: 'FNO',
        displaySegment: 'NSEOPT',
        instrumentType: 'OPTIONS',
        optionType: 'CE',
        strike: strike,
        category: 'BANKNIFTY',
        expiry: currentExpiry,
        lotSize: 15,
        sortOrder: 10 + idx
      });
      
      // Put Option
      fnoInstruments.push({
        token: `NFO_BANKNIFTY_${strike}PE_${expiryStr}`,
        symbol: `BANKNIFTY${expiryStr}${strike}PE`,
        name: `BANKNIFTY ${expiryStr} ${strike} PE`,
        exchange: 'NFO',
        segment: 'FNO',
        displaySegment: 'NSEOPT',
        instrumentType: 'OPTIONS',
        optionType: 'PE',
        strike: strike,
        category: 'BANKNIFTY',
        expiry: currentExpiry,
        lotSize: 15,
        sortOrder: 30 + idx
      });
    });
    
    // FINNIFTY Futures and Options
    const finniftyStrikes = [24000, 24100, 24200, 24300, 24400, 24500, 24600, 24700, 24800, 24900];
    
    fnoInstruments.push({
      token: `NFO_FINNIFTY_FUT_${expiryStr}`,
      symbol: `FINNIFTY${expiryStr}FUT`,
      name: `FINNIFTY ${expiryStr} FUT`,
      exchange: 'NFO',
      segment: 'FNO',
      displaySegment: 'NSEFUT',
      instrumentType: 'FUTURES',
      category: 'FINNIFTY',
      expiry: currentExpiry,
      lotSize: 25,
      isFeatured: true,
      sortOrder: 1
    });
    
    finniftyStrikes.forEach((strike, idx) => {
      fnoInstruments.push({
        token: `NFO_FINNIFTY_${strike}CE_${expiryStr}`,
        symbol: `FINNIFTY${expiryStr}${strike}CE`,
        name: `FINNIFTY ${expiryStr} ${strike} CE`,
        exchange: 'NFO',
        segment: 'FNO',
        displaySegment: 'NSEOPT',
        instrumentType: 'OPTIONS',
        optionType: 'CE',
        strike: strike,
        category: 'FINNIFTY',
        expiry: currentExpiry,
        lotSize: 25,
        sortOrder: 10 + idx
      });
      
      fnoInstruments.push({
        token: `NFO_FINNIFTY_${strike}PE_${expiryStr}`,
        symbol: `FINNIFTY${expiryStr}${strike}PE`,
        name: `FINNIFTY ${expiryStr} ${strike} PE`,
        exchange: 'NFO',
        segment: 'FNO',
        displaySegment: 'NSEOPT',
        instrumentType: 'OPTIONS',
        optionType: 'PE',
        strike: strike,
        category: 'FINNIFTY',
        expiry: currentExpiry,
        lotSize: 25,
        sortOrder: 30 + idx
      });
    });
    
    let added = 0;
    let skipped = 0;
    
    for (const inst of fnoInstruments) {
      const exists = await Instrument.findOne({ token: inst.token });
      if (!exists) {
        await Instrument.create(inst);
        added++;
      } else {
        skipped++;
      }
    }
    
    res.json({ 
      message: `Seeded F&O instruments: ${added} added, ${skipped} already existed`,
      added,
      skipped,
      expiry: expiryStr,
      nextExpiry: nextExpiryStr,
      totalInstruments: fnoInstruments.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Sync F&O instruments with real Angel One tokens
router.post('/admin/sync-fno-tokens', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const axiosLib = (await import('axios')).default;
    
    // Get Angel One session
    const statusRes = await axiosLib.get('http://localhost:5001/api/angelone/status');
    if (!statusRes.data.connected) {
      return res.status(400).json({ message: 'Angel One not connected. Please login first.' });
    }
    
    // Current expiry - find next Tuesday
    const getNextTuesday = () => {
      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysUntilTuesday = (2 - dayOfWeek + 7) % 7 || 7;
      const nextTue = new Date(today);
      nextTue.setDate(today.getDate() + daysUntilTuesday);
      return nextTue;
    };

    const expiry = getNextTuesday();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const expiryStr = `${expiry.getDate()}${months[expiry.getMonth()]}${expiry.getFullYear().toString().slice(-2)}`;
    
    // Delete old F&O instruments
    await Instrument.deleteMany({ segment: 'FNO' });
    
    // NIFTY strikes around current price (~26250)
    const niftyStrikes = [25800, 25900, 26000, 26100, 26200, 26300, 26400, 26500, 26600, 26700];
    // BANKNIFTY strikes around current price (~60000)
    const bankniftyStrikes = [59000, 59500, 60000, 60500, 61000];
    
    const fnoInstruments = [];
    
    // Helper to search Angel One for token
    const searchToken = async (query) => {
      try {
        const { data } = await axiosLib.get(`http://localhost:5001/api/angelone/search?query=${query}&exchange=NFO`);
        if (Array.isArray(data) && data.length > 0) {
          const match = data.find(d => d.tradingsymbol === query);
          return match ? match.symboltoken : (data[0]?.symboltoken || null);
        }
        return null;
      } catch (e) {
        return null;
      }
    };
    
    // NIFTY Future
    const niftyFutSymbol = `NIFTY${expiryStr}FUT`;
    const niftyFutToken = await searchToken(niftyFutSymbol);
    if (niftyFutToken) {
      fnoInstruments.push({
        token: niftyFutToken,
        symbol: niftyFutSymbol,
        name: `NIFTY ${expiryStr} FUT`,
        exchange: 'NFO',
        segment: 'FNO',
        instrumentType: 'FUTURES',
        category: 'NIFTY',
        expiry: expiry,
        lotSize: 25,
        isFeatured: true,
        sortOrder: 1
      });
    }
    
    // NIFTY Options
    for (const strike of niftyStrikes) {
      // CE
      const ceSymbol = `NIFTY${expiryStr}${strike}CE`;
      const ceToken = await searchToken(ceSymbol);
      if (ceToken) {
        fnoInstruments.push({
          token: ceToken,
          symbol: ceSymbol,
          name: `NIFTY ${expiryStr} ${strike} CE`,
          exchange: 'NFO',
          segment: 'FNO',
          instrumentType: 'OPTIONS',
          optionType: 'CE',
          strike: strike,
          category: 'NIFTY',
          expiry: expiry,
          lotSize: 25,
          sortOrder: 10 + niftyStrikes.indexOf(strike)
        });
      }
      
      // PE
      const peSymbol = `NIFTY${expiryStr}${strike}PE`;
      const peToken = await searchToken(peSymbol);
      if (peToken) {
        fnoInstruments.push({
          token: peToken,
          symbol: peSymbol,
          name: `NIFTY ${expiryStr} ${strike} PE`,
          exchange: 'NFO',
          segment: 'FNO',
          instrumentType: 'OPTIONS',
          optionType: 'PE',
          strike: strike,
          category: 'NIFTY',
          expiry: expiry,
          lotSize: 25,
          sortOrder: 30 + niftyStrikes.indexOf(strike)
        });
      }
    }
    
    // BANKNIFTY Future
    const bnFutSymbol = `BANKNIFTY${expiryStr}FUT`;
    const bnFutToken = await searchToken(bnFutSymbol);
    if (bnFutToken) {
      fnoInstruments.push({
        token: bnFutToken,
        symbol: bnFutSymbol,
        name: `BANKNIFTY ${expiryStr} FUT`,
        exchange: 'NFO',
        segment: 'FNO',
        instrumentType: 'FUTURES',
        category: 'BANKNIFTY',
        expiry: expiry,
        lotSize: 15,
        isFeatured: true,
        sortOrder: 1
      });
    }
    
    // BANKNIFTY Options
    for (const strike of bankniftyStrikes) {
      const ceSymbol = `BANKNIFTY${expiryStr}${strike}CE`;
      const ceToken = await searchToken(ceSymbol);
      if (ceToken) {
        fnoInstruments.push({
          token: ceToken,
          symbol: ceSymbol,
          name: `BANKNIFTY ${expiryStr} ${strike} CE`,
          exchange: 'NFO',
          segment: 'FNO',
          instrumentType: 'OPTIONS',
          optionType: 'CE',
          strike: strike,
          category: 'BANKNIFTY',
          expiry: expiry,
          lotSize: 15,
          sortOrder: 10 + bankniftyStrikes.indexOf(strike)
        });
      }
      
      const peSymbol = `BANKNIFTY${expiryStr}${strike}PE`;
      const peToken = await searchToken(peSymbol);
      if (peToken) {
        fnoInstruments.push({
          token: peToken,
          symbol: peSymbol,
          name: `BANKNIFTY ${expiryStr} ${strike} PE`,
          exchange: 'NFO',
          segment: 'FNO',
          instrumentType: 'OPTIONS',
          optionType: 'PE',
          strike: strike,
          category: 'BANKNIFTY',
          expiry: expiry,
          lotSize: 15,
          sortOrder: 30 + bankniftyStrikes.indexOf(strike)
        });
      }
    }
    
    // Insert all instruments
    let added = 0;
    for (const inst of fnoInstruments) {
      try {
        await Instrument.create(inst);
        added++;
      } catch (e) {
        console.error('Error adding instrument:', inst.symbol, e.message);
      }
    }
    
    res.json({
      message: `Synced F&O instruments with real Angel One tokens`,
      expiry: expiryStr,
      added,
      totalSearched: niftyStrikes.length * 2 + bankniftyStrikes.length * 2 + 2
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== SEED CRYPTO INSTRUMENTS ====================

router.post('/admin/seed-crypto', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    // Popular crypto instruments
    const cryptoInstruments = [
      { symbol: 'BTC', name: 'Bitcoin', pair: 'BTCUSDT', lotSize: 0.001 },
      { symbol: 'ETH', name: 'Ethereum', pair: 'ETHUSDT', lotSize: 0.01 },
      { symbol: 'BNB', name: 'Binance Coin', pair: 'BNBUSDT', lotSize: 0.1 },
      { symbol: 'XRP', name: 'Ripple', pair: 'XRPUSDT', lotSize: 10 },
      { symbol: 'ADA', name: 'Cardano', pair: 'ADAUSDT', lotSize: 10 },
      { symbol: 'DOGE', name: 'Dogecoin', pair: 'DOGEUSDT', lotSize: 100 },
      { symbol: 'SOL', name: 'Solana', pair: 'SOLUSDT', lotSize: 0.1 },
      { symbol: 'DOT', name: 'Polkadot', pair: 'DOTUSDT', lotSize: 1 },
      { symbol: 'POL', name: 'Polygon', pair: 'POLUSDT', lotSize: 10 },
      { symbol: 'LTC', name: 'Litecoin', pair: 'LTCUSDT', lotSize: 0.1 },
      { symbol: 'AVAX', name: 'Avalanche', pair: 'AVAXUSDT', lotSize: 0.1 },
      { symbol: 'LINK', name: 'Chainlink', pair: 'LINKUSDT', lotSize: 1 },
      { symbol: 'ATOM', name: 'Cosmos', pair: 'ATOMUSDT', lotSize: 1 },
      { symbol: 'UNI', name: 'Uniswap', pair: 'UNIUSDT', lotSize: 1 },
      { symbol: 'XLM', name: 'Stellar', pair: 'XLMUSDT', lotSize: 100 },
      { symbol: 'SHIB', name: 'Shiba Inu', pair: 'SHIBUSDT', lotSize: 1000000 },
      { symbol: 'TRX', name: 'TRON', pair: 'TRXUSDT', lotSize: 100 },
      { symbol: 'ETC', name: 'Ethereum Classic', pair: 'ETCUSDT', lotSize: 1 },
      { symbol: 'NEAR', name: 'NEAR Protocol', pair: 'NEARUSDT', lotSize: 1 },
      { symbol: 'APT', name: 'Aptos', pair: 'APTUSDT', lotSize: 1 }
    ];

    let added = 0;
    let updated = 0;

    for (const crypto of cryptoInstruments) {
      const existing = await Instrument.findOne({ symbol: crypto.symbol, exchange: 'BINANCE' });
      
      if (existing) {
        await Instrument.updateOne(
          { _id: existing._id },
          { 
            $set: { 
              name: crypto.name,
              pair: crypto.pair,
              lotSize: crypto.lotSize,
              displaySegment: 'CRYPTOFUT',
              isEnabled: true,
              isCrypto: true
            }
          }
        );
        updated++;
      } else {
        await Instrument.create({
          symbol: crypto.symbol,
          name: crypto.name,
          exchange: 'BINANCE',
          token: crypto.pair,
          pair: crypto.pair,
          segment: 'CRYPTOFUT',
          displaySegment: 'CRYPTOFUT',
          category: 'OTHER',
          instrumentType: 'FUTURES',
          lotSize: crypto.lotSize,
          tickSize: 0.01,
          isEnabled: true,
          isFeatured: false,
          isCrypto: true
        });
        added++;
      }
    }

    res.json({
      message: 'Crypto instruments seeded successfully',
      added,
      updated,
      total: cryptoInstruments.length
    });
  } catch (error) {
    console.error('Seed crypto error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Sample crypto perpetuals & options (synthetic — LTP is indicative; run after seed-crypto)
router.post('/admin/seed-crypto-derivatives', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const result = await ensureCryptoDerivativesInstruments();
    res.json({
      message: 'Crypto F&O synced (Binance USDT-M perps + synthetic options chain)',
      futures: result.futures,
      options: result.options,
      total: result.total
    });
  } catch (error) {
    console.error('Seed crypto derivatives error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== WEBSOCKET STATUS ====================

router.get('/websocket/status', protectAdmin, (req, res) => {
  res.json(marketDataService.getStatus());
});

router.post('/websocket/connect', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    // Get session from angelone routes
    const { feedToken, clientCode, apiKey } = req.body;
    
    if (feedToken) {
      marketDataService.init(feedToken, clientCode, apiKey);
      marketDataService.connect();
      res.json({ message: 'WebSocket connection initiated' });
    } else {
      res.status(400).json({ message: 'Feed token required' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/websocket/subscribe', protectAdmin, async (req, res) => {
  try {
    const { tokens } = req.body;
    marketDataService.subscribeTokens(tokens);
    res.json({ message: `Subscribed to ${tokens.length} tokens` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get symbols grouped by segment for script settings
router.get('/by-segment', protectAdmin, async (req, res) => {
  try {
    // Map segment names to database segment/category values
    const segmentMapping = {
      MCX: { segment: 'MCX' },
      NSEINDEX: { category: { $in: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'INDICES'] } },
      NSESTOCK: { category: 'STOCKS' },
      BSE: { exchange: 'BSE' },
      EQ: { segment: 'EQUITY', instrumentType: 'STOCK' }
    };
    
    const result = {};
    
    for (const [segmentName, query] of Object.entries(segmentMapping)) {
      const instruments = await Instrument.find({ 
        isEnabled: true,
        ...query 
      })
        .select('symbol name')
        .sort({ sortOrder: 1, symbol: 1 })
        .limit(100);
      
      // Get unique symbols
      const symbols = [...new Set(instruments.map(i => i.symbol))];
      result[segmentName] = symbols;
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching symbols by segment:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get instruments grouped by displaySegment (for UI tabs)
router.get('/by-display-segment', async (req, res) => {
  try {
    const segments = ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT'];
    const result = {};
    
    for (const segment of segments) {
      const instruments = await Instrument.find({ 
        isEnabled: true,
        displaySegment: segment 
      })
        .select('token symbol name exchange instrumentType category lotSize tickSize expiry strike optionType ltp change changePercent isFeatured sortOrder tradingSymbol')
        .sort({ isFeatured: -1, sortOrder: 1, symbol: 1 });
      
      result[segment] = instruments;
    }
    
    // Also include counts
    const counts = {};
    for (const segment of segments) {
      counts[segment] = await Instrument.countDocuments({ isEnabled: true, displaySegment: segment });
    }
    
    res.json({ instruments: result, counts });
  } catch (error) {
    console.error('Error fetching instruments by display segment:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all available segments with their instrument counts
router.get('/segments', async (req, res) => {
  try {
    // Normalize segment name to standard format
    const normalizeSegmentName = (seg) => {
      if (!seg) return null;
      const upper = seg.toUpperCase().replace(/[•·]/g, '').trim();
      if (upper.includes('NSE') && (upper.includes('FO') || upper.includes('F&O') || upper.includes('NFO'))) return 'NSE F&O';
      if (upper.includes('BSE') && (upper.includes('FO') || upper.includes('F&O') || upper.includes('BFO'))) return 'BSE F&O';
      if (upper.includes('NSE') || upper.includes('SPOT') || upper === 'EQUITY') return 'NSE';
      if (upper.includes('MCX')) return 'MCX';
      if (upper.includes('CURRENCY') || upper.includes('CDS')) return 'Currency';
      if (upper.includes('CRYPTOFUT') || upper.includes('CRYPTOOPT')) return 'Crypto';
      return seg; // Return original if no match
    };
    
    // Get all instruments and count by normalized segment
    const allInstruments = await Instrument.aggregate([
      { $match: { isEnabled: true } },
      { $group: { 
        _id: { displaySegment: '$displaySegment', segment: '$segment', exchange: '$exchange' }, 
        count: { $sum: 1 } 
      }}
    ]);
    
    // Normalize and merge counts
    const segmentMap = {};
    for (const item of allInstruments) {
      // Try displaySegment first, then segment, then exchange
      let normalizedName = normalizeSegmentName(item._id.displaySegment);
      if (!normalizedName) normalizedName = normalizeSegmentName(item._id.segment);
      if (!normalizedName) {
        // Use exchange as fallback
        const ex = item._id.exchange;
        if (ex === 'NSE') normalizedName = 'NSE';
        else if (ex === 'NFO') normalizedName = 'NSE F&O';
        else if (ex === 'MCX') normalizedName = 'MCX';
        else if (ex === 'BFO') normalizedName = 'BSE F&O';
        else if (ex === 'CDS') normalizedName = 'Currency';
        else normalizedName = ex || 'Other';
      }
      
      if (!segmentMap[normalizedName]) segmentMap[normalizedName] = 0;
      segmentMap[normalizedName] += item.count;
    }
    
    // Always include all standard segments (even if no instruments exist yet)
    const standardSegments = ['NSE', 'NSE F&O', 'MCX', 'BSE F&O', 'Currency'];
    for (const seg of standardSegments) {
      if (!segmentMap[seg]) {
        segmentMap[seg] = 0;
      }
    }
    
    // Define preferred order
    const preferredOrder = ['NSE', 'NSE F&O', 'MCX', 'BSE F&O', 'Currency'];
    
    // Sort by preferred order, then alphabetically
    const result = Object.entries(segmentMap)
      .filter(([segment]) => segment && segment !== 'null' && segment !== 'undefined')
      .map(([segment, count]) => ({ segment, count }))
      .sort((a, b) => {
        const aIdx = preferredOrder.indexOf(a.segment);
        const bIdx = preferredOrder.indexOf(b.segment);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.segment.localeCompare(b.segment);
      });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all segments and scripts for user settings page
router.get('/settings-data', async (req, res) => {
  try {
    // All Market Watch segments - these are the standard segment names
    const MARKET_WATCH_SEGMENTS = ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FOREXFUT', 'FOREXOPT', 'CRYPTOFUT', 'CRYPTOOPT'];
    
    // Map displaySegment to standard Market Watch segment name
    const normalizeSegment = (seg) => {
      if (!seg) return null;
      const upper = seg.toUpperCase().trim();
      
      // Direct matches first
      if (MARKET_WATCH_SEGMENTS.includes(upper)) return upper;
      
      // Map variations to standard names
      if (upper.includes('NSEFUT') || (upper.includes('NSE') && upper.includes('FUT') && !upper.includes('OPT'))) return 'NSEFUT';
      if (upper.includes('NSEOPT') || (upper.includes('NSE') && upper.includes('OPT'))) return 'NSEOPT';
      if (upper.includes('MCXFUT') || (upper.includes('MCX') && upper.includes('FUT') && !upper.includes('OPT'))) return 'MCXFUT';
      if (upper.includes('MCXOPT') || (upper.includes('MCX') && upper.includes('OPT'))) return 'MCXOPT';
      if (upper.includes('NSE-EQ') || upper.includes('NSEEQ') || upper === 'NSE' || upper.includes('EQUITY')) return 'NSE-EQ';
      if (upper.includes('BSE-FUT') || upper.includes('BSEFUT') || (upper.includes('BSE') && upper.includes('FUT'))) return 'BSE-FUT';
      if (upper.includes('BSE-OPT') || upper.includes('BSEOPT') || (upper.includes('BSE') && upper.includes('OPT'))) return 'BSE-OPT';
      if (upper === 'FOREXOPT' || (upper.includes('FOREX') && upper.includes('OPT'))) return 'FOREXOPT';
      if (upper === 'FOREXFUT' || upper === 'FOREX' || upper.includes('FOREX')) return 'FOREXFUT';

      return null; // Unknown segment
    };
    
    // Get all unique segments from instruments
    const segmentAgg = await Instrument.aggregate([
      { $match: { isEnabled: true } },
      { $group: { 
        _id: '$displaySegment', 
        count: { $sum: 1 },
        exchanges: { $addToSet: '$exchange' }
      }},
      { $sort: { _id: 1 } }
    ]);
    
    // Initialize all Market Watch segments first
    const segmentMap = {};
    for (const seg of MARKET_WATCH_SEGMENTS) {
      segmentMap[seg] = { id: seg, name: seg, count: 0, exchanges: [] };
    }
    
    // Merge instrument counts into segments
    for (const s of segmentAgg) {
      const normalizedId = normalizeSegment(s._id);
      if (normalizedId && segmentMap[normalizedId]) {
        segmentMap[normalizedId].count += s.count;
        segmentMap[normalizedId].exchanges = [...new Set([...segmentMap[normalizedId].exchanges, ...s.exchanges])];
      }
    }
    
    const segments = Object.values(segmentMap);
    
    // Get all unique base symbols (scripts) grouped by segment
    const scriptsAgg = await Instrument.aggregate([
      { $match: { isEnabled: true } },
      { $group: { 
        _id: { 
          segment: '$displaySegment',
          category: '$category',
          name: '$name'
        },
        symbol: { $first: '$symbol' },
        exchange: { $first: '$exchange' },
        instrumentType: { $first: '$instrumentType' },
        lotSize: { $first: '$lotSize' },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.segment': 1, '_id.category': 1, '_id.name': 1 } }
    ]);
    
    // Initialize scripts for all Market Watch segments
    const scriptsBySegment = {};
    for (const seg of MARKET_WATCH_SEGMENTS) {
      scriptsBySegment[seg] = [];
    }
    
    // Group scripts by segment using normalized segment names
    for (const script of scriptsAgg) {
      const segmentKey = normalizeSegment(script._id.segment);
      if (!segmentKey || !scriptsBySegment[segmentKey]) continue;
      
      // Extract base symbol name
      let baseSymbol = script._id.name || script.symbol;
      // Remove FUT, CE, PE suffixes and dates
      baseSymbol = baseSymbol.replace(/\s+(FUT|CE|PE).*$/i, '').replace(/\d+\s*(CE|PE)$/i, '').trim();
      
      // Check if already added
      const existing = scriptsBySegment[segmentKey].find(s => s.baseSymbol === baseSymbol);
      if (!existing) {
        scriptsBySegment[segmentKey].push({
          baseSymbol,
          name: script._id.name || baseSymbol,
          category: script._id.category,
          exchange: script.exchange,
          instrumentType: script.instrumentType,
          lotSize: script.lotSize,
          instrumentCount: script.count
        });
      }
    }
    
    // Also get unique base symbols for F&O (NIFTY, BANKNIFTY, etc.)
    const fnoSymbols = await Instrument.aggregate([
      { $match: { isEnabled: true, exchange: { $in: ['NFO', 'BFO', 'MCX'] } } },
      { $group: { 
        _id: '$category',
        exchange: { $first: '$exchange' },
        lotSize: { $first: '$lotSize' },
        count: { $sum: 1 }
      }},
      { $match: { _id: { $ne: null } } },
      { $sort: { _id: 1 } }
    ]);
    
    // Add F&O symbols to their respective segments using Market Watch segment names
    for (const sym of fnoSymbols) {
      // Map exchange to Market Watch segment names
      let segmentKey = null;
      if (sym.exchange === 'NFO') {
        // NFO can be either NSEFUT or NSEOPT - check instrument type if available
        segmentKey = 'NSEFUT'; // Default to futures, options will be added via scriptsAgg
      } else if (sym.exchange === 'BFO') {
        segmentKey = 'BSE-FUT';
      } else if (sym.exchange === 'MCX') {
        segmentKey = 'MCXFUT';
      }
      
      if (!segmentKey || !scriptsBySegment[segmentKey]) continue;
      
      const existing = scriptsBySegment[segmentKey].find(s => s.baseSymbol === sym._id);
      if (!existing && sym._id) {
        scriptsBySegment[segmentKey].push({
          baseSymbol: sym._id,
          name: sym._id,
          category: sym._id,
          exchange: sym.exchange,
          lotSize: sym.lotSize,
          instrumentCount: sym.count
        });
      }
    }
    
    res.json({ 
      segments,
      scripts: scriptsBySegment
    });
  } catch (error) {
    console.error('Error fetching settings data:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== WATCHLIST API ====================

// Get user's watchlist (all segments)
router.get('/watchlist', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const watchlists = await Watchlist.find({ userId }).lean();
    
    // Convert to object format with segment names
    const result = {
      'NSEFUT': [],
      'NSEOPT': [],
      'MCXFUT': [],
      'MCXOPT': [],
      'NSE-EQ': [],
      'BSE-FUT': [],
      'BSE-OPT': [],
      'CRYPTOFUT': [],
      'CRYPTOOPT': [],
      'FOREXFUT': [],
      'FOREXOPT': [],
      'FOREX': [],
      'FAVORITES': []
    };
    
    // Collect all tokens to fetch fresh lot sizes
    const allTokens = [];
    for (const wl of watchlists) {
      for (const inst of wl.instruments || []) {
        if (inst.token) allTokens.push(inst.token);
      }
    }
    
    // Fetch current fields from Instrument database (incl. expiry to drop rolled contracts)
    const freshInstruments = await Instrument.find({ token: { $in: allTokens } })
      .select('token lotSize lastBid lastAsk expiry instrumentType')
      .lean();
    const instrumentDataMap = {};
    for (const inst of freshInstruments) {
      instrumentDataMap[inst.token] = {
        lotSize: inst.lotSize,
        lastBid: inst.lastBid || 0,
        lastAsk: inst.lastAsk || 0,
        expiry: inst.expiry,
        instrumentType: inst.instrumentType
      };
    }

    for (const wl of watchlists) {
      const before = (wl.instruments || []).length;
      const kept = (wl.instruments || []).filter(
        (inst) => !watchlistItemIsExpired(inst, inst.token ? instrumentDataMap[inst.token] : null)
      );
      if (kept.length < before) {
        await Watchlist.updateOne({ _id: wl._id }, { $set: { instruments: kept } });
        wl.instruments = kept;
      }
    }
    
    // Build result with refreshed lot sizes and last bid/ask (split legacy FOREX into FOREXFUT / FOREXOPT)
    for (const wl of watchlists) {
      if (wl.segment === 'FOREX') {
        for (const inst of wl.instruments || []) {
          const it = String(inst.instrumentType || '').toUpperCase();
          const key = it === 'OPTIONS' || it === 'OPT' ? 'FOREXOPT' : 'FOREXFUT';
          if (!result[key]) result[key] = [];
          const out =
            inst.token && !inst.isCrypto && instrumentDataMap[inst.token]
              ? { ...inst, lotSize: instrumentDataMap[inst.token].lotSize, lastBid: instrumentDataMap[inst.token].lastBid, lastAsk: instrumentDataMap[inst.token].lastAsk }
              : inst;
          result[key].push(out);
        }
        continue;
      }
      result[wl.segment] = (wl.instruments || []).map((inst) => {
        if (inst.token && !inst.isCrypto && instrumentDataMap[inst.token]) {
          return {
            ...inst,
            lotSize: instrumentDataMap[inst.token].lotSize,
            lastBid: instrumentDataMap[inst.token].lastBid,
            lastAsk: instrumentDataMap[inst.token].lastAsk
          };
        }
        return inst;
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching watchlist:', error);
    res.status(500).json({ message: error.message });
  }
});

// Add instrument to watchlist
router.post('/watchlist/add', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const { instrument, segment } = req.body;
    
    console.log('Watchlist add request - segment:', segment, 'instrument:', instrument?.symbol);
    
    if (!instrument || !segment) {
      return res.status(400).json({ message: 'Instrument and segment are required' });
    }
    
    // Find or create watchlist for this segment
    let watchlist = await Watchlist.findOne({ userId, segment });
    
    if (!watchlist) {
      watchlist = new Watchlist({ userId, segment, instruments: [] });
    }
    
    // Check if already exists — pair for crypto & forex, else Zerodha token
    const usePair = !!(instrument.isCrypto || instrument.isForex || instrument.exchange === 'FOREX');
    const identifier = usePair
      ? String(instrument.pair || instrument.symbol || '').trim()
      : String(instrument.token || '').trim();
    if (!identifier) {
      return res.status(400).json({ message: 'Instrument has no token or pair' });
    }

    const dbInst = instrument.token
      ? await Instrument.findOne({ token: String(instrument.token) })
          .select('expiry instrumentType')
          .lean()
      : null;
    if (watchlistItemIsExpired(instrument, dbInst)) {
      return res
        .status(400)
        .json({ message: 'This contract has expired and cannot be added to the watchlist' });
    }

    const exists = watchlist.instruments.some((i) => {
      const id = (i.isCrypto || i.isForex || i.exchange === 'FOREX')
        ? String(i.pair || i.symbol || '').trim()
        : String(i.token || '').trim();
      return id === identifier;
    });
    if (exists) {
      return res.status(400).json({ message: 'Instrument already in watchlist' });
    }
    
    // Add instrument
    watchlist.instruments.push({
      token: instrument.token,
      symbol: instrument.symbol,
      name: instrument.name,
      exchange: instrument.exchange,
      segment: instrument.segment,
      displaySegment: instrument.displaySegment,
      instrumentType: instrument.instrumentType,
      optionType: instrument.optionType,
      strike: instrument.strike,
      expiry: instrument.expiry,
      lotSize: instrument.lotSize,
      tradingSymbol: instrument.tradingSymbol,
      category: instrument.category,
      pair: instrument.pair,
      isCrypto: !!instrument.isCrypto,
      isForex: !!(instrument.isForex || instrument.exchange === 'FOREX')
    });
    
    await watchlist.save();
    res.json({ message: 'Added to watchlist', segment });
  } catch (error) {
    console.error('Error adding to watchlist:', error);
    res.status(500).json({ message: error.message });
  }
});

// Remove instrument from watchlist
router.post('/watchlist/remove', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const { token, pair, segment } = req.body;
    
    if ((!token && !pair) || !segment) {
      return res.status(400).json({ message: 'Token/pair and segment are required' });
    }
    
    const watchlist = await Watchlist.findOne({ userId, segment });
    
    if (!watchlist) {
      return res.status(404).json({ message: 'Watchlist not found' });
    }
    
    const pairNorm = pair != null ? String(pair).trim() : '';
    const tokenNorm = token != null ? String(token).trim() : '';
    if (pairNorm) {
      watchlist.instruments = watchlist.instruments.filter((i) => String(i.pair || '').trim() !== pairNorm);
    } else if (tokenNorm) {
      watchlist.instruments = watchlist.instruments.filter((i) => String(i.token || '').trim() !== tokenNorm);
    } else {
      return res.status(400).json({ message: 'Token or pair required' });
    }
    await watchlist.save();
    
    res.json({ message: 'Removed from watchlist' });
  } catch (error) {
    console.error('Error removing from watchlist:', error);
    res.status(500).json({ message: error.message });
  }
});

// Sync entire watchlist (for migration from localStorage)
router.post('/watchlist/sync', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const { watchlistBySegment } = req.body;
    
    if (!watchlistBySegment) {
      return res.status(400).json({ message: 'Watchlist data required' });
    }

    const allSyncTokens = [];
    for (const instruments of Object.values(watchlistBySegment)) {
      for (const inst of instruments || []) {
        if (inst && inst.token) allSyncTokens.push(inst.token);
      }
    }
    const uniqueTokens = [...new Set(allSyncTokens.map((t) => String(t)))];
    const syncDb = await Instrument.find({ token: { $in: uniqueTokens } })
      .select('token expiry instrumentType')
      .lean();
    const syncMap = Object.fromEntries(syncDb.map((i) => [i.token, i]));

    // Update each segment
    for (const [segment, instruments] of Object.entries(watchlistBySegment)) {
      if (!['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREX', 'FOREXFUT', 'FOREXOPT', 'CDS', 'FAVORITES'].includes(segment)) continue;

      const instrumentsClean = (instruments || []).filter(
        (inst) => !watchlistItemIsExpired(inst, inst.token ? syncMap[String(inst.token)] : null)
      );

      await Watchlist.findOneAndUpdate(
        { userId, segment },
        { 
          userId, 
          segment, 
          instruments: instrumentsClean.map(inst => ({
            token: inst.token,
            symbol: inst.symbol,
            name: inst.name,
            exchange: inst.exchange,
            segment: inst.segment,
            displaySegment: inst.displaySegment,
            instrumentType: inst.instrumentType,
            optionType: inst.optionType,
            strike: inst.strike,
            expiry: inst.expiry,
            lotSize: inst.lotSize,
            tradingSymbol: inst.tradingSymbol,
            category: inst.category,
            pair: inst.pair,
            isCrypto: !!inst.isCrypto,
            isForex: !!(inst.isForex || inst.exchange === 'FOREX')
          }))
        },
        { upsert: true, new: true }
      );
    }
    
    res.json({ message: 'Watchlist synced successfully' });
  } catch (error) {
    console.error('Error syncing watchlist:', error);
    res.status(500).json({ message: error.message });
  }
});

// Manual check for expired instruments (Super Admin only)
router.post('/admin/check-expired', protectAdmin, superAdminOnly, async (req, res) => {
  try {
    const result = await manualCheckExpiredInstruments();
    res.json({
      message: `Processed ${result.processed} expired instruments, disabled ${result.disabled}`,
      ...result
    });
  } catch (error) {
    console.error('Error checking expired instruments:', error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
