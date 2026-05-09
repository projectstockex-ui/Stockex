import { Edit } from 'lucide-react';

const ClientList = ({ clients, onEditLeverage, parentMaxLeverage }) => {
  if (clients.length === 0) {
    return (
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-8 text-center">
        <p className="text-gray-400">No clients found</p>
      </div>
    );
  }

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-dark-900 border-b border-dark-700">
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Username</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Email</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Intraday Leverage</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Carry Forward Leverage</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Max Leverage</th>
              <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {clients.map((client) => (
              <tr key={client._id} className="hover:bg-dark-700/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-white">{client.fullName || 'N/A'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-300">{client.username}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-300">{client.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-cyan-400">
                    {client.leverageSettings?.intradayLeverage || client.leverageSettings?.maxLeverage || 10}x
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-purple-400">
                    {client.leverageSettings?.carryForwardLeverage || 5}x
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-orange-400">
                    {parentMaxLeverage}x (Max)
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => onEditLeverage(client)}
                    className="inline-flex items-center px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-medium rounded transition-colors"
                  >
                    <Edit size={14} className="mr-1" />
                    Edit Leverage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ClientList;
