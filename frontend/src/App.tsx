import './App.css';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { AdminPage } from '@/components/AdminPage';
import { MarketplaceLayout } from '@/components/MarketplaceLayout';

function App() {
  return (
    <>
      <Toaster />
      <Routes>
        {/* Admin route - MUST come first and be exact to prevent catch-all from matching */}
        <Route path="/admin" element={<AdminPage />} />
        
        {/* All other routes - with marketplace layout */}
        <Route path="/*" element={<MarketplaceLayout />} />
      </Routes>
    </>
  );
}

export default App;
