"""
MOTOR DE MÉTRICAS - calculator.py
===================================
Corazón del sistema. Toma un DataFrame de trades y calcula
todas las métricas de rendimiento.

Concepto clave: todas las funciones reciben un DataFrame
y devuelven un diccionario de métricas. Simple y testeable.
"""

import pandas as pd
import numpy as np
from typing import Optional


# ─────────────────────────────────────────────
# UTILIDADES INTERNAS
# ─────────────────────────────────────────────

def _net_profit(row: pd.Series) -> float:
    """Profit neto = profit + comisión + swap (ya vienen negativos si aplica)."""
    return float(row["profit"] + row["commission"] + row["swap"])


def _prepare_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Limpia y enriquece el DataFrame crudo antes de calcular métricas.
    Añade columnas calculadas que usan varias métricas.
    """
    df = df.copy()

    # Asegurar tipos de fecha
    df["open_time"]  = pd.to_datetime(df["open_time"])
    df["close_time"] = pd.to_datetime(df["close_time"])

    # Profit neto por trade (lo que realmente entra al bolsillo)
    df["net_profit"] = df["profit"] + df["commission"] + df["swap"]

    # Clasificar trade como ganador o perdedor
    df["is_win"] = df["net_profit"] > 0

    # Duración del trade en minutos
    df["duration_min"] = (df["close_time"] - df["open_time"]).dt.total_seconds() / 60

    # Columnas de tiempo útiles
    df["weekday"]  = df["close_time"].dt.day_name()      # 'Monday', 'Tuesday'...
    df["hour"]     = df["close_time"].dt.hour             # 0-23
    df["month"]    = df["close_time"].dt.to_period("M")  # 2024-01, 2024-02...

    # Equity acumulada (suma corrida del net_profit)
    df = df.sort_values("close_time").reset_index(drop=True)
    df["equity_curve"] = df["net_profit"].cumsum()

    return df


# ─────────────────────────────────────────────
# MÉTRICAS BÁSICAS
# ─────────────────────────────────────────────

def basic_metrics(df: pd.DataFrame) -> dict:
    """
    Calcula las métricas fundamentales de cualquier sistema de trading.

    Args:
        df: DataFrame ya preparado por _prepare_df()

    Returns:
        Diccionario con todas las métricas básicas
    """
    wins   = df[df["is_win"]]
    losses = df[~df["is_win"]]

    total_trades   = len(df)
    winning_trades = len(wins)
    losing_trades  = len(losses)

    # Win Rate: ¿qué % de trades terminan en ganancia?
    win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0

    # Profit Factor: ganancia bruta / pérdida bruta
    # >1 = sistema rentable, >2 = excelente
    gross_profit = wins["net_profit"].sum() if len(wins) > 0 else 0
    gross_loss   = abs(losses["net_profit"].sum()) if len(losses) > 0 else 0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")

    # Promedios
    avg_win  = wins["net_profit"].mean()   if len(wins)   > 0 else 0
    avg_loss = losses["net_profit"].mean() if len(losses) > 0 else 0
    avg_trade = df["net_profit"].mean()    if total_trades > 0 else 0

    # Extremos
    best_trade  = df["net_profit"].max() if total_trades > 0 else 0
    worst_trade = df["net_profit"].min() if total_trades > 0 else 0

    # Totales
    total_net_profit  = df["net_profit"].sum()
    total_commissions = df["commission"].sum()
    total_swaps       = df["swap"].sum()

    # Duración promedio del trade (en minutos)
    avg_duration_min = df["duration_min"].mean() if total_trades > 0 else 0

    # Ratio Ganancia/Pérdida promedio (Risk:Reward real)
    payoff_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else float("inf")

    return {
        "total_trades":      total_trades,
        "winning_trades":    winning_trades,
        "losing_trades":     losing_trades,
        "win_rate_pct":      round(win_rate, 2),
        "profit_factor":     round(profit_factor, 4),
        "total_net_profit":  round(total_net_profit, 2),
        "gross_profit":      round(gross_profit, 2),
        "gross_loss":        round(gross_loss, 2),
        "avg_win":           round(avg_win, 2),
        "avg_loss":          round(avg_loss, 2),
        "avg_trade":         round(avg_trade, 2),
        "best_trade":        round(best_trade, 2),
        "worst_trade":       round(worst_trade, 2),
        "payoff_ratio":      round(payoff_ratio, 4),
        "total_commissions": round(total_commissions, 2),
        "total_swaps":       round(total_swaps, 2),
        "avg_duration_min":  round(avg_duration_min, 2),
    }


# ─────────────────────────────────────────────
# DRAWDOWN
# ─────────────────────────────────────────────

def drawdown_metrics(df: pd.DataFrame, initial_balance: float = 10_000.0) -> dict:
    """
    Calcula el Drawdown Máximo: la mayor caída desde un pico hasta un valle.
    Es la métrica de riesgo más importante en trading.

    Args:
        df: DataFrame preparado
        initial_balance: Capital inicial (para calcular % de drawdown)

    Returns:
        max_drawdown_usd: caída máxima en dólares
        max_drawdown_pct: caída máxima en porcentaje
        recovery_factor: cuántas veces el profit cubre el drawdown
    """
    if df.empty:
        return {"max_drawdown_usd": 0, "max_drawdown_pct": 0, "recovery_factor": 0}

    equity = df["equity_curve"] + initial_balance

    # Rolling maximum: en cada punto, ¿cuál fue el máximo histórico?
    rolling_max = equity.cummax()

    # Drawdown en cada punto = diferencia entre pico histórico y valor actual
    drawdown_series = equity - rolling_max

    max_drawdown_usd = abs(drawdown_series.min())
    max_drawdown_pct = (max_drawdown_usd / rolling_max[drawdown_series.idxmin()]) * 100

    total_profit = df["net_profit"].sum()
    recovery_factor = (total_profit / max_drawdown_usd) if max_drawdown_usd > 0 else float("inf")

    return {
        "max_drawdown_usd":   round(max_drawdown_usd, 2),
        "max_drawdown_pct":   round(max_drawdown_pct, 2),
        "recovery_factor":    round(recovery_factor, 4),
        "initial_balance":    initial_balance,
        "final_balance":      round(equity.iloc[-1], 2) if len(equity) > 0 else initial_balance,
        "return_pct":         round(((equity.iloc[-1] - initial_balance) / initial_balance * 100), 2) if len(equity) > 0 else 0,
    }


# ─────────────────────────────────────────────
# SHARPE RATIO
# ─────────────────────────────────────────────

def sharpe_ratio(df: pd.DataFrame, risk_free_rate: float = 0.0) -> dict:
    """
    Ratio de Sharpe: mide el rendimiento ajustado al riesgo.
    Sharpe > 1 = bueno, > 2 = muy bueno, > 3 = excelente.

    Fórmula: (Retorno promedio - Tasa libre de riesgo) / Desviación estándar

    Args:
        df: DataFrame preparado
        risk_free_rate: tasa libre de riesgo diaria (default 0 para simplificar)
    """
    if len(df) < 2:
        return {"sharpe_ratio": 0, "sortino_ratio": 0}

    returns = df["net_profit"].values
    mean_return = np.mean(returns)
    std_return  = np.std(returns, ddof=1)

    sharpe = ((mean_return - risk_free_rate) / std_return) if std_return > 0 else 0

    # Sortino: como Sharpe pero solo penaliza la volatilidad negativa
    # Es más justo porque las ganancias grandes no deberían penalizar
    downside_returns = returns[returns < 0]
    downside_std = np.std(downside_returns, ddof=1) if len(downside_returns) > 1 else 0
    sortino = ((mean_return - risk_free_rate) / downside_std) if downside_std > 0 else 0

    # Calmar Ratio: retorno anualizado / max drawdown (se calcula en metrics_summary)
    return {
        "sharpe_ratio":  round(sharpe, 4),
        "sortino_ratio": round(sortino, 4),
    }


# ─────────────────────────────────────────────
# EXPECTANCY Y MÉTRICAS AVANZADAS
# ─────────────────────────────────────────────

def advanced_metrics(df: pd.DataFrame) -> dict:
    """
    Métricas avanzadas que combinan probabilidad y magnitud.

    Expectancy = (Win Rate × Avg Win) + (Loss Rate × Avg Loss)
    → Si es positiva, el sistema es rentable en el largo plazo.
    → Te dice cuánto esperas ganar/perder por cada trade.
    """
    if df.empty:
        return {}

    wins   = df[df["is_win"]]
    losses = df[~df["is_win"]]

    total  = len(df)
    win_rate  = len(wins) / total if total > 0 else 0
    loss_rate = len(losses) / total if total > 0 else 0

    avg_win  = wins["net_profit"].mean()   if len(wins)   > 0 else 0
    avg_loss = losses["net_profit"].mean() if len(losses) > 0 else 0

    # Expectancy por trade
    expectancy = (win_rate * avg_win) + (loss_rate * avg_loss)

    # Expectancy por dólar arriesgado (más útil si los trades varían de tamaño)
    avg_risk = abs(avg_loss) if avg_loss != 0 else 1
    expectancy_per_dollar = expectancy / avg_risk if avg_risk > 0 else 0

    # ── Rachas consecutivas ──────────────────────────
    results = df["is_win"].values  # Array de True/False

    max_win_streak  = 0
    max_loss_streak = 0
    cur_win  = 0
    cur_loss = 0

    for is_win in results:
        if is_win:
            cur_win += 1
            cur_loss = 0
        else:
            cur_loss += 1
            cur_win  = 0
        max_win_streak  = max(max_win_streak, cur_win)
        max_loss_streak = max(max_loss_streak, cur_loss)

    # Racha actual (al final del período)
    current_streak      = 0
    current_streak_type = None
    if len(results) > 0:
        current_streak_type = "win" if results[-1] else "loss"
        for result in reversed(results):
            if result == results[-1]:
                current_streak += 1
            else:
                break

    # Coeficiente de variación (consistencia del sistema)
    # Bajo CV = sistema consistente, alto CV = sistema errático
    profit_std  = df["net_profit"].std()
    profit_mean = df["net_profit"].mean()
    cv = abs(profit_std / profit_mean) if profit_mean != 0 else float("inf")

    return {
        "expectancy":               round(expectancy, 4),
        "expectancy_per_dollar":    round(expectancy_per_dollar, 4),
        "max_consecutive_wins":     max_win_streak,
        "max_consecutive_losses":   max_loss_streak,
        "current_streak":           current_streak,
        "current_streak_type":      current_streak_type,
        "profit_std_dev":           round(profit_std, 4),
        "coefficient_of_variation": round(cv, 4),
    }


# ─────────────────────────────────────────────
# MÉTRICAS TEMPORALES
# ─────────────────────────────────────────────

def time_metrics(df: pd.DataFrame) -> dict:
    """
    Analiza rendimiento según el tiempo: hora, día de semana, mes.
    Útil para descubrir patrones (ej: "los lunes pierdo", "las 14h son mejores").
    """
    if df.empty:
        return {}

    # Por hora del día (0-23)
    hourly = (
        df.groupby("hour")["net_profit"]
        .agg(trades="count", profit="sum", avg="mean")
        .round(2)
        .to_dict(orient="index")
    )

    # Por día de la semana
    weekday_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weekly = (
        df.groupby("weekday")["net_profit"]
        .agg(trades="count", profit="sum", avg="mean")
        .reindex([d for d in weekday_order if d in df["weekday"].unique()])
        .round(2)
        .to_dict(orient="index")
    )

    # Por mes
    monthly = (
        df.groupby(df["close_time"].dt.to_period("M").astype(str))["net_profit"]
        .agg(trades="count", profit="sum", avg="mean")
        .round(2)
        .to_dict(orient="index")
    )

    # Mejor y peor hora/día/mes
    hourly_df  = df.groupby("hour")["net_profit"].sum()
    weekday_df = df.groupby("weekday")["net_profit"].sum()
    monthly_df = df.groupby(df["close_time"].dt.to_period("M").astype(str))["net_profit"].sum()

    return {
        "by_hour":          hourly,
        "by_weekday":       weekly,
        "by_month":         monthly,
        "best_hour":        int(hourly_df.idxmax()) if len(hourly_df) > 0 else None,
        "worst_hour":       int(hourly_df.idxmin()) if len(hourly_df) > 0 else None,
        "best_weekday":     weekday_df.idxmax() if len(weekday_df) > 0 else None,
        "worst_weekday":    weekday_df.idxmin() if len(weekday_df) > 0 else None,
        "best_month":       monthly_df.idxmax() if len(monthly_df) > 0 else None,
        "worst_month":      monthly_df.idxmin() if len(monthly_df) > 0 else None,
    }


# ─────────────────────────────────────────────
# CURVA DE EQUITY
# ─────────────────────────────────────────────

def equity_curve(df: pd.DataFrame, initial_balance: float = 10_000.0) -> list[dict]:
    """
    Genera la curva de equity: lista de puntos {fecha, balance}.
    Lista para graficar en el frontend con Chart.js o Recharts.

    Returns:
        Lista de dicts: [{"time": "2024-01-15T10:30:00", "equity": 10250.50}, ...]
    """
    if df.empty:
        return []

    curve = df[["close_time", "equity_curve"]].copy()
    curve["equity"] = curve["equity_curve"] + initial_balance
    curve["time"]   = curve["close_time"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    return curve[["time", "equity"]].round(2).to_dict(orient="records")


# ─────────────────────────────────────────────
# FUNCIÓN PRINCIPAL: TODAS LAS MÉTRICAS JUNTAS
# ─────────────────────────────────────────────

def compute_all_metrics(
    raw_df: pd.DataFrame,
    initial_balance: float = 10_000.0
) -> dict:
    """
    Orquesta el cálculo de TODAS las métricas para un DataFrame de trades.

    Args:
        raw_df: DataFrame crudo de trades_raw
        initial_balance: Capital inicial del EA

    Returns:
        Diccionario completo con todas las secciones de métricas
    """
    if raw_df.empty:
        return {"error": "No hay trades para calcular métricas"}

    # 1. Preparar DataFrame (añadir columnas calculadas)
    df = _prepare_df(raw_df)

    # 2. Calcular todas las métricas
    basic    = basic_metrics(df)
    dd       = drawdown_metrics(df, initial_balance)
    sharpe   = sharpe_ratio(df)
    advanced = advanced_metrics(df)
    time     = time_metrics(df)

    # 3. Calmar Ratio = retorno total / max drawdown (penaliza el riesgo)
    total_return = dd["return_pct"]
    max_dd       = dd["max_drawdown_pct"]
    calmar = (total_return / max_dd) if max_dd > 0 else float("inf")

    return {
        "summary": {
            **basic,
            **dd,
            **sharpe,
            "calmar_ratio": round(calmar, 4),
        },
        "advanced":    advanced,
        "time_analysis": time,
        "equity_curve": equity_curve(df, initial_balance),
        "trade_count":  len(df),
        "date_range": {
            "from": df["open_time"].min().isoformat() if len(df) > 0 else None,
            "to":   df["close_time"].max().isoformat() if len(df) > 0 else None,
        }
    }
