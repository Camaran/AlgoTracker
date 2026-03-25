from fastapi import FastAPI, HTTPException, BackgroundTasks, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional
import psycopg2
import psycopg2.extras
import secrets
import logging
import traceback

# Motor de métricas
from metrics.routes import router as metrics_router
from metrics.scheduler import on_new_trade

# ─────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# CONFIGURACIÓN DE BASE DE DATOS
# ─────────────────────────────────────────────
DB_CONFIG = {
    "dbname":   "algotracker_db",
    "user":     "algotracker_user",
    "password": "Aa1073162355",
    "host":     "localhost",
    "port":     "5432"
}

def get_conn():
    return psycopg2.connect(**DB_CONFIG)


# ─────────────────────────────────────────────
# MODELOS Pydantic
# ─────────────────────────────────────────────
class TradeIn(BaseModel):
    ticket:      int
    symbol:      str
    order_type:  str        = Field(..., pattern="^(BUY|SELL)$")
    volume:      float
    open_price:  float
    close_price: float
    open_time:   datetime
    close_time:  datetime
    profit:      float

    stop_loss:    Optional[float] = None
    take_profit:  Optional[float] = None
    commission:   Optional[float] = None
    swap:         Optional[float] = None
    magic_number: Optional[int]   = None
    comment:      Optional[str]   = None

    @validator("comment", pre=True, always=True)
    def empty_string_to_none(cls, v):
        return None if (v == "" or v is None) else v

    @validator("order_type", pre=True)
    def uppercase_order_type(cls, v):
        return v.upper()


class AccountIn(BaseModel):
    name:            str
    broker:          Optional[str]   = None
    type:            Optional[str]   = Field(None, pattern="^(Propfirm|Broker|Personal)$")
    platform:        Optional[str]   = "MT5"
    phase:           Optional[str]   = None
    initial_balance: Optional[float] = 0.0


# ─────────────────────────────────────────────
# DEPENDENCY: resolver account_id desde X-API-Key
# ─────────────────────────────────────────────
def get_account_id(x_api_key: str = Header(..., alias="X-API-Key")) -> int:
    """
    Busca la cuenta asociada al header X-API-Key.
    Lanza 401 si la clave no existe o la cuenta está inactiva.
    """
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM accounts WHERE api_key = %s AND is_active = TRUE",
            (x_api_key,)
        )
        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=401, detail="API Key inválida o cuenta inactiva")

        return row[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validando API Key: {e}")
        raise HTTPException(status_code=500, detail="Error interno al validar API Key")


# ─────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────
app = FastAPI(
    title="AlgoTracker API",
    description="Recibe trades desde MT5 y los guarda en PostgreSQL — Multicuenta",
    version="0.3.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(metrics_router, prefix="/metrics", tags=["metrics"])


# ─────────────────────────────────────────────
# ACCOUNTS — CRUD
# ─────────────────────────────────────────────

@app.post("/accounts", status_code=201, tags=["accounts"])
def create_account(account: AccountIn):
    """Crea una nueva cuenta MT5 y devuelve su API Key generada."""
    api_key = secrets.token_hex(32)   # 64 caracteres hex, criptográficamente seguro

    conn   = None
    cursor = None
    try:
        conn   = get_conn()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cursor.execute("""
            INSERT INTO accounts (name, broker, type, platform, phase, initial_balance, api_key)
            VALUES (%(name)s, %(broker)s, %(type)s, %(platform)s, %(phase)s, %(initial_balance)s, %(api_key)s)
            RETURNING id, name, broker, type, platform, phase, initial_balance, api_key, created_at;
        """, {**account.dict(), "api_key": api_key})

        new_account = dict(cursor.fetchone())
        conn.commit()

        logger.info(f"Cuenta creada | id={new_account['id']} | name={new_account['name']}")
        return new_account

    except psycopg2.Error as e:
        logger.error(f"DB error al crear cuenta: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


@app.get("/accounts", tags=["accounts"])
def list_accounts():
    """Lista todas las cuentas activas con sus métricas básicas."""
    conn   = None
    cursor = None
    try:
        conn   = get_conn()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cursor.execute("""
            SELECT
                a.id,
                a.name,
                a.broker,
                a.type,
                a.platform,
                a.phase,
                a.initial_balance,
                a.created_at,
                -- métricas agregadas en vivo
                COUNT(t.id)                             AS total_trades,
                COALESCE(SUM(t.profit), 0)              AS total_profit,
                COALESCE(SUM(t.profit + COALESCE(t.commission,0) + COALESCE(t.swap,0)), 0) AS net_profit,
                ROUND(
                    CASE WHEN COUNT(t.id) > 0
                         THEN COUNT(t.id) FILTER (WHERE t.profit > 0)::NUMERIC / COUNT(t.id) * 100
                         ELSE 0
                    END, 2
                )                                       AS winrate,
                ROUND(
                    CASE WHEN SUM(CASE WHEN t.profit < 0 THEN ABS(t.profit) ELSE 0 END) > 0
                         THEN SUM(CASE WHEN t.profit > 0 THEN t.profit ELSE 0 END) /
                              SUM(CASE WHEN t.profit < 0 THEN ABS(t.profit) ELSE 0 END)
                         ELSE NULL
                    END, 2
                )                                       AS profit_factor
            FROM   accounts a
            LEFT JOIN trades_raw t ON t.account_id = a.id
            WHERE  a.is_active = TRUE
            GROUP  BY a.id
            ORDER  BY a.created_at ASC;
        """)

        rows = [dict(r) for r in cursor.fetchall()]
        return rows

    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


@app.get("/accounts/{account_id}", tags=["accounts"])
def get_account(account_id: int):
    """Detalle de una cuenta con sus EAs/magic numbers."""
    conn   = None
    cursor = None
    try:
        conn   = get_conn()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Cuenta base
        cursor.execute(
            "SELECT id, name, broker, type, platform, phase, initial_balance, created_at "
            "FROM accounts WHERE id = %s AND is_active = TRUE",
            (account_id,)
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Cuenta no encontrada")

        account = dict(row)

        # EAs dentro de esta cuenta
        cursor.execute("""
            SELECT
                magic_number,
                COUNT(*)                             AS total_trades,
                COALESCE(SUM(profit), 0)             AS total_profit,
                ROUND(
                    CASE WHEN COUNT(*) > 0
                         THEN COUNT(*) FILTER (WHERE profit > 0)::NUMERIC / COUNT(*) * 100
                         ELSE 0
                    END, 2
                )                                    AS winrate
            FROM  trades_raw
            WHERE account_id = %s
            GROUP BY magic_number
            ORDER BY total_profit DESC;
        """, (account_id,))

        account["strategies"] = [dict(r) for r in cursor.fetchall()]
        return account

    except HTTPException:
        raise
    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


@app.delete("/accounts/{account_id}", tags=["accounts"])
def deactivate_account(account_id: int):
    """Desactiva (soft-delete) una cuenta."""
    conn = None
    cursor = None
    try:
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE accounts SET is_active = FALSE WHERE id = %s RETURNING id",
            (account_id,)
        )
        if cursor.fetchone() is None:
            raise HTTPException(status_code=404, detail="Cuenta no encontrada")
        conn.commit()
        return {"status": "ok", "message": f"Cuenta {account_id} desactivada"}
    except HTTPException:
        raise
    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


# ─────────────────────────────────────────────
# TRADE — ahora con autenticación por API Key
# ─────────────────────────────────────────────
@app.post("/trade", status_code=201, tags=["trades"])
def receive_trade(
    trade: TradeIn,
    background_tasks: BackgroundTasks,
    account_id: int = Depends(get_account_id)   # ← resuelto desde X-API-Key
):
    """Recibe un trade cerrado desde MT5 y lo persiste en trades_raw."""
    logger.info(
        f"Trade recibido | account_id={account_id} | ticket={trade.ticket} "
        f"| symbol={trade.symbol} | profit={trade.profit}"
    )

    conn   = None
    cursor = None
    try:
        conn   = get_conn()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO trades_raw (
                account_id,
                ticket, magic_number, comment,
                symbol, order_type, volume,
                open_price, close_price, stop_loss, take_profit,
                open_time, close_time,
                profit, commission, swap
            ) VALUES (
                %(account_id)s,
                %(ticket)s, %(magic_number)s, %(comment)s,
                %(symbol)s, %(order_type)s, %(volume)s,
                %(open_price)s, %(close_price)s, %(stop_loss)s, %(take_profit)s,
                %(open_time)s, %(close_time)s,
                %(profit)s, %(commission)s, %(swap)s
            )
            ON CONFLICT DO NOTHING
            RETURNING id;
        """, {**trade.dict(), "account_id": account_id})

        result = cursor.fetchone()
        conn.commit()

        if result is None:
            # El trade ya existía (ticket duplicado para esta cuenta)
            logger.info(f"Trade duplicado ignorado | ticket={trade.ticket} | account_id={account_id}")
            return {"status": "duplicate", "ticket": trade.ticket}

        new_id = result[0]
        logger.info(f"Trade guardado | id={new_id} | ticket={trade.ticket} | account_id={account_id}")

        if trade.magic_number:
            background_tasks.add_task(on_new_trade, trade.magic_number)

        return {"status": "ok", "id": new_id, "ticket": trade.ticket}

    except psycopg2.Error as e:
        logger.error(f"DB error | ticket={trade.ticket} | {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    except Exception as e:
        logger.error(f"Error inesperado | {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")
    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


# ─────────────────────────────────────────────
# EQUITY — curva por cuenta
# ─────────────────────────────────────────────
@app.get("/accounts/{account_id}/equity", tags=["accounts"])
def get_equity_curve(account_id: int):
    """Curva de equity acumulada de todos los trades de una cuenta."""
    conn = None
    cursor = None
    try:
        conn   = get_conn()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cursor.execute("""
            SELECT
                close_time                                   AS date,
                profit,
                SUM(profit) OVER (ORDER BY close_time)       AS cumulative_profit
            FROM   trades_raw
            WHERE  account_id = %s
            ORDER  BY close_time ASC;
        """, (account_id,))

        return [dict(r) for r in cursor.fetchall()]

    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


# ─────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────
@app.get("/health", tags=["system"])
def health_check():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "ok", "database": "connected", "version": "0.3.0"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database unreachable")
