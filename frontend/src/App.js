import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./styles.css";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import AccountDetail from "./pages/AccountDetail";
import EADetail from "./pages/EADetail";

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cuenta/:account_id" element={<AccountDetail />} />
            <Route path="/ea/:account_id/:magic_number" element={<EADetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
