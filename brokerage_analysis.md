# 📊 BROKERAGE DISTRIBUTION ANALYSIS
## Multi-Level Admin/Broker Structure

### 🏗️ STRUCTURE HIERARCHY

```
SUPERADMIN
    ↓
ROSHINI (Inside Admin - No Incentive)
    ↓
├── ARJUN (Broker)
│   └── DRISTHI (Sub-Broker)
│       └── ANJALI (Client - Referral)
│
└── SOHAN (Broker)
    └── MANISH (Sub-Broker)
        ├── KRITI (Client - Referral) → LOHIA (Client)
        └── MONISHIT (Client - Referral)
            └── HAMSA (Client - Referral)
                └── UPENDRA (Client)
                    └── KAMLESH (Client - Referral)
                        └── MANOJ (Client)
```

---

## ❓ QUESTION 1: ROSHINI BROKERAGE WHEN SUPERADMIN DISABLED

### 📦 ANSWER BOX:
```
🔴 NO - Roshini will NOT get brokerage if superadmin disables it.

REASON:
- Superadmin has ultimate control over all admin permissions
- If superadmin disables brokerage for roshini, she cannot receive any brokerage
- This applies to all levels below roshini (arjun, sohan, etc.)
- All brokerage distribution stops at the disabled level
```

---

## ❓ QUESTION 2: LEVERAGE LIMITS

### 📦 ANSWER BOX:
```
🔴 NO - Roshini CANNOT give more than 100x leverage if superadmin set 100x limit.

RULES:
- Superadmin sets MAX leverage: 100x (intraday)
- Roshini can give LESS or EQUAL to 100x, but NOT MORE
- If roshini gives arjun 70x, sohan can get maximum 30x (70x + 30x = 100x total)
- Roshini cannot exceed superadmin's leverage limit
- All brokers under roshini must share within the 100x limit
```

---

## ❓ QUESTION 3: SECOND-TIME REFERRAL IN GAMES

### 📦 ANSWER BOX:
```
🟡 DEPENDS - Usually NO for second-time referral in games.

RULES:
- First-time referral: YES (gets referral amount)
- Second-time referral: Usually NO (already referred once)
- Exception: If system allows multiple referral bonuses
- Most systems only pay referral on FIRST registration/deposit
- Games typically pay referral only once per client
```

---

## ❓ QUESTION 4: TRADING REFERRAL TIMING & AMOUNTS

### 📦 ANSWER BOX:
```
🟡 CONDITIONAL - Referral paid ONLY when superadmin receives full amount.

TIMING RULE:
- User1 gets referral ONLY when User2 → Superadmin = 1000rs received
- Until superadmin gets 1000rs, User1 gets NO referral
- This creates a chain payment system

AMOUNT DISTRIBUTION:
- Sohan: 1000/core
- Manish: 1500/core  
- Manoj: 2000/core

CHAIN EXAMPLE:
Monoj → Superadmin (1000rs needed) → Monishit gets referral
If monoj doesn't pay 1000rs to superadmin, monishit gets nothing
```

---

## 💰 BROKERAGE DISTRIBUTION FLOW

### 📊 DISTRIBUTION CHAIN:

```
CLIENT TRADING → BROKERAGE POOL → DISTRIBUTION

1. Client pays brokerage
2. Brokerage goes to pool
3. Distribution follows hierarchy:
   - Superadmin (if enabled)
   - Roshini (if enabled by superadmin)
   - Arjun/Sohan (if enabled by roshini)
   - Manish/Dristhi (if enabled by arjun/sohan)
   - Referral payments (last)
```

### 🎯 KEY RULES:

1. **SUPERADMIN CONTROL**: Can disable/enable any level
2. **LEVERAGE LIMITS**: Cannot exceed parent level
3. **REFERRAL TIMING**: Paid only after parent receives full amount
4. **BROKERAGE FLOW**: Top-down distribution
5. **INSIDE ADMIN**: Roshini gets no incentive (as specified)

---

## ⚠️ IMPORTANT NOTES:

- All permissions flow downward (superadmin → roshini → brokers)
- Leverage limits are cumulative, not individual
- Referral payments are conditional on parent payments
- Inside admin (roshini) has no incentive but controls brokers
- System follows strict hierarchy for all distributions
