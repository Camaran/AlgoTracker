from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional
import psycopg2
import psycopg2.extras
import logging
import traceback

# ─────────────────────────────────────────────
# LOGGING
# Configura el sistema de logs. En vez de usar print(),
# usamos logging porque nos da timestamp, nivel de severidad,
# y en el futuro podemos redirigir a archivos fácilmente.
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# CONFIGURACIÓN DE BASE DE DATOS
# Centralizada aquí para cambiarla en un solo lugar.
# Más adelante esto vendrá de variables de entorno (.env)
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
# Esto reemplaza el `trade: dict` que teníamos antes.
# Pydantic valida automáticamente que los tipos sean correctos
# ANTES de que el dato llegue a la base de datos.
# Si falta un campo obligatorio o el tipo es incorrecto,
# FastAPI devuelve un 422 con el error exacto, no un 500.
# ─────────────────────────────────────────────
class TradeIn(BaseModel):
    # Campos obligatorios (si no vienen, FastAPI rechaza con 422)
    ticket:      int
    symbol:      str
    order_type:  str        = Field(..., pattern="^(BUY|SELL)$")  # solo acepta BUY o SELL
    volume:      float
    open_price:  float
    close_price: float
    open_time:   datetime
    close_time:  datetime
    profit:      float

    # Campos opcionales (pueden no venir desde MT5)
    stop_loss:    Optional[float]   = None
    take_profit:  Optional[float]   = None
    commission:   Optional[float]   = None
    swap:         Optional[float]   = None
    magic_number: Optional[int]     = None
    comment:      Optional[str]     = None
    
    @validator("comment", pre=True, always=True)
    def empty_string_to_none(cls, v):
        return None if (v == "" or v is None) else v

    # Validación personalizada: order_type siempre en mayúsculas
    # Por si MT5 envía "buy" en minúsculas
    @validator("order_type", pre=True)
    def uppercase_order_type(cls, v):
        return v.upper()


# ─────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────
app = FastAPI(
    title="AlgoTracker API",
    description="Recibe trades desde MT5 y los guarda en PostgreSQL",
    version="0.1.0"
)


# ─────────────────────────────────────────────
# ENDPOINT PRINCIPAL
# ─────────────────────────────────────────────
@app.post("/trade", status_code=201)  # 201 = Created (más correcto que 200 para inserts)
def receive_trade(trade: TradeIn):
    """
    Recibe un trade cerrado desde MT5 y lo persiste en trades_raw.
    """
    logger.info(f"Trade recibido | ticket={trade.ticket} | symbol={trade.symbol} | profit={trade.profit}")

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
        # RETURNING id → PostgreSQL nos devuelve el id asignado al nuevo registro

        new_id = cursor.fetchone()[0]
        conn.commit()

        logger.info(f"Trade guardado correctamente | id={new_id} | ticket={trade.ticket}")

        return {
            "status": "ok",
            "id": new_id,
            "ticket": trade.ticket
        }

    except psycopg2.Error as e:
        # Error específico de PostgreSQL
        logger.error(f"Error de base de datos | ticket={trade.ticket} | error={e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    except Exception as e:
        # Cualquier otro error inesperado
        logger.error(f"Error inesperado | {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")

    finally:
        # El bloque finally SIEMPRE se ejecuta, haya error o no.
        # Garantiza que la conexión se cierra aunque el INSERT falle.
        if cursor: cursor.close()
        if conn:   conn.close()


# ─────────────────────────────────────────────
# HEALTH CHECK
# Endpoint simple para verificar que el servidor está vivo.
# MT5 o un monitor externo puede llamarlo periódicamente.
# ─────────────────────────────────────────────
@app.get("/health")
def health_check():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "ok", "database": "connected"}
    except Exception:
        raise HTTPException(status_code=503, detail="Database unreachable")