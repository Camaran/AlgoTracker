-- =============================================================
-- AlgoTracker — Migración Completa
-- Recrea TODA la base de datos desde cero.
--
-- CÓMO USAR (primera vez en una máquina nueva):
--
--   1. Crear usuario y BD (como superuser postgres):
--        psql -U postgres
--        CREATE USER algotracker_user WITH PASSWORD 'Aa1073162355';
--        CREATE DATABASE algotracker_db OWNER algotracker_user;
--        \q
--
--   2. Ejecutar este archivo:
--        psql -U algotracker_user -d algotracker_db -f migrations_completo.sql
--
-- Si la BD ya existe, el script es seguro de re-ejecutar:
-- usa IF NOT EXISTS y ON CONFLICT DO NOTHING en todos lados.
-- =============================================================


-- =============================================================
-- TABLA 1: accounts
-- Una fila por cuenta de MT5 (FTMO, Pepperstone, etc.)
-- La api_key es la que va en el parámetro InpApiKey del EA.
-- =============================================================
CREATE TABLE IF NOT EXISTS accounts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100)  NOT NULL,
    broker          VARCHAR(100),
    type            VARCHAR(50)   CHECK (type IN ('Propfirm', 'Broker', 'Personal')),
    platform        VARCHAR(20)   DEFAULT 'MT5',
    phase           VARCHAR(50),
    initial_balance NUMERIC       DEFAULT 0,
    api_key         VARCHAR(64)   NOT NULL,
    is_active       BOOLEAN       DEFAULT TRUE,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),

    CONSTRAINT accounts_api_key_key UNIQUE (api_key)
);

CREATE INDEX IF NOT EXISTS idx_accounts_api_key ON accounts(api_key);


-- =============================================================
-- TABLA 2: trades_raw
-- Cada trade cerrado enviado por el EA llega aquí.
-- account_id FK a accounts — identifica de qué cuenta viene.
-- =============================================================
CREATE TABLE IF NOT EXISTS trades_raw (
    id           SERIAL PRIMARY KEY,
    ticket       BIGINT        NOT NULL,
    magic_number BIGINT,
    comment      TEXT,
    symbol       TEXT          NOT NULL,
    order_type   TEXT          NOT NULL,           -- 'BUY' | 'SELL'
    volume       NUMERIC       NOT NULL,
    open_price   NUMERIC       NOT NULL,
    close_price  NUMERIC       NOT NULL,
    stop_loss    NUMERIC,
    take_profit  NUMERIC,
    open_time    TIMESTAMP     NOT NULL,
    close_time   TIMESTAMP     NOT NULL,
    profit       NUMERIC       NOT NULL,
    commission   NUMERIC,
    swap         NUMERIC,
    received_at  TIMESTAMP     DEFAULT NOW(),
    account_id   INTEGER       NOT NULL
                 REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_raw_account_id   ON trades_raw(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_raw_magic_number ON trades_raw(magic_number);
CREATE INDEX IF NOT EXISTS idx_trades_raw_close_time   ON trades_raw(close_time);


-- =============================================================
-- TABLA 3: metrics_daily
-- Snapshot diario de métricas calculadas por magic_number.
-- Se actualiza automáticamente cada vez que llega un trade nuevo
-- (via scheduler.py → on_new_trade).
-- =============================================================
CREATE TABLE IF NOT EXISTS metrics_daily (
    id                  SERIAL PRIMARY KEY,
    magic_number        BIGINT        NOT NULL,
    snapshot_date       DATE          NOT NULL,

    -- Actividad del día
    trades_today        INTEGER       DEFAULT 0,
    profit_today        NUMERIC       DEFAULT 0,

    -- Totales acumulados
    total_trades        INTEGER,
    winning_trades      INTEGER,
    losing_trades       INTEGER,

    -- Ratios principales
    win_rate_pct        NUMERIC,
    profit_factor       NUMERIC,
    total_net_profit    NUMERIC,
    gross_profit        NUMERIC,
    gross_loss          NUMERIC,

    -- Promedios
    avg_win             NUMERIC,
    avg_loss            NUMERIC,
    avg_trade           NUMERIC,
    best_trade          NUMERIC,
    worst_trade         NUMERIC,
    payoff_ratio        NUMERIC,

    -- Drawdown y riesgo
    max_drawdown_usd    NUMERIC,
    max_drawdown_pct    NUMERIC,
    recovery_factor     NUMERIC,

    -- Ratios avanzados
    sharpe_ratio        NUMERIC,
    sortino_ratio       NUMERIC,
    calmar_ratio        NUMERIC,
    expectancy          NUMERIC,

    -- Balance
    initial_balance     NUMERIC       DEFAULT 10000,
    final_balance       NUMERIC,
    return_pct          NUMERIC,

    created_at          TIMESTAMP     DEFAULT NOW(),
    account_id          INTEGER
                        REFERENCES accounts(id) ON DELETE SET NULL,

    CONSTRAINT metrics_daily_magic_number_snapshot_date_key
        UNIQUE (magic_number, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_magic    ON metrics_daily(magic_number);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_date     ON metrics_daily(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_account  ON metrics_daily(account_id);


-- =============================================================
-- TABLA 4: equity_curve
-- Puntos de la curva de equity por magic_number.
-- Cada trade cerrado agrega un punto con el equity acumulado.
-- =============================================================
CREATE TABLE IF NOT EXISTS equity_curve (
    id           SERIAL PRIMARY KEY,
    magic_number BIGINT        NOT NULL,
    trade_ticket BIGINT,
    trade_time   TIMESTAMP     NOT NULL,
    equity       NUMERIC       NOT NULL,
    trade_profit NUMERIC,
    created_at   TIMESTAMP     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equity_curve_magic ON equity_curve(magic_number);
CREATE INDEX IF NOT EXISTS idx_equity_curve_time  ON equity_curve(trade_time);


-- =============================================================
-- TABLA 5: metrics_by_symbol
-- Métricas desglosadas por símbolo (EURUSD, XAUUSD, etc.)
-- dentro de cada magic_number. Snapshot diario.
-- =============================================================
CREATE TABLE IF NOT EXISTS metrics_by_symbol (
    id              SERIAL PRIMARY KEY,
    magic_number    BIGINT        NOT NULL,
    symbol          TEXT          NOT NULL,
    snapshot_date   DATE          NOT NULL,

    total_trades    INTEGER,
    net_profit      NUMERIC,
    win_rate_pct    NUMERIC,
    profit_factor   NUMERIC,
    expectancy      NUMERIC,
    max_drawdown_pct NUMERIC,

    created_at      TIMESTAMP     DEFAULT NOW(),

    CONSTRAINT metrics_by_symbol_magic_number_symbol_snapshot_date_key
        UNIQUE (magic_number, symbol, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_by_symbol_magic  ON metrics_by_symbol(magic_number);
CREATE INDEX IF NOT EXISTS idx_metrics_by_symbol_symbol ON metrics_by_symbol(symbol);


-- =============================================================
-- CUENTA DEFAULT
-- Asocia los trades históricos que llegaron antes de que
-- existiera el sistema multicuenta. No borrar.
-- =============================================================
INSERT INTO accounts (name, broker, type, platform, phase, initial_balance, api_key)
VALUES ('Cuenta Default', 'Manual', 'Personal', 'MT5', NULL, 0,
        'default-legacy-key-00000000000000000000')
ON CONFLICT (api_key) DO NOTHING;


-- =============================================================
-- FIN
-- Verifica con:
--   \dt                          → lista las 5 tablas
--   SELECT * FROM accounts;      → debe mostrar la Cuenta Default
-- =============================================================
