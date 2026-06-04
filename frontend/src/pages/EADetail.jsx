import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine
} from 'recharts';
import { getEAMetrics, getEquityCurve, getBySymbol, getTrades } from '../api/client';
import TradesTable from '../components/TradesTable';

// ─── Helpers ────────────────────────────────────────────────────
function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPnl(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}$${fmt(Math.abs(v), d)}`;
}
function scoreColor(val, good, warn) {
  if (val == null || isNaN(val)) return 'neutral';
  if (val >= good) return 'positive';
  if (val >= warn) return 'warning';
  return 'negative';
}

// ─── Tooltip curva equity ────────────────────────────────────────
function EqTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="eq-tooltip">
      <div className="eq-tt-time">{payload[0]?.payload?.time}</div>
      <div className="eq-tt-val">${fmt(payload[0]?.value)}</div>
    </div>
  );
}

// ─── Sección con título ──────────────────────────────────────────
function Section({ title, children, accent }) {
  return (
    <div className="ed-section">
      <div className={`ed-section-title ${accent || ''}`}>{title}</div>
      {children}
    </div>
  );
}

// ─── Card de métrica individual ──────────────────────────────────
function KPI({ label, value, sub, tone, size }) {
  return (
    <div className={`ed-kpi ${tone || ''} ${size || ''}`}>
      <div className="ed-kpi-label">{label}</div>
      <div className="ed-kpi-value">{value}</div>
      {sub && <div className="ed-kpi-sub">{sub}</div>}
    </div>
  );
}

// ─── Fila de dato (label + valor) ───────────────────────────────
function DataRow({ label, value, tone }) {
  return (
    <div className="ed-data-row">
      <span className="ed-data-label">{label}</span>
      <span className={`ed-data-value ${tone || ''}`}>{value}</span>
    </div>
  );
}

// ─── Tabla de símbolos ───────────────────────────────────────────
function SymbolTable({ data }) {
  if (!data || !Object.keys(data).length)
    return <p className="ed-empty">Sin datos por símbolo</p>;

  return (
    <div className="ed-symbol-table-wrap">
      <table className="ed-symbol-table">
        <thead>
          <tr>
            <th>Símbolo</th>
            <th>Trades</th>
            <th>Win Rate</th>
            <th>Prof. Factor</th>
            <th>PnL Neto</th>
            <th>Expectativa</th>
            <th>Max DD</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data).map(([sym, m]) => (
            <tr key={sym}>
              <td><span className="ed-sym-badge">{sym}</span></td>
              <td>{m.total_trades}</td>
              <td className={m.win_rate >= 50 ? 'positive' : 'negative'}>{fmt(m.win_rate, 1)}%</td>
              <td className={m.profit_factor >= 1.5 ? 'positive' : m.profit_factor >= 1 ? 'warning' : 'negative'}>{fmt(m.profit_factor, 2)}</td>
              <td className={m.net_profit >= 0 ? 'positive' : 'negative'}>{fmtPnl(m.net_profit)}</td>
              <td className={m.expectancy >= 0 ? 'positive' : 'negative'}>${fmt(m.expectancy)}</td>
              <td className={m.max_drawdown_pct < 10 ? 'positive' : m.max_drawdown_pct < 20 ? 'warning' : 'negative'}>{fmt(m.max_drawdown_pct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Calendario ──────────────────────────────────────────────────
function TradeCalendar({ trades }) {
  const [cur, setCur] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  if (!trades?.length) return null;

  const byDay = {};
  trades.forEach(t => {
    const d = new Date(t.close_time || t.time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay[key]) byDay[key] = { profit: 0, count: 0 };
    byDay[key].profit += parseFloat(t.profit || t.trade_profit || 0);
    byDay[key].count++;
  });

  const { year, month } = cur;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay + 6) % 7;
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const days = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const monthName = new Date(year, month).toLocaleString('es', { month: 'long', year: 'numeric' });

  const nav = (delta) => setCur(p => {
    const d = new Date(p.year, p.month + delta);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return (
    <div className="ed-calendar">
      <div className="ed-cal-nav">
        <span className="ed-cal-month">{monthName}</span>
        <div className="ed-cal-btns">
          <button onClick={() => nav(-1)}>‹</button>
          <button onClick={() => nav(1)}>›</button>
        </div>
      </div>
      <div className="ed-cal-grid">
        {days.map(d => <div key={d} className="ed-cal-head">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="ed-cal-cell empty" />;
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const data = byDay[key];
          const cls = data ? (data.profit >= 0 ? 'profit' : 'loss') : '';
          return (
            <div key={key} className={`ed-cal-cell ${cls}`}>
              <span className="ed-cal-num">{day}</span>
              {data && <>
                <span className="ed-cal-pnl">{data.profit >= 0 ? '+' : ''}${fmt(data.profit, 0)}</span>
                <span className="ed-cal-ops">{data.count}op</span>
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ────────────────────────────────────────────
export default function EADetail() {
  const { magic_number: magic, account_id } = useParams();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState(null);
  const [equity, setEquity] = useState([]);
  const [symbols, setSymbols] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trades, setTrades] = useState([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getEAMetrics(magic, account_id),
      getEquityCurve(magic, account_id),
      getBySymbol(magic, account_id),
      getTrades(account_id, magic),
    ]).then(([m, e, s, t]) => {
      setMetrics(m.data);
      setEquity(e.data.equity_curve || []);
      setSymbols(s.data.by_symbol || {});
      setTrades(t.data || []);
      setLoading(false);
    }).catch(err => {
      setError(err.message);
      setLoading(false);
    });
  }, [magic]);

  if (loading) return (
    <div className="ed-loading">
      <div className="ed-spinner" />
      <span>Cargando estrategia...</span>
    </div>
  );
  if (error) return <div className="ed-error">Error: {error}</div>;
  if (!metrics) return null;

  const s = metrics.summary || {};
  const adv = metrics.advanced || {};
  const name = metrics.ea_name || `EA ${magic}`;

  // Equity chart
  const eqData = equity.map(p => ({
    time: p.time ? p.time.slice(5, 16) : '',
    equity: parseFloat(p.equity),
    profit: parseFloat(p.trade_profit || 0),
  }));
  const eqMin = eqData.length ? Math.min(...eqData.map(d => d.equity)) : 0;
  const eqMax = eqData.length ? Math.max(...eqData.map(d => d.equity)) : 0;
  const eqColor = (s.total_net_profit || 0) >= 0 ? '#00d4a4' : '#ff4d6d';

  // Monthly bar chart
  const monthly = metrics.time_analysis?.by_month || {};
  const monthlyData = Object.entries(monthly).map(([m, d]) => ({
    month: m.slice(-5),
    profit: d.profit || 0,
    trades: d.count || 0,
  }));

  // Trades para calendario
  const calTrades = equity.map(p => ({
    close_time: p.time,
    profit: p.trade_profit || 0,
  })).filter(t => t.profit !== 0);

  // Colores de ratios
  const pfTone = scoreColor(s.profit_factor, 1.5, 1.0);
  const wrTone = scoreColor(s.win_rate_pct, 55, 45);
  const shTone = scoreColor(s.sharpe_ratio, 1.0, 0.5);
  const ddTone = s.max_drawdown_pct < 10 ? 'positive' : s.max_drawdown_pct < 20 ? 'warning' : 'negative';
  const pnlTone = (s.total_net_profit || 0) >= 0 ? 'positive' : 'negative';

  return (
    <div className="ed-page">

      {/* ── BREADCRUMB ── */}
      <div className="ed-breadcrumb">
        <button className="ed-back" onClick={() => navigate(-1)}>← Volver</button>
        <span className="ed-bc-sep">/</span>
        <span className="ed-bc-name">{name}</span>
      </div>

      {/* ── HEADER ── */}
      <div className="ed-header">
        <div>
          <h1 className="ed-title">{name}</h1>
          <div className="ed-meta">
            <span className="ed-meta-tag">Magic #{magic}</span>
            {metrics.date_range?.from && (
              <span className="ed-meta-tag">
                {metrics.date_range.from.slice(0, 10)} → {metrics.date_range.to.slice(0, 10)}
              </span>
            )}
            <span className="ed-meta-tag">{metrics.trade_count} operaciones</span>
          </div>
        </div>
        <div className={`ed-header-pnl ${pnlTone}`}>
          <div className="ed-header-pnl-label">PnL neto</div>
          <div className="ed-header-pnl-value">{fmtPnl(s.total_net_profit)}</div>
          <div className="ed-header-pnl-sub">Retorno {fmt(s.return_pct)}%</div>
        </div>
      </div>

      {/* ── KPIs PRINCIPALES (fila 1) ── */}
      <div className="ed-kpi-grid-main">
        <KPI label="Win Rate" value={`${fmt(s.win_rate_pct, 1)}%`} sub={`${s.winning_trades}W · ${s.losing_trades}L`} tone={wrTone} size="large" />
        <KPI label="Profit Factor" value={fmt(s.profit_factor, 3)} sub=">1.5 excelente" tone={pfTone} size="large" />
        <KPI label="Expectativa" value={`$${fmt(adv.expectancy)}`} sub="por trade" tone={(adv.expectancy || 0) >= 0 ? 'positive' : 'negative'} size="large" />
        <KPI label="Max Drawdown" value={`${fmt(s.max_drawdown_pct)}%`} sub={`-$${fmt(s.max_drawdown_usd)}`} tone={ddTone} size="large" />
      </div>

      {/* ── CURVA DE EQUITY ── */}
      <Section title="Curva de Equity">
        <div className="ed-chart-card">
          {eqData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={eqData} margin={{ top: 10, right: 16, bottom: 0, left: 10 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={eqColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={eqColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#4a5568' }} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[eqMin * 0.998, eqMax * 1.002]}
                  tick={{ fontSize: 10, fill: '#4a5568' }}
                  tickLine={false} axisLine={false}
                  tickFormatter={v => `$${v.toFixed(0)}`}
                />
                <Tooltip content={<EqTooltip />} />
                <Area type="monotone" dataKey="equity" stroke={eqColor} strokeWidth={2} fill="url(#eqGrad)" dot={false} activeDot={{ r: 3, fill: eqColor }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="ed-empty">Sin datos de equity</p>}
        </div>
      </Section>

      {/* ── HISTORIAL DE TRADES ── */}
      <Section title="Historial de Trades">
        <TradesTable accountId={account_id} magicNumber={magic} />
      </Section>

      {/* ── DOS COLUMNAS: ratios avanzados + ganadores/perdedores ── */}
      <div className="ed-two-col">

        {/* Ratios avanzados */}
        <Section title="Ratios de Rendimiento">
          <div className="ed-ratio-card">
            <DataRow label="Sharpe Ratio" value={fmt(s.sharpe_ratio, 4)} tone={shTone} />
            <DataRow label="Sortino Ratio" value={fmt(s.sortino_ratio, 4)} tone={scoreColor(s.sortino_ratio, 1, 0.5)} />
            <DataRow label="Calmar Ratio" value={fmt(s.calmar_ratio, 4)} tone={scoreColor(s.calmar_ratio, 1, 0.5)} />
            <DataRow label="Recovery Factor" value={fmt(s.recovery_factor, 3)} tone={scoreColor(s.recovery_factor, 1, 0.5)} />
            <DataRow label="Payoff Ratio" value={fmt(s.payoff_ratio, 3)} tone={scoreColor(s.payoff_ratio, 1.5, 1)} />
            <DataRow label="Retorno total" value={`${fmt(s.return_pct)}%`} tone={pnlTone} />
            <DataRow label="Balance final" value={`$${fmt(s.final_balance)}`} />
          </div>
        </Section>

        {/* Trades stats */}
        <Section title="Estadísticas de Trades">
          <div className="ed-ratio-card">
            <DataRow label="Total trades" value={s.total_trades} />
            <DataRow label="Ganadores" value={s.winning_trades} tone="positive" />
            <DataRow label="Perdedores" value={s.losing_trades} tone="negative" />
            <DataRow label="Mejor trade" value={`+$${fmt(s.best_trade)}`} tone="positive" />
            <DataRow label="Peor trade" value={`-$${fmt(Math.abs(s.worst_trade || 0))}`} tone="negative" />
            <DataRow label="Ganancia media" value={`+$${fmt(s.avg_win)}`} tone="positive" />
            <DataRow label="Pérdida media" value={`-$${fmt(Math.abs(s.avg_loss || 0))}`} tone="negative" />
            <DataRow label="Ticket promedio" value={`$${fmt(s.avg_trade)}`} tone={(s.avg_trade || 0) >= 0 ? 'positive' : 'negative'} />
          </div>
        </Section>
      </div>

      {/* ── DOS COLUMNAS: rachas + bruto ── */}
      <div className="ed-two-col">

        {/* Rachas */}
        <Section title="Rachas">
          <div className="ed-ratio-card">
            <DataRow label="Máx. racha ganadora" value={`${adv.max_consecutive_wins || '—'} trades`} tone="positive" />
            <DataRow label="Máx. racha perdedora" value={`${adv.max_consecutive_losses || '—'} trades`} tone="negative" />
            <DataRow label="Racha actual"
              value={adv.current_streak_type
                ? `${adv.current_streak} ${adv.current_streak_type === 'win' ? 'ganadora' : 'perdedora'}`
                : '—'}
              tone={adv.current_streak_type === 'win' ? 'positive' : adv.current_streak_type === 'loss' ? 'negative' : ''}
            />
            <DataRow label="Desviación estándar" value={`$${fmt(adv.profit_std_dev)}`} />
            <DataRow label="Coef. variación" value={fmt(adv.coefficient_of_variation, 3)} />
          </div>
        </Section>

        {/* Brutos */}
        <Section title="Totales Brutos">
          <div className="ed-ratio-card">
            <DataRow label="Ganancia bruta" value={`$${fmt(s.gross_profit)}`} tone="positive" />
            <DataRow label="Pérdida bruta" value={`-$${fmt(s.gross_loss)}`} tone="negative" />
            <DataRow label="PnL neto" value={fmtPnl(s.total_net_profit)} tone={pnlTone} />
            <DataRow label="Comisiones" value={`-$${fmt(Math.abs(s.total_commissions || 0))}`} tone="negative" />
            <DataRow label="Swaps" value={`$${fmt(s.total_swaps || 0)}`} />
          </div>
        </Section>
      </div>

      {/* ── RENDIMIENTO MENSUAL ── */}
      {monthlyData.length > 0 && (
        <Section title="Rendimiento Mensual">
          <div className="ed-chart-card">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} margin={{ top: 10, right: 16, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#4a5568' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#4a5568' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f1522', border: '1px solid #1e2d45', borderRadius: 8, fontSize: 12 }}
                  formatter={v => [`$${fmt(v)}`, 'Profit']}
                />
                <ReferenceLine y={0} stroke="#1e2d45" />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.profit >= 0 ? '#00d4a4' : '#ff4d6d'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ── POR SÍMBOLO ── */}
      <Section title="Estadísticas por Símbolo">
        <SymbolTable data={symbols} />
      </Section>

      {/* ── CALENDARIO ── */}
      {calTrades.length > 0 && (
        <Section title="Calendario de Operaciones">
          <div className="ed-chart-card">
            <TradeCalendar trades={calTrades} />
          </div>
        </Section>
      )}

    </div>
  );
}
