/**
 * Zerodha Sync Service
 * 
 * Handles instrument synchronization with proper timeout management and error handling.
 * Follows SOLID principles with single responsibility for synchronization operations.
 */

import axios from 'axios';
import {
  ZERODHA_SYNC_EXCHANGES,
  POPULAR_EQ_SYMBOLS,
  POPULAR_INDEX_UNDERLYINGS,
  POPULAR_MCX_PREFIXES,
  POPULAR_FNO_MAX_DAYS,
} from './zerodhaSyncConstants.js';

export class ZerodhaSyncService {
  constructor(configService, loggerService, progressService) {
    this.configService = configService;
    this.loggerService = loggerService;
    this.progressService = progressService;
    this.syncConfig = {
      timeout: 300000, // 5 minutes
      chunkSize: 5000,
      maxRetries: 3,
      retryDelay: 5000,
    };
  }

  /**
   * Upsert popular / high-traffic instruments only (no full reset).
   */
  async performPopularSync(apiKey, accessToken, options = {}) {
    const jobId = options.jobId || this.generateJobId();
    const config = { ...this.syncConfig, ...options };

    try {
      this.progressService.startJob(jobId, {
        type: 'popular_sync',
        totalSteps: 3,
        description: 'Popular instrument sync from Zerodha',
      });

      const csvText = await this.downloadInstruments(apiKey, accessToken, config);
      this.progressService.updateJob(jobId, { step: 1, message: 'Downloaded instrument master', progress: 25 });

      const parsedInstruments = await this.parseInstruments(csvText, {
        jobId,
        filterMode: 'popular',
        minCount: 10,
      });
      this.progressService.updateJob(jobId, {
        step: 2,
        message: `Parsed ${parsedInstruments.length} popular instruments`,
        progress: 45,
      });

      const result = await this.upsertInstruments(parsedInstruments, config, jobId, {
        progressBase: 45,
        progressSpan: 50,
      });

      const counts = await this.buildExchangeCounts();
      const verification = await this.verifySync(null);

      const completionPayload = {
        message: 'Popular instruments synced',
        added: result.upserted,
        updated: result.modified,
        inserted: result.upserted,
        total: parsedInstruments.length,
        counts,
        totalInDatabase: verification?.actual ?? null,
        subscribedTokens: 0,
      };

      this.progressService.completeJob(jobId, { result: completionPayload });
      return completionPayload;
    } catch (error) {
      this.progressService.failJob(jobId, { error: error.message });
      this.loggerService.error('Popular sync failed:', error);
      throw error;
    }
  }

  /**
   * Refresh lot sizes on existing DB instruments from Kite master (fast).
   */
  async performLotSizeSync(apiKey, accessToken, options = {}) {
    const config = { ...this.syncConfig, ...options };
    const csvText = await this.downloadInstruments(apiKey, accessToken, config);

    const lotByToken = new Map();
    const lines = csvText.split('\n');
    const headers = this.parseCSVLine(lines[0]);

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = this.parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((header, idx) => {
        row[header.trim()] = values[idx]?.trim();
      });

      const exchange = String(row.exchange || '').trim().toUpperCase();
      if (!ZERODHA_SYNC_EXCHANGES.includes(exchange)) continue;

      const tokenNum = parseInt(row.instrument_token, 10);
      const token = Number.isFinite(tokenNum) ? String(tokenNum) : String(row.instrument_token || '');
      const lotSize = parseInt(row.lot_size, 10);
      if (!token || !Number.isFinite(lotSize) || lotSize < 1) continue;
      lotByToken.set(token, lotSize);
    }

    const Instrument = (await import('../../models/Instrument.js')).default;
    const existing = await Instrument.find({
      exchange: { $in: ZERODHA_SYNC_EXCHANGES },
    }).select('token lotSize').lean();

    let updated = 0;
    let notFound = 0;
    const ops = [];

    for (const inst of existing) {
      const nextLot = lotByToken.get(String(inst.token));
      if (nextLot == null) {
        notFound += 1;
        continue;
      }
      if (Number(inst.lotSize) === nextLot) continue;
      ops.push({
        updateOne: {
          filter: { token: String(inst.token) },
          update: { $set: { lotSize: nextLot, lastUpdated: new Date() } },
        },
      });
    }

    const chunkSize = config.chunkSize || 5000;
    for (let i = 0; i < ops.length; i += chunkSize) {
      const chunk = ops.slice(i, i + chunkSize);
      const res = await Instrument.bulkWrite(chunk, { ordered: false });
      updated += res.modifiedCount || 0;
    }

    return {
      message: 'Lot sizes updated from Zerodha',
      updated,
      notFound,
      total: existing.length,
      kiteMasterRows: lotByToken.size,
    };
  }

  /**
   * Perform full instrument sync with timeout and progress tracking
   */
  async performFullSync(apiKey, accessToken, options = {}) {
    const jobId = options.jobId || this.generateJobId();
    const config = { ...this.syncConfig, ...options };
    
    try {
      this.progressService.startJob(jobId, {
        type: 'full_sync',
        totalSteps: 5,
        description: 'Full instrument synchronization from Zerodha',
      });

      // Step 1: Download instruments
      const instruments = await this.downloadInstruments(apiKey, accessToken, config);
      this.progressService.updateJob(jobId, { step: 1, message: 'Instruments downloaded', progress: 10 });

      // Step 2: Parse and validate instruments (Zerodha exchanges only)
      const parsedInstruments = await this.parseInstruments(instruments, { jobId });
      this.progressService.updateJob(jobId, { step: 2, message: `Parsed ${parsedInstruments.length} instruments`, progress: 35 });

      // Step 3: Count existing Zerodha instruments (no full DB load)
      const backup = await this.countExistingZerodhaInstruments();
      this.progressService.updateJob(jobId, { step: 3, message: `Replacing ${backup.count} Zerodha instruments`, progress: 40 });

      // Step 4: Replace Zerodha instruments (preserves BINANCE / FOREX)
      const result = await this.replaceZerodhaInstruments(parsedInstruments, config, jobId);
      this.progressService.updateJob(jobId, { step: 4, message: 'Database updated', progress: 92 });

      // Step 5: Verify sync
      const verification = await this.verifySync(parsedInstruments.length);
      this.progressService.updateJob(jobId, { step: 5, message: 'Sync verified' });

      // Build a per-exchange breakdown so the UI can show a meaningful counts dialog.
      const counts = await this.buildExchangeCounts();

      // Stable, UI-friendly completion payload. The frontend consumes:
      //   { message, deleted, added, counts, totalInDatabase, subscribedTokens }
      // so we expose those canonical aliases without losing the raw fields.
      const completionPayload = {
        message: 'Reset & sync completed',
        deleted: result.deleted,
        added: result.inserted,
        inserted: result.inserted,
        total: result.total,
        errors: result.errors,
        success: result.success,
        counts,
        totalInDatabase: verification?.actual ?? null,
        subscribedTokens: 0, // Enriched in the controller from the live subscription manager.
        verification,
        totalInstruments: parsedInstruments.length,
      };

      this.progressService.completeJob(jobId, { result: completionPayload });

      return completionPayload;

    } catch (error) {
      this.progressService.failJob(jobId, { error: error.message });
      this.loggerService.error('Full sync failed:', error);
      throw error;
    }
  }

  /**
   * Download instruments with timeout and retry logic
   */
  async downloadInstruments(apiKey, accessToken, config) {
    const maxRetries = config.maxRetries || 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.loggerService.info(`Downloading instruments (attempt ${attempt}/${maxRetries})`);

        const response = await axios.get('https://api.kite.trade/instruments', {
          responseType: 'text',
          timeout: config.timeout,
          headers: {
            'X-Kite-Version': '3',
            Authorization: `token ${apiKey}:${accessToken}`,
          },
        });

        const csvText = typeof response.data === 'string' ? response.data : String(response.data ?? '');
        
        if (csvText.length < 1000) {
          throw new Error('Invalid response: insufficient data received');
        }

        this.loggerService.info(`Downloaded ${csvText.length} characters of instrument data`);
        return csvText;

      } catch (error) {
        lastError = error;
        this.loggerService.error(`Download attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          await this.delay(config.retryDelay);
        }
      }
    }

    throw new Error(`Failed to download instruments after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Parse CSV instruments with validation
   */
  async parseInstruments(csvText, options = {}) {
    const { jobId, filterMode = 'full' } = options;

    try {
      const lines = csvText.split('\n');
      const headers = this.parseCSVLine(lines[0]);
      
      const instruments = [];
      let lineNumber = 1;
      const fnoCutoff = filterMode === 'popular'
        ? Date.now() + POPULAR_FNO_MAX_DAYS * 24 * 60 * 60 * 1000
        : null;

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        try {
          const values = this.parseCSVLine(lines[i]);
          const instrument = {};

          headers.forEach((header, idx) => {
            instrument[header.trim()] = values[idx]?.trim();
          });

          if (!instrument.instrument_token || !instrument.tradingsymbol) {
            throw new Error(`Missing required fields at line ${lineNumber}`);
          }

          const exchange = String(instrument.exchange || '').trim().toUpperCase();
          if (!ZERODHA_SYNC_EXCHANGES.includes(exchange)) {
            lineNumber++;
            continue;
          }

          if (filterMode === 'popular' && !this.shouldIncludePopularInstrument(instrument, fnoCutoff)) {
            lineNumber++;
            continue;
          }

          instruments.push(instrument);
          lineNumber++;

          if (jobId && instruments.length % 15000 === 0) {
            this.progressService.updateProgress(jobId, {
              message: `Parsing… ${instruments.length.toLocaleString()} instruments`,
              progress: filterMode === 'popular' ? 35 : 25,
            });
          }

        } catch (error) {
          this.loggerService.warn(`Skipping line ${lineNumber}: ${error.message}`);
          lineNumber++;
        }
      }

      if (instruments.length < (options.minCount ?? 100)) {
        throw new Error(`Unexpected instrument count: ${instruments.length}. Check API credentials.`);
      }

      this.loggerService.info(`Parsed ${instruments.length} valid instruments (${filterMode})`);
      return instruments;

    } catch (error) {
      this.loggerService.error('Failed to parse instruments:', error);
      throw error;
    }
  }

  shouldIncludePopularInstrument(instrument, fnoCutoffMs) {
    const exchange = String(instrument.exchange || '').trim().toUpperCase();
    const type = String(instrument.instrument_type || '').trim().toUpperCase();
    const symbol = String(instrument.tradingsymbol || '').trim().toUpperCase();
    const name = String(instrument.name || '').trim().toUpperCase();

    if (exchange === 'NSE' && type === 'EQ') {
      if (POPULAR_EQ_SYMBOLS.has(symbol)) return true;
      if (name.includes('NIFTY') || symbol.includes('NIFTY') || name.includes('INDIA VIX')) return true;
      return false;
    }

    if (exchange === 'MCX') {
      return POPULAR_MCX_PREFIXES.some((prefix) => symbol.startsWith(prefix));
    }

    if (exchange === 'NFO' || exchange === 'BFO' || exchange === 'CDS') {
      const underlying = this.getUnderlyingFromSymbol(symbol);
      const isIndex = POPULAR_INDEX_UNDERLYINGS.has(underlying);
      const isPopularStock = POPULAR_EQ_SYMBOLS.has(underlying);
      if (!isIndex && !isPopularStock) return false;

      if (type === 'EQ') return true;
      if (!instrument.expiry) return isIndex;

      const expiry = new Date(instrument.expiry);
      if (Number.isNaN(expiry.getTime())) return isIndex;
      return expiry.getTime() <= fnoCutoffMs;
    }

    if (exchange === 'BSE' && type === 'EQ') {
      return POPULAR_EQ_SYMBOLS.has(symbol);
    }

    return false;
  }

  /**
   * Count Zerodha-sourced instruments without loading documents into memory.
   */
  async countExistingZerodhaInstruments() {
    try {
      const Instrument = (await import('../../models/Instrument.js')).default;
      const count = await Instrument.countDocuments({
        exchange: { $in: ZERODHA_SYNC_EXCHANGES },
      });

      this.loggerService.info(`Found ${count} existing Zerodha instruments`);
      return { count, timestamp: new Date() };
    } catch (error) {
      this.loggerService.error('Failed to count existing instruments:', error);
      throw error;
    }
  }

  /**
   * Delete Zerodha instruments and bulk-insert the fresh master (preserves crypto/forex).
   */
  async replaceZerodhaInstruments(instruments, config, jobId) {
    const Instrument = (await import('../../models/Instrument.js')).default;
    const chunkSize = config.chunkSize || 5000;

    try {
      const deleteResult = await Instrument.deleteMany({
        exchange: { $in: ZERODHA_SYNC_EXCHANGES },
      });
      this.loggerService.info(`Deleted ${deleteResult.deletedCount} Zerodha instruments`);

      let insertedCount = 0;
      const errors = [];

      for (let i = 0; i < instruments.length; i += chunkSize) {
        const chunk = instruments.slice(i, i + chunkSize);

        try {
          const processedChunk = this.processInstrumentChunk(chunk);
          await Instrument.insertMany(processedChunk, { ordered: false });
          insertedCount += processedChunk.length;

          const pct = 40 + Math.round((insertedCount / instruments.length) * 50);
          this.progressService.updateProgress(jobId, {
            message: `Inserted ${insertedCount.toLocaleString()}/${instruments.length.toLocaleString()} instruments`,
            progress: Math.min(pct, 90),
          });
        } catch (error) {
          this.loggerService.error(`Error inserting chunk ${Math.floor(i / chunkSize) + 1}:`, error.message);
          errors.push({
            chunk: Math.floor(i / chunkSize) + 1,
            error: error.message,
            startIndex: i,
            endIndex: Math.min(i + chunkSize, instruments.length),
          });
        }
      }

      return {
        deleted: deleteResult.deletedCount,
        inserted: insertedCount,
        total: instruments.length,
        errors,
        success: errors.length === 0,
      };
    } catch (error) {
      this.loggerService.error('Failed to replace Zerodha instruments:', error);
      throw error;
    }
  }

  /**
   * Upsert instruments without deleting the collection (popular sync).
   */
  async upsertInstruments(instruments, config, jobId, progress = {}) {
    const Instrument = (await import('../../models/Instrument.js')).default;
    const chunkSize = config.chunkSize || 5000;
    const progressBase = progress.progressBase ?? 40;
    const progressSpan = progress.progressSpan ?? 50;

    let upserted = 0;
    let modified = 0;
    const errors = [];

    for (let i = 0; i < instruments.length; i += chunkSize) {
      const chunk = instruments.slice(i, i + chunkSize);

      try {
        const processedChunk = this.processInstrumentChunk(chunk);
        const ops = processedChunk.map((doc) => ({
          replaceOne: {
            filter: { token: doc.token },
            replacement: doc,
            upsert: true,
          },
        }));

        const res = await Instrument.bulkWrite(ops, { ordered: false });
        upserted += (res.upsertedCount || 0) + (res.modifiedCount || 0);
        modified += res.modifiedCount || 0;

        const done = Math.min(i + chunkSize, instruments.length);
        const pct = progressBase + Math.round((done / instruments.length) * progressSpan);
        this.progressService.updateProgress(jobId, {
          message: `Upserted ${done.toLocaleString()}/${instruments.length.toLocaleString()} instruments`,
          progress: Math.min(pct, 95),
        });
      } catch (error) {
        this.loggerService.error(`Error upserting chunk ${Math.floor(i / chunkSize) + 1}:`, error.message);
        errors.push({ chunk: Math.floor(i / chunkSize) + 1, error: error.message });
      }
    }

    return { upserted, modified, total: instruments.length, errors, success: errors.length === 0 };
  }

  /**
   * Process instrument chunk with data transformation
   */
  async processInstrumentChunk(chunk) {
    return chunk.map((instrument) => {
      const tokenNum = parseInt(instrument.instrument_token, 10);
      const token = Number.isFinite(tokenNum) ? String(tokenNum) : String(instrument.instrument_token || '');
      const symbol = String(instrument.tradingsymbol || '').trim();
      const exchange = String(instrument.exchange || '').trim().toUpperCase();
      const instrumentTypeRaw = String(instrument.instrument_type || '').trim().toUpperCase();
      const underlying = this.getUnderlyingFromSymbol(symbol);
      const expiry = this.parseExpiryDate(instrument.expiry);

      return {
        token,
        symbol,
        name: String(instrument.name || symbol).trim() || symbol,
        exchange,
        segment: this.mapSegment(instrument),
        displaySegment: this.getDisplaySegment(instrument),
        instrumentType: this.getInstrumentType(instrument),
        category: this.getCategory(instrument, underlying),
        tradingSymbol: symbol,
        lotSize: parseInt(instrument.lot_size, 10) || 1,
        tickSize: parseFloat(instrument.tick_size) || 0.05,
        expiry,
        strike: parseFloat(instrument.strike) || null,
        optionType: instrumentTypeRaw === 'CE' ? 'CE' : instrumentTypeRaw === 'PE' ? 'PE' : null,
        isEnabled: true,
        lastUpdated: new Date()
      };
    });
  }

  /**
   * Build a per-exchange instrument count breakdown for the UI.
   * Returns e.g. { NSE: 1234, MCX: 56, NFO: 78 }. Failures degrade to {}.
   */
  async buildExchangeCounts() {
    try {
      const Instrument = (await import('../../models/Instrument.js')).default;
      const rows = await Instrument.aggregate([
        { $group: { _id: '$exchange', count: { $sum: 1 } } },
      ]);
      return rows.reduce((acc, row) => {
        const key = String(row?._id || 'UNKNOWN').toUpperCase();
        acc[key] = row?.count ?? 0;
        return acc;
      }, {});
    } catch (error) {
      this.loggerService.error('Failed to build exchange counts:', error?.message || error);
      return {};
    }
  }

  /**
   * Verify sync completion
   */
  async verifySync(expectedCount) {
    try {
      const Instrument = (await import('../../models/Instrument.js')).default;
      const actualCount = await Instrument.countDocuments();
      
      const verification = {
        expected: expectedCount,
        actual: actualCount,
        success: expectedCount == null || actualCount >= expectedCount * 0.95,
      };

      this.loggerService.info(`Sync verification: expected ${expectedCount ?? 'n/a'}, actual ${actualCount}`);
      return verification;

    } catch (error) {
      this.loggerService.error('Failed to verify sync:', error);
      throw error;
    }
  }

  /**
   * Helper methods for data mapping
   */
  mapSegment(instrument) {
    const exchange = String(instrument.exchange || '').toUpperCase();

    if (exchange === 'NSE' || exchange === 'BSE') return 'EQUITY';
    if (exchange === 'NFO' || exchange === 'BFO') return 'FNO';
    if (exchange === 'MCX') return 'MCX';
    if (exchange === 'CDS' || exchange === 'FOREX') return 'CURRENCY';
    if (exchange === 'BINANCE') return 'CRYPTOFUT';

    return 'EQUITY';
  }

  getDisplaySegment(instrument) {
    const exchange = String(instrument.exchange || '').toUpperCase();
    const type = String(instrument.instrument_type || '').toUpperCase();
    const isOption = type === 'CE' || type === 'PE' || type.includes('OPT');
    const isFuture = type === 'FUT' || type.includes('FUT');

    if (exchange === 'NSE' || exchange === 'BSE') return 'NSE-EQ';
    if (exchange === 'NFO') return isOption ? 'NSEOPT' : 'NSEFUT';
    if (exchange === 'BFO') return isOption ? 'BSE-OPT' : 'BSE-FUT';
    if (exchange === 'MCX') return isOption ? 'MCXOPT' : 'MCXFUT';
    if (exchange === 'CDS') return isOption ? 'FOREXOPT' : 'FOREXFUT';
    if (exchange === 'FOREX') return isOption ? 'FOREXOPT' : 'FOREXFUT';
    if (exchange === 'BINANCE') return isFuture ? 'CRYPTOFUT' : 'CRYPTOOPT';

    return 'NSE-EQ';
  }

  getInstrumentType(instrument) {
    const type = String(instrument.instrument_type || '').toUpperCase();

    if (type === 'EQ') return 'STOCK';
    if (type === 'FUT' || type.includes('FUT')) return 'FUTURES';
    if (type === 'CE' || type === 'PE' || type.includes('OPT')) return 'OPTIONS';

    return 'STOCK';
  }

  getCategory(instrument, underlying = '') {
    const exchange = String(instrument.exchange || '').toUpperCase();
    const type = String(instrument.instrument_type || '').toUpperCase();
    const u = String(underlying || '').toUpperCase();

    if (exchange === 'MCX') return 'MCX';
    if (exchange === 'CDS' || exchange === 'FOREX') return 'CURRENCY';
    if (exchange === 'BINANCE') return 'CRYPTOFUT';
    if (type === 'EQ') return u.includes('NIFTY') ? 'INDICES' : 'STOCKS';
    if (u.includes('BANKNIFTY')) return 'BANKNIFTY';
    if (u.includes('FINNIFTY')) return 'FINNIFTY';
    if (u.includes('MIDCPNIFTY')) return 'MIDCPNIFTY';
    if (u.includes('NIFTY')) return 'NIFTY';
    return 'OTHER';
  }

  getUnderlyingFromSymbol(symbol = '') {
    const s = String(symbol).toUpperCase();
    if (!s) return '';
    if (s.startsWith('BANKNIFTY')) return 'BANKNIFTY';
    if (s.startsWith('FINNIFTY')) return 'FINNIFTY';
    if (s.startsWith('MIDCPNIFTY')) return 'MIDCPNIFTY';
    if (s.startsWith('NIFTY')) return 'NIFTY';
    return s.replace(/\d.*$/, '');
  }

  parseExpiryDate(raw) {
    if (!raw) return null;
    const dt = new Date(raw);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  /**
   * Parse CSV line handling quoted fields
   */
  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
  
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
