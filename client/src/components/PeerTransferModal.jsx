import React from 'react';
import { X, Send } from 'lucide-react';
import PeerTransferPanel from './PeerTransferPanel.jsx';

/** Full-screen modal wrapper — used from My Accounts wallet section. */
export default function PeerTransferModal({ token, walletData, nseBseSnapshot, onClose, onSuccess }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-2xl border border-dark-600 shadow-xl max-h-[92vh] min-h-[min(640px,88vh)] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-dark-600 shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2 text-blue-300">
            <Send size={20} />
            Send to Client
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={22} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          <PeerTransferPanel
            token={token}
            walletData={walletData}
            nseBseSnapshot={nseBseSnapshot}
            onSuccess={(data) => {
              onSuccess?.(data);
            }}
          />
        </div>
        <div className="p-3 border-t border-dark-600 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
