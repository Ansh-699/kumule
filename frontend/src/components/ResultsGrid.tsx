import React from 'react';
import { NftCard } from './NftCard';
import type { NftAsset } from '@/services/api';

interface ResultsGridProps {
    results: NftAsset[];
}

export const ResultsGrid: React.FC<ResultsGridProps> = ({ results }) => {
    if (!results || results.length === 0) {
        return (
            <div className="text-center text-muted-foreground mt-10">
                No results found.
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 p-4">
            {results.map((nft) => (
                <NftCard key={nft.publicKey} nft={nft} />
            ))}
        </div>
    );
};
