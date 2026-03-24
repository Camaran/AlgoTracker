from fastapi import FastAPI, HTTPException, BackgroundTasks   # ← BackgroundTasks agregado
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional
import psycopg2
import psycopg2.extras
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
# MODELO DE DATOS (Pydantic)
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

    stop_loss:    Optional[float]   = None
    take_profit:  Optional[float]   = None
    commission:   Optional[float]   = None
    swap:         Optional[float]   = None
    magic_number: Optional[int]     = None
    comment:      Optional[str]     = None

    @validator("comment", pre=True, always=True)
    def empty_string_to_none(cls, v):
        return None if (v == "" or v is None) else v

    @validator("order_type", pre=True)
    def uppercase_order_type(cls, v):
        return v.upper()


# ─────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────
app = FastAPI(
    title="AlgoTracker API",
    description="Recibe trades desde MT5 y los guarda en PostgreSQL",
    version="0.2.0"
)

# CORS: permite que React en localhost:3000 llame al backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(metrics_router, prefix="/metrics", tags=["metrics"])


# ─────────────────────────────────────────────
# ENDPOINT PRINCIPAL
# ─────────────────────────────────────────────
@app.post("/trade", status_code=201)
def receive_trade(trade: TradeIn, background_tasks: BackgroundTasks):
    """Recibe un trade cerrado desde MT5 y lo persiste en trades_raw."""
    logger.info(f"Trade recibido | ticket={trade.ticket} | symbol={trade.symbol} | profit={trade.profit}")

    conn   = None   # ← inicializar aquí para que finally no falle si get_conn() lanza
    cursor = None   # ← ídem

    try:
        conn   = get_conn()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO trades_raw (
                ticket, magic_number, comment,
                symbol, order_type, volume,
                open_price, close_price, stop_loss, take_profit,
                open_time, close_time,
                profit, commission, swap
            ) VALUES (
                %(ticket)s, %(magic_number)s, %(comment)s,
                %(symbol)s, %(order_type)s, %(volume)s,
                %(open_price)s, %(close_price)s, %(stop_loss)s, %(take_profit)s,
                %(open_time)s, %(close_time)s,
                %(profit)s, %(commission)s, %(swap)s
            )
            RETURNING id;
        """, trade.dict())

        new_id = cursor.fetchone()[0]
        conn.commit()

        logger.info(f"Trade guardado correctamente | id={new_id} | ticket={trade.ticket}")

        if trade.magic_number:
            background_tasks.add_task(on_new_trade, trade.magic_number)

        return {
            "status": "ok",
            "id": new_id,
            "ticket": trade.ticket
        }

    except psycopg2.Error as e:
        logger.error(f"Error de base de datos | ticket={trade.ticket} | error={e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    except Exception as e:
        logger.error(f"Error inesperado | {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")

    finally:
        if cursor: cursor.close()
        if conn:   conn.close()


# ─────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────
@app.get("/health")
def health_check():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "ok", "database": "connected"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database unreachable")
