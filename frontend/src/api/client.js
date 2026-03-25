import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 10000,
});

export const getSummary = (account_id) => API.get(`/metrics/summary${account_id ? `?account_id=${account_id}` : ''}`);
export const getEAMetrics = (magic, account_id) => API.get(`/metrics/${magic}?account_id=${account_id}`);
export const getEquityCurve = (magic, account_id, balance = 10000) =>
  API.get(`/metrics/${magic}/equity?initial_balance=${balance}&account_id=${account_id}`);
export const getBySymbol = (magic, account_id) => API.get(`/metrics/${magic}/by-symbol?account_id=${account_id}`);
export const getTimeAnalysis = (magic, account_id) => API.get(`/metrics/${magic}/time-analysis?account_id=${account_id}`);
export const getTrades = () => API.get('/trades_raw');

export default API;
