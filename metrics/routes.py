"""
ENDPOINTS DE MÉTRICAS - routes.py
=====================================
Router de FastAPI que expone las métricas al frontend.

Incluir en tu main.py con:
    from metrics.routes import router as metrics_router
    app.include_router(metrics_router, prefix="/metrics", tags=["metrics"])
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import datetime

from .db import load_trades, load_trades_grouped_by_ea, get_available_eas, get_available_symbols
from .calculator import compute_all_metrics, equity_curve, _prepare_df

router = APIRouter()


# ─────────────────────────────────────────────
# GET /metrics/summary
# ─────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    date_from: Optional[datetime] = Query(None, description="Desde fecha (ISO 8601)"),
    date_to:   Optional[datetime] = Query(None, description="Hasta fecha"),
):
    """
    Resumen de TODOS los EAs activos.
    Devuelve métricas básicas de cada magic_number.

    Ejemplo: GET /metrics/summary
    """
    grouped = load_trades_grouped_by_ea(date_from=date_from, date_to=date_to)

    if not grouped:
        return {"eas": [], "message": "No hay trades en el rango especificado"}

    summary = []
    for magic, df in grouped.items():
        metrics = compute_all_metrics(df)
        comments = df["comment"].dropna()
        ea_name = comments.iloc[0] if len(comments) > 0 else None
        summary.append({
            "magic_number":    magic,
            "comment":         ea_name,
            "total_trades":    metrics["trade_count"],
            "net_profit":      metrics["summary"]["total_net_profit"],
            "win_rate":        metrics["summary"]["win_rate_pct"],
            "profit_factor":   metrics["summary"]["profit_factor"],
            "max_drawdown_pct": metrics["summary"]["max_drawdown_pct"],
            "sharpe_ratio":    metrics["summary"]["sharpe_ratio"],
            "date_range":      metrics["date_range"],
        })

    return {"eas": summary, "total_eas": len(summary)}


# ─────────────────────────────────────────────
# GET /metrics/{magic_number}
# ─────────────────────────────────────────────

@router.get("/{magic_number}")
async def get_ea_metrics(
    magic_number: int,
    symbol:     Optional[str]      = Query(None, description="Filtrar por símbolo (EURUSD)"),
    date_from:  Optional[datetime] = Query(None),
    date_to:    Optional[datetime] = Query(None),
    initial_balance: float         = Query(10_000.0, description="Capital inicial del EA"),
):
    """
    Todas las métricas de un EA específico.

    Ejemplo: GET /metrics/12345?symbol=EURUSD&initial_balance=5000
    """
    df = load_trades(
        magic_number=magic_number,
        symbol=symbol,
        date_from=date_from,
        date_to=date_to,
    )

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontraron trades para EA {magic_number}"
        )

    metrics = compute_all_metrics(df, initial_balance=initial_balance)
    # Nombre de la estrategia desde el comment
    comments = df["comment"].dropna()
    metrics["ea_name"] = comments.iloc[0] if len(comments) > 0 else f"EA {magic_number}"
    metrics["magic_number"] = magic_number
    metrics["symbol_filter"] = symbol

    return metrics


# ─────────────────────────────────────────────
# GET /metrics/{magic_number}/equity
# ─────────────────────────────────────────────

@router.get("/{magic_number}/equity")
async def get_equity_curve(
    magic_number: int,
    symbol:          Optional[str]      = Query(None),
    date_from:       Optional[datetime] = Query(None),
    date_to:         Optional[datetime] = Query(None),
    initial_balance: float              = Query(10_000.0),
):
    """
    Solo la curva de equity (optimizado para gráficos).
    Devuelve lista de {time, equity} lista para Chart.js/Recharts.

    Ejemplo: GET /metrics/12345/equity?initial_balance=5000
    """
    df = load_trades(magic_number=magic_number, symbol=symbol, date_from=date_from, date_to=date_to)

    if df.empty:
        raise HTTPException(status_code=404, detail=f"No hay trades para EA {magic_number}")

    from .calculator import _prepare_df, equity_curve as build_equity_curve
    prepared = _prepare_df(df)
    curve = build_equity_curve(prepared, initial_balance)

    return {
        "magic_number":    magic_number,
        "initial_balance": initial_balance,
        "final_balance":   curve[-1]["equity"] if curve else initial_balance,
        "data_points":     len(curve),
        "equity_curve":    curve,
    }


# ─────────────────────────────────────────────
# GET /metrics/{magic_number}/by-symbol
# ─────────────────────────────────────────────

@router.get("/{magic_number}/by-symbol")
async def get_metrics_by_symbol(
    magic_number:    int,
    date_from:       Optional[datetime] = Query(None),
    date_to:         Optional[datetime] = Query(None),
    initial_balance: float              = Query(10_000.0),
):
    """
    Métricas desglosadas por símbolo para un EA.

    Ejemplo: GET /metrics/12345/by-symbol
    Devuelve: {EURUSD: {metrics...}, GBPUSD: {metrics...}}
    """
    symbols = get_available_symbols(magic_number)

    if not symbols:
        raise HTTPException(status_code=404, detail=f"No hay trades para EA {magic_number}")

    result = {}
    for symbol in symbols:
        df = load_trades(magic_number=magic_number, symbol=symbol, date_from=date_from, date_to=date_to)
        if not df.empty:
            m = compute_all_metrics(df, initial_balance)
            result[symbol] = {
                "total_trades":    m["trade_count"],
                "net_profit":      m["summary"]["total_net_profit"],
                "win_rate":        m["summary"]["win_rate_pct"],
                "profit_factor":   m["summary"]["profit_factor"],
                "max_drawdown_pct": m["summary"]["max_drawdown_pct"],
                "expectancy":      m["advanced"].get("expectancy", 0),
            }

    return {"magic_number": magic_number, "by_symbol": result}


# ─────────────────────────────────────────────
# GET /metrics/{magic_number}/time-analysis
# ─────────────────────────────────────────────

@router.get("/{magic_number}/time-analysis")
async def get_time_analysis(
    magic_number: int,
    date_from: Optional[datetime] = Query(None),
    date_to:   Optional[datetime] = Query(None),
):
    """
    Análisis temporal: rendimiento por hora, día, mes.
    Ideal para heatmaps en el frontend.
    """
    df = load_trades(magic_number=magic_number, date_from=date_from, date_to=date_to)

    if df.empty:
        raise HTTPException(status_code=404, detail=f"No hay trades para EA {magic_number}")

    metrics = compute_all_metrics(df)
    return {
        "magic_number":  magic_number,
        "time_analysis": metrics["time_analysis"],
    }
