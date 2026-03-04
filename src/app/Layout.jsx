import { Outlet, NavLink } from 'react-router-dom';

const navItems = [
  { to: '/suppliers', label: 'Поставщики' },
  { to: '/partners', label: 'Партнёры' },
  { to: '/drivers', label: 'Водители' },
  { to: '/vehicles', label: 'Автомобили' },
  { to: '/distribution', label: 'Распределение' },
  { to: '/schedule', label: 'График смен' },
];

export default function Layout() {
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
      <main className="container" style={{ padding: 16, flex: 1, minHeight: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}
