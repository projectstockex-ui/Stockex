import {
  getSortedStates,
  getCitiesForState,
  getAreasForStateCity,
  areaOptionValue,
  parseAreaOptionValue,
  resolveLocationSelection,
} from '../../utils/brokerLocation.js';

/**
 * Cascading State → City → Area (pincode) selects for broker/sub-broker forms.
 */
export default function BrokerLocationFields({ value, onChange, className = '' }) {
  const states = getSortedStates();
  const cities = value.stateName ? getCitiesForState(value.stateName) : [];
  const areas = value.stateName && value.cityName
    ? getAreasForStateCity(value.stateName, value.cityName)
    : [];

  const areaSelectValue =
    value.areaName && value.areaPincode
      ? areaOptionValue({ area: value.areaName, pincode: value.areaPincode })
      : '';

  const emit = (patch) => onChange({ ...value, ...patch });

  const handleStateChange = (stateName) => {
    const state = states.find((s) => s.state === stateName);
    emit({
      stateName: stateName || '',
      stateCode: state?.stateCode || '',
      cityName: '',
      cityCode: '',
      areaName: '',
      areaPincode: '',
    });
  };

  const handleCityChange = (cityName) => {
    const city = cities.find((c) => c.city === cityName);
    emit({
      cityName: cityName || '',
      cityCode: city?.cityCode || '',
      areaName: '',
      areaPincode: '',
    });
  };

  const handleAreaChange = (raw) => {
    const { areaName, areaPincode } = parseAreaOptionValue(raw);
    const resolved = resolveLocationSelection({
      stateName: value.stateName,
      cityName: value.cityName,
      areaName,
      areaPincode,
    });
    if (resolved) {
      emit(resolved);
    } else {
      emit({ areaName: '', areaPincode: '' });
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <label className="block text-xs text-gray-400 mb-1">State *</label>
        <select
          value={value.stateName || ''}
          onChange={(e) => handleStateChange(e.target.value)}
          className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
          required
        >
          <option value="">Select state</option>
          {states.map((s) => (
            <option key={s.stateCode} value={s.state}>
              {s.state}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">City *</label>
        <select
          value={value.cityName || ''}
          onChange={(e) => handleCityChange(e.target.value)}
          className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
          required
          disabled={!value.stateName}
        >
          <option value="">{value.stateName ? 'Select city' : 'Select state first'}</option>
          {cities.map((c) => (
            <option key={`${value.stateName}-${c.cityCode}`} value={c.city}>
              {c.city} ({c.cityCode})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Area *</label>
        <select
          value={areaSelectValue}
          onChange={(e) => handleAreaChange(e.target.value)}
          className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
          required
          disabled={!value.cityName}
        >
          <option value="">{value.cityName ? 'Select area' : 'Select city first'}</option>
          {areas.map((a) => (
            <option key={`${a.area}-${a.pincode}`} value={areaOptionValue(a)}>
              {a.area} ({a.pincode})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export const EMPTY_BROKER_LOCATION = {
  stateName: '',
  stateCode: '',
  cityName: '',
  cityCode: '',
  areaName: '',
  areaPincode: '',
};
