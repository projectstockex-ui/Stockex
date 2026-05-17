/**
 * StatCard component for AdminDashboard
 */
const StatCard = ({ title, value, subtitle, color }) => {
  const colors = {
    green: 'text-green-400',
    purple: 'text-purple-400',
    yellow: 'text-yellow-400',
    blue: 'text-blue-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
    pink: 'text-pink-400',
    cyan: 'text-cyan-400'
  };

  return (
    <div className="bg-dark-800 rounded-lg p-4">
      <div className="text-sm text-gray-400">{title}</div>
      <div className={`text-2xl font-bold ${colors[color] || 'text-white'}`}>{value}</div>
      <div className="text-xs text-gray-500">{subtitle}</div>
    </div>
  );
};

export default StatCard;
