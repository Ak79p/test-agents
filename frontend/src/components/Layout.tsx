import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" data-testid="brand-link">
            <span className="brand-mark" aria-hidden="true">F</span>
            FeeFlow
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end data-testid="nav-dashboard">
              Dashboard
            </NavLink>
            <NavLink to="/transactions" data-testid="nav-transactions">
              Transactions
            </NavLink>
          </nav>
          <div className="user-menu">
            <span className="user-name" data-testid="user-name">
              {session?.parent.full_name}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleLogout}
              disabled={loggingOut}
              data-testid="logout-button"
            >
              {loggingOut ? 'Signing out…' : 'Log out'}
            </button>
          </div>
        </div>
      </header>
      <main className="container" id="main">
        <Outlet />
      </main>
      <footer className="footer">Practice application · All payments are simulated · No real money moves</footer>
    </div>
  );
}
