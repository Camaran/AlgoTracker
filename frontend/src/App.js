import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import EADetail from './pages/EADetail';
import './styles.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/"           element={<Dashboard />} />
            <Route path="/ea/:magic"  element={<EADetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
