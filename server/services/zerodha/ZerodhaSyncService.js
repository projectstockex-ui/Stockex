/**
 * Zerodha Sync Service
 * 
 * Handles instrument synchronization with proper timeout management and error handling.
 * Follows SOLID principles with single responsibility for synchronization operations.
 */

import axios from 'axios';

export class ZerodhaSyncService {
  constructor(configService, loggerService, progressService) {
    this.configService = configService;
    this.loggerService = loggerService;
    this.progressService = progressService;
    this.syncConfig = {
      timeout: 300000, // 5 minutes
      chunkSize: 2000,
      maxRetries: 3,
      retryDelay: 5000
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
        description: 'Full instrument synchronization from Zerodha'
      });

      // Step 1: Download instruments
      const instruments = await this.downloadInstruments(apiKey, accessToken, config);
      this.progressService.updateJob(jobId, { step: 1, message: 'Instruments downloaded' });

      // Step 2: Parse and validate instruments
      const parsedInstruments = await this.parseInstruments(instruments);
      this.progressService.updateJob(jobId, { step: 2, message: 'Instruments parsed' });

      // Step 3: Backup existing data
      const backup = await this.backupExistingData();
      this.progressService.updateJob(jobId, { step: 3, message: 'Existing data backed up' });

      // Step 4: Clear and insert new data
      const result = await this.clearAndInsert(parsedInstruments, config, jobId);
      this.progressService.updateJob(jobId, { step: 4, message: 'Database updated' });

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
  async parseInstruments(csvText) {
    try {
      const lines = csvText.split('\n');
      const headers = this.parseCSVLine(lines[0]);
      
      const instruments = [];
      let lineNumber = 1;

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        try {
          const values = this.parseCSVLine(lines[i]);
          const instrument = {};

          headers.forEach((header, idx) => {
            instrument[header.trim()] = values[idx]?.trim();
          });

          // Validate required fields
          if (!instrument.instrument_token || !instrument.tradingsymbol) {
            throw new Error(`Missing required fields at line ${lineNumber}`);
          }

          instruments.push(instrument);
          lineNumber++;

        } catch (error) {
          this.loggerService.warn(`Skipping line ${lineNumber}: ${error.message}`);
          lineNumber++;
        }
      }

      if (instruments.length < 100) {
        throw new Error(`Unexpected instrument count: ${instruments.length}. Check API credentials.`);
      }

      this.loggerService.info(`Parsed ${instruments.length} valid instruments`);
      return instruments;

    } catch (error) {
      this.loggerService.error('Failed to parse instruments:', error);
      throw error;
    }
  }

  /**
   * Backup existing data before clearing
   */
  async backupExistingData() {
    try {
      const Instrument = (await import('../../models/Instrument.js')).default;
      
      const existing = await Instrument.find({}).lean();
      const backup = {
        count: existing.length,
        timestamp: new Date(),
        data: existing.slice(0, 1000) // Keep first 1000 for reference
      };

      this.loggerService.info(`Backed up ${existing.length} existing instruments`);
      return backup;

    } catch (error) {
      this.loggerService.error('Failed to backup existing data:', error);
      throw error;
    }
  }

  /**
   * Clear existing data and insert new instruments in chunks
   */
  async clearAndInsert(instruments, config, jobId) {
    const Instrument = (await import('../../models/Instrument.js')).default;
    const chunkSize = config.chunkSize || 2000;
    
    try {
      // Clear existing data
      const deleteResult = await Instrument.deleteMany({});
      this.loggerService.info(`Deleted ${deleteResult.deletedCount} existing instruments`);

      // Insert in chunks to avoid memory issues
      let insertedCount = 0;
      const errors = [];

      for (let i = 0; i < instruments.length; i += chunkSize) {
        const chunk = instruments.slice(i, i + chunkSize);
        
        try {
          const processedChunk = await this.processInstrumentChunk(chunk);
          await Instrument.insertMany(processedChunk, { ordered: false });
          insertedCount += processedChunk.length;
          
          this.progressService.updateProgress(jobId, {
            message: `Inserted ${insertedCount}/${instruments.length} instruments`,
            progress: (insertedCount / instruments.length) * 100
          });

        } catch (error) {
          this.loggerService.error(`Error inserting chunk ${Math.floor(i / chunkSize) + 1}:`, error.message);
          errors.push({
            chunk: Math.floor(i / chunkSize) + 1,
            error: error.message,
            startIndex: i,
            endIndex: Math.min(i + chunkSize, instruments.length)
          });
        }
      }

      const result = {
        deleted: deleteResult.deletedCount,
        inserted: insertedCount,
        total: instruments.length,
        errors,
        success: errors.length === 0
      };

      this.loggerService.info(`Sync completed: deleted ${result.deleted}, inserted ${result.inserted}, errors ${errors.length}`);
      return result;

    } catch (error) {
      this.loggerService.error('Failed to clear and insert instruments:', error);
      throw error;
    }
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
        success: actualCount >= expectedCount * 0.95 // Allow 5% tolerance
      };

      this.loggerService.info(`Sync verification: expected ${expectedCount}, actual ${actualCount}`);
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
