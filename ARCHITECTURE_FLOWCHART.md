# StockEx Project Architecture Flow Chart

## Table of Contents
1. [Overall Architecture](#1-overall-architecture)
2. [Live Price Data Flow](#2-live-price-data-flow)
3. [Trading Flow](#3-trading-flow)
4. [Authentication Flow](#4-authentication-flow)
5. [Games Flow](#5-games-flow)
6. [Key Components Summary](#6-key-components-summary)
7. [Data Flow Summary](#7-data-flow-summary)

---

## 1. Overall Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (React + Vite)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ UserDashboard│  │  UserGames   │  │AdminDashboard│          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                    │
│  ┌──────▼─────────────────▼─────────────────▼───────┐          │
│  │         Socket.IO Client (Real-time)             │          │
│  └──────────────────────┬──────────────────────────┘          │
│                         │                                         │
│                         │ HTTP + WebSocket                         │
└─────────────────────────┼─────────────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────────────┐
│                    SERVER (Node.js + Express)                     │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  index.js (Main Entry Point)                            │    │
│  │  - Express Server Setup                                  │    │
│  │  - Socket.IO Server Setup                                │    │
│  │  - Route Registration                                    │    │
│  └──────────────────────┬───────────────────────────────────┘    │
│                         │                                          │
│  ┌──────────────────────▼───────────────────────────────────┐    │
│  │              Socket.IO Server                             │    │
│  │  - Client Connection Management                           │    │
│  │  - Real-time Event Broadcasting                           │    │
│  └──────────────────────┬───────────────────────────────────┘    │
│                         │                                          │
│  ┌──────────────────────▼───────────────────────────────────┐    │
│  │                    ROUTES                                  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │    │
│  │  │userRoutes│ │tradeRoutes│ │zerodhaRoutes│ │gamesRoutes│   │    │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘     │    │
│  └───────┼────────────┼────────────┼────────────┼───────────┘    │
│          │            │            │            │                │
│  ┌───────▼────────────▼────────────▼────────────▼───────────┐    │
│  │                    CONTROLLERS                           │    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │    │
│  │  │userController│ │tradeController│ │zerodhaController│ │    │
│  │  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘     │    │
│  └─────────┼────────────────┼────────────────┼──────────────┘    │
│            │                │                │                   │
│  ┌─────────▼────────────────▼────────────────▼──────────────┐    │
│  │                     SERVICES                              │    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │    │
│  │  │tradingService│ │zerodhaWebSocket│ │gamingService│  │    │
│  │  └──────────────┘ └──────┬───────┘ └──────────────┘     │    │
│  │                          │                               │    │
│  │  ┌──────────────┐ ┌──────▼───────┐ ┌──────────────┐     │    │
│  │  │binanceWebSocket│ │marginMonitorService│ │autoSettlement│ │    │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │    │
│  └──────────────────────┬───────────────────────────────────┘    │
│                         │                                          │
│  ┌──────────────────────▼───────────────────────────────────┐    │
│  │                     MODELS (Mongoose)                      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │    │
│  │  │   User   │ │  Trade   │ │Position │ │  Order   │     │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │    │
│  └──────────────────────┬───────────────────────────────────┘    │
└─────────────────────────┼─────────────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────────────┐
│                    DATABASE (MongoDB)                             │
│  - Users, Trades, Positions, Orders, Instruments                 │
│  - Game Results, Wallet Ledger, Settings                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend:**
- React.js (UI Framework)
- Vite (Build Tool)
- TailwindCSS (Styling)
- Socket.IO Client (Real-time)

**Backend:**
- Node.js (Runtime)
- Express.js (Web Framework)
- Socket.IO Server (Real-time)
- MongoDB (Database)
- Mongoose (ODM)

**External APIs:**
- Zerodha Kite Connect (Stock Market Data)
- Binance API (Crypto Data)

---

## 2. Live Price Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZERODHA/KITE CONNECT                          │
│                    (WebSocket Server)                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ WebSocket Connection
                             │ (KiteTicker library)
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              zerodhaWebSocket.js (Service)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  1. connectTicker(apiKey, accessToken)                   │  │
│  │     - Creates KiteTicker instance                        │  │
│  │     - Subscribes to tokens (NIFTY, BANKNIFTY, etc.)      │  │
│  │                                                          │  │
│  │  2. ticker.on('ticks', (ticks) => processTicks(ticks))  │  │
│  │     - Receives live price updates from Zerodha          │  │
│  │                                                          │  │
│  │  3. processTicks(ticks)                                  │  │
│  │     - Extracts: LTP, Bid, Ask, OHLC, Volume             │  │
│  │     - Builds tickData object                            │  │
│  │     - Stores in marketData cache                        │  │
│  │     - Updates MongoDB (throttled to 300ms)              │  │
│  │                                                          │  │
│  │  4. io.emit('market_tick', updates)                      │  │
│  │     - Broadcasts to all connected clients via Socket.IO  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Socket.IO Event
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    CLIENT (React)                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  socket.on('market_tick', (data) => {                    │  │
│  │    - Update UI with live prices                          │  │
│  │    - Update charts                                       │  │
│  │    - Update P&L calculations                            │  │
│  │  })                                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files for Live Prices

- **Backend:** `server/services/zerodhaWebSocket.js`
- **Backend:** `server/controllers/zerodhaController.js`
- **Frontend:** `client/src/components/MarketWatch.jsx`
- **Frontend:** `client/src/pages/UserDashboard.jsx`

### WebSocket vs Socket.IO

- **WebSocket (Zerodha):** Direct connection to Zerodha servers using `KiteTicker` library
- **Socket.IO (Internal):** Broadcasts data from server to all connected clients

---

## 3. Trading Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT                                    │
│  User places trade order (Buy/Sell)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ POST /api/trade
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    tradeRoutes.js                                │
│  - Validates request                                            │
│  - Calls tradeController.placeOrder()                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    tradeController.js                            │
│  - Validates user permissions                                   │
│  - Checks margin requirements                                   │
│  - Validates trading hours                                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    tradingService.js                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  1. Check Margin & Risk                                  │  │
│  │     - Calculate required margin                         │  │
│  │     - Check user wallet balance                          │  │
│  │     - Apply leverage multiplier                           │  │
│  │                                                          │  │
│  │  2. Create Order Record                                  │  │
│  │     - Save to MongoDB (Order model)                      │  │
│  │                                                          │  │
│  │  3. Execute Trade                                        │  │
│  │     - Create Position (if opening)                       │  │
│  │     - Update Position (if modifying/closing)             │  │
│  │                                                          │  │
│  │  4. Update Wallet                                        │  │
│  │     - Deduct/Add margin                                  │  │
│  │     - Record transaction in WalletLedger                 │  │
│  │                                                          │  │
│  │  5. Notify Client                                        │  │
│  │     - io.emit('order_update', order)                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    DATABASE (MongoDB)                            │
│  - Orders Collection                                            │
│  - Trades Collection                                             │
│  - Positions Collection                                         │
│  - WalletLedger Collection                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files for Trading

- **Routes:** `server/routes/tradeRoutes.js`
- **Controller:** `server/controllers/tradeController.js`
- **Service:** `server/services/tradingService.js`
- **Models:** `server/models/Trade.js`, `server/models/Position.js`, `server/models/Order.js`

---

## 4. Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT                                    │
│  User Login (Email/Password)                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ POST /api/user/login
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    userRoutes.js                                 │
│  - Calls userController.login()                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    userController.js                             │
│  - Find user by email                                            │
│  - Compare password hash (bcrypt)                                │
│  - Generate JWT token                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    MIDDLEWARE                                    │
│  - authenticationMiddleware                                     │
│  - Verifies JWT token on protected routes                        │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files for Authentication

- **Routes:** `server/routes/userRoutes.js`
- **Controller:** `server/controllers/userController.js`
- **Middleware:** `server/middleware/authMiddleware.js`
- **Model:** `server/models/User.js`

---

## 5. Games Flow (Nifty Up/Down, Jackpot, etc.)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT                                    │
│  User places game bet                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ POST /api/games/bet
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    gamingController.js                           │
│  - Validates bet amount                                          │
│  - Checks game timing (bidding window)                           │
│  - Records bet in database                                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    gamesAutoSettlement.js                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Runs every 30 seconds (setInterval)                     │  │
│  │                                                          │  │
│  │  1. Check Market Close Time                              │  │
│  │     - NIFTY: Every 15 min (:00, :15, :30, :45)           │  │
│  │     - BTC: Every 5 min                                    │  │
│  │                                                          │  │
│  │  2. Fetch Closing Price                                  │  │
│  │     - From Zerodha WebSocket (marketData cache)          │  │
│  │     - Or from file cache if market closed                │  │
│  │                                                          │  │
│  │  3. Determine Result (UP/DOWN/NUMBER)                   │  │
│  │     - Compare with opening price                          │  │
│  │                                                          │  │
│  │  4. Calculate Winnings                                   │  │
│  │     - For winning bets: Stake × Multiplier               │  │
│  │     - Deduct platform fee                                │  │
│  │                                                          │  │
│  │  5. Update Wallets                                       │  │
│  │     - Credit winners                                     │  │
│  │     - Record in WalletLedger                             │  │
│  │                                                          │  │
│  │  6. Publish Result                                      │  │
│  │     - Save to GameResult collection                      │  │
│  │     - io.emit('game_result', result)                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    DATABASE (MongoDB)                            │
│  - NiftyUpDownBet, NiftyJackpotBid, NiftyNumberBet              │
│  - GameResult, WalletLedger                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Game Types

1. **Nifty Up/Down:** Predict if NIFTY will go UP or DOWN in 15 minutes
2. **Nifty Jackpot:** Predict exact NIFTY closing number (0-9)
3. **Nifty Bracket:** Predict NIFTY price range
4. **BTC Up/Down:** Predict Bitcoin price movement

### Key Files for Games

- **Controller:** `server/controllers/gamingController.js`
- **Service:** `server/services/gamesAutoSettlement.js`
- **Service:** `server/services/gamingService.js`
- **Models:** `server/models/NiftyUpDownBet.js`, `server/models/NiftyJackpotBid.js`

---

## 6. Key Components Summary

| Component | Purpose | Technology | Key Files |
|-----------|---------|------------|-----------|
| **Client** | Frontend UI | React + Vite + TailwindCSS | `client/src/` |
| **Server** | Backend API | Node.js + Express | `server/index.js` |
| **Socket.IO** | Real-time communication | socket.io (Server + Client) | `server/index.js`, `client/src/` |
| **Zerodha WebSocket** | Live market data | KiteConnect (KiteTicker) | `server/services/zerodhaWebSocket.js` |
| **Binance WebSocket** | Crypto prices | Binance API | `server/services/binanceWebSocket.js` |
| **Database** | Data persistence | MongoDB + Mongoose | `server/models/` |
| **Authentication** | User auth | JWT + bcrypt | `server/controllers/userController.js` |
| **Background Jobs** | Scheduled tasks | node-cron + setInterval | `server/services/gamesAutoSettlement.js` |

---

## 7. Data Flow Summary

```
User Action → React Client → HTTP Request → Express Route → Controller 
→ Service → Business Logic → Database (MongoDB) → Response → Client
     ↓
Socket.IO Events (Real-time updates)
     ↓
Zerodha WebSocket → Live Prices → processTicks() → Socket.IO Broadcast → Client UI
```

### Complete Request Flow

1. **User initiates action** (place trade, place bet, login, etc.)
2. **React Client** sends HTTP request to Express server
3. **Express Router** routes request to appropriate controller
4. **Controller** validates request and calls service
5. **Service** implements business logic
6. **Database** operations via Mongoose models
7. **Response** sent back to client
8. **Socket.IO** broadcasts real-time updates if needed

### Real-time Data Flow

1. **Zerodha WebSocket** connects to Kite Connect servers
2. **KiteTicker** receives live price ticks
3. **processTicks()** processes and formats data
4. **Socket.IO** broadcasts to all connected clients
5. **React Client** updates UI with live data

---

## Project Structure

```
stockex/
├── client/                 # React Frontend
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   └── utils/         # Utility functions
│   └── package.json
├── server/                # Node.js Backend
│   ├── config/           # Database configuration
│   ├── controllers/      # Request handlers
│   ├── models/           # Mongoose models
│   ├── routes/           # Express routes
│   ├── services/         # Business logic
│   ├── middleware/       # Express middleware
│   └── index.js          # Entry point
├── docs/                 # Documentation
└── package.json
```

---

## Environment Variables

### Server (.env)
```
MONGODB_URI=mongodb://localhost:27017/stockex
PORT=5001
CLIENT_URL=http://localhost:5173
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
JWT_SECRET=your_jwt_secret
```

### Client (.env)
```
VITE_API_URL=http://localhost:5001
```

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB
- Zerodha Kite Connect Account

### Installation
```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd client
npm install
```

### Running the Project
```bash
# Start MongoDB
mongod

# Start server (from server directory)
npm run dev

# Start client (from client directory)
npm run dev
```

---

## Key Features

1. **Real-time Market Data:** Live prices via Zerodha WebSocket
2. **Trading Platform:** Buy/Sell stocks with leverage
3. **Games:** Nifty Up/Down, Jackpot, Bracket games
4. **User Management:** Authentication, wallet management
5. **Admin Panel:** User management, market controls
6. **Auto Settlement:** Automatic game result processing

---

## API Endpoints

### Authentication
- `POST /api/user/register` - Register new user
- `POST /api/user/login` - User login

### Trading
- `POST /api/trade` - Place trade order
- `GET /api/trade/positions` - Get user positions
- `POST /api/trade/close` - Close position

### Market Data
- `GET /api/instruments` - Get available instruments
- `GET /api/market/live` - Get live market data

### Games
- `POST /api/games/updown/bet` - Place Up/Down bet
- `GET /api/games/results` - Get game results

---

## Conclusion

This architecture provides a scalable real-time trading and gaming platform. The separation of concerns (Routes → Controllers → Services → Models) ensures maintainability, while Socket.IO enables real-time updates for live market data and game results.

---

*Generated for StockEx Project Learning Documentation*
