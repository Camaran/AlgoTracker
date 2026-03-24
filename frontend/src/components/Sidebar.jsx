import { Link, useLocation } from 'react-router-dom';

const icons = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  ),
  strategies: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
};

export default function Sidebar() {
  const loc = useLocation();

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <span>AlgoTracker</span>
        <small>MT5 Journal</small>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Principal</div>
        <Link to="/" className={`sidebar-link ${loc.pathname === '/' ? 'active' : ''}`}>
          {icons.dashboard} Dashboard
        </Link>
        <Link to="/strategies" className={`sidebar-link ${loc.pathname.startsWith('/ea') ? 'active' : ''}`}>
          {icons.strategies} Estrategias
        </Link>
      </div>
    </nav>
  );
}
