"""
AUTOMATIZACIÓN DE MÉTRICAS - scheduler.py
==========================================
Calcula y guarda métricas automáticamente en BD.

Tres estrategias posibles (elige la que mejor se adapte):

1. TRIGGER EN FASTAPI: calcular cuando llega un trade nuevo
   → Ventaja: siempre actualizado
   → Desventaja: puede hacer lenta la recepción de trades

2. JOB PERIÓDICO CON APScheduler: cada hora o cada día
   → Ventaja: no impacta el pipeline de trades
   → Recomendado para empezar

3. TAREA EXTERNA: cron job del sistema operativo
   → Más simple, no requiere librería extra

Este archivo implementa la opción 2 (APScheduler).

Instalación: pip install apscheduler
"""

import logging
from datetime import datetime, date
from typing import Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# FUNCIÓN PRINCIPAL: CALCULAR Y GUARDAR
# ─────────────────────────────────────────────

def calculate_and_save_metrics(
    initial_balance: float = 10_000.0,
    target_date: Optional[date] = None
):
    """
    Calcula métricas de todos los EAs y las guarda en metrics_daily.
    
    Args:
        initial_balance: Capital inicial (idealmente configurable por EA)
        target_date: Fecha del snapshot (default: hoy)
    """
    from metrics.db import load_trades_grouped_by_ea, get_engine
    from metrics.calculator import compute_all_metrics
    from sqlalchemy import text

    target_date = target_date or date.today()
    engine = get_engine()

    logger.info(f"📊 Calculando métricas para {target_date}...")

    grouped = load_trades_grouped_by_ea()

    if not grouped:
        logger.warning("⚠️  No hay trades para calcular métricas")
        return

    saved_count = 0
    for magic_number, df in grouped.items():
        try:
            metrics = compute_all_metrics(df, initial_balance=initial_balance)
            s = metrics["summary"]

            # Insertar o actualizar el snapshot (ON CONFLICT UPDATE)
            upsert_sql = text("""
                INSERT INTO metrics_daily (
                    magic_number, snapshot_date, total_trades, winning_trades,
                    losing_trades, win_rate_pct, profit_factor, total_net_profit,
                    gross_profit, gross_loss, avg_win, avg_loss, avg_trade,
                    best_trade, worst_trade, payoff_ratio, max_drawdown_usd,
                    max_drawdown_pct, recovery_factor, sharpe_ratio, sortino_ratio,
                    calmar_ratio, expectancy, initial_balance, final_balance, return_pct
                ) VALUES (
                    :magic_number, :snapshot_date, :total_trades, :winning_trades,
                    :losing_trades, :win_rate_pct, :profit_factor, :total_net_profit,
                    :gross_profit, :gross_loss, :avg_win, :avg_loss, :avg_trade,
                    :best_trade, :worst_trade, :payoff_ratio, :max_drawdown_usd,
                    :max_drawdown_pct, :recovery_factor, :sharpe_ratio, :sortino_ratio,
                    :calmar_ratio, :expectancy, :initial_balance, :final_balance, :return_pct
                )
                ON CONFLICT (magic_number, snapshot_date) DO UPDATE SET
                    total_trades     = EXCLUDED.total_trades,
                    win_rate_pct     = EXCLUDED.win_rate_pct,
                    profit_factor    = EXCLUDED.profit_factor,
                    total_net_profit = EXCLUDED.total_net_profit,
                    max_drawdown_pct = EXCLUDED.max_drawdown_pct,
                    sharpe_ratio     = EXCLUDED.sharpe_ratio,
                    return_pct       = EXCLUDED.return_pct,
                    final_balance    = EXCLUDED.final_balance
            """)

            adv = metrics.get("advanced", {})

            with engine.begin() as conn:
                conn.execute(upsert_sql, {
                    "magic_number":    magic_number,
                    "snapshot_date":   target_date,
                    "total_trades":    s["total_trades"],
                    "winning_trades":  s["winning_trades"],
                    "losing_trades":   s["losing_trades"],
                    "win_rate_pct":    s["win_rate_pct"],
                    "profit_factor":   s["profit_factor"],
                    "total_net_profit": s["total_net_profit"],
                    "gross_profit":    s["gross_profit"],
                    "gross_loss":      s["gross_loss"],
                    "avg_win":         s["avg_win"],
                    "avg_loss":        s["avg_loss"],
                    "avg_trade":       s["avg_trade"],
                    "best_trade":      s["best_trade"],
                    "worst_trade":     s["worst_trade"],
                    "payoff_ratio":    s["payoff_ratio"],
                    "max_drawdown_usd": s["max_drawdown_usd"],
                    "max_drawdown_pct": s["max_drawdown_pct"],
                    "recovery_factor": s["recovery_factor"],
                    "sharpe_ratio":    s["sharpe_ratio"],
                    "sortino_ratio":   s["sortino_ratio"],
                    "calmar_ratio":    s.get("calmar_ratio", 0),
                    "expectancy":      adv.get("expectancy", 0),
                    "initial_balance": initial_balance,
                    "final_balance":   s.get("final_balance", initial_balance),
                    "return_pct":      s.get("return_pct", 0),
                })

            saved_count += 1
            logger.info(f"   ✅ EA {magic_number}: guardado ({s['total_trades']} trades)")

        except Exception as e:
            logger.error(f"   ❌ EA {magic_number}: error → {e}")

    logger.info(f"✅ Métricas guardadas para {saved_count}/{len(grouped)} EAs")
    return saved_count


# ─────────────────────────────────────────────
# HOOK PARA FASTAPI: llamar cuando llega un trade
# ─────────────────────────────────────────────

def on_new_trade(magic_number: int, initial_balance: float = 10_000.0):
    """
    Llama esto desde tu endpoint POST /trades cuando recibes un trade nuevo.
    
    Actualiza solo las métricas del EA afectado, no todos.
    
    Uso en FastAPI:
        from metrics.scheduler import on_new_trade
        
        @app.post("/trades")
        async def receive_trade(trade: TradeData, background_tasks: BackgroundTasks):
            # Guardar trade en BD...
            
            # Actualizar métricas en background (no bloquea la respuesta)
            background_tasks.add_task(on_new_trade, trade.magic_number)
            
            return {"status": "ok"}
    """
    from metrics.db import load_trades
    from metrics.calculator import compute_all_metrics

    try:
        df = load_trades(magic_number=magic_number)
        if df.empty:
            return

        metrics = compute_all_metrics(df, initial_balance=initial_balance)
        logger.info(f"📈 Métricas actualizadas para EA {magic_number} "
                    f"(profit: {metrics['summary']['total_net_profit']:.2f})")

        # Aquí podrías también actualizar la equity_curve en BD
        # o disparar un WebSocket al frontend

    except Exception as e:
        logger.error(f"Error actualizando métricas EA {magic_number}: {e}")


# ─────────────────────────────────────────────
# APSCHEDULER: Job automático periódico
# ─────────────────────────────────────────────

def setup_scheduler():
    """
    Configura APScheduler para ejecutar el cálculo automáticamente.
    
    Llama esto en el startup de FastAPI:
    
        @app.on_event("startup")
        async def startup():
            from metrics.scheduler import setup_scheduler
            setup_scheduler()
    
    Requiere: pip install apscheduler
    """
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = BackgroundScheduler()

        # Job 1: Calcular y guardar métricas cada hora
        scheduler.add_job(
            calculate_and_save_metrics,
            trigger=CronTrigger(minute=0),  # Al inicio de cada hora
            id="hourly_metrics",
            name="Calcular métricas cada hora",
            replace_existing=True,
        )

        # Job 2: Snapshot completo diario a medianoche
        scheduler.add_job(
            calculate_and_save_metrics,
            trigger=CronTrigger(hour=0, minute=5),  # 00:05 cada día
            id="daily_snapshot",
            name="Snapshot diario de métricas",
            replace_existing=True,
        )

        scheduler.start()
        logger.info("✅ Scheduler de métricas iniciado")
        return scheduler

    except ImportError:
        logger.warning("⚠️  APScheduler no instalado. pip install apscheduler")
        return None
