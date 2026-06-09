import { INDIA_BROKER_LOCATIONS } from '../data/indiaBrokerLocations.js';

export function resolveLocationSelection({ stateName, cityName, areaName, areaPincode }) {
  const state = INDIA_BROKER_LOCATIONS.find((s) => s.state === stateName);
  const city = state?.cities?.find((c) => c.city === cityName);
  const area = city?.areas?.find((a) => a.area === areaName && a.pincode === String(areaPincode));
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

export function formatBrokerLocation(admin = {}) {
  const { stateName, cityName, areaName, areaPincode } = admin;
  if (stateName && cityName && areaName) {
    const pin = areaPincode ? ` (${areaPincode})` : '';
    return `${stateName} · ${cityName} · ${areaName}${pin}`;
  }
  if (admin.areaName && admin.areaPincode) {
    return `${admin.areaName} (${admin.areaPincode})`;
  }
  if (admin.cityCode && admin.cityName) {
    return `${admin.cityCode} · ${admin.cityName}`;
  }
  return admin.cityName || admin.cityCode || '';
}
