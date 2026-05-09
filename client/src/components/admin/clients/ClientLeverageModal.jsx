import { useState, useEffect } from 'react';
import axios from '../../../config/axios';
import { X } from 'lucide-react';

const ClientLeverageModal = ({ client, parentMaxLeverage, onClose, onUpdate }) => {
  const [intradayLeverage, setIntradayLeverage] = useState(10);
  const [carryForwardLeverage, setCarryForwardLeverage] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (client) {
      setIntradayLeverage(client.leverageSettings?.intradayLeverage || client.leverageSettings?.maxLeverage || 10);
      setCarryForwardLeverage(client.leverageSettings?.carryForwardLeverage || 5);
    }
  }, [client]);

  const validateLeverage = (value) => {
    if (value < 1) return 'Minimum leverage is 1x';
    if (value > parentMaxLeverage) return `Cannot exceed parent's max leverage (${parentMaxLeverage}x)`;
    return '';
  };

  const handleIntradayChange = (e) => {
    const value = parseFloat(e.target.value) || 1;
    const validationError = validateLeverage(value);
    setError(validationError);
    setIntradayLeverage(value);
  };

  const handleCarryForwardChange = (e) => {
    const value = parseFloat(e.target.value) || 1;
    const validationError = validateLeverage(value);
    setError(validationError);
    setCarryForwardLeverage(value);
  };

  const handleSave = async () => {
    const intradayError = validateLeverage(intradayLeverage);
    const carryForwardError = validateLeverage(carryForwardLeverage);

    if (intradayError || carryForwardError) {
      setError(intradayError || carryForwardError);
      return;
    }

    try {
      setLoading(true);
      const { data } = await axios.put(`/api/admin/manage/users/${client._id}/leverage`, {
        enabledLeverages: [intradayLeverage, carryForwardLeverage],
        maxLeverage: Math.max(intradayLeverage, carryForwardLeverage)
      });

      onUpdate({
        ...client,
        leverageSettings: {
          ...client.leverageSettings,
          intradayLeverage,
          carryForwardLeverage,
          maxLeverage: Math.max(intradayLeverage, carryForwardLeverage)
        }
      });
    } catch (error) {
      setError(error.response?.data?.message || 'Failed to update leverage');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 border border-dark-700 rounded-lg w-full max-w-md mx-4">
        <div className="flex justify-between items-center p-4 border-b border-dark-700">
          <h2 className="text-xl font-bold text-white">
            Edit Client Leverage - {client?.fullName || client?.username}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Intraday Leverage
            </label>
            <input
              type="number"
              min="1"
              max={parentMaxLeverage}
              value={intradayLeverage}
              onChange={handleIntradayChange}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Max allowed: {parentMaxLeverage}x (parent's cap)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Carry Forward Leverage
            </label>
            <input
              type="number"
              min="1"
              max={parentMaxLeverage}
              value={carryForwardLeverage}
              onChange={handleCarryForwardChange}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Max allowed: {parentMaxLeverage}x (parent's cap)
            </p>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-500/30 rounded px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-dark-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !!error}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClientLeverageModal;
