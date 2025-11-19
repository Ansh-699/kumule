import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { API_BASE_URL } from '@/services/api';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

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

    return (
        <div className="border rounded-lg p-4 space-y-3 flex flex-col h-full">
            <div className="aspect-square bg-muted rounded-md flex items-center justify-center overflow-hidden relative">
                {loading ? (
                    <div className="text-muted-foreground text-sm">Loading...</div>
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
                    className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                    Buy
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

    const handleBuy = async (listing: Listing) => {
        if (!walletPublicKey || !signTransaction) {
            alert('Please connect your wallet to buy.');
            return;
        }

        try {
            if (!window.confirm(`Buy ${listing.name} for ${listing.price} SOL?`)) {
                return;
            }

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
            alert(`NFT Bought Successfully for ${listing.price} SOL! Check your wallet.`);
            loadListings(); // Refresh listings
        } catch (error) {
            console.error('Error buying NFT:', error);
            alert(`Failed to buy NFT: ${error}`);
        }
    };

    if (loading) {
        return <div className="text-center p-10">Loading Marketplace...</div>;
    }

    return (
        <div className="w-full">
            <h2 className="text-2xl font-bold mb-4">Marketplace</h2>
            {listings.length === 0 ? (
                <p className="text-muted-foreground">No NFTs listed in the marketplace.</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {listings.map((listing) => (
                        <ListingCard key={listing.escrow} listing={listing} onBuy={handleBuy} />
                    ))}
                </div>
            )}
        </div>
    );
};
