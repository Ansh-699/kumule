import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { API_BASE_URL } from '@/services/api';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusModal, type StatusType } from './StatusModal';
import { Skeleton } from '@/components/ui/skeleton';

interface Listing {
    escrow: string;
    asset: string;
    seller: string;
    price: number;
    name: string;
    uri: string;
}

const ListingCard = ({ listing, onBuy }: { listing: Listing, onBuy: (listing: Listing) => void }) => {
    const [metadata, setMetadata] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const { publicKey } = useWallet();

    useEffect(() => {
        const fetchMetadata = async () => {
            if (!listing.uri) {
                setLoading(false);
                return;
            }
            try {
                console.log(`Fetching metadata for ${listing.name}:`, listing.uri);
                const response = await fetch(listing.uri);
                const data = await response.json();
                setMetadata(data);
            } catch (error) {
                console.error('Failed to fetch metadata for', listing.name, error);
            } finally {
                setLoading(false);
            }
        };
        fetchMetadata();
    }, [listing.uri]);

    const isOwner = publicKey && listing.seller === publicKey.toString();

    return (
        <div className="border rounded-lg p-4 space-y-3 flex flex-col h-full">
            <div className="aspect-square bg-muted rounded-md flex items-center justify-center overflow-hidden relative">
                {loading ? (
                    <Skeleton className="w-full h-full" />
                ) : metadata?.animation_url ? (
                    metadata.properties?.category === 'audio' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-500/10 to-pink-500/10 p-4">
                            {metadata.image && (
                                <img
                                    src={metadata.image}
                                    alt="Cover"
                                    className="w-full h-32 object-cover rounded-lg mb-3 shadow-lg"
                                />
                            )}
                            <audio controls src={metadata.animation_url} className="w-full" />
                        </div>
                    ) : (
                        <video
                            src={metadata.animation_url}
                            autoPlay
                            loop
                            muted
                            className="w-full h-full object-cover"
                            poster={metadata.image}
                        />
                    )
                ) : metadata?.image ? (
                    <img
                        src={metadata.image}
                        alt={listing.name}
                        className="w-full h-full object-cover transition-transform hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                            console.error('Image load failed for:', metadata.image);
                            (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Image';
                        }}
                    />
                ) : (
                    <div className="text-muted-foreground text-sm">No Image</div>
                )}
            </div>
            <div className="flex-grow">
                <h3 className="font-semibold truncate" title={listing.name}>{listing.name}</h3>
                <p className="text-xs text-muted-foreground truncate" title={listing.asset}>
                    Asset: {listing.asset.slice(0, 4)}...{listing.asset.slice(-4)}
                </p>
                <p className="text-xs text-muted-foreground truncate" title={listing.seller}>
                    Seller: {listing.seller.slice(0, 4)}...{listing.seller.slice(-4)}
                </p>
            </div>
            <div className="flex items-center justify-between mt-2">
                <div>
                    <p className="text-xs text-muted-foreground">Price</p>
                    <p className="font-bold">{listing.price !== undefined && listing.price !== null ? listing.price : 'N/A'} SOL</p>
                </div>
                <button
                    onClick={() => onBuy(listing)}
                    disabled={!!isOwner}
                    className={`h-10 px-4 py-2 rounded-md text-sm font-medium transition-colors ${isOwner
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                        }`}
                >
                    {isOwner ? 'You Own This' : 'Buy'}
                </button>
            </div>
        </div>
    );
};

export const MarketplaceList = () => {
    const { publicKey: walletPublicKey, signTransaction } = useWallet();
    const { connection } = useConnection();
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(false);

    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; listing: Listing | null }>({ isOpen: false, listing: null });
    const [statusModal, setStatusModal] = useState<{ isOpen: boolean; status: StatusType; title: string; message: string }>({
        isOpen: false,
        status: 'idle',
        title: '',
        message: '',
    });

    useEffect(() => {
        loadListings();
    }, []);

    const loadListings = async () => {
        setLoading(true);
        try {
            console.log('🔍 Fetching marketplace listings from escrow accounts');
            const response = await fetch(`${API_BASE_URL}listings`);
            if (!response.ok) {
                throw new Error(`Failed to fetch listings: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('Received listings:', data.listings);
            setListings(data.listings || []);
        } catch (error) {
            console.error('Error fetching marketplace listings:', error);
        } finally {
            setLoading(false);
        }
    };

    const initiateBuy = (listing: Listing) => {
        if (!walletPublicKey || !signTransaction) {
            setStatusModal({
                isOpen: true,
                status: 'error',
                title: 'Wallet Not Connected',
                message: 'Please connect your wallet to buy NFTs.',
            });
            return;
        }
        setConfirmDialog({ isOpen: true, listing });
    };

    const handleBuyConfirm = async () => {
        const listing = confirmDialog.listing;
        if (!listing || !walletPublicKey || !signTransaction) return;

        setConfirmDialog({ isOpen: false, listing: null });
        setStatusModal({
            isOpen: true,
            status: 'loading',
            title: 'Processing Purchase',
            message: `Buying ${listing.name} for ${listing.price} SOL...`,
        });

        try {
            console.log('Buying NFT:', listing.asset, 'for', listing.price, 'SOL');

            // Call /buy endpoint for atomic swap
            const response = await fetch(`${API_BASE_URL}buy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    assetId: listing.asset,
                    buyer: walletPublicKey.toString(),
                    seller: listing.seller,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Backend error: ${errorText}`);
            }

            const { transaction } = await response.json();

            const txBuffer = Buffer.from(transaction, 'base64');
            const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));

            const signedTx = await signTransaction(tx);

            const signature = await connection.sendRawTransaction(signedTx.serialize());

            await connection.confirmTransaction(signature, 'confirmed');

            console.log('Buy successful, signature:', signature);
            setStatusModal({
                isOpen: true,
                status: 'success',
                title: 'Purchase Successful!',
                message: `You successfully bought ${listing.name} for ${listing.price} SOL. Check your wallet.`,
            });
            loadListings();
        } catch (error) {
            console.error('Error buying NFT:', error);
            setStatusModal({
                isOpen: true,
                status: 'error',
                title: 'Purchase Failed',
                message: `Failed to buy NFT: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    };

    if (loading) {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between mb-4">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-9 w-24" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="border rounded-lg p-4 space-y-3">
                            <Skeleton className="aspect-square w-full rounded-md" />
                            <Skeleton className="h-6 w-3/4" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-2/3" />
                            <div className="flex items-center justify-between mt-2">
                                <div className="space-y-2">
                                    <Skeleton className="h-3 w-12" />
                                    <Skeleton className="h-5 w-20" />
                                </div>
                                <Skeleton className="h-10 w-20" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">Marketplace</h2>
                <button
                    onClick={loadListings}
                    disabled={loading}
                    className="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>
            {listings.length === 0 ? (
                <p className="text-muted-foreground">No NFTs listed in the marketplace.</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {listings.map((listing) => (
                        <ListingCard key={listing.escrow} listing={listing} onBuy={initiateBuy} />
                    ))}
                </div>
            )}

            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                onClose={() => setConfirmDialog({ isOpen: false, listing: null })}
                onConfirm={handleBuyConfirm}
                title="Confirm Purchase"
                description={`Are you sure you want to buy "${confirmDialog.listing?.name}" for ${confirmDialog.listing?.price} SOL? This action cannot be undone.`}
                confirmText="Buy Now"
            />

            <StatusModal
                isOpen={statusModal.isOpen}
                onClose={() => setStatusModal(prev => ({ ...prev, isOpen: false }))}
                status={statusModal.status}
                title={statusModal.title}
                message={statusModal.message}
            />
        </div>
    );
};
