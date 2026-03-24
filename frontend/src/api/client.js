import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 10000,
});

export const getSummary = () => API.get('/metrics/summary');
export const getEAMetrics = (magic) => API.get(`/metrics/${magic}`);
export const getEquityCurve = (magic, balance = 10000) =>
  API.get(`/metrics/${magic}/equity?initial_balance=${balance}`);
export const getBySymbol = (magic) => API.get(`/metrics/${magic}/by-symbol`);
export const getTimeAnalysis = (magic) => API.get(`/metrics/${magic}/time-analysis`);
export const getTrades = () => API.get('/trades_raw'); // endpoint directo a BD si lo agregas

export default API;
