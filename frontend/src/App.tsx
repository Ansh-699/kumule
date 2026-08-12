import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { MarketplacePage } from '@/pages/MarketplacePage'
import { NftDetailPage } from '@/pages/NftDetailPage'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { EventsPage } from '@/pages/EventsPage'
import { CreatePage } from '@/pages/CreatePage'
import { AdminPage } from '@/pages/AdminPage'

const App = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route path="/" element={<MarketplacePage />} />
      <Route path="/nft/:assetId" element={<NftDetailPage />} />
      <Route path="/collections" element={<CollectionsPage />} />
      <Route path="/events" element={<EventsPage />} />
      <Route path="/create" element={<CreatePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>
)

export default App
