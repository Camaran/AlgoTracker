import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { getSummary } from '../api/client';

const COLORS = ['#00d4a4', '#00a8ff', '#f5a623', '#ff4d6d', '#a78bfa', '#34d399'];

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pnlColor(v) {
  if (v > 0) return 'green';
  if (v < 0) return 'red';
  return '';
}

export default function Dashboard() {
  const [eas, setEas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSummary()
      .then(r => { setEas(r.data.eas || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <div className="loading"><div className="spinner"/> Cargando métricas...</div>;
  if (error)   return <div className="error-box">❌ Error conectando al backend: {error}<br/><small>Verifica que FastAPI esté corriendo en localhost:8000</small></div>;

  // Totales globales
  const totalProfit  = eas.reduce((s, e) => s + (e.net_profit || 0), 0);
  const avgWinrate   = eas.length ? eas.reduce((s, e) => s + (e.win_rate || 0), 0) / eas.length : 0;
  const avgPF        = eas.length ? eas.reduce((s, e) => s + (e.profit_factor || 0), 0) / eas.length : 0;
  const totalTrades  = eas.reduce((s, e) => s + (e.total_trades || 0), 0);

  // Donut data
  const donutData = eas
    .filter(e => e.total_trades > 0)
    .map(e => ({ name: e.comment || `EA ${e.magic_number}`, value: e.total_trades }));

  // Top performers
  const topPerformers = [...eas].sort((a, b) => (b.net_profit || 0) - (a.net_profit || 0)).slice(0, 3);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard de Estrategias</h1>
        <p className="page-subtitle">Vista general del rendimiento de todos tus EAs en tiempo real</p>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">PnL Total</div>
          <div className={`stat-value ${pnlColor(totalProfit)}`}>
            {totalProfit >= 0 ? '+' : ''}${fmt(totalProfit)}
          </div>
          <div className="stat-change">Todas las estrategias</div>
          <div className="stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Total Trades</div>
          <div className="stat-value">{totalTrades}</div>
          <div className="stat-change">{eas.length} estrategias activas</div>
          <div className="stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Winrate Promedio</div>
          <div className={`stat-value ${avgWinrate >= 50 ? 'green' : avgWinrate >= 40 ? '' : 'red'}`}>
            {fmt(avgWinrate, 1)}%
          </div>
          <div className="stat-change">Promedio de todos los EAs</div>
          <div className="stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Profit Factor Prom.</div>
          <div className={`stat-value ${avgPF >= 1.5 ? 'green' : avgPF >= 1 ? '' : 'red'}`}>
            {fmt(avgPF, 3)}
          </div>
          <div className="stat-change">&gt;1.5 = sistema bueno</div>
          <div className="stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
        </div>
      </div>

      {/* EA Cards */}
      <div className="ea-grid">
        {eas.map((ea, i) => {
          const name = ea.comment || `EA ${ea.magic_number}`;
          const pnl  = ea.net_profit || 0;
          const wr   = ea.win_rate   || 0;
          const pf   = ea.profit_factor || 0;
          const good = pnl > 0 && pf >= 1;

          return (
            <Link to={`/ea/${ea.magic_number}`} className="ea-card" key={ea.magic_number}>
              <div className="ea-card-header">
                <div>
                  <div className="ea-name">{name}</div>
                  <div className="ea-magic">magic: {ea.magic_number}</div>
                </div>
                <span className={`ea-badge ${good ? '' : 'red'}`}>
                  {good ? '▲ activo' : '▼ revisar'}
                </span>
              </div>

              <div className="ea-metrics">
                <div className="ea-metric-item">
                  <div className="ea-metric-label">PnL Neto</div>
                  <div className={`ea-metric-value ${pnlColor(pnl)}`}>
                    {pnl >= 0 ? '+' : ''}${fmt(pnl)}
                  </div>
                </div>
                <div className="ea-metric-item">
                  <div className="ea-metric-label">Win Rate</div>
                  <div className={`ea-metric-value ${wr >= 50 ? 'green' : wr >= 40 ? '' : 'red'}`}>
                    {fmt(wr, 1)}%
                  </div>
                </div>
                <div className="ea-metric-item">
                  <div className="ea-metric-label">Profit Factor</div>
                  <div className={`ea-metric-value ${pf >= 1.5 ? 'green' : pf >= 1 ? '' : 'red'}`}>
                    {fmt(pf, 3)}
                  </div>
                </div>
                <div className="ea-metric-item">
                  <div className="ea-metric-label">Max DD</div>
                  <div className={`ea-metric-value ${(ea.max_drawdown_pct || 0) < 10 ? 'green' : 'red'}`}>
                    {fmt(ea.max_drawdown_pct || 0, 1)}%
                  </div>
                </div>
              </div>

              <div className="ea-footer">
                <span className="ea-ops">{ea.total_trades} operaciones</span>
                <span className="btn-ver">Ver EA →</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-title">Distribución de Operaciones</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={donutData} cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                   dataKey="value" paddingAngle={3}>
                {donutData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1e2d45', borderRadius: 8, fontSize: 12 }}
                formatter={(v, n) => [`${v} trades`, n]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: 8 }}>
            {donutData.map((d, i) => (
              <span key={i} style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block' }}/>
                {d.name}
              </span>
            ))}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Top Performers</div>
          {topPerformers.map((ea, i) => {
            const pnl = ea.net_profit || 0;
            const medals = ['🥇', '🥈', '🥉'];
            return (
              <div key={ea.magic_number} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 0', borderBottom: i < 2 ? '1px solid #1e2d45' : 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{medals[i]}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                      {ea.comment || `EA ${ea.magic_number}`}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{ea.total_trades} ops</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: pnl >= 0 ? '#00d4a4' : '#ff4d6d' }}>
                    {pnl >= 0 ? '+' : ''}${fmt(pnl)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>WR: {fmt(ea.win_rate || 0, 1)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
