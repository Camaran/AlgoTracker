import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

// ─── Badge de tipo de cuenta ────────────────────────────────────
function AccountTypeBadge({ type, phase }) {
  const label = phase || type || "—";
  const color =
    phase === "Fondeada"   ? "badge-funded"  :
    phase?.startsWith("Fase") ? "badge-phase" :
    type === "Propfirm"    ? "badge-propfirm" :
    "badge-default";
  return <span className={`account-badge ${color}`}>{label}</span>;
}

// ─── Modal: Agregar Cuenta ───────────────────────────────────────
function AddAccountModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "", broker: "", type: "Propfirm",
    platform: "MT5", phase: "", initial_balance: ""
  });
  const [loading, setLoading]   = useState(false);
  const [newAccount, setNewAccount] = useState(null);
  const [copied, setCopied]     = useState(false);

  const handleChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      const payload = {
        ...form,
        initial_balance: parseFloat(form.initial_balance) || 0
      };
      const res = await api.post("/accounts", payload);
      setNewAccount(res.data);
      onCreated();
    } catch (err) {
      alert("Error creando cuenta: " + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newAccount.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{newAccount ? "¡Cuenta creada!" : "Agregar Cuenta MT5"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {newAccount ? (
          <div className="modal-success">
            <div className="success-icon">✓</div>
            <p className="success-msg">
              <strong>{newAccount.name}</strong> fue registrada correctamente.
            </p>
            <p className="key-label">Copia tu API Key y pégala en el parámetro <code>InpApiKey</code> del EA:</p>
            <div className="api-key-box">
              <code className="api-key-text">{newAccount.api_key}</code>
              <button className="copy-btn" onClick={copyKey}>
                {copied ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
            <p className="key-warning">
              ⚠ Esta es la única vez que se muestra completa. Guárdala en un lugar seguro.
            </p>
            <button className="btn-primary" onClick={onClose}>Listo</button>
          </div>
        ) : (
          <div className="modal-form">
            <div className="form-row">
              <label>Nombre de la cuenta *</label>
              <input name="name" placeholder="Ej: FTMO Cuenta 1" value={form.name} onChange={handleChange} />
            </div>
            <div className="form-row-2col">
              <div className="form-row">
                <label>Plataforma</label>
                <select name="platform" value={form.platform} onChange={handleChange}>
                  <option>MT5</option>
                  <option>MT4</option>
                </select>
              </div>
              <div className="form-row">
                <label>Tipo</label>
                <select name="type" value={form.type} onChange={handleChange}>
                  <option value="Propfirm">Propfirm</option>
                  <option value="Broker">Broker</option>
                  <option value="Personal">Personal</option>
                </select>
              </div>
            </div>
            <div className="form-row-2col">
              <div className="form-row">
                <label>Broker / Propfirm</label>
                <input name="broker" placeholder="Ej: FTMO, Pepperstone" value={form.broker} onChange={handleChange} />
              </div>
              <div className="form-row">
                <label>Fase</label>
                <input name="phase" placeholder="Ej: Fase 1, Fondeada" value={form.phase} onChange={handleChange} />
              </div>
            </div>
            <div className="form-row">
              <label>Balance inicial</label>
              <input name="initial_balance" type="number" placeholder="100000" value={form.initial_balance} onChange={handleChange} />
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={handleSubmit} disabled={loading || !form.name.trim()}>
                {loading ? "Guardando…" : "Crear cuenta"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card de cuenta ──────────────────────────────────────────────
function AccountCard({ account }) {
  const navigate = useNavigate();
  const pnl      = parseFloat(account.net_profit || 0);
  const pnlPos   = pnl >= 0;

  return (
    <div className="account-card" onClick={() => navigate(`/cuenta/${account.id}`)}>
      <div className="ac-header">
        <div>
          <div className="ac-name">{account.name}</div>
          <div className="ac-broker">{account.broker || "—"}</div>
        </div>
        <AccountTypeBadge type={account.type} phase={account.phase} />
      </div>

      <div className="ac-balance">
        <span className="ac-balance-label">Balance inicial</span>
        <span className="ac-balance-value">
          ${parseFloat(account.initial_balance || 0).toLocaleString("es-CO", { minimumFractionDigits: 0 })}
        </span>
      </div>

      <div className="ac-metrics">
        <div className="ac-metric">
          <span className="ac-metric-label">PnL neto</span>
          <span className={`ac-metric-value ${pnlPos ? "positive" : "negative"}`}>
            {pnlPos ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </div>
        <div className="ac-metric">
          <span className="ac-metric-label">Winrate</span>
          <span className="ac-metric-value">{account.winrate ?? "—"}%</span>
        </div>
        <div className="ac-metric">
          <span className="ac-metric-label">Prof. Factor</span>
          <span className="ac-metric-value">{account.profit_factor ?? "—"}</span>
        </div>
        <div className="ac-metric">
          <span className="ac-metric-label">Operaciones</span>
          <span className="ac-metric-value">{account.total_trades ?? 0}</span>
        </div>
      </div>

      <button className="ac-btn-detail">Ver cuenta →</button>
    </div>
  );
}

// ─── Dashboard principal ─────────────────────────────────────────
export default function Dashboard() {
  const [accounts,    setAccounts]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get("/accounts");
      setAccounts(res.data);
    } catch (err) {
      console.error("Error cargando cuentas:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Métricas globales consolidadas
  const globalMetrics = accounts.reduce(
    (acc, a) => ({
      totalProfit:  acc.totalProfit  + parseFloat(a.net_profit   || 0),
      totalTrades:  acc.totalTrades  + parseInt(a.total_trades   || 0),
      winrateSum:   acc.winrateSum   + parseFloat(a.winrate      || 0),
      pfSum:        acc.pfSum        + parseFloat(a.profit_factor || 0),
      pfCount:      acc.pfCount      + (a.profit_factor != null ? 1 : 0),
    }),
    { totalProfit: 0, totalTrades: 0, winrateSum: 0, pfSum: 0, pfCount: 0 }
  );
  const avgWinrate = accounts.length ? (globalMetrics.winrateSum / accounts.length).toFixed(1) : "—";
  const avgPF      = globalMetrics.pfCount ? (globalMetrics.pfSum / globalMetrics.pfCount).toFixed(2) : "—";

  return (
    <div className="page dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Vista consolidada de todas tus cuentas</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          + Agregar Cuenta
        </button>
      </div>

      {/* Cards globales */}
      <div className="global-cards">
        <div className="global-card">
          <span className="gc-label">PnL Total</span>
          <span className={`gc-value ${globalMetrics.totalProfit >= 0 ? "positive" : "negative"}`}>
            {globalMetrics.totalProfit >= 0 ? "+" : ""}
            ${globalMetrics.totalProfit.toFixed(2)}
          </span>
        </div>
        <div className="global-card">
          <span className="gc-label">Operaciones</span>
          <span className="gc-value">{globalMetrics.totalTrades}</span>
        </div>
        <div className="global-card">
          <span className="gc-label">Winrate prom.</span>
          <span className="gc-value">{avgWinrate}%</span>
        </div>
        <div className="global-card">
          <span className="gc-label">Profit Factor prom.</span>
          <span className="gc-value">{avgPF}</span>
        </div>
      </div>

      {/* Grid de cuentas */}
      {loading ? (
        <div className="loading-state">Cargando cuentas…</div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h3>Sin cuentas registradas</h3>
          <p>Agrega tu primera cuenta MT5 para comenzar a trackear tus estrategias.</p>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            + Agregar Cuenta
          </button>
        </div>
      ) : (
        <div className="accounts-grid">
          {accounts.map(a => <AccountCard key={a.id} account={a} />)}
        </div>
      )}

      {showModal && (
        <AddAccountModal
          onClose={() => setShowModal(false)}
          onCreated={() => { fetchAccounts(); }}
        />
      )}
    </div>
  );
}
