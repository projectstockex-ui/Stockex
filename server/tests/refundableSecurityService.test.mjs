import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPendingSecurityAmount,
  isRefundableSecurityRole,
} from '../services/refundableSecurityService.js';

test('isRefundableSecurityRole includes ADMIN', () => {
  assert.equal(isRefundableSecurityRole('ADMIN'), true);
});

test('getPendingSecurityAmount', () => {
  assert.equal(getPendingSecurityAmount({ amount: 50000, collectedAmount: 0 }), 50000);
  assert.equal(getPendingSecurityAmount({ amount: 50000, collectedAmount: 30000 }), 20000);
  assert.equal(getPendingSecurityAmount({ amount: 50000, collectedAmount: 50000 }), 0);
  assert.equal(getPendingSecurityAmount(null), 0);
});

test('broker wallet math: -50000 opening + 200000 transfer = 150000 usable', () => {
  const opening = -50000;
  const transfer = 200000;
  const pending = 50000;
  const securityApplied = Math.min(transfer, pending);
  const finalBalance = opening + transfer;
  const netUsable = transfer - securityApplied;
  assert.equal(securityApplied, 50000);
  assert.equal(finalBalance, 150000);
  assert.equal(netUsable, 150000);
});

test('partial security collection: -50000 + 30000 transfer', () => {
  const opening = -50000;
  const transfer = 30000;
  const securityApplied = Math.min(transfer, 50000);
  const finalBalance = opening + transfer;
  assert.equal(securityApplied, 30000);
  assert.equal(finalBalance, -20000);
});
