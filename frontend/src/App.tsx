import { useState } from 'react';
import './App.css';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { UserNftList } from '@/components/UserNftList';
import { MarketplaceList } from '@/components/MarketplaceList';
import { NftCreator } from '@/components/NftCreator';

import { Github } from 'lucide-react';

function App() {
  const [view, setView] = useState<'marketplace' | 'my-nfts' | 'create'>('marketplace');

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
      <div className="w-full bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-600 dark:text-yellow-500 px-4 py-2 text-center text-sm font-medium">
        ⚠️ Make sure you are on Devnet wallet with some airdropped SOL
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
            <WalletMultiButton />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">NFT Marketplace</h1>
          <div className="flex gap-4 mt-4">
            <button
              onClick={() => setView('marketplace')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${view === 'marketplace' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              Marketplace
            </button>
            <button
              onClick={() => setView('my-nfts')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${view === 'my-nfts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              My NFTs
            </button>
            <button
              onClick={() => setView('create')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${view === 'create' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              Create NFT
            </button>
          </div>
        </header>

        <main className="w-full max-w-7xl px-4">
          {view === 'marketplace' ? (
            <MarketplaceList />
          ) : view === 'my-nfts' ? (
            <UserNftList />
          ) : (
            <NftCreator />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
