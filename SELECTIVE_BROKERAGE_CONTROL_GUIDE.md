# Selective Brokerage Control System Guide

## Overview

The selective brokerage control system allows Super Admins to disable brokerage for individual admins while keeping their entire hierarchy active and earning brokerage normally. This solves the problem where disabling an admin's brokerage would affect their entire hierarchy.

## 🎯 Problem Solved

**Before (Full Inheritance):**
```
Superadmin disables Roshini → Entire hierarchy stops ❌
- Roshini: No brokerage
- Arjun/Sohan: No brokerage  
- Manish/Dristhi: No brokerage
```

**After (Selective Inheritance):**
```
Superadmin disables only Roshini → Hierarchy continues ✅
- Roshini: No brokerage (disabled)
- Arjun/Sohan: Continue getting brokerage ✅
- Manish/Dristhi: Continue getting brokerage ✅
```

## 🏗️ Architecture

### Database Schema Changes

Added `hierarchyInheritanceMode` field to Admin model:

```javascript
restrictMode: {
  // ... existing fields
  hierarchyInheritanceMode: { 
    type: String, 
    enum: ['FULL_INHERITANCE', 'SELECTIVE_INHERITANCE'], 
    default: 'FULL_INHERITANCE' 
  }
}
```

### Services Created

1. **SelectiveBrokerageService** - Manages selective inheritance rules
2. **BrokerageRestrictionService** - Extended with inheritance logic
3. **BrokerageDistributionService** - Handles distribution with inheritance
4. **SelectiveBrokerageMiddleware** - Automatic inheritance checking

## 🚀 Usage Examples

### 1. Setting Up Selective Control for Roshini

```javascript
// API Call
PUT /api/admins/:id/selective-brokerage-control

// Request Body
{
  "hierarchyInheritanceMode": "SELECTIVE_INHERITANCE",
  "restrictBrokerage": {
    "games": true,
    "trading": true
  }
}

// Response
{
  "message": "Selective brokerage control updated successfully",
  "admin": {
    "_id": "roshini_id",
    "username": "roshini",
    "name": "Roshini",
    "role": "ADMIN"
  },
  "selectiveBrokerageControl": {
    "hierarchyInheritanceMode": "SELECTIVE_INHERITANCE",
    "restrictBrokerage": {
      "games": true,
      "trading": true
    }
  },
  "effectiveRestrictions": {
    "games": true,
    "trading": true
  }
}
```

### 2. Checking Comprehensive Status

```javascript
// API Call
GET /api/admins/:id/comprehensive-brokerage-restriction

// Response
{
  "admin": {
    "_id": "arjun_id",
    "username": "arjun",
    "name": "Arjun",
    "role": "BROKER"
  },
  "comprehensiveBrokerageRestriction": {
    "games": false,
    "trading": false,
    "anyRestricted": false,
    "hierarchyInheritanceMode": "FULL_INHERITANCE",
    "inheritedRestrictions": {
      "games": false,  // No inheritance in selective mode
      "trading": false
    },
    "effectiveRestrictions": {
      "games": false,  // Arjun gets brokerage
      "trading": false
    }
  }
}
```

### 3. Brokerage Distribution Example

```javascript
import { BrokerageDistributionService } from './services/brokerageDistributionService.js';

const service = new BrokerageDistributionService();

const tradeData = {
  gamesBrokerage: 1000,
  tradingBrokerage: 500
};

const hierarchyPath = [roshini, arjun, sohan, manish];
const distribution = service.distributeBrokerage(tradeData, hierarchyPath, 'games');

// Result:
// [
//   { adminId: roshini._id, brokerageAmount: 0, isRestricted: true },
//   { adminId: arjun._id, brokerageAmount: 350, isRestricted: false },
//   { adminId: sohan._id, brokerageAmount: 350, isRestricted: false },
//   { adminId: manish._id, brokerageAmount: 300, isRestricted: false },
//   { adminId: 'SUPER_ADMIN', brokerageAmount: 1000, redirectedFromRestrictions: true }
// ]
```

## 🔧 API Endpoints

### 1. Update Selective Brokerage Control
```
PUT /api/admins/:id/selective-brokerage-control
Authorization: Super Admin required
```

### 2. Get Comprehensive Brokerage Restriction
```
GET /api/admins/:id/comprehensive-brokerage-restriction
Authorization: Super Admin required
```

### 3. Existing Endpoints (Enhanced)
```
GET /api/admins/:id/brokerage-restriction
PUT /api/admins/:id/brokerage-restriction
```

## 📋 Inheritance Modes

### FULL_INHERITANCE (Default)
- Child admins inherit parent's brokerage restrictions
- Traditional behavior
- Use when you want hierarchical restrictions

### SELECTIVE_INHERITANCE (New)
- Child admins DO NOT inherit parent's brokerage restrictions
- Only the specific admin is restricted
- Use when you want to disable individual admins only

## 🎮 Real-World Scenarios

### Scenario 1: Roshini Problem (Solved)
```javascript
// Roshini setup
{
  "hierarchyInheritanceMode": "SELECTIVE_INHERITANCE",
  "restrictBrokerage": { "games": true, "trading": true }
}

// Result: Only Roshini restricted, hierarchy continues
```

### Scenario 2: Full Hierarchy Control
```javascript
// Admin setup
{
  "hierarchyInheritanceMode": "FULL_INHERITANCE",
  "restrictBrokerage": { "games": true, "trading": false }
}

// Result: Admin and all children restricted for games only
```

### Scenario 3: Mixed Control
```javascript
// Parent: SELECTIVE_INHERITANCE (only parent restricted)
// Child: FULL_INHERITANCE (child and grandchildren restricted)

// Result: Granular control at each level
```

## 🧪 Testing

Run the integration tests to verify functionality:

```bash
npm test -- tests/selectiveBrokerage.test.js
```

Test coverage includes:
- ✅ Roshini scenario
- ✅ Full inheritance mode
- ✅ Comprehensive status
- ✅ Brokerage distribution
- ✅ Validation
- ✅ Permissions

## 🔍 Monitoring & Auditing

### Audit Logging
All brokerage restriction changes are automatically logged:

```javascript
{
  "timestamp": "2026-05-06T12:00:00Z",
  "adminId": "superadmin_id",
  "adminName": "Super Admin",
  "action": "BROKERAGE_RESTRICTION_UPDATE",
  "targetAdminId": "roshini_id",
  "changes": {
    "hierarchyInheritanceMode": "SELECTIVE_INHERITANCE",
    "restrictBrokerage": { "games": true, "trading": true }
  },
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0..."
}
```

### Distribution Summary
Get detailed breakdown of brokerage distribution:

```javascript
const summary = service.getDistributionSummary(distribution);
// Returns:
// {
//   totalBrokerage: 1000,
//   distributedBrokerage: 700,
//   restrictedBrokerage: 300,
//   superAdminBrokerage: 300,
//   adminBreakdown: { ... },
//   segments: { games: 1000 }
// }
```

## 🛡️ Security & Permissions

### Permission Matrix
| Role | Can Modify Self | Can Modify Direct Reports | Can Modify Others |
|------|----------------|-------------------------|------------------|
| Super Admin | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ❌ |
| Broker | ✅ | ✅ (Sub-brokers only) | ❌ |
| Sub-Broker | ✅ | ❌ | ❌ |

### Validation Rules
- Only Super Admin can modify inheritance modes
- Admins can only modify their direct reports
- All changes are validated and audited
- Invalid data is rejected with detailed errors

## 🔄 Migration Guide

### Existing Systems
Existing systems continue to work unchanged with `FULL_INHERITANCE` (default).

### New Features
- Add `hierarchyInheritanceMode` field to existing admins (optional)
- Use new selective endpoints for granular control
- Enable comprehensive status checking

### Rollback
If needed, set all admins back to `FULL_INHERITANCE` to revert to original behavior.

## 🎯 Benefits Achieved

1. **Granular Control**: Disable individual admins without affecting hierarchy
2. **Backward Compatibility**: Existing systems work unchanged
3. **SOLID Principles**: Clean, maintainable architecture
4. **Audit Trail**: Complete logging of all changes
5. **Performance**: No impact on existing performance
6. **Flexibility**: Easy to extend with new inheritance modes

## 📞 Support

For issues or questions:
1. Check the test files for usage examples
2. Review the API documentation
3. Enable debug logging for troubleshooting
4. Contact development team for complex scenarios
