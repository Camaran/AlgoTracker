import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';
import { getEAMetrics, getEquityCurve, getBySymbol } from '../api/client';

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pnlColor(v) { return v > 0 ? 'green' : v < 0 ? 'red' : ''; }

// Componente: Card de métrica
function MetricCard({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color || ''}`}>{value}</div>
      {sub && <div className="stat-change">{sub}</div>}
    </div>
  );
}

// Componente: Tabla de símbolos
function SymbolTable({ data }) {
  if (!data || !Object.keys(data).length) return <div style={{ color: '#64748b', fontSize: 13 }}>Sin datos por símbolo</div>;

  return (
    <table>
      <thead>
        <tr>
          <th>Símbolo</th><th>Trades</th><th>Win Rate</th>
          <th>Profit Factor</th><th>Ganancia Neta</th><th>Expectancy</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(data).map(([sym, m]) => (
          <tr key={sym}>
            <td><span className="badge badge-buy">{sym}</span></td>
            <td>{m.total_trades}</td>
            <td style={{ color: (m.win_rate || 0) >= 50 ? '#00d4a4' : '#ff4d6d' }}>{fmt(m.win_rate, 1)}%</td>
            <td style={{ color: (m.profit_factor || 0) >= 1.5 ? '#00d4a4' : (m.profit_factor || 0) >= 1 ? '#e2e8f0' : '#ff4d6d' }}>{fmt(m.profit_factor, 3)}</td>
            <td style={{ color: (m.net_profit || 0) >= 0 ? '#00d4a4' : '#ff4d6d' }}>
              {(m.net_profit || 0) >= 0 ? '+' : ''}${fmt(m.net_profit)}
            </td>
            <td style={{ color: (m.expectancy || 0) >= 0 ? '#00d4a4' : '#ff4d6d' }}>
              ${fmt(m.expectancy)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Componente: Calendario
function TradeCalendar({ trades }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  if (!trades || !trades.length) return null;

  // Agrupar por día
  const byDay = {};
  trades.forEach(t => {
    const d = new Date(t.close_time || t.open_time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay[key]) byDay[key] = { profit: 0, count: 0 };
    byDay[key].profit += parseFloat(t.profit || 0);
    byDay[key].count++;
  });

  const { year, month } = currentMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleString('es', { month: 'long', year: 'numeric' });
  const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // Ajustar para que semana empiece en lunes
  const offset = (firstDay + 6) % 7;
  const cells = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14 }}>{monthName}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCurrentMonth(p => {
            const d = new Date(p.year, p.month - 1);
            return { year: d.getFullYear(), month: d.getMonth() };
          })} style={{ background: '#1e2d45', border: 'none', color: '#e2e8f0', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>‹</button>
          <button onClick={() => setCurrentMonth(p => {
            const d = new Date(p.year, p.month + 1);
            return { year: d.getFullYear(), month: d.getMonth() };
          })} style={{ background: '#1e2d45', border: 'none', color: '#e2e8f0', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>›</button>
        </div>
      </div>

      <div className="calendar-grid">
        {days.map(d => <div key={d} className="cal-header">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="cal-day empty" />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const data = byDay[key];
          const cls = data ? (data.profit >= 0 ? 'profit' : 'loss') : '';
          return (
            <div key={key} className={`cal-day ${cls}`}>
              <div className="cal-day-num">{day}</div>
              {data && <>
                <div className="cal-day-pnl">{data.profit >= 0 ? '+' : ''}${fmt(data.profit, 0)}</div>
                <div className="cal-day-ops">{data.count} ops</div>
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EADetail() {
  const { magic, account_id } = useParams();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState(null);
  const [equity, setEquity] = useState([]);
  const [symbols, setSymbols] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getEAMetrics(magic, account_id),
      getEquityCurve(magic, account_id),
      getBySymbol(magic, account_id),
    ]).then(([m, e, s]) => {
      setMetrics(m.data);
      setEquity(e.data.equity_curve || []);
      setSymbols(s.data.by_symbol || {});
      setLoading(false);
    }).catch(err => {
      setError(err.message);
      setLoading(false);
    });
  }, [magic]);

  if (loading) return <div className="loading"><div className="spinner" /> Cargando estrategia...</div>;
  if (error) return <div className="error-box">❌ {error}</div>;
  if (!metrics) return null;

  const s = metrics.summary || {};
  const adv = metrics.advanced || {};
  const name = metrics.ea_name || `EA ${magic}`;

  // Equity chart data
  const equityData = equity.map(p => ({
    time: p.time ? p.time.slice(5, 16) : '',
    equity: parseFloat(p.equity),
  }));

  // Monthly data
  const monthly = metrics.time_analysis?.by_month || {};

  // Trades para calendario (del summary necesitaríamos un endpoint de trades)
  // Por ahora construimos datos del equity_curve
  const calTrades = equity.map(p => ({
    close_time: p.time,
    profit: p.trade_profit || 0,
  })).filter(t => t.profit !== 0);

  return (
    <div>
      <button className="back-btn" onClick={() => navigate('/')}>
        ← Volver al Dashboard
      </button>

      <div className="detail-header">
        <div>
          <h1 className="detail-title">{name}</h1>
          <div className="detail-magic">magic number: {magic}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#64748b' }}>
          <div>{metrics.date_range?.from?.slice(0, 10)} → {metrics.date_range?.to?.slice(0, 10)}</div>
          <div style={{ marginTop: 4 }}>{metrics.trade_count} operaciones totales</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-row" style={{ marginBottom: 28 }}>
        <MetricCard label="PnL Neto"
          value={`${(s.total_net_profit || 0) >= 0 ? '+' : ''}$${fmt(s.total_net_profit)}`}
          sub={`Retorno: ${fmt(s.return_pct, 2)}%`}
          color={pnlColor(s.total_net_profit)} />
        <MetricCard label="Expectativa"
          value={`$${fmt(adv.expectancy)}`}
          sub="por trade"
          color={pnlColor(adv.expectancy)} />
        <MetricCard label="Win Rate"
          value={`${fmt(s.win_rate_pct, 1)}%`}
          sub={`${s.winning_trades}W / ${s.losing_trades}L`}
          color={s.win_rate_pct >= 50 ? 'green' : s.win_rate_pct >= 40 ? '' : 'red'} />
        <MetricCard label="Profit Factor"
          value={fmt(s.profit_factor, 3)}
          sub=">1.5 = sistema bueno"
          color={s.profit_factor >= 1.5 ? 'green' : s.profit_factor >= 1 ? '' : 'red'} />
        <MetricCard label="Max Drawdown"
          value={`${fmt(s.max_drawdown_pct, 2)}%`}
          sub={`-$${fmt(s.max_drawdown_usd)}`}
          color={s.max_drawdown_pct < 10 ? 'green' : s.max_drawdown_pct < 20 ? '' : 'red'} />
        <MetricCard label="Sharpe Ratio"
          value={fmt(s.sharpe_ratio, 4)}
          sub=">1 = bueno"
          color={s.sharpe_ratio > 1 ? 'green' : s.sharpe_ratio > 0 ? '' : 'red'} />
        <MetricCard label="Recovery Factor"
          value={fmt(s.recovery_factor, 3)}
          sub="profit/drawdown"
          color={s.recovery_factor > 1 ? 'green' : ''} />
        <MetricCard label="Sortino Ratio"
          value={fmt(s.sortino_ratio, 4)}
          sub="penaliza pérdidas"
          color={s.sortino_ratio > 1 ? 'green' : s.sortino_ratio > 0 ? '' : 'red'} />
      </div>

      {/* Equity curve */}
      <div className="chart-card" style={{ marginBottom: 28 }}>
        <div className="chart-title">Evolución del Balance</div>
        {equityData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={equityData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4a4" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#00d4a4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${v.toLocaleString()}`} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 8, fontSize: 12 }}
                formatter={v => [`$${fmt(v)}`, 'Equity']}
              />
              <Area type="monotone" dataKey="equity" stroke="#00d4a4" strokeWidth={2}
                fill="url(#eqGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div style={{ color: '#64748b', fontSize: 13, padding: 20 }}>Sin datos de equity curve</div>}
      </div>

      {/* Symbols */}
      <div className="table-card" style={{ marginBottom: 28 }}>
        <div className="chart-title">Estadísticas por Símbolo</div>
        <SymbolTable data={symbols} />
      </div>

      {/* Winners vs Losers */}
      <div className="winners-losers">
        <div className="wl-card">
          <div className="wl-title green">▲ Ganadores</div>
          {[
            ['Total ganadores', s.winning_trades],
            ['Mejor victoria', `+$${fmt(s.best_trade)}`],
            ['Ganancia media', `+$${fmt(s.avg_win)}`],
            ['Racha máx. ganadora', `${adv.max_consecutive_wins || '—'} trades`],
          ].map(([k, v]) => (
            <div className="wl-row" key={k}>
              <span className="wl-key">{k}</span>
              <span className="wl-val">{v}</span>
            </div>
          ))}
        </div>
        <div className="wl-card">
          <div className="wl-title red">▼ Perdedores</div>
          {[
            ['Total perdedores', s.losing_trades],
            ['Peor pérdida', `-$${fmt(Math.abs(s.worst_trade || 0))}`],
            ['Pérdida media', `-$${fmt(Math.abs(s.avg_loss || 0))}`],
            ['Racha máx. perdedora', `${adv.max_consecutive_losses || '—'} trades`],
          ].map(([k, v]) => (
            <div className="wl-row" key={k}>
              <span className="wl-key">{k}</span>
              <span className="wl-val">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly */}
      {Object.keys(monthly).length > 0 && (
        <div className="table-card" style={{ marginBottom: 28 }}>
          <div className="chart-title">Rendimiento por Mes</div>
          <table className="month-table">
            <thead>
              <tr><th>Mes</th><th>Trades</th><th>Profit</th><th>Win Rate</th></tr>
            </thead>
            <tbody>
              {Object.entries(monthly).map(([month, data]) => (
                <tr key={month}>
                  <td>{month}</td>
                  <td>{data.count || '—'}</td>
                  <td style={{ color: (data.profit || 0) >= 0 ? '#00d4a4' : '#ff4d6d', fontWeight: 600 }}>
                    {(data.profit || 0) >= 0 ? '+' : ''}${fmt(data.profit)}
                  </td>
                  <td style={{ color: (data.win_rate || 0) >= 50 ? '#00d4a4' : '#ff4d6d' }}>
                    {fmt(data.win_rate || 0, 1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Calendar */}
      {calTrades.length > 0 && (
        <div className="chart-card">
          <div className="chart-title">Calendario de Operaciones</div>
          <TradeCalendar trades={calTrades} />
        </div>
      )}
    </div>
  );
}
