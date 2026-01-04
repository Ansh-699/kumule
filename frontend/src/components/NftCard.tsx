import React, { useEffect, useState } from 'react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { NftAsset, NftMetadata } from '@/services/api';
import { ExternalLink, Music, Image, Ticket, FileVideo } from 'lucide-react';

interface NftCardProps {
    nft: NftAsset;
    onList?: (nft: NftAsset) => void;
}

// Determine NFT category based on metadata
function getNftCategory(metadata: NftMetadata | null): { type: string; icon: React.ReactNode; color: string } {
    if (!metadata) return { type: 'Unknown', icon: <Image className="w-3 h-3" />, color: 'bg-gray-500/20 text-gray-500' };
    
    const category = metadata.properties?.category?.toLowerCase();
    const name = (metadata.name || '').toLowerCase();
    
    if (category === 'audio' || name.includes('track') || name.includes('album') || name.includes('music')) {
        return { type: 'Music', icon: <Music className="w-3 h-3" />, color: 'bg-purple-500/20 text-purple-500' };
    }
    if (category === 'video' || metadata.animation_url?.includes('.mp4')) {
        return { type: 'Video', icon: <FileVideo className="w-3 h-3" />, color: 'bg-blue-500/20 text-blue-500' };
    }
    if (name.includes('badge') || name.includes('ticket') || name.includes('event')) {
        return { type: 'Event Badge', icon: <Ticket className="w-3 h-3" />, color: 'bg-amber-500/20 text-amber-500' };
    }
    
    return { type: 'Artwork', icon: <Image className="w-3 h-3" />, color: 'bg-green-500/20 text-green-500' };
}

// Generate Solana explorer URL
function getExplorerUrl(publicKey: string): string {
    return `https://explorer.solana.com/address/${publicKey}?cluster=devnet`;
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
            <div className="h-48 w-full relative overflow-hidden bg-muted group">
                {/* NFT Type Badge */}
                {!loading && (
                    <div className="absolute top-2 left-2 z-10">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getNftCategory(metadata).color}`}>
                            {getNftCategory(metadata).icon}
                            {getNftCategory(metadata).type}
                        </span>
                    </div>
                )}
                {/* Explorer Link */}
                <a
                    href={getExplorerUrl(nft.publicKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                    title="View on Solana Explorer"
                >
                    <ExternalLink className="w-4 h-4" />
                </a>
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
                <CardDescription className="truncate text-xs font-mono flex items-center gap-1" title={nft.publicKey}>
                    <span>{nft.publicKey.slice(0, 8)}...{nft.publicKey.slice(-8)}</span>
                    <a
                        href={getExplorerUrl(nft.publicKey)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                        title="View on Solana Explorer"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </a>
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
