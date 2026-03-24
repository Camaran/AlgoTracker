-- ═══════════════════════════════════════════════════════════════
-- SCHEMA DE MÉTRICAS - migrations.sql
-- ═══════════════════════════════════════════════════════════════
-- Ejecutar una vez para crear las tablas de métricas persistentes.
--
-- Estrategia híbrida:
--   - Métricas básicas: calcular en tiempo real (rápido, siempre fresco)
--   - Equity curve: guardar en BD (muchos puntos, costoso recalcular)
--   - Snapshots diarios: guardar en BD (histórico, no recalculable)
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- TABLA 1: Snapshots diarios de métricas por EA
-- Se llena con un job que corre cada noche (o cada hora)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics_daily (
    id                  SERIAL PRIMARY KEY,
    magic_number        BIGINT NOT NULL,
    snapshot_date       DATE NOT NULL,

    -- Métricas del día
    trades_today        INTEGER DEFAULT 0,
    profit_today        NUMERIC(12,4) DEFAULT 0,

    -- Métricas acumuladas hasta ese día
    total_trades        INTEGER,
    winning_trades      INTEGER,
    losing_trades       INTEGER,
    win_rate_pct        NUMERIC(6,2),
    profit_factor       NUMERIC(10,4),
    total_net_profit    NUMERIC(12,4),
    gross_profit        NUMERIC(12,4),
    gross_loss          NUMERIC(12,4),
    avg_win             NUMERIC(10,4),
    avg_loss            NUMERIC(10,4),
    avg_trade           NUMERIC(10,4),
    best_trade          NUMERIC(10,4),
    worst_trade         NUMERIC(10,4),
    payoff_ratio        NUMERIC(10,4),

    -- Riesgo
    max_drawdown_usd    NUMERIC(12,4),
    max_drawdown_pct    NUMERIC(6,2),
    recovery_factor     NUMERIC(10,4),

    -- Ratios avanzados
    sharpe_ratio        NUMERIC(10,4),
    sortino_ratio       NUMERIC(10,4),
    calmar_ratio        NUMERIC(10,4),
    expectancy          NUMERIC(10,4),

    -- Balance
    initial_balance     NUMERIC(12,2) DEFAULT 10000,
    final_balance       NUMERIC(12,2),
    return_pct          NUMERIC(8,4),

    created_at          TIMESTAMP DEFAULT NOW(),

    -- Constraint: solo un snapshot por EA por día
    UNIQUE (magic_number, snapshot_date)
);

-- Índice para consultas por EA y fecha
CREATE INDEX IF NOT EXISTS idx_metrics_daily_ea_date
    ON metrics_daily (magic_number, snapshot_date DESC);


-- ─────────────────────────────────────────────────────────────
-- TABLA 2: Curva de equity (punto por cada trade cerrado)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equity_curve (
    id              SERIAL PRIMARY KEY,
    magic_number    BIGINT NOT NULL,
    trade_ticket    BIGINT,         -- FK al trade que generó este punto
    trade_time      TIMESTAMP NOT NULL,
    equity          NUMERIC(12,2) NOT NULL,
    trade_profit    NUMERIC(10,4),  -- Profit del trade individual
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equity_curve_ea_time
    ON equity_curve (magic_number, trade_time ASC);


-- ─────────────────────────────────────────────────────────────
-- TABLA 3: Métricas por símbolo (por EA)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics_by_symbol (
    id              SERIAL PRIMARY KEY,
    magic_number    BIGINT NOT NULL,
    symbol          TEXT NOT NULL,
    snapshot_date   DATE NOT NULL,

    total_trades    INTEGER,
    net_profit      NUMERIC(12,4),
    win_rate_pct    NUMERIC(6,2),
    profit_factor   NUMERIC(10,4),
    expectancy      NUMERIC(10,4),
    max_drawdown_pct NUMERIC(6,2),

    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (magic_number, symbol, snapshot_date)
);


-- ─────────────────────────────────────────────────────────────
-- VISTA: Métricas actuales de cada EA (fácil de consultar)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_ea_current_metrics AS
SELECT DISTINCT ON (magic_number)
    magic_number,
    snapshot_date,
    total_trades,
    win_rate_pct,
    profit_factor,
    total_net_profit,
    max_drawdown_pct,
    sharpe_ratio,
    return_pct,
    final_balance
FROM metrics_daily
ORDER BY magic_number, snapshot_date DESC;


-- ─────────────────────────────────────────────────────────────
-- VISTA: Resumen de rendimiento por símbolo (todos los EAs)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_symbol_performance AS
SELECT
    symbol,
    SUM(profit + commission + swap) AS net_profit,
    COUNT(*) AS total_trades,
    AVG(profit + commission + swap) AS avg_trade,
    COUNT(*) FILTER (WHERE profit + commission + swap > 0) * 100.0 / COUNT(*) AS win_rate_pct
FROM trades_raw
WHERE close_time IS NOT NULL AND close_price > 0
GROUP BY symbol
ORDER BY net_profit DESC;
