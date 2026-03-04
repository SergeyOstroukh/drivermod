import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout.jsx';
import SuppliersPage from '../pages/suppliers/ui/SuppliersPage.jsx';
import PartnersPage from '../pages/partners/ui/PartnersPage.jsx';
import DriversPage from '../pages/drivers/ui/DriversPage.jsx';
import VehiclesPage from '../pages/vehicles/ui/VehiclesPage.jsx';
import DistributionPage from '../pages/distribution/ui/DistributionPage.jsx';
import SchedulePage from '../pages/schedule/ui/SchedulePage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/suppliers" replace />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="drivers" element={<DriversPage />} />
        <Route path="vehicles" element={<VehiclesPage />} />
        <Route path="distribution" element={<DistributionPage />} />
        <Route path="schedule" element={<SchedulePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/suppliers" replace />} />
    </Routes>
  );
}

export default App;
