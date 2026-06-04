import axios from 'axios';
import { getRuntimeApiBase, isMobileEmbed } from '../lib/runtimeApiUrl.js';

function resolveBaseUrl() {
  const base = getRuntimeApiBase();
  if (base) return base;
  if (typeof window !== 'undefined' && isMobileEmbed() && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

axios.defaults.baseURL = resolveBaseUrl();
axios.defaults.headers.common['Content-Type'] = 'application/json';

axios.interceptors.request.use((config) => {
  config.baseURL = resolveBaseUrl();
  return config;
});

export default axios;
