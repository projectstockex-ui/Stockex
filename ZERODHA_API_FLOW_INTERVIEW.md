# Zerodha API Integration Flow - Interview Preparation

## Complete Flow Chart (API Key से लेकर Live Data तक)

```
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 1: SETUP                                │
│                                                                 │
│  1. developers.kite.trade पर जाओ                              │
│  2. New Kite Connect App बनाओ                                 │
│  3. API Key और API Secret मिलता है                            │
│  4. Redirect URL set करो:                                     │
│     {SERVER_URL}/api/zerodha/callback                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Copy API Key & Secret
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 2: ENV CONFIGURATION                     │
│                                                                 │
│  server/.env file में add करो:                                 │
│                                                                 │
│  ZERODHA_API_KEY=your_api_key_here                             │
│  ZERODHA_API_SECRET=your_api_secret_here                       │
│  SERVER_URL=http://localhost:5001 (या production URL)         │
│  CLIENT_URL=http://localhost:3000                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Server Restart
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 3: OAUTH FLOW START                     │
│                                                                 │
│  Admin Dashboard → "Connect Zerodha" button click               │
│                                                                 │
│  Client calls: GET /api/zerodha/login-url                      │
│                                                                 │
│  Server generates login URL:                                   │
│  https://kite.zerodha.com/connect/login?v=3&                   │
│  api_key={ZERODHA_API_KEY}&                                    │
│  redirect_url={SERVER_URL}/api/zerodha/callback                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Redirect to Zerodha
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 4: ZERODHA AUTHENTICATION               │
│                                                                 │
│  User Zerodha पर login करता है                                 │
│  - Username + Password + 2FA                                   │
│  - App approve करता है                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ User approves
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 5: CALLBACK RECEIVED                    │
│                                                                 │
│  Zerodha redirect करता है:                                    │
│  {SERVER_URL}/api/zerodha/callback?request_token={xyz}        │
│                                                                 │
│  Server receives request_token                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 6: TOKEN EXCHANGE                       │
│                                                                 │
│  Controller: zerodhaController.handleCallback()                │
│                                                                 │
│  Checksum calculation:                                          │
│  checksum = SHA256(api_key + request_token + api_secret)        │
│                                                                 │
│  POST to Zerodha:                                               │
│  https://api.kite.trade/session/token                           │
│                                                                 │
│  Body:                                                          │
│  - api_key                                                      │
│  - request_token                                                │
│  - checksum                                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Zerodha validates
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 7: ACCESS TOKEN RECEIVED                │
│                                                                 │
│  Zerodha response:                                              │
│  {                                                              │
│    "user_id": "ABC123",                                         │
│    "access_token": "xyz789...",                                 │
│    "public_token": "pqr456..."                                  │
│  }                                                              │
│                                                                 │
│  Session object created:                                         │
│  {                                                              │
│    apiKey: ZERODHA_API_KEY,                                     │
│    accessToken: received_token,                                 │
│    userId: user_id,                                             │
│    loginTime: timestamp                                         │
│  }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 8: SESSION PERSISTENCE                   │
│                                                                 │
│  Session saved to:                                              │
│  - Memory (this.session)                                        │
│  - File (.zerodha-session.json)                                 │
│  - Database (optional)                                         │
│                                                                 │
│  Auto-renewal service started                                   │
│  Token expiration monitoring enabled                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 9: WEBSOCKET CONNECTION                  │
│                                                                 │
│  Service: ZerodhaConnectionManager                              │
│                                                                 │
│  connectTicker(apiKey, accessToken)                             │
│                                                                 │
│  KiteTicker instance created                                    │
│  WebSocket connected to:                                        │
│  wss://ws.kite.trade/                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ WebSocket Connected
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 10: INSTRUMENT SYNC                     │
│                                                                 │
│  Admin clicks "Sync Instruments"                                │
│                                                                 │
│  POST /api/zerodha/reset-and-sync                               │
│                                                                 │
│  Background job starts:                                          │
│  - Fetch all instruments from Zerodha API                      │
│  - NIFTY, BANKNIFTY, stocks, etc.                               │
│  - Save to MongoDB Instrument collection                        │
│  - Process in batches (pagination)                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Sync Complete
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 11: TOKEN SUBSCRIPTION                   │
│                                                                 │
│  ZerodhaSubscriptionManager:                                    │
│                                                                 │
│  Subscribe to tokens:                                           │
│  - NIFTY 50 (256265)                                            │
│  - BANKNIFTY (260105)                                           │
│  - FINNIFTY (257801)                                            │
│  - MCX tokens                                                   │
│  - User watchlist tokens                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Subscribed
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 12: LIVE DATA FLOW                      │
│                                                                 │
│  Zerodha WebSocket sends ticks:                                 │
│  ticker.on('ticks', (ticks) => ...)                             │
│                                                                 │
│  Each tick contains:                                             │
│  - instrument_token                                            │
│  - last_price (LTP)                                             │
│  - bid/ask prices                                               │
│  - volume                                                       │
│  - OHLC data                                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 13: TICK PROCESSING                      │
│                                                                 │
│  ZerodhaOrchestrator.processTicks(ticks)                        │
│                                                                 │
│  For each tick:                                                  │
│  1. Extract price data                                          │
│  2. Calculate bid/ask from order book                           │
│  3. Detect circuit limits (UC/LC)                               │
│  4. Calculate change %                                          │
│  5. Store in marketData Map                                     │
│  6. Handle legacy token mapping                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 14: BROADCAST TO CLIENTS                  │
│                                                                 │
│  Socket.IO broadcast:                                           │
│  io.emit('market_tick', {                                       │
│    token: "256265",                                             │
│    ltp: 24500.50,                                               │
│    bid: 24500.00,                                               │
│    ask: 24501.00,                                               │
│    change: 0.5,                                                 │
│    ...                                                          │
│  })                                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 15: CLIENT UI UPDATE                     │
│                                                                 │
│  React Client receives via Socket.IO:                            │
│  socket.on('market_tick', (data) => {                           │
│    updatePriceUI(data);                                         │
│  })                                                             │
│                                                                 │
│  Dashboard shows live prices                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Components और उनके Roles

### 1. **Environment Configuration**
```
server/.env
├── ZERODHA_API_KEY (from developers.kite.trade)
├── ZERODHA_API_SECRET (from developers.kite.trade)
├── SERVER_URL (callback URL के लिए)
└── CLIENT_URL (redirect के लिए)
```

### 2. **OAuth Flow Components**
```
zerodhaRoutes.js
├── GET /login-url (login URL generate)
└── GET /callback (Zerodha से callback handle)

zerodhaController.js
├── getLoginUrl() - Zerodha login URL बनाता है
├── handleCallback() - request_token से access_token बनाता है
└── exchangeAndPersistSession() - token exchange करता है
```

### 3. **Session Management**
```
TokenPersistenceService
├── saveSession() - session को file में save करता है
├── loadSession() - session को load करता है
└── clearSession() - session को clear करता है

AutoTokenRenewalService
├── Token expiration check करता है
├── Auto-renewal trigger करता है
└── Background monitoring चलाता है
```

### 4. **WebSocket Connection**
```
ZerodhaConnectionManager
├── connect() - WebSocket connect करता है
├── disconnect() - WebSocket disconnect करता है
├── isConnected() - connection status check
└── healthCheck() - connection health check

zerodhaWebSocket.js
├── connectTicker() - KiteTicker instance बनाता है
├── subscribeTokens() - tokens subscribe करता है
└── processTicks() - ticks process करता है
```

### 5. **Data Orchestration**
```
ZerodhaOrchestrator
├── Coordinates सभी services
├── processTicks() - main tick processing
├── broadcastToClients() - Socket.IO broadcast
└── getConnectionStatus() - status provide करता है
```

### 6. **Instrument Sync**
```
ZerodhaSyncService
├── performFullSync() - सभी instruments sync करता है
├── fetchInstruments() - Zerodha से data fetch करता है
└── saveToDatabase() - MongoDB में save करता है

ZerodhaProgressService
├── Job tracking करता है
├── Progress updates provide करता है
└── Job status manage करता है
```

---

## Important Interview Points

### **Q1: API Key और Secret कहाँ से मिलते हैं?**
**A:** developers.kite.trade पर Kite Connect app बनाने पर मिलते हैं। यह Zerodha का developer portal है।

### **Q2: OAuth Flow कैसे काम करता है?**
**A:** 
1. Server login URL generate करता है (API key के साथ)
2. User को Zerodha पर redirect करता है
3. User login और approve करता है
4. Zerodha callback URL पर request_token भेजता है
5. Server request_token + API key + API secret से checksum बनाता है
6. Server Zerodha API को POST request भेजता है
7. Zerodha access_token return करता है

### **Q3: Access Token कहाँ store होता है?**
**A:** 
- Memory में (this.session)
- File में (.zerodha-session.json)
- Database में (optional)
- Token expiration के लिए auto-renewal service चलता है

### **Q4: WebSocket connection कैसे establish होता है?**
**A:** 
- KiteTicker library use होती है
- apiKey और accessToken के साथ connect होता है
- wss://ws.kite.trade/ पर connection बनता है
- Tokens subscribe करने पर data receive होना शुरू होता है

### **Q5: Live data flow कैसे होता है?**
**A:** 
1. Zerodha WebSocket → ticks भेजता है
2. processTicks() → data process करता है
3. marketData Map → latest prices store होते हैं
4. Socket.IO broadcast → सभी connected clients को भेजता है
5. React Client → UI update करता है

### **Q6: Token expiration handle कैसे होता है?**
**A:** 
- AutoTokenRenewalService background में चलता है
- Token expiration detect करता है
- User को re-authenticate करने के लिए prompt करता है
- Auto-renewal attempt करता है (अगर enabled)

### **Q7: Instrument sync क्यों जरूरी है?**
**A:** 
- Trading symbols और tokens map करने के लिए
- New instruments add होने पर update करने के लिए
- Token IDs (instrument_token) को database में store करने के लिए
- Background job में run होता है (504 error prevent करने के लिए)

### **Q8: Error handling कैसे होता है?**
**A:** 
- ZerodhaErrorHandler class use होती है
- Error classification (critical/non-critical)
- Auto-reconnection attempt
- User notification via Socket.IO
- Graceful degradation

---

## Security Best Practices

1. **API Secret कभी expose न करें** - सिर्फ server-side में रखें
2. **HTTPS use करें** - production में mandatory
3. **Redirect URL validate करें** - Zerodha strict है
4. **Token encryption** - sensitive data encrypt करें
5. **Rate limiting** - API abuse prevent करें
6. **Session timeout** - auto-logout implement करें

---

## Common Issues & Solutions

### **Issue 1: Redirect URL mismatch**
**Solution:** SERVER_URL और Zerodha app में redirect URL exactly same होना चाहिए

### **Issue 2: Token expired**
**Solution:** Auto-renewal service check करें या manual re-authenticate करें

### **Issue 3: WebSocket disconnect**
**Solution:** ZerodhaConnectionManager auto-reconnect attempt करता है

### **Issue 4: 504 Gateway Timeout**
**Solution:** Instrument sync background में run होता है, job status polling से track करें

---

## File Reference (Interview के लिए Important Files)

```
server/
├── routes/zerodhaRoutes.js          - OAuth endpoints
├── controllers/zerodhaController.js  - Main business logic
├── services/zerodha/
│   ├── ZerodhaOrchestrator.js       - Main coordinator
│   ├── ZerodhaConnectionManager.js  - WebSocket management
│   ├── ZerodhaSubscriptionManager.js - Token subscriptions
│   ├── ZerodhaSyncService.js        - Instrument sync
│   └── token/
│       ├── TokenPersistenceService.js - Session storage
│       └── AutoTokenRenewalService.js - Token renewal
├── services/zerodhaWebSocket.js     - KiteTicker wrapper
└── utils/zerodhaSessionUtils.js     - Session utilities
```

---

## Summary (Interview में बोलने के लिए)

"Zerodha API integration में पहले developers.kite.trade से API key और secret लेते हैं। फिर .env में configure करते हैं। OAuth flow के through user को Zerodha पर redirect करते हैं जहाँ user approve करता है। Callback में request_token मिलता है जिसे API key और secret के साथ checksum बनाकर Zerodha API को भेजते हैं। वापस access_token मिलता है जिससे WebSocket connection बनाते हैं। Tokens subscribe करने पर live data मिलना शुरू होता है जिसे process करके Socket.IO के through सभी clients को broadcast करते हैं। Session persistence और auto-renewal से connection stable रहता है।"
