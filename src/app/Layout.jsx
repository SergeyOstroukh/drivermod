import { Outlet, NavLink, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/suppliers', label: 'Поставщики' },
  { to: '/partners', label: 'Партнёры' },
  { to: '/drivers', label: 'Водители' },
  { to: '/vehicles', label: 'Автомобили' },
  { to: '/distribution', label: 'Распределение' },
  { to: '/schedule', label: 'График смен' },
];

export default function Layout() {
  const { pathname } = useLocation();
  const isDistribution = pathname === '/distribution' || pathname === '/distribution/';

  return (
    <div className="app">
      <header className="header">
        <nav className="nav-tabs">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => 'nav-tab' + (isActive ? ' active' : '')}
              end={to === '/'}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="header-top">
          <h1 id="pageTitle" style={{ margin: 0, fontSize: '1.25rem' }}>DriveControl</h1>
        </div>
      </header>
      <main
        className={'container' + (isDistribution ? ' dc-fullwidth' : '')}
        style={{
          padding: isDistribution ? 0 : 16,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
