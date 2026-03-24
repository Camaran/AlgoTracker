#!/usr/bin/env python3
"""
SCRIPT DE CONSOLA - run_metrics.py
=====================================
Ejecuta ahora mismo para ver las métricas en consola.

Uso:
    python run_metrics.py                        # Todos los EAs
    python run_metrics.py --magic 12345          # EA específico
    python run_metrics.py --magic 12345 --symbol EURUSD
    python run_metrics.py --from 2024-01-01 --to 2024-12-31
    python run_metrics.py --demo                 # Modo demo con datos ficticios

Requiere variables de entorno (o archivo .env):
    DATABASE_URL=postgresql://user:pass@host:5432/trading_journal
"""

import argparse
import sys
import os
from datetime import datetime

# ── Cargar .env si existe ────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
    print("📄 Variables cargadas desde .env")
except ImportError:
    pass  # python-dotenv no instalado, continuar con env vars del sistema


# ── Colores ANSI para consola ────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"
DIM    = "\033[2m"

def green(s):  return f"{GREEN}{s}{RESET}"
def red(s):    return f"{RED}{s}{RESET}"
def yellow(s): return f"{YELLOW}{s}{RESET}"
def cyan(s):   return f"{CYAN}{s}{RESET}"
def bold(s):   return f"{BOLD}{s}{RESET}"
def dim(s):    return f"{DIM}{s}{RESET}"

def colored_value(value: float, positive_is_good: bool = True) -> str:
    """Colorea un número: verde si es bueno, rojo si es malo."""
    if value > 0:
        return green(f"+{value:,.2f}") if positive_is_good else red(f"+{value:,.2f}")
    elif value < 0:
        return red(f"{value:,.2f}") if positive_is_good else green(f"{value:,.2f}")
    else:
        return f"{value:,.2f}"


# ── Funciones de display ─────────────────────────────────────────────────────

def print_header(title: str):
    width = 60
    print(f"\n{'═' * width}")
    print(f"  {bold(title)}")
    print(f"{'═' * width}")


def print_section(title: str):
    print(f"\n  {cyan('▶')} {bold(title)}")
    print(f"  {'─' * 50}")


def print_metric(label: str, value, unit: str = "", width: int = 35):
    label_str = f"  {label:<{width}}"
    if isinstance(value, float):
        value_str = f"{value:,.4f}{unit}" if abs(value) < 1 else f"{value:,.2f}{unit}"
    else:
        value_str = f"{value}{unit}"
    print(f"{label_str} {value_str}")


def print_metrics_summary(magic_number: int, metrics: dict):
    """Muestra las métricas de un EA en la consola."""
    s  = metrics["summary"]
    adv = metrics["advanced"]
    dr = metrics["date_range"]

    print_header(f"EA: {magic_number}")

    # Rango de fechas
    if dr["from"]:
        print(f"  {dim('Período:')} {dr['from'][:10]} → {dr['to'][:10]}")
    print(f"  {dim('Trades:')} {metrics['trade_count']}")

    # ── Rendimiento general ──────────────────────────────
    print_section("RENDIMIENTO GENERAL")

    net = s['total_net_profit']
    ret = s.get('return_pct', 0)
    print(f"  {'Profit Neto':<35} {colored_value(net)} USD  ({colored_value(ret)}%)")
    gp = s['gross_profit']
    gl = s['gross_loss']
    print(f"  {'Profit Bruto':<35} {green(f'+{gp:,.2f}')}")
    print(f"  {'Pérdida Bruta':<35} {red(f'-{gl:,.2f}')}")
    print(f"  {'Balance Final':<35} {s.get('final_balance', 'N/A'):,.2f} USD")
    print_metric("Comisiones Pagadas",    s['total_commissions'], " USD")
    print_metric("Swaps",                 s['total_swaps'],        " USD")

    # ── Estadísticas de trades ───────────────────────────
    print_section("ESTADÍSTICAS DE TRADES")

    wr = s['win_rate_pct']
    wr_colored = green(f"{wr:.1f}%") if wr >= 50 else yellow(f"{wr:.1f}%") if wr >= 40 else red(f"{wr:.1f}%")
    print(f"  {'Win Rate':<35} {wr_colored}  ({s['winning_trades']}W / {s['losing_trades']}L)")

    pf = s['profit_factor']
    pf_colored = green(f"{pf:.3f}") if pf >= 1.5 else yellow(f"{pf:.3f}") if pf >= 1 else red(f"{pf:.3f}")
    print(f"  {'Profit Factor':<35} {pf_colored}  {dim('(>1.5 = bueno)')}")

    print_metric("Ganancia Promedio",      s['avg_win'],   " USD")
    print_metric("Pérdida Promedio",       s['avg_loss'],  " USD")
    print_metric("Promedio por Trade",     s['avg_trade'], " USD")
    print_metric("Mejor Trade",            s['best_trade'],  " USD")
    print_metric("Peor Trade",             s['worst_trade'], " USD")
    print_metric("Ratio Ganancia/Pérdida", s['payoff_ratio'])
    print_metric("Duración Promedio",      s['avg_duration_min'], " min")

    # ── Riesgo ───────────────────────────────────────────
    print_section("GESTIÓN DE RIESGO")

    dd = s['max_drawdown_pct']
    dd_colored = green(f"{dd:.2f}%") if dd < 10 else yellow(f"{dd:.2f}%") if dd < 20 else red(f"{dd:.2f}%")
    mdd = s['max_drawdown_usd']
    print(f"  {'Max Drawdown':<35} {dd_colored}  ({red(f'-{mdd:,.2f} USD')})")
    print_metric("Recovery Factor",  s['recovery_factor'], "  (profit/drawdown)")

    sharpe = s['sharpe_ratio']
    sharpe_c = green(f"{sharpe:.4f}") if sharpe > 1 else yellow(f"{sharpe:.4f}") if sharpe > 0 else red(f"{sharpe:.4f}")
    print(f"  {'Sharpe Ratio':<35} {sharpe_c}  {dim('(>1 = bueno)')}")

    sortino = s['sortino_ratio']
    print_metric("Sortino Ratio",  sortino,  f"  {dim('(penaliza solo pérdidas)')}")
    print_metric("Calmar Ratio",   s.get('calmar_ratio', 0))

    # ── Métricas avanzadas ───────────────────────────────
    if adv:
        print_section("MÉTRICAS AVANZADAS")

        exp = adv.get('expectancy', 0)
        exp_colored = green(f"{exp:,.4f}") if exp > 0 else red(f"{exp:,.4f}")
        print(f"  {'Expectancy (por trade)':<35} {exp_colored} USD  {dim('(esperanza matemática)')}")
        print_metric("Expectancy por $1 arriesgado", adv.get('expectancy_per_dollar', 0))
        print_metric("Desviación Estándar",           adv.get('profit_std_dev', 0), " USD")
        print_metric("Coef. de Variación",            adv.get('coefficient_of_variation', 0))

        mwins  = adv.get('max_consecutive_wins', 0)
        mlosses = adv.get('max_consecutive_losses', 0)
        print(f"  {'Racha Máx. Ganadora':<35} {green(str(mwins))} trades")
        print(f"  {'Racha Máx. Perdedora':<35} {red(str(mlosses))} trades")

        cur = adv.get('current_streak', 0)
        cur_type = adv.get('current_streak_type', '')
        if cur_type == 'win':
            print(f"  {'Racha Actual':<35} {green(f'{cur} victorias consecutivas')}")
        else:
            print(f"  {'Racha Actual':<35} {red(f'{cur} pérdidas consecutivas')}")

    # ── Análisis temporal ────────────────────────────────
    time_a = metrics.get("time_analysis", {})
    if time_a:
        print_section("ANÁLISIS TEMPORAL")

        best_h  = time_a.get("best_hour")
        worst_h = time_a.get("worst_hour")
        best_d  = time_a.get("best_weekday")
        worst_d = time_a.get("worst_weekday")

        if best_h is not None:
            print(f"  {'Mejor Hora del Día':<35} {green(f'{best_h:02d}:00')}")
            print(f"  {'Peor Hora del Día':<35} {red(f'{worst_h:02d}:00')}")
        if best_d:
            print(f"  {'Mejor Día de la Semana':<35} {green(best_d)}")
            print(f"  {'Peor Día de la Semana':<35} {red(worst_d)}")

        # Top 3 meses
        monthly = time_a.get("by_month", {})
        if monthly:
            print(f"\n  {'Rendimiento Mensual':}")
            for month, data in list(monthly.items())[:6]:
                p = data['profit']
                bar = "█" * min(int(abs(p) / 10), 20)
                color = green if p > 0 else red
                print(f"    {month}  {color(f'{p:+.2f} USD')}  {dim(bar)}")


def print_equity_snapshot(metrics: dict, points: int = 10):
    """Muestra un snapshot ASCII de la curva de equity."""
    curve = metrics.get("equity_curve", [])
    if not curve:
        return

    print_section("CURVA DE EQUITY (snapshot)")

    # Tomar solo 'points' muestras equidistantes
    step = max(1, len(curve) // points)
    samples = curve[::step][-points:]

    max_val = max(p["equity"] for p in samples)
    min_val = min(p["equity"] for p in samples)
    range_v = max_val - min_val if max_val != min_val else 1

    for point in samples:
        date_str = point["time"][:10]
        equity   = point["equity"]
        bar_len  = int(((equity - min_val) / range_v) * 30)
        bar = "█" * bar_len
        color = green if equity >= samples[0]["equity"] else red
        print(f"  {date_str}  {color(f'{equity:>10,.2f}')  }  {color(bar)}")


# ── DEMO MODE (datos ficticios para probar sin BD) ───────────────────────────

def generate_demo_data() -> "pd.DataFrame":
    """Genera datos de trades ficticios para probar el motor sin BD."""
    import pandas as pd
    import numpy as np

    np.random.seed(42)
    n = 150

    open_times  = pd.date_range("2024-01-01", periods=n, freq="3h")
    close_times = open_times + pd.to_timedelta(np.random.randint(30, 300, n), unit="min")

    profits = np.random.normal(loc=5, scale=45, size=n)  # media positiva = sistema rentable

    df = pd.DataFrame({
        "id":           range(1, n + 1),
        "ticket":       np.random.randint(100_000, 999_999, n),
        "magic_number": np.random.choice([11111, 22222], n),
        "comment":      ["EA_Demo"] * n,
        "symbol":       np.random.choice(["EURUSD", "GBPUSD", "USDJPY"], n, p=[0.5, 0.3, 0.2]),
        "order_type":   np.random.choice(["buy", "sell"], n),
        "volume":       np.round(np.random.choice([0.01, 0.1, 0.5], n), 2),
        "open_price":   np.round(np.random.uniform(1.05, 1.15, n), 5),
        "close_price":  np.round(np.random.uniform(1.05, 1.15, n), 5),
        "stop_loss":    np.zeros(n),
        "take_profit":  np.zeros(n),
        "open_time":    open_times,
        "close_time":   close_times,
        "profit":       np.round(profits, 2),
        "commission":   np.round(-abs(np.random.normal(0.5, 0.1, n)), 2),
        "swap":         np.zeros(n),
        "received_at":  close_times,
    })

    return df


# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Motor de Métricas - Trading Journal")
    parser.add_argument("--magic",   type=int,  help="Magic number del EA")
    parser.add_argument("--symbol",  type=str,  help="Par de divisas (EURUSD)")
    parser.add_argument("--from",    type=str,  dest="date_from", help="Fecha inicio (YYYY-MM-DD)")
    parser.add_argument("--to",      type=str,  dest="date_to",   help="Fecha fin (YYYY-MM-DD)")
    parser.add_argument("--balance", type=float, default=10_000.0, help="Capital inicial")
    parser.add_argument("--demo",    action="store_true", help="Usar datos de demostración")
    args = parser.parse_args()

    print(f"\n{bold('🚀 MOTOR DE MÉTRICAS - TRADING JOURNAL')}")
    print(f"{dim('─' * 60)}")

    # ── Cargar datos ────────────────────────────────────
    if args.demo:
        print(f"\n{yellow('⚡ MODO DEMO: usando datos ficticios')}")
        import pandas as pd
        df_all = generate_demo_data()
        magic_numbers = df_all["magic_number"].unique().tolist()
    else:
        # Importar aquí para no fallar en modo demo si no hay BD
        try:
            sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
            from metrics.db import load_trades, load_trades_grouped_by_ea

            date_from = datetime.fromisoformat(args.date_from) if args.date_from else None
            date_to   = datetime.fromisoformat(args.date_to)   if args.date_to   else None

            if args.magic:
                df_all = load_trades(
                    magic_number=args.magic,
                    symbol=args.symbol,
                    date_from=date_from,
                    date_to=date_to,
                )
                magic_numbers = [args.magic] if not df_all.empty else []
            else:
                grouped = load_trades_grouped_by_ea(date_from=date_from, date_to=date_to)
                if not grouped:
                    print(red("\n❌ No se encontraron trades. ¿Está la BD configurada?"))
                    print(dim("   Usa --demo para probar con datos ficticios"))
                    sys.exit(1)

                # Procesar cada EA
                from metrics.calculator import compute_all_metrics
                for magic, df in grouped.items():
                    metrics = compute_all_metrics(df, initial_balance=args.balance)
                    print_metrics_summary(magic, metrics)
                    print_equity_snapshot(metrics)

                print(f"\n{'═' * 60}")
                print(f"  ✅ {bold(str(len(grouped)))} EAs procesados")
                print(f"{'═' * 60}\n")
                return

        except Exception as e:
            print(red(f"\n❌ Error conectando a BD: {e}"))
            print(dim("   Verifica DATABASE_URL en tu .env"))
            print(dim("   Usa --demo para probar sin BD"))
            sys.exit(1)

    # ── Calcular y mostrar métricas ─────────────────────
    from metrics.calculator import compute_all_metrics

    for magic in magic_numbers:
        df = df_all[df_all["magic_number"] == magic] if args.demo else df_all

        if args.symbol and args.demo:
            df = df[df["symbol"] == args.symbol.upper()]

        metrics = compute_all_metrics(df, initial_balance=args.balance)
        print_metrics_summary(magic, metrics)
        print_equity_snapshot(metrics)

    print(f"\n{'═' * 60}")
    print(f"  ✅ {bold('Análisis completado')}")
    print(f"{'═' * 60}\n")


if __name__ == "__main__":
    main()
