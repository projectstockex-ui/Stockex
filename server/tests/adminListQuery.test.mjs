import test from 'node:test';
import assert from 'node:assert/strict';

test('activeUsersPanelQuery module exports fetchActiveUsersPanel', async () => {
  const mod = await import('../utils/activeUsersPanelQuery.js');
  assert.equal(typeof mod.fetchActiveUsersPanel, 'function');
});

test('adminListQuery module exports fetchAdminHierarchyList', async () => {
  const mod = await import('../utils/adminListQuery.js');
  assert.equal(typeof mod.fetchAdminHierarchyList, 'function');
});
