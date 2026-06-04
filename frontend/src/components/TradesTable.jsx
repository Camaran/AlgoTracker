import { useEffect, useState, useMemo } from 'react';
import { getTrades } from '../api/client';

// ─── Helpers ─────────────────────────────────────────────────────
function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtDuration(open, close) {
  if (!open || !close) return '—';
  const ms = new Date(close) - new Date(open);
  if (ms < 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function fmtPips(row) {
  const diff = parseFloat(row.close_price) - parseFloat(row.open_price);
  if (isNaN(diff)) return '—';
  // Invertir si es SELL
  const pips = row.order_type === 'SELL' ? -diff : diff;
  return (pips >= 0 ? '+' : '') + pips.toFixed(5);
}

// ─── Constantes de filtro / orden ────────────────────────────────
const PAGE_SIZE = 20;
const SORT_FIELDS = {
  close_time: 'Fecha',
  symbol:     'Símbolo',
  profit:     'P&L',
  volume:     'Lotes',
};

// ─── Subcomponentes de celda ─────────────────────────────────────
function TypeBadge({ type }) {
  const isBuy = type === 'BUY';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.04em',
      background: isBuy ? 'var(--green-dim)' : 'var(--red-dim)',
      color: isBuy ? 'var(--green)' : 'var(--red)',
      border: `1px solid ${isBuy ? 'var(--green)' : 'var(--red)'}`,
      fontFamily: 'var(--font-mono)',
    }}>
      {type}
    </span>
  );
}

function StatusBadge({ profit }) {
  const isWin = parseFloat(profit) >= 0;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.04em',
      background: isWin ? 'var(--green-dim)' : 'var(--red-dim)',
      color: isWin ? 'var(--green)' : 'var(--red)',
      border: `1px solid ${isWin ? 'var(--green)' : 'var(--red)'}`,
      fontFamily: 'var(--font-mono)',
    }}>
      {isWin ? 'WIN' : 'LOSS'}
    </span>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────
export default function TradesTable({ accountId, magicNumber }) {
  const [trades, setTrades]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [page, setPage]           = useState(1);
  const [sortField, setSortField] = useState('close_time');
  const [sortDir, setSortDir]     = useState('desc');
  const [filterType, setFilterType] = useState('ALL');   // ALL | BUY | SELL
  const [filterResult, setFilterResult] = useState('ALL'); // ALL | WIN | LOSS
  const [search, setSearch]       = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    getTrades(accountId, magicNumber)
      .then(res => {
        setTrades(res.data || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [accountId, magicNumber]);

  // Reset página al cambiar filtros
  useEffect(() => { setPage(1); }, [filterType, filterResult, search, sortField, sortDir]);

  const filtered = useMemo(() => {
    let rows = [...trades];

    if (filterType !== 'ALL')
      rows = rows.filter(r => r.order_type === filterType);

    if (filterResult === 'WIN')
      rows = rows.filter(r => parseFloat(r.profit) >= 0);
    else if (filterResult === 'LOSS')
      rows = rows.filter(r => parseFloat(r.profit) < 0);

    if (search.trim())
      rows = rows.filter(r =>
        r.symbol?.toLowerCase().includes(search.toLowerCase()) ||
        String(r.ticket).includes(search)
      );

    rows.sort((a, b) => {
      let va = a[sortField], vb = b[sortField];
      if (sortField === 'profit' || sortField === 'volume') {
        va = parseFloat(va); vb = parseFloat(vb);
      } else {
        va = va ?? ''; vb = vb ?? '';
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }, [trades, filterType, filterResult, search, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return <span style={{ opacity: 0.25, marginLeft: 4 }}>⇅</span>;
    return <span style={{ marginLeft: 4, color: 'var(--green)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  // ─── Estilos inline (respeta variables del proyecto) ────────────
  const S = {
    wrap: {
      marginTop: 0,
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      marginBottom: 14,
    },
    input: {
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      color: 'var(--text)',
      padding: '6px 12px',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      outline: 'none',
      flex: '1 1 160px',
      minWidth: 120,
    },
    filterGroup: {
      display: 'flex',
      gap: 4,
    },
    filterBtn: (active, colorKey) => ({
      background: active ? (colorKey === 'green' ? 'var(--green-dim)' : colorKey === 'red' ? 'var(--red-dim)' : 'rgba(245,166,35,0.12)') : 'var(--bg2)',
      border: `1px solid ${active ? (colorKey === 'green' ? 'var(--green)' : colorKey === 'red' ? 'var(--red)' : 'var(--yellow)') : 'var(--border)'}`,
      color: active ? (colorKey === 'green' ? 'var(--green)' : colorKey === 'red' ? 'var(--red)' : 'var(--yellow)') : 'var(--text2)',
      borderRadius: 5,
      padding: '5px 11px',
      fontSize: 11,
      fontWeight: 600,
      fontFamily: 'var(--font-mono)',
      cursor: 'pointer',
      letterSpacing: '0.03em',
      transition: 'all 0.15s',
    }),
    count: {
      marginLeft: 'auto',
      fontSize: 11,
      color: 'var(--text2)',
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
    },
    tableWrap: {
      overflowX: 'auto',
      borderRadius: 8,
      border: '1px solid var(--border)',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
    },
    th: (clickable) => ({
      background: 'var(--bg2)',
      color: 'var(--text2)',
      padding: '10px 12px',
      textAlign: 'left',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      borderBottom: '1px solid var(--border)',
      whiteSpace: 'nowrap',
      cursor: clickable ? 'pointer' : 'default',
      userSelect: 'none',
    }),
    td: {
      padding: '9px 12px',
      borderBottom: '1px solid rgba(30,45,69,0.5)',
      color: 'var(--text)',
      whiteSpace: 'nowrap',
    },
    trHover: {
      background: 'var(--bg3)',
    },
    pnlPos: { color: 'var(--green)', fontWeight: 600 },
    pnlNeg: { color: 'var(--red)',   fontWeight: 600 },
    symBadge: {
      background: 'rgba(0,212,164,0.08)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 11,
      fontWeight: 600,
    },
    pipsPos: { color: 'var(--green)', fontSize: 11 },
    pipsNeg: { color: 'var(--red)',   fontSize: 11 },
    pagination: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 14,
    },
    pageBtn: (active, disabled) => ({
      background: active ? 'var(--green)' : 'var(--bg2)',
      color: active ? '#000' : disabled ? 'var(--text3)' : 'var(--text2)',
      border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
      borderRadius: 5,
      padding: '5px 11px',
      fontSize: 12,
      fontWeight: active ? 700 : 400,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-mono)',
      transition: 'all 0.15s',
    }),
    empty: {
      textAlign: 'center',
      color: 'var(--text2)',
      padding: '40px 0',
      fontSize: 13,
    },
  };

  // ─── Render ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text2)', fontSize: 13 }}>
      <span style={{ marginRight: 8 }}>⏳</span>Cargando trades...
    </div>
  );

  if (error) return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--red)', fontSize: 13 }}>
      Error: {error}
    </div>
  );

  return (
    <div style={S.wrap}>

      {/* ── Toolbar ── */}
      <div style={S.toolbar}>
        <input
          style={S.input}
          placeholder="Buscar símbolo o ticket…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Filtro tipo */}
        <div style={S.filterGroup}>
          {[['ALL', 'neutral'], ['BUY', 'green'], ['SELL', 'red']].map(([v, c]) => (
            <button key={v} style={S.filterBtn(filterType === v, c)} onClick={() => setFilterType(v)}>{v}</button>
          ))}
        </div>

        {/* Filtro resultado */}
        <div style={S.filterGroup}>
          {[['ALL', 'neutral'], ['WIN', 'green'], ['LOSS', 'red']].map(([v, c]) => (
            <button key={v} style={S.filterBtn(filterResult === v, c)} onClick={() => setFilterResult(v)}>{v}</button>
          ))}
        </div>

        <span style={S.count}>{filtered.length} trades</span>
      </div>

      {/* ── Tabla ── */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {[
                ['close_time', 'Fecha cierre', true],
                ['symbol',     'Símbolo',      true],
                [null,         'Tipo',         false],
                ['volume',     'Lotes',        true],
                [null,         'Entrada',      false],
                [null,         'Salida',       false],
                [null,         'Pips',         false],
                ['profit',     'P&L',          true],
                [null,         'Duración',     false],
                [null,         'Estado',       false],
              ].map(([field, label, sortable]) => (
                <th
                  key={label}
                  style={S.th(sortable)}
                  onClick={sortable ? () => toggleSort(field) : undefined}
                >
                  {label}{sortable && <SortIcon field={field} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={10} style={S.empty}>
                  {trades.length === 0 ? 'No hay trades registrados.' : 'Sin resultados para los filtros aplicados.'}
                </td>
              </tr>
            ) : paginated.map((row, i) => {
              const pnl      = parseFloat(row.profit || 0);
              const isWin    = pnl >= 0;
              const pipsRaw  = parseFloat(row.close_price) - parseFloat(row.open_price);
              const pips     = row.order_type === 'SELL' ? -pipsRaw : pipsRaw;
              const pipsPos  = pips >= 0;

              return (
                <tr
                  key={row.ticket ?? i}
                  style={{ cursor: 'default' }}
                  onMouseEnter={e => e.currentTarget.style.background = S.trHover.background}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <td style={{ ...S.td, color: 'var(--text2)', fontSize: 11 }}>
                    {fmtDate(row.close_time)}
                  </td>
                  <td style={S.td}>
                    <span style={S.symBadge}>{row.symbol}</span>
                  </td>
                  <td style={S.td}>
                    <TypeBadge type={row.order_type} />
                  </td>
                  <td style={{ ...S.td, color: 'var(--text2)' }}>
                    {fmt(row.volume, 2)}
                  </td>
                  <td style={{ ...S.td, color: 'var(--text2)', fontSize: 11 }}>
                    {fmt(row.open_price, 5)}
                  </td>
                  <td style={{ ...S.td, color: 'var(--text2)', fontSize: 11 }}>
                    {fmt(row.close_price, 5)}
                  </td>
                  <td style={pipsPos ? S.pipsPos : S.pipsNeg}>
                    {isNaN(pips) ? '—' : (pipsPos ? '+' : '') + pips.toFixed(5)}
                  </td>
                  <td style={isWin ? S.pnlPos : S.pnlNeg}>
                    {pnl >= 0 ? '+' : ''}${fmt(Math.abs(pnl))}
                  </td>
                  <td style={{ ...S.td, color: 'var(--text2)', fontSize: 11 }}>
                    {fmtDuration(row.open_time, row.close_time)}
                  </td>
                  <td style={S.td}>
                    <StatusBadge profit={row.profit} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Paginación ── */}
      {totalPages > 1 && (
        <div style={S.pagination}>
          <button
            style={S.pageBtn(false, page === 1)}
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            ‹
          </button>

          {/* Páginas: mostrar max 7 botones con elipsis */}
          {(() => {
            const pages = [];
            const delta = 2;
            const range = [];
            for (let i = Math.max(2, page - delta); i <= Math.min(totalPages - 1, page + delta); i++) {
              range.push(i);
            }
            pages.push(1);
            if (range[0] > 2) pages.push('…');
            pages.push(...range);
            if (range[range.length - 1] < totalPages - 1) pages.push('…');
            if (totalPages > 1) pages.push(totalPages);

            return pages.map((p, i) =>
              p === '…'
                ? <span key={`e${i}`} style={{ color: 'var(--text3)', fontSize: 12 }}>…</span>
                : <button
                    key={p}
                    style={S.pageBtn(p === page, false)}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
            );
          })()}

          <button
            style={S.pageBtn(false, page === totalPages)}
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
