import React from 'react';

/** Shown in place of segment brokerage when franchise is active. */
export default function FranchiseSegmentBrokerageNotice({ compact = false }) {
  return (
    <div
      className={`rounded-lg border border-purple-700/40 bg-purple-900/20 text-purple-200/90 ${
        compact ? 'mb-4 p-3 text-xs' : 'mb-4 p-3 text-sm'
      }`}
    >
      Franchise is active — segment brokerage fields are hidden. Set per-crore charge via the{' '}
      <strong className="text-purple-300">Franchise</strong> button (admin/broker) and{' '}
      <strong className="text-purple-300">Client Franchise Charge</strong> on users.
    </div>
  );
}
