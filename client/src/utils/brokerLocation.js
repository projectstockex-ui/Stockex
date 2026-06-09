import { INDIA_BROKER_LOCATIONS } from '../data/indiaBrokerLocations.js';

const sortByName = (a, b, key) => String(a[key]).localeCompare(String(b[key]), 'en', { sensitivity: 'base' });

export function getSortedStates() {
  return [...INDIA_BROKER_LOCATIONS].sort((a, b) => sortByName(a, b, 'state'));
}

export function getCitiesForState(stateName) {
  const state = INDIA_BROKER_LOCATIONS.find((s) => s.state === stateName);
  if (!state) return [];
  return [...state.cities].sort((a, b) => sortByName(a, b, 'city'));
}

export function getAreasForStateCity(stateName, cityName) {
  const state = INDIA_BROKER_LOCATIONS.find((s) => s.state === stateName);
  const city = state?.cities?.find((c) => c.city === cityName);
  if (!city) return [];
  return [...city.areas].sort((a, b) => sortByName(a, b, 'area'));
}

export function areaOptionValue(area) {
  return `${area.area}|${area.pincode}`;
}

export function parseAreaOptionValue(value) {
  if (!value || !value.includes('|')) return { areaName: '', areaPincode: '' };
  const [areaName, areaPincode] = value.split('|');
  return { areaName, areaPincode };
}

export function resolveLocationSelection({ stateName, cityName, areaName, areaPincode }) {
  const state = INDIA_BROKER_LOCATIONS.find((s) => s.state === stateName);
  const city = state?.cities?.find((c) => c.city === cityName);
  const area = city?.areas?.find((a) => a.area === areaName && a.pincode === areaPincode);
  if (!state || !city || !area) return null;
  return {
    stateName: state.state,
    stateCode: state.stateCode,
    cityName: city.city,
    cityCode: city.cityCode,
    areaName: area.area,
    areaPincode: area.pincode,
  };
}

/** Display: Karnataka · Bengaluru · Koramangala (560034) */
export function formatBrokerLocation(broker = {}) {
  const { stateName, cityName, areaName, areaPincode } = broker;

  if (stateName && cityName && areaName) {
    const pin = areaPincode ? ` (${areaPincode})` : '';
    return `${stateName} · ${cityName} · ${areaName}${pin}`;
  }
  if (areaName && areaPincode) {
    return `${areaName} (${areaPincode})`;
  }
  if (broker.cityCode && broker.cityName) {
    return `${broker.cityCode} · ${broker.cityName}`;
  }
  return broker.cityName || broker.cityCode || '';
}

export function brokerMatchesLocationFilters(broker, { stateName, cityName }) {
  if (stateName && broker.stateName !== stateName) return false;
  if (cityName && broker.cityName !== cityName) return false;
  return true;
}

export function brokerMatchesSearch(broker, searchLower) {
  if (!searchLower) return true;
  const haystack = [
    broker.adminCode,
    broker.stateName,
    broker.stateCode,
    broker.cityName,
    broker.cityCode,
    broker.areaName,
    broker.areaPincode,
    broker.cityCode,
    broker.cityName,
    formatBrokerLocation(broker),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(searchLower);
}
