import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import api from "../api/client";

// ─── Tooltip personalizado para la equity ───────────────────────
function EquityTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="tt-date">{label}</p>
      <p className="tt-value">
        Equity acum.: <strong>${parseFloat(payload[0].value).toFixed(2)}</strong>
      </p>
    </div>
  );
}

// ─── Card de estrategia / EA ─────────────────────────────────────
function StrategyCard({ strategy, accountId }) {
  const navigate = useNavigate();
  const pnl      = parseFloat(strategy.total_profit || 0);

  return (
    <div
      className="strategy-card"
      onClick={() => navigate(`/ea/${accountId}/${strategy.magic_number}`)}
    >
      <div className="sc-header">
        <div className="sc-magic">Magic #{strategy.magic_number ?? "0"}</div>
        <span className={`sc-pnl ${pnl >= 0 ? "positive" : "negative"}`}>
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </span>
      </div>
      <div className="sc-stats">
        <div>
          <span className="sc-label">Operaciones</span>
          <span className="sc-val">{strategy.total_trades}</span>
        </div>
        <div>
          <span className="sc-label">Winrate</span>
          <span className="sc-val">{strategy.winrate}%</span>
        </div>
      </div>
      <div className="sc-link">Ver detalle →</div>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────
export default function AccountDetail() {
  const { account_id } = useParams();
  const navigate        = useNavigate();

  const [account,  setAccount]  = useState(null);
  const [equity,   setEquity]   = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [accRes, eqRes] = await Promise.all([
          api.get(`/accounts/${account_id}`),
          api.get(`/accounts/${account_id}/equity`)
        ]);
        setAccount(accRes.data);

        // Formatear curva de equity para recharts
        const eqData = eqRes.data.map(row => ({
          date: new Date(row.date).toLocaleDateString("es-CO", { month: "short", day: "numeric" }),
          equity: parseFloat(row.cumulative_profit)
        }));
        setEquity(eqData);
      } catch (err) {
        console.error("Error cargando cuenta:", err);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, [account_id]);

  if (loading) return <div className="page loading-state">Cargando cuenta…</div>;
  if (!account) return <div className="page loading-state">Cuenta no encontrada.</div>;

  const netProfit = (account.strategies || []).reduce(
    (sum, s) => sum + parseFloat(s.total_profit || 0), 0
  );
  const totalTrades = (account.strategies || []).reduce(
    (sum, s) => sum + parseInt(s.total_trades || 0), 0
  );
  const avgWinrate = account.strategies?.length
    ? (account.strategies.reduce((s, e) => s + parseFloat(e.winrate || 0), 0) / account.strategies.length).toFixed(1)
    : "—";

  const eqMin = equity.length ? Math.min(...equity.map(e => e.equity)) : 0;
  const eqMax = equity.length ? Math.max(...equity.map(e => e.equity)) : 0;

  return (
    <div className="page account-detail-page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span className="bc-link" onClick={() => navigate("/")}>Dashboard</span>
        <span className="bc-sep">›</span>
        <span className="bc-current">{account.name}</span>
      </div>

      {/* Header de cuenta */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{account.name}</h1>
          <p className="page-subtitle">
            {account.broker && <span>{account.broker}</span>}
            {account.phase  && <span> · {account.phase}</span>}
            {account.platform && <span> · {account.platform}</span>}
          </p>
        </div>
        <div className="ac-balance-hero">
          <span className="ac-balance-label">Balance inicial</span>
          <span className="ac-balance-hero-val">
            ${parseFloat(account.initial_balance || 0).toLocaleString("es-CO")}
          </span>
        </div>
      </div>

      {/* Métricas resumen */}
      <div className="global-cards">
        <div className="global-card">
          <span className="gc-label">PnL Neto</span>
          <span className={`gc-value ${netProfit >= 0 ? "positive" : "negative"}`}>
            {netProfit >= 0 ? "+" : ""}${netProfit.toFixed(2)}
          </span>
        </div>
        <div className="global-card">
          <span className="gc-label">Operaciones</span>
          <span className="gc-value">{totalTrades}</span>
        </div>
        <div className="global-card">
          <span className="gc-label">Winrate prom.</span>
          <span className="gc-value">{avgWinrate}%</span>
        </div>
        <div className="global-card">
          <span className="gc-label">Estrategias activas</span>
          <span className="gc-value">{account.strategies?.length ?? 0}</span>
        </div>
      </div>

      {/* Curva de equity */}
      {equity.length > 0 && (
        <div className="chart-section">
          <h2 className="section-title">Curva de Equity</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={equity} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#6b7fa3", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[eqMin - Math.abs(eqMin * 0.05), eqMax + Math.abs(eqMax * 0.05)]}
                  tick={{ fill: "#6b7fa3", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${v.toFixed(0)}`}
                />
                <Tooltip content={<EquityTooltip />} />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke="#00d4a4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#00d4a4" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Estrategias */}
      <div className="section">
        <h2 className="section-title">Estrategias en esta cuenta</h2>
        {!account.strategies?.length ? (
          <div className="empty-state">
            <p>No hay trades registrados en esta cuenta aún.</p>
          </div>
        ) : (
          <div className="strategies-grid">
            {account.strategies.map(s => (
              <StrategyCard key={s.magic_number} strategy={s} accountId={account_id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
