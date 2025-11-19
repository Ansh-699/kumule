import React, { useEffect, useState } from 'react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import type { NftAsset, NftMetadata } from '@/services/api';

interface NftCardProps {
    nft: NftAsset;
    onList?: (nft: NftAsset) => void;
}

export const NftCard: React.FC<NftCardProps> = ({ nft, onList }) => {
    const [metadata, setMetadata] = useState<NftMetadata | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const fetchMetadata = async () => {
            if (!nft.uri) {
                setLoading(false);
                return;
            }
            try {
                const response = await fetch(nft.uri);
                const data = await response.json();
                setMetadata(data);
            } catch (error) {
                console.error('Failed to fetch metadata:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchMetadata();
    }, [nft.uri]);

    return (
        <Card className="w-full overflow-hidden hover:shadow-lg transition-shadow flex flex-col h-full">
            <div className="h-48 w-full relative overflow-hidden bg-muted">
                {loading ? (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        Loading...
                    </div>
                ) : metadata?.image ? (
                    <img
                        src={metadata.image}
                        alt={metadata.name || nft.name || 'NFT Image'}
                        className="object-cover w-full h-full transition-transform hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Image';
                        }}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary">
                        No Image
                    </div>
                )}
            </div>
            <CardHeader className="p-3">
                <CardTitle className="truncate text-base" title={metadata?.name || nft.name}>
                    {metadata?.name || nft.name || 'Unnamed NFT'}
                </CardTitle>
                <CardDescription className="truncate text-xs font-mono" title={nft.publicKey}>
                    {nft.publicKey}
                </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0 flex-grow">
                <div className="text-sm text-muted-foreground truncate mb-2" title={nft.owner}>
                    <span className="font-semibold text-foreground">Owner:</span> {nft.owner.slice(0, 4)}...{nft.owner.slice(-4)}
                </div>
                {metadata?.attributes && metadata.attributes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {metadata.attributes.slice(0, 3).map((attr, index) => (
                            <span key={index} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                                {attr.value}
                            </span>
                        ))}
                        {metadata.attributes.length > 3 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                                +{metadata.attributes.length - 3}
                            </span>
                        )}
                    </div>
                )}
                {onList && (
                    <button
                        onClick={() => onList(nft)}
                        className="mt-4 w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                    >
                        Send to Marketplace
                    </button>
                )}
            </CardContent>
        </Card>
    );
};
