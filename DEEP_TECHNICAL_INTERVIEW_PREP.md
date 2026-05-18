# Deep Technical Interview Preparation - 1+ Year Experience

## SUPER IMPORTANT TOPICS

---

## 1. OAuth Deep Dive

### Understanding OAuth 2.0 in Zerodha Integration

#### What is OAuth?
OAuth 2.0 is an authorization framework that enables third-party applications to obtain limited access to user accounts on HTTP services. In Zerodha's case, it allows our application to access trading data on behalf of the user without storing their Zerodha credentials.

#### OAuth Flow in Our System

```
┌─────────────┐
│   Client    │ (React Admin Dashboard)
└──────┬──────┘
       │ 1. Click "Connect Zerodha"
       ▼
┌─────────────────────────────────────┐
│  GET /api/zerodha/login-url         │
│  Server generates login URL:        │
│  https://kite.zerodha.com/connect/  │
│  login?v=3&api_key={KEY}&           │
│  redirect_url={CALLBACK}             │
└──────┬──────────────────────────────┘
       │ 2. Redirect to Zerodha
       ▼
┌─────────────────────────────────────┐
│  Zerodha Authorization Server       │
│  - User login                       │
│  - 2FA verification                 │
│  - App approval                     │
└──────┬──────────────────────────────┘
       │ 3. User approves, redirect back
       ▼
┌─────────────────────────────────────┐
│  GET /api/zerodha/callback?         │
│  request_token={REQUEST_TOKEN}      │
└──────┬──────────────────────────────┘
       │ 4. Server receives request_token
       ▼
┌─────────────────────────────────────┐
│  Token Exchange Process              │
│  - Calculate checksum               │
│  - POST to Zerodha API              │
│  - Receive access_token              │
└──────┬──────────────────────────────┘
       │ 5. Store access_token
       ▼
┌─────────────────────────────────────┐
│  Session Established                │
│  - WebSocket connection             │
│  - Subscribe to instruments        │
│  - Start receiving live data        │
└─────────────────────────────────────┘
```

### Key Components Explained

#### 1. Request Token
**What is it?**
A temporary token issued by Zerodha after user authorization. It's a one-time use token that must be exchanged immediately for an access token.

**How we get it:**
```javascript
// Callback handler in zerodhaController.js
async handleCallback(req, res) {
  const { request_token } = req.query;
  
  if (!request_token) {
    return redirectError('Missing request_token');
  }
  
  await this.exchangeAndPersistSession(request_token);
}
```

**Characteristics:**
- Single-use (expires immediately after exchange)
- Short-lived (typically 5-10 minutes)
- Passed via query parameter in redirect
- Must be validated and exchanged server-side

#### 2. Access Token
**What is it?**
A long-lived token that authorizes API and WebSocket requests to Zerodha.

**How we get it:**
```javascript
async exchangeAndPersistSession(requestToken) {
  const apiKey = process.env.ZERODHA_API_KEY;
  const apiSecret = process.env.ZERODHA_API_SECRET;
  
  // Calculate checksum
  const checksum = crypto
    .createHash('sha256')
    .update(apiKey + requestToken + apiSecret)
    .digest('hex');
  
  // Exchange with Zerodha
  const form = new URLSearchParams({
    api_key: apiKey,
    request_token: requestToken,
    checksum
  });
  
  const res = await axios.post('https://api.kite.trade/session/token', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  
  const accessToken = res.data.data.access_token;
  
  // Store session
  this.session = {
    apiKey,
    accessToken: accessToken.trim(),
    userId: res.data.data.user_id,
    loginTime: new Date()
  };
  
  await this.saveSession();
}
```

**Characteristics:**
- Long-lived (typically 24 hours for Zerodha)
- Used for REST API calls
- Used for WebSocket authentication
- Must be kept secure (never expose to client)
- Can be renewed via re-authentication

**Security Measures:**
```javascript
// Trim to remove whitespace/newline
const trimmedAccessToken = d.access_token.trim();

// Verify token works before WebSocket connection
const verifyRes = await axios.get('https://api.kite.trade/user/profile', {
  headers: {
    'Authorization': `token ${apiKey}:${trimmedAccessToken}`,
    'X-Kite-Version': '3'
  }
});
```

#### 3. Checksum
**What is it?**
A SHA-256 hash used to verify the integrity of the token exchange request. It proves that the server possesses the API secret without transmitting it.

**How it's calculated:**
```javascript
const checksum = crypto
  .createHash('sha256')
  .update(apiKey + requestToken + apiSecret)
  .digest('hex');
```

**Why it's needed:**
- Prevents token interception attacks
- Verifies server authenticity
- Prevents replay attacks
- Zerodha requirement for security

**Interview Question: Why SHA-256?**
- Cryptographically secure hash function
- One-way function (cannot reverse)
- Collision-resistant
- Industry standard for security
- Fast computation

#### 4. Redirect Flow
**Complete redirect flow:**

```javascript
// Step 1: Generate login URL
async getLoginUrl(req, res) {
  const apiKey = process.env.ZERODHA_API_KEY;
  const callbackUrl = environmentConfig.getCallbackUrl();
  
  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}&redirect_url=${encodeURIComponent(callbackUrl)}`;
  
  return res.json({ url: loginUrl, callbackUrl });
}

// Step 2: User redirected to Zerodha
// Step 3: User approves
// Step 4: Zerodha redirects back
async handleCallback(req, res) {
  const { request_token } = req.query;
  const { success, error } = environmentConfig.getDashboardUrls();
  
  try {
    await this.exchangeAndPersistSession(request_token);
    return res.redirect(success); // Redirect to admin dashboard
  } catch (err) {
    return res.redirect(`${error}&message=${encodeURIComponent(err.message)}`);
  }
}
```

**Redirect URL Validation:**
```javascript
// Validate redirect URL matches environment
if (kitePortalUrl && kitePortalUrl.replace(/\/$/, '') !== callbackUrl.replace(/\/$/, '')) {
  const msg = `Connection rejected: Kite Portal redirect URL (${kitePortalUrl}) does not match current environment (${callbackUrl})`;
  return redirectError(msg);
}
```

### OAuth Security Best Practices

1. **State Parameter (not implemented but should be):**
```javascript
// Generate random state to prevent CSRF
const state = crypto.randomBytes(16).toString('hex');
session.oauthState = state;

// Include in login URL
const loginUrl = `https://kite.zerodha.com/connect/login?api_key=${apiKey}&state=${state}&redirect_url=${callbackUrl}`;

// Validate on callback
if (req.query.state !== session.oauthState) {
  throw new Error('Invalid state - CSRF detected');
}
```

2. **PKCE (Proof Key for Code Exchange):**
```javascript
// Generate code verifier
const codeVerifier = crypto.randomBytes(32).toString('base64url');

// Generate code challenge
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');
```

3. **Token Storage:**
```javascript
// Never store in localStorage or cookies
// Store server-side only
// Use encryption for persistence
```

### Interview Questions & Answers

**Q1: What is the difference between request_token and access_token?**
**A:** 
- Request token: Temporary, single-use, obtained after user authorization, must be exchanged immediately
- Access token: Long-lived (24h), used for API/WebSocket calls, stored securely server-side

**Q2: Why do we need a checksum in OAuth?**
**A:** 
- Proves server possesses API secret without transmitting it
- Prevents token interception and replay attacks
- Verifies request integrity
- Zerodha security requirement

**Q3: What happens if the redirect URL doesn't match?**
**A:** 
- Zerodha will reject the callback
- User won't get access token
- Connection fails
- Must match exactly (scheme, host, port, path)

**Q4: How do you handle token expiration?**
**A:** 
- Store login timestamp
- Check token age before use
- Implement auto-renewal service
- Prompt user to re-authenticate when expired
- Background monitoring for expiration

**Q5: Why trim the access token?**
**A:** 
- Remove whitespace/newline characters
- Prevent authentication failures
- Zerodha API is strict about token format
- Common issue with string handling

---

## 2. WebSocket Lifecycle Deep Dive

### Complete WebSocket Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  1. INITIALIZATION                                            │
│  - Load session from storage                                  │
│  - Validate access token                                      │
│  - Check connection state                                    │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CONNECTION SETUP                                          │
│  - Create KiteTicker instance                                 │
│  - Set credentials (api_key, access_token)                    │
│  - Configure auto-reconnect                                  │
│  - Setup event handlers                                      │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. CONNECTING STATE                                          │
│  - Set isConnecting flag                                     │
│  - Start connection timeout timer                             │
│  - Initiate WebSocket handshake                               │
│  - Wait for 'connect' event                                  │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  4. CONNECTED STATE                                           │
│  - Set isConnected flag                                       │
│  - Clear timeout timer                                       │
│  - Start heartbeat monitoring                                 │
│  - Subscribe to essential tokens                             │
│  - Process pending subscriptions                            │
│  - Emit 'connected' event                                   │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  5. ACTIVE STATE (Data Flow)                                  │
│  - Receive ticks from Zerodha                                │
│  - Process tick data                                        │
│  - Broadcast to clients via Socket.IO                        │
│  - Update database (throttled)                               │
│  - Monitor connection health                                 │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  6. DISCONNECTION                                              │
│  - Detect disconnect event                                   │
│  - Stop heartbeat                                            │
│  - Clear subscriptions                                      │
│  - Update connection state                                  │
│  - Emit 'disconnected' event                                │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  7. RECONNECTION (if auto-reconnect enabled)                │
│  - Calculate backoff delay                                  │
│  - Increment reconnect attempts                              │
│  - Schedule reconnection                                    │
│  - Attempt reconnection                                      │
│  - Resubscribe to tokens                                    │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  8. CLEANUP (manual disconnect or max retries)               │
│  - Clear all timers                                          │
│  - Disconnect ticker                                         │
│  - Clear subscriptions                                      │
│  - Reset connection state                                   │
│  - Emit cleanup events                                      │
└─────────────────────────────────────────────────────────────┘
```

### Detailed Implementation

#### 1. Connection Setup

```javascript
// ZerodhaConnectionManager.js
async connect(apiKey, accessToken, options = {}) {
  try {
    // Prevent duplicate connections
    if (this.connectionState.isConnecting) {
      throw new Error('Connection already in progress');
    }
    
    // Disconnect existing connection
    if (this.connectionState.isConnected) {
      await this.disconnect();
    }
    
    // Set connection state
    this.connectionState.isConnecting = true;
    this.connectionState.reconnectAttempts = 0;
    
    // Create connection promise with timeout
    const connectPromise = new Promise((resolve, reject) => {
      const timeout = options.timeout || this.configService.getConnectionTimeout();
      const timeoutId = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);
      
      // Create KiteTicker instance
      this.ticker = new KiteTicker({
        api_key: apiKey,
        access_token: accessToken
      });
      
      // Setup event handlers
      this.setupEventHandlers(resolve, reject, timeoutId);
      
      // Initiate connection
      this.ticker.connect();
    });
    
    await connectPromise;
    
    // Update state on success
    this.connectionState.isConnected = true;
    this.connectionState.isConnecting = false;
    this.connectionState.lastConnectedAt = new Date();
    
    // Emit connected event
    this.emit('connected', { timestamp: this.connectionState.lastConnectedAt });
    
    return this.ticker;
    
  } catch (error) {
    this.connectionState.isConnecting = false;
    this.connectionState.lastError = error;
    this.emit('error', error);
    throw error;
  }
}
```

#### 2. Event Handlers Setup

```javascript
setupEventHandlers(resolve, reject, timeoutId) {
  // Connection success
  this.ticker.on('connect', () => {
    clearTimeout(timeoutId);
    resolve(this.ticker);
  });
  
  // Connection error
  this.ticker.on('error', (error) => {
    clearTimeout(timeoutId);
    this.connectionState.lastError = error;
    
    // Detect authentication errors
    if (String(error?.message || error).includes('403')) {
      this.loggerService.error('Zerodha WebSocket 403: Access token expired or invalid');
      this.emit('auth_error', error);
    } else {
      this.emit('error', error);
    }
    
    if (this.connectionState.isConnecting) {
      reject(error);
    }
  });
  
  // Disconnection
  this.ticker.on('disconnect', () => {
    this.connectionState.isConnected = false;
    this.emit('disconnected', { timestamp: new Date() });
  });
  
  // Reconnection
  this.ticker.on('reconnect', (reconnectCount, reconnectInterval) => {
    this.connectionState.reconnectAttempts = reconnectCount;
    this.emit('reconnecting', { attempt: reconnectCount, interval: reconnectInterval });
  });
  
  // Max reconnection attempts
  this.ticker.on('noreconnect', () => {
    this.connectionState.isConnected = false;
    this.emit('max_reconnect_reached', { attempts: this.connectionState.reconnectAttempts });
  });
  
  // Order updates
  this.ticker.on('order_update', (order) => {
    this.emit('order_update', order);
  });
}
```

#### 3. Heartbeat Monitoring

```javascript
// WebSocketReconnectionManager.js
startHeartbeat() {
  this.stopHeartbeat();
  
  this.heartbeatTimer = setInterval(() => {
    if (this.isConnected && this.ticker) {
      this.checkConnectionHealth();
    } else {
      this.logger.warn('Heartbeat: WebSocket not connected');
      this.emitEvent('heartbeatFailed', { reason: 'not_connected' });
    }
  }, this.config.heartbeatInterval); // 30 seconds
}

checkConnectionHealth() {
  try {
    if (this.ticker && this.isConnected) {
      this.logger.debug('Heartbeat: Connection healthy');
      this.emitEvent('heartbeat', { 
        connected: true, 
        timestamp: new Date().toISOString(),
        reconnectAttempts: this.reconnectAttempts
      });
    } else {
      this.logger.warn('Heartbeat: Connection lost, triggering reconnection');
      this.isConnected = false;
      this.emitEvent('heartbeatFailed', { reason: 'connection_lost' });
      
      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  } catch (error) {
    this.logger.error('Heartbeat check failed:', error);
    this.emitEvent('heartbeatFailed', { reason: 'check_failed', error: error.message });
  }
}
```

#### 4. Reconnection with Exponential Backoff

```javascript
scheduleReconnect() {
  if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
    this.logger.error('Max reconnection attempts reached');
    this.emitEvent('reconnectFailed');
    return;
  }
  
  // Calculate delay with exponential backoff
  let delay;
  if (this.config.exponentialBackoff) {
    delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );
  } else {
    delay = this.config.reconnectDelay;
  }
  
  this.reconnectAttempts++;
  
  this.logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${delay/1000}s`);
  
  this.reconnectTimer = setTimeout(async () => {
    this.logger.info(`Attempting reconnection ${this.reconnectAttempts}`);
    this.emitEvent('reconnecting', { attempt: this.reconnectAttempts });
    this.emitEvent('reconnectRequested', { attempt: this.reconnectAttempts });
  }, delay);
}
```

**Exponential Backoff Formula:**
```
delay = min(base_delay * 2^attempt, max_delay)

Example:
- Attempt 1: 5s
- Attempt 2: 10s
- Attempt 3: 20s
- Attempt 4: 40s
- Attempt 5: 60s (max)
```

#### 5. Subscription Management

```javascript
// ZerodhaSubscriptionManager.js
async subscribeTokens(tokens, options = {}) {
  try {
    // Check connection
    if (!this.connectionManager.isConnected()) {
      return this.queueSubscriptions(tokens);
    }
    
    // Normalize and filter tokens
    const normalizedTokens = this.normalizeTokens(tokens);
    const cappedTokens = this.capSubscriptions(normalizedTokens, config.maxTokens);
    
    // Filter already subscribed
    const newTokens = cappedTokens.filter(token => !this.subscribedTokens.has(token));
    
    if (newTokens.length === 0) {
      return { subscribed: 0, total: this.subscribedTokens.size };
    }
    
    // Subscribe in batches
    const result = await this.subscribeInBatches(newTokens, config);
    
    // Update subscribed tokens
    newTokens.forEach(token => this.subscribedTokens.add(token));
    
    return { ...result, total: this.subscribedTokens.size };
    
  } catch (error) {
    this.loggerService.error('Error subscribing to tokens:', error);
    throw error;
  }
}

async subscribeInBatches(tokens, config) {
  let subscribedCount = 0;
  const errors = [];
  
  // Process in batches of 100
  for (let i = 0; i < tokens.length; i += config.batchSize) {
    const batch = tokens.slice(i, i + config.batchSize);
    
    try {
      await this.subscribeBatch(batch);
      subscribedCount += batch.length;
      
      // Delay between batches
      if (i + config.batchSize < tokens.length) {
        await this.delay(config.batchDelay);
      }
      
    } catch (error) {
      errors.push({ batch: Math.floor(i / config.batchSize) + 1, error: error.message });
      await this.delay(config.rateLimitDelay);
    }
  }
  
  return { subscribed: subscribedCount, total: tokens.length, errors };
}
```

**Why Batching?**
- Zerodha rate limits (max 3000 tokens per connection)
- Prevents overwhelming the connection
- Allows error recovery per batch
- Better memory management
- Avoids timeout issues

#### 6. Disconnection Cleanup

```javascript
async disconnect() {
  try {
    // Clear timers
    this.stopHeartbeat();
    this.clearReconnectTimer();
    
    // Disconnect ticker
    if (this.ticker) {
      this.ticker.disconnect();
      this.ticker = null;
    }
    
    // Update state
    this.connectionState.isConnected = false;
    this.connectionState.isConnecting = false;
    this.connectionState.lastConnectedAt = null;
    
    // Emit event
    this.emit('disconnected', { timestamp: new Date() });
    
  } catch (error) {
    this.loggerService.error('Error disconnecting:', error);
    throw error;
  }
}
```

### WebSocket vs HTTP Comparison

| Aspect | WebSocket | HTTP |
|--------|-----------|------|
| **Connection** | Persistent, full-duplex | Stateless, request-response |
| **Latency** | Low (always open) | Higher (new connection each time) |
| **Overhead** | Minimal (small headers) | Higher (headers each request) |
| **Server Push** | Native (server can push anytime) | Not possible (client must poll) |
| **Real-time** | Excellent | Poor (requires polling) |
| **Scaling** | Challenging (stateful) | Easier (stateless) |

### Interview Questions & Answers

**Q1: Why use WebSocket instead of HTTP polling for market data?**
**A:** 
- WebSocket provides real-time, low-latency data
- No connection overhead per request
- Server can push data instantly
- Bidirectional communication
- Better for high-frequency updates (ticks every second)

**Q2: How do you handle WebSocket disconnections?**
**A:** 
- Detect disconnect event
- Stop heartbeat monitoring
- Clear subscriptions
- Implement auto-reconnect with exponential backoff
- Resubscribe to tokens after reconnection
- Notify clients via Socket.IO

**Q3: What is exponential backoff and why use it?**
**A:** 
- Algorithm: delay = min(base_delay * 2^attempt, max_delay)
- Prevents server overload during outages
- Gives server time to recover
- Reduces unnecessary reconnection attempts
- Standard pattern for resilient connections

**Q4: Why batch token subscriptions?**
**A:** 
- Zerodha limits (3000 tokens max)
- Rate limiting prevention
- Error isolation per batch
- Memory management
- Avoids timeout on large requests

**Q5: How does heartbeat monitoring work?**
**A:** 
- Periodic connection health check (every 30s)
- Verifies WebSocket is still active
- Triggers reconnection on failure
- Monitors reconnection attempts
- Emits health status events

**Q6: What happens when access token expires during WebSocket connection?**
**A:** 
- WebSocket error with 403 status
- Detect authentication error
- Emit auth_error event
- Trigger re-authentication flow
- Disconnect and reconnect with new token

---

## 3. Event-Driven Architecture Deep Dive

### Event Flow: Received → Processed → Broadcasted

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: EVENT RECEIVED (Zerodha WebSocket)                │
│                                                              │
│  Zerodha Server → WebSocket → KiteTicker Library            │
│                                                              │
│  ticker.on('ticks', (ticks) => {                            │
│    // Raw tick data received                                │
│    // Array of tick objects                                 │
│  })                                                         │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: EVENT PROCESSING (Orchestrator)                    │
│                                                              │
│  processTicks(ticks) {                                      │
│    // Phase 2.1: Data normalization                         │
│    for (const tick of ticks) {                              │
│      const tickData = buildTickData(tick);                  │
│                                                              │
│      // Phase 2.2: Data enrichment                          │
│      - Calculate bid/ask from order book                    │
│      - Detect circuit limits                               │
│      - Calculate change %                                  │
│      - Handle legacy token mapping                         │
│                                                              │
│      // Phase 2.3: Cache update                             │
│      marketData.set(token, tickData);                      │
│    }                                                        │
│  }                                                          │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: IMMEDIATE BROADCAST (Real-time)                   │
│                                                              │
│  // Phase 3.1: Prepare updates                              │
│  const updates = {};                                        │
│  updates[token] = tickData;                                 │
│                                                              │
│  // Phase 3.2: Broadcast via Socket.IO                      │
│  io.emit('market_tick', updates);                           │
│                                                              │
│  // Phase 3.3: Client receives                              │
│  socket.on('market_tick', (data) => {                       │
│    updateUI(data);                                          │
│  });                                                        │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: DEFERRED PROCESSING (Async, Non-blocking)          │
│                                                              │
│  setImmediate(() => {                                       │
│    // Phase 4.1: Database update (throttled)                │
│    if (now - lastUpdate >= 300ms) {                         │
│      updateInstrumentInDatabase(token, tickData);           │
│    }                                                        │
│                                                              │
│    // Phase 4.2: File cache update (NIFTY only)            │
│    if (token === '256265') {                                │
│      saveToCache(tickData.ltp);                             │
│    }                                                        │
│                                                              │
│    // Phase 4.3: Margin monitoring (optional)               │
│    triggerMarginMonitoring(token, tickData);                 │
│  });                                                        │
└─────────────────────────────────────────────────────────────┘
```

### Detailed Implementation

#### Phase 1: Event Reception

```javascript
// zerodhaWebSocket.js
ticker.on('ticks', (ticks) => {
  console.log('[ZerodhaWebSocket] Received ticks from Kite:', ticks.length);
  processTicks(ticks); // Delegate to processing
});
```

**Raw Tick Structure:**
```javascript
{
  instrument_token: 256265,
  last_price: 24500.50,
  ohlc: {
    open: 24400,
    high: 24600,
    low: 24350,
    close: 24450
  },
  depth: {
    buy: [{ price: 24500, quantity: 100, orders: 5 }],
    sell: [{ price: 24501, quantity: 150, orders: 3 }]
  },
  volume_traded: 1000000,
  change: 50.50,
  change_percent: 0.21,
  last_trade_time: '2024-01-15 10:30:00'
}
```

#### Phase 2: Event Processing

```javascript
// ZerodhaOrchestrator.js
processTicks(ticks) {
  try {
    const updates = {};
    const canonicalOnly = {};
    
    // Phase 2.1: Process each tick
    for (const tick of ticks) {
      const token = tick.instrument_token.toString();
      const tickData = this.buildTickData(tick);
      
      // Phase 2.2: Cache in memory
      this.marketData.set(token, tickData);
      updates[token] = tickData;
      canonicalOnly[token] = tickData;
      
      // Phase 2.3: Handle legacy token mapping
      const legacyTokens = this.getLegacyTokens(tick.instrument_token);
      for (const legacyToken of legacyTokens) {
        const alias = { ...tickData, token: String(legacyToken) };
        this.marketData.set(String(legacyToken), alias);
        updates[String(legacyToken)] = alias;
      }
    }
    
    // Phase 2.4: Immediate broadcast
    if (Object.keys(updates).length > 0) {
      this.broadcastToClients('market_tick', updates);
    }
    
    // Phase 2.5: Deferred processing
    if (Object.keys(canonicalOnly).length > 0) {
      setImmediate(() => {
        this.processTicksDeferred(canonicalOnly);
      });
    }
    
  } catch (error) {
    this.loggerService.error('Error processing ticks:', error);
  }
}
```

**Data Enrichment (buildTickData):**
```javascript
buildTickData(tick) {
  // Extract bid/ask from order book
  const rawBid = tick.depth?.buy?.[0]?.price;
  const rawAsk = tick.depth?.sell?.[0]?.price;
  
  // Fallback to last price if bid/ask unavailable
  const bestBid = rawBid && rawBid > 0 ? rawBid : tick.last_price;
  const bestAsk = rawAsk && rawAsk > 0 ? rawAsk : tick.last_price;
  
  // Detect circuit limits
  const isUpperCircuit = (!rawAsk || rawAsk === 0) && tick.last_price > 0;
  const isLowerCircuit = (!rawBid || rawBid === 0) && tick.last_price > 0;
  const circuitStatus = isUpperCircuit ? 'UC' : isLowerCircuit ? 'LC' : null;
  
  // Build enriched tick data
  return {
    token: tick.instrument_token.toString(),
    symbol: this.getSymbol(tick),
    ltp: tick.last_price,
    bid: bestBid,
    ask: bestAsk,
    rawBid: rawBid || 0,
    rawAsk: rawAsk || 0,
    circuit: circuitStatus,
    open: tick.ohlc?.open,
    high: tick.ohlc?.high,
    low: tick.ohlc?.low,
    close: tick.ohlc?.close,
    change: tick.change,
    changePercent: tick.change_percent || this.calculateChangePercent(tick),
    volume: tick.volume_traded || tick.volume,
    buyQuantity: tick.total_buy_quantity,
    sellQuantity: tick.total_sell_quantity,
    lastTradeTime: tick.last_trade_time,
    oi: tick.oi,
    oiDayHigh: tick.oi_day_high,
    oiDayLow: tick.oi_day_low,
    lastUpdated: new Date(),
    serverTimestamp: Date.now()
  };
}
```

#### Phase 3: Immediate Broadcast

```javascript
// zerodhaWebSocket.js - PHASE 2: IMMEDIATE BROADCAST
if (io && Object.keys(updates).length > 0) {
  console.log('[ZerodhaWebSocket] Emitting market_tick with tokens:', Object.keys(updates));
  io.emit('market_tick', updates);
}
```

**Why Immediate Broadcast?**
- Real-time requirement for trading
- Low latency critical for market data
- Users expect instant price updates
- Competitive advantage over polling
- Better user experience

#### Phase 4: Deferred Processing

```javascript
// zerodhaWebSocket.js - PHASE 3: BALANCED ASYNC PROCESSING
setImmediate(() => {
  for (const [tok, tickData] of Object.entries(canonicalOnly)) {
    // Database update with throttling
    const now = Date.now();
    const lastUpdate = lastDbUpdateTimestamps.get(tok) || 0;
    if (now - lastUpdate >= DB_UPDATE_THROTTLE_MS) { // 300ms throttle
      lastDbUpdateTimestamps.set(tok, now);
      updateInstrumentLastPrice(tok, tickData).catch((err) =>
        console.error(`DB update error for token ${tok}:`, err.message)
      );
    }
    
    // File cache for NIFTY (closed-market fallback)
    if (tok === '256265' && tickData.ltp && tickData.ltp > 0) {
      const lastNiftyUpdate = lastDbUpdateTimestamps.get('nifty_cache') || 0;
      if (now - lastNiftyUpdate >= DB_UPDATE_THROTTLE_MS) {
        lastDbUpdateTimestamps.set('nifty_cache', now);
        saveToCache(tickData.ltp);
      }
    }
  }
});
```

**Why Deferred Processing?**
- Non-blocking: Doesn't delay broadcast
- Throttled: Prevents DB overload
- Best-effort: Failures don't affect real-time flow
- Resource efficient: Batch updates
- Graceful degradation

### Event-Driven Architecture Benefits

1. **Decoupling:**
```javascript
// Producers don't know consumers
this.emit('connected', data); // Producer
this.on('connected', handler); // Consumer
```

2. **Scalability:**
```javascript
// Multiple consumers can subscribe
this.on('ticks', handler1);
this.on('ticks', handler2);
this.on('ticks', handler3);
```

3. **Flexibility:**
```javascript
// Easy to add new handlers without changing producer
this.on('ticks', newHandler);
```

4. **Asynchronous:**
```javascript
// Non-blocking event processing
setImmediate(() => {
  processTicksDeferred(canonicalOnly);
});
```

### Event Emitter Pattern Implementation

```javascript
// Custom event emitter
class EventEmitter {
  constructor() {
    this.eventHandlers = new Map();
  }
  
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }
  
  emit(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }
  
  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }
}
```

### Interview Questions & Answers

**Q1: Why use event-driven architecture for market data?**
**A:** 
- Real-time requirements (low latency)
- Decoupling of components
- Scalability (multiple consumers)
- Asynchronous processing (non-blocking)
- Flexibility (easy to add handlers)

**Q2: What is the difference between immediate broadcast and deferred processing?**
**A:** 
- Immediate: Synchronous, critical path, low latency, for real-time UI
- Deferred: Asynchronous, non-blocking, throttled, for persistence/monitoring

**Q3: Why use setImmediate for deferred processing?**
**A:** 
- Defers to next event loop iteration
- Doesn't block the current execution
- Allows immediate broadcast to complete first
- Better performance than setTimeout(fn, 0)
- Node.js optimized for this pattern

**Q4: How do you handle errors in event handlers?**
**A:** 
- Wrap in try-catch blocks
- Log errors without crashing
- Continue processing other handlers
- Isolate failures to prevent cascade

**Q5: Why throttle database updates?**
**A:** 
- Prevent DB overload from high-frequency ticks
- Reduce write operations (thousands per second)
- Maintain performance
- Avoid connection pool exhaustion
- Balance real-time vs persistence

**Q6: What is the purpose of legacy token mapping?**
**A:** 
- Backward compatibility with old data
- Support multiple token formats
- Smooth migration between systems
- Prevent breaking changes for existing clients

---

## 4. Separation of Concerns Deep Dive

### Why Separate Services?

```
┌─────────────────────────────────────────────────────────────┐
│  MONOLITHIC APPROACH (BAD)                                   │
│                                                              │
│  class ZerodhaService {                                      │
│    connect() { }                                            │
│    subscribe() { }                                          │
│    processTicks() { }                                       │
│    saveToken() { }                                          │
│    loadToken() { }                                          │
│    syncInstruments() { }                                    │
│    manageReconnection() { }                                 │
│    handleErrors() { }                                       │
│    // 1000+ lines of code                                  │
│    // Hard to test                                          │
│    // Hard to maintain                                      │
│    // Hard to extend                                        │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SEPARATED CONCERNS (GOOD)                                   │
│                                                              │
│  ConnectionManager     → Connection lifecycle              │
│  SubscriptionManager  → Token subscriptions               │
│  Orchestrator          → Coordination & tick processing     │
│  TokenService          → Token persistence & renewal         │
│  SyncService           → Instrument synchronization          │
│  ErrorHandler          → Error classification & recovery    │
│  // Each class: ~200 lines                                 │
│  // Easy to test                                            │
│  // Easy to maintain                                        │
│  // Easy to extend                                          │
└─────────────────────────────────────────────────────────────┘
```

### SOLID Principles Applied

#### 1. Single Responsibility Principle (SRP)

**ConnectionManager:**
```javascript
export class ZerodhaConnectionManager {
  // ONLY handles WebSocket connection lifecycle
  constructor(configService, loggerService) { }
  
  async connect(apiKey, accessToken, options = {}) { }
  async disconnect() { }
  isConnected() { }
  getConnectionState() { }
  enableAutoReconnect(options = {}) { }
  
  // Event handling (still connection-related)
  on(event, handler) { }
  emit(event, data) { }
  
  // Health check (connection-related)
  async healthCheck() { }
}
```

**Responsibility:** Manage WebSocket connection state and lifecycle

**Does NOT:**
- Subscribe to tokens
- Process tick data
- Manage tokens
- Handle business logic

#### 2. SubscriptionManager:
```javascript
export class ZerodhaSubscriptionManager {
  // ONLY handles token subscriptions
  constructor(connectionManager, configService, loggerService) { }
  
  async subscribeTokens(tokens, options = {}) { }
  async unsubscribeTokens(tokens) { }
  async resubscribeAll() { }
  queueSubscriptions(tokens) { }
  processPendingSubscriptions() { }
  
  // Token management
  normalizeTokens(tokens) { }
  capSubscriptions(tokens, maxTokens) { }
  isSubscribed(token) { }
  
  // Statistics
  getSubscriptionStats() { }
}
```

**Responsibility:** Manage which tokens are subscribed

**Does NOT:**
- Connect to WebSocket
- Process tick data
- Manage connection state
- Handle business logic

#### 3. Orchestrator:
```javascript
export class ZerodhaOrchestrator {
  // ONLY coordinates other services
  constructor(
    connectionManager,
    subscriptionManager,
    syncService,
    progressService,
    configService,
    loggerService
  ) { }
  
  // Orchestration methods
  async connect(apiKey, accessToken, options = {}) {
    return await this.connectionManager.connect(apiKey, accessToken, options);
  }
  
  async disconnect() {
    await this.connectionManager.disconnect();
    this.subscriptionManager.clearAllSubscriptions();
  }
  
  async performSync(apiKey, accessToken, options = {}) {
    return await this.syncService.performFullSync(apiKey, accessToken, options);
  }
  
  async subscribeTokens(tokens, options = {}) {
    return await this.subscriptionManager.subscribeTokens(tokens, options);
  }
  
  // Tick processing (coordination)
  processTicks(ticks) { }
  buildTickData(tick) { }
  broadcastToClients(event, data) { }
  
  // Status
  getConnectionStatus() { }
  async performHealthCheck() { }
}
```

**Responsibility:** Coordinate all services and process business logic

**Does NOT:**
- Directly manage WebSocket
- Directly handle subscriptions
- Directly sync instruments
- Low-level implementation details

#### 4. TokenService:
```javascript
class TokenPersistenceService {
  // ONLY handles token storage and retrieval
  constructor(logger) {
    this.encryptionKey = process.env.ZERODHA_TOKEN_ENCRYPTION_KEY;
    this.tokenFile = path.join(process.cwd(), '.zerodha-session.json');
  }
  
  async saveToken(tokenData) { }
  async loadToken() { }
  async deleteToken() { }
  isTokenExpired(tokenData, bufferMinutes = 30) { }
  async getTokenStatus() { }
  
  // Encryption
  encrypt(text) { }
  decrypt(encryptedText) { }
}
```

**Responsibility:** Secure token persistence

**Does NOT:**
- Manage connections
- Process data
- Handle business logic
- Expose tokens to clients

### Dependency Injection

```javascript
// Clean dependency injection
const progressService = new ZerodhaProgressService(logger);
const connectionManager = new ZerodhaConnectionManager(config, logger);
const subscriptionManager = new ZerodhaSubscriptionManager(connectionManager, config, logger);
const syncService = new ZerodhaSyncService(config, logger, progressService);

this.orchestrator = new ZerodhaOrchestrator(
  connectionManager,
  subscriptionManager,
  syncService,
  progressService,
  config,
  logger
);
```

**Benefits:**
- Testable (can mock dependencies)
- Flexible (easy to swap implementations)
- Clear dependencies (explicit in constructor)
- Loose coupling (services don't know each other's internals)

### Interface Segregation

```javascript
// Interface for WebSocket management
export class IWebSocketManager {
  connect(session) { throw new Error('Must implement'); }
  disconnect() { throw new Error('Must implement'); }
  isConnected() { throw new Error('Must implement'); }
  subscribe(instruments) { throw new Error('Must implement'); }
  unsubscribe(instruments) { throw new Error('Must implement'); }
}

// Implementation
export class WebSocketReconnectionManager extends IWebSocketManager {
  // Implements all required methods
  connect(session) { /* implementation */ }
  disconnect() { /* implementation */ }
  // ...
}
```

**Benefits:**
- Clear contract
- Multiple implementations possible
- Easy to mock for testing
- Enforces consistency

### Error Handling Separation

```javascript
// Dedicated error handler
class ZerodhaErrorHandler {
  handleConnectError(error, context, userId) {
    // Classify error
    const errorType = this.classifyError(error);
    
    // Determine recovery strategy
    const shouldClearSession = this.shouldClearSession(errorType);
    
    // Log appropriately
    this.logError(error, errorType, context);
    
    // Return structured error info
    return {
      errorType,
      errorDescription: this.getDescription(errorType),
      shouldClearSession,
      userMessage: this.getUserMessage(errorType)
    };
  }
  
  classifyError(error) {
    if (error.message.includes('403')) return 'AUTH_ERROR';
    if (error.message.includes('timeout')) return 'TIMEOUT';
    if (error.message.includes('network')) return 'NETWORK_ERROR';
    return 'UNKNOWN_ERROR';
  }
}
```

**Benefits:**
- Centralized error handling
- Consistent error classification
- Reusable recovery logic
- Better logging and monitoring

### Testing Benefits

```javascript
// Easy to test ConnectionManager in isolation
describe('ZerodhaConnectionManager', () => {
  it('should connect successfully', async () => {
    const mockConfig = { getConnectionTimeout: () => 30000 };
    const mockLogger = { info: jest.fn(), error: jest.fn() };
    const manager = new ZerodhaConnectionManager(mockConfig, mockLogger);
    
    // Mock KiteTicker
    jest.mock('kiteconnect', () => ({
      KiteTicker: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        on: jest.fn()
      }))
    }));
    
    await manager.connect('api_key', 'access_token');
    expect(manager.isConnected()).toBe(true);
  });
});

// Easy to test SubscriptionManager in isolation
describe('ZerodhaSubscriptionManager', () => {
  it('should subscribe to tokens', async () => {
    const mockConnection = { 
      isConnected: () => true,
      ticker: { 
        subscribe: jest.fn(),
        setMode: jest.fn()
      }
    };
    const manager = new ZerodhaSubscriptionManager(mockConnection, config, logger);
    
    const result = await manager.subscribeTokens([256265, 260105]);
    expect(result.subscribed).toBe(2);
  });
});
```

### Interview Questions & Answers

**Q1: Why separate ConnectionManager from SubscriptionManager?**
**A:** 
- SRP: Each has single responsibility
- ConnectionManager: WebSocket lifecycle only
- SubscriptionManager: Token management only
- Easy to test in isolation
- Can change implementation without affecting other
- Clear separation of concerns

**Q2: What is the role of the Orchestrator?**
**A:** 
- Coordinates all services
- Implements business logic
- Processes tick data
- Broadcasts to clients
- Doesn't handle low-level details
- Glue between services

**Q3: Why use dependency injection?**
**A:** 
- Testability (can mock dependencies)
- Flexibility (swap implementations)
- Clear dependencies (explicit in constructor)
- Loose coupling (services don't know internals)
- Better code organization

**Q4: How does separation of concerns improve maintainability?**
**A:** 
- Smaller, focused classes (~200 lines vs 1000+)
- Easier to understand
- Easier to modify (change one thing without breaking others)
- Easier to test (unit tests per service)
- Easier to extend (add new features without modifying existing)

**Q5: What are the SOLID principles applied?**
**A:** 
- **S**ingle Responsibility: Each class has one job
- **O**pen/Closed: Open for extension, closed for modification
- **L**iskov Substitution: Subtypes can replace base types
- **I**nterface Segregation: Small, specific interfaces
- **D**ependency Inversion: Depend on abstractions, not concretions

**Q6: Why separate error handling?**
**A:** 
- Centralized error classification
- Consistent error responses
- Reusable recovery logic
- Better logging and monitoring
- Separation of error logic from business logic

---

## Summary: Key Takeaways for Interview

### OAuth
- **request_token**: Temporary, single-use, obtained after user approval
- **access_token**: Long-lived (24h), used for API/WebSocket, stored securely
- **checksum**: SHA-256 hash proving server possession of API secret
- **redirect flow**: User → Zerodha → Callback with request_token → Exchange → Access token

### WebSocket Lifecycle
- **Connect**: Create KiteTicker, setup handlers, initiate connection
- **Reconnect**: Exponential backoff, max retries, resubscribe tokens
- **Disconnect**: Cleanup timers, clear subscriptions, update state
- **Heartbeat**: Periodic health check (30s), trigger reconnection on failure
- **Subscriptions**: Batch processing (100 tokens), rate limiting, pending queue

### Event-Driven Architecture
- **Received**: WebSocket emits 'ticks' event
- **Processed**: Normalize, enrich, cache data
- **Broadcast**: Immediate Socket.IO broadcast for real-time UI
- **Deferred**: Async DB updates, throttled (300ms), non-blocking

### Separation of Concerns
- **ConnectionManager**: WebSocket lifecycle only
- **SubscriptionManager**: Token subscriptions only
- **Orchestrator**: Coordination and business logic
- **TokenService**: Secure token persistence
- **Benefits**: Testability, maintainability, flexibility, SOLID principles

---

## Code References

### Key Files for Interview

```
server/
├── controllers/zerodhaController.js          - OAuth flow
├── services/zerodha/
│   ├── ZerodhaOrchestrator.js               - Coordination
│   ├── ZerodhaConnectionManager.js          - Connection lifecycle
│   ├── ZerodhaSubscriptionManager.js        - Subscriptions
│   ├── ZerodhaSyncService.js                - Instrument sync
│   ├── token/
│   │   ├── TokenPersistenceService.js        - Token storage
│   │   └── AutoTokenRenewalService.js       - Token renewal
│   └── connection/
│       └── WebSocketReconnectionManager.js   - Reconnection logic
└── services/zerodhaWebSocket.js             - Legacy implementation
```

---

## Practice Questions for Self-Test

1. **OAuth:** What happens if the checksum is incorrect?
2. **WebSocket:** How do you handle 403 errors during WebSocket connection?
3. **Events:** Why use setImmediate instead of setTimeout for deferred processing?
4. **Architecture:** Can you explain the dependency injection pattern used?
5. **Security:** How do you protect the access token from being exposed?
6. **Performance:** Why throttle database updates to 300ms?
7. **Reliability:** What is exponential backoff and why is it important?
8. **Design:** How would you add a new event handler without modifying existing code?

---

*Prepared for 1+ Year Experience Candidates - Deep Technical Interview Preparation*
