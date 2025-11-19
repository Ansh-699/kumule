import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { NftAsset } from '@/services/api';

interface ListNftModalProps {
    nft: NftAsset | null;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (price: number) => void;
}

export const ListNftModal: React.FC<ListNftModalProps> = ({ nft, isOpen, onClose, onConfirm }) => {
    const [price, setPrice] = useState('');
    const [error, setError] = useState('');

    if (!isOpen || !nft) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const numPrice = Number(price);
        if (!price || isNaN(numPrice) || numPrice <= 0) {
            setError('Please enter a valid positive price.');
            return;
        }
        onConfirm(numPrice);
        setPrice('');
        setError('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <Card className="w-full max-w-md shadow-xl">
                <CardHeader>
                    <CardTitle>List NFT for Sale</CardTitle>
                    <CardDescription>
                        Transfer <strong>{nft.name}</strong> to the marketplace.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="flex items-center justify-center p-4 bg-muted rounded-md">
                            <div className="text-center">
                                <p className="font-semibold text-lg">{nft.name}</p>
                                <p className="text-xs text-muted-foreground font-mono">{nft.publicKey}</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="price" className="text-sm font-medium">
                                Sale Price (SOL)
                            </label>
                            <Input
                                id="price"
                                type="number"
                                step="0.000000001"
                                min="0"
                                placeholder="0.5"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                autoFocus
                            />
                            {error && <p className="text-sm text-red-500">{error}</p>}
                        </div>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} type="button">
                        Cancel
                    </Button>
                    <Button onClick={(e) => handleSubmit(e as any)}>
                        Send to Marketplace
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};
