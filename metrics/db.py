"""
CONECTOR A BASE DE DATOS - db.py
==================================
Maneja toda la comunicación con PostgreSQL.
Usa SQLAlchemy como capa de abstracción (recomendado con pandas).

Por qué SQLAlchemy en vez de psycopg2 directo:
- pandas.read_sql() lo prefiere
- Maneja el pool de conexiones automáticamente
- Más seguro contra SQL injection
"""

import os
import pandas as pd
from sqlalchemy import create_engine, text
from typing import Optional
from datetime import datetime


def get_engine():
    """
    Crea y devuelve el engine de SQLAlchemy.

    Lee las credenciales de variables de entorno.
    NUNCA hardcodees credenciales en el código.

    Variables de entorno necesarias:
        DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

    O puedes usar DATABASE_URL directamente:
        postgresql://user:password@host:port/dbname
    """
    database_url = os.getenv("DATABASE_URL")

    if database_url:
        return create_engine(database_url)

    # Construir URL desde variables individuales
    host     = os.getenv("DB_HOST", "localhost")
    port     = os.getenv("DB_PORT", "5432")
    dbname   = os.getenv("DB_NAME", "trading_journal")
    user     = os.getenv("DB_USER", "postgres")
    password = os.getenv("DB_PASSWORD", "")

    url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"
    return create_engine(url, pool_pre_ping=True)  # pool_pre_ping verifica la conexión antes de usarla


def load_trades(
    magic_number: Optional[int] = None,
    symbol: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    only_closed: bool = True,
) -> pd.DataFrame:
    """
    Lee trades de la tabla trades_raw con filtros opcionales.

    Args:
        magic_number: Filtrar por EA específico (None = todos los EAs)
        symbol:       Filtrar por par de divisas (ej: "EURUSD")
        date_from:    Desde esta fecha (close_time)
        date_to:      Hasta esta fecha (close_time)
        only_closed:  Solo trades cerrados (con close_time definido)

    Returns:
        DataFrame con los trades filtrados

    Ejemplo de uso:
        df = load_trades(magic_number=12345, date_from=datetime(2024, 1, 1))
    """
    engine = get_engine()

    # Construir query de forma segura con parámetros
    # Los :param son placeholders que SQLAlchemy reemplaza de forma segura
    conditions = []
    params = {}

    if only_closed:
        conditions.append("close_time IS NOT NULL")
        conditions.append("close_price > 0")

    if magic_number is not None:
        conditions.append("magic_number = :magic_number")
        params["magic_number"] = magic_number

    if symbol is not None:
        conditions.append("symbol = :symbol")
        params["symbol"] = symbol.upper()

    if date_from is not None:
        conditions.append("close_time >= :date_from")
        params["date_from"] = date_from

    if date_to is not None:
        conditions.append("close_time <= :date_to")
        params["date_to"] = date_to

    where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
        SELECT
            id, ticket, magic_number, comment, symbol,
            order_type, volume, open_price, close_price,
            stop_loss, take_profit, open_time, close_time,
            profit, commission, swap, received_at
        FROM trades_raw
        {where_clause}
        ORDER BY close_time ASC
    """

    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn, params=params)

    print(f"✅ Cargados {len(df)} trades desde PostgreSQL")
    return df


def load_trades_grouped_by_ea(
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> dict[int, pd.DataFrame]:
    """
    Carga todos los trades y los agrupa por magic_number.
    Útil para calcular métricas de todos los EAs de una vez.

    Returns:
        Diccionario {magic_number: DataFrame_de_ese_EA}
    """
    df_all = load_trades(date_from=date_from, date_to=date_to)

    if df_all.empty:
        print("⚠️  No hay trades en la base de datos")
        return {}

    grouped = {}
    for magic, group_df in df_all.groupby("magic_number"):
        grouped[magic] = group_df.reset_index(drop=True)
        print(f"   EA {magic}: {len(group_df)} trades")

    return grouped


def get_available_eas() -> list[dict]:
    """
    Devuelve la lista de EAs únicos con su conteo de trades.
    Útil para el endpoint /metrics/summary
    """
    engine = get_engine()
    query = """
        SELECT
            magic_number,
            COUNT(*) as total_trades,
            MIN(close_time) as first_trade,
            MAX(close_time) as last_trade,
            SUM(profit + commission + swap) as net_profit
        FROM trades_raw
        WHERE close_time IS NOT NULL AND close_price > 0
        GROUP BY magic_number
        ORDER BY magic_number
    """
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn)
    return df.to_dict(orient="records")


def get_available_symbols(magic_number: Optional[int] = None) -> list[str]:
    """Devuelve los símbolos únicos operados por un EA (o todos)."""
    engine = get_engine()
    params = {}
    where = ""
    if magic_number is not None:
        where = "WHERE magic_number = :magic_number"
        params["magic_number"] = magic_number

    query = f"SELECT DISTINCT symbol FROM trades_raw {where} ORDER BY symbol"
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn, params=params)
    return df["symbol"].tolist()
