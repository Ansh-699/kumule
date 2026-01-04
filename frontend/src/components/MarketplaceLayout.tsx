import { useNavigate, useLocation } from 'react-router-dom';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Github, Shield } from 'lucide-react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MarketplaceList } from './MarketplaceList';
import { UserNftList } from './UserNftList';
import { NftCreator } from './NftCreator';
import { NftDetailPage } from './NftDetailPage';
import { RewardSystem } from './RewardSystem';
import { EventsPage } from './EventsPage';
import { EventDetailPage } from './EventDetailPage';
import { AlbumPage } from './AlbumPage';
import { Button } from '@/components/ui/button';

export const MarketplaceLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
      <div className="w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-600 dark:text-yellow-500 px-4 py-2 text-center text-sm font-medium">
        ⚠️ Make sure you are on Testnet wallet with some airdropped SOL
      </div>

      <div className="w-full py-10 flex flex-col items-center">
        <header className="mb-10 text-center flex flex-col items-center gap-4 w-full max-w-7xl px-4 relative">
          <div className="absolute top-0 right-4 flex items-center gap-4">
            <a
              href="https://github.com/Ansh-699/NFT-Marketplace"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="View on GitHub"
            >
              <Github className="w-6 h-6" />
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/admin')}
              className="flex items-center gap-2"
            >
              <Shield className="h-4 w-4" />
              Admin
            </Button>
            <WalletMultiButton />
          </div>
          <h1
            className="text-4xl font-bold tracking-tight mb-2 cursor-pointer hover:text-primary transition-colors"
            onClick={() => navigate('/marketplace')}
          >
            NFT Marketplace
          </h1>
          <div className="flex gap-4 mt-4">
            <button
              onClick={() => navigate('/marketplace')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${location.pathname === '/marketplace' || location.pathname === '/' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              Marketplace
            </button>
            <button
              onClick={() => navigate('/my-nfts')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${location.pathname === '/my-nfts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              My NFTs
            </button>
            <button
              onClick={() => navigate('/create')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${location.pathname === '/create' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              Create NFT
            </button>
            <button
              onClick={() => navigate('/rewards')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${location.pathname === '/rewards' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              Rewards
            </button>
            <button
              onClick={() => navigate('/events')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${location.pathname === '/events' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              Events
            </button>
          </div>
        </header>

        <main className="w-full max-w-7xl px-4">
          <Routes>
            <Route path="/" element={<Navigate to="/marketplace" replace />} />
            <Route path="/marketplace" element={<MarketplaceList />} />
            <Route path="/my-nfts" element={<UserNftList />} />
            <Route path="/create" element={<NftCreator />} />
            <Route path="/rewards" element={<RewardSystem />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:eventId" element={<EventDetailPage />} />
            <Route path="/nft/:id" element={<NftDetailPage />} />
            <Route path="/album/:id" element={<AlbumPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};
