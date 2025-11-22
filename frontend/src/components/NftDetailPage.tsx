import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Copy, Check } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { fetchNftByAsset, API_BASE_URL } from '@/services/api';
import type { NftAsset, NftMetadata } from '@/services/api';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
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

export const NftDetailPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { publicKey: walletPublicKey, signTransaction } = useWallet();
    const { connection } = useConnection();

    const [nft, setNft] = useState<NftAsset | null>(null);
    const [metadata, setMetadata] = useState<NftMetadata | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [listing, setListing] = useState<Listing | null>(null);
    const [isBuying, setIsBuying] = useState(false);

    useEffect(() => {
        const loadNftDetails = async () => {
            if (!id) return;
            setLoading(true);
            try {
                // Fetch NFT details
                const nftData = await fetchNftByAsset(id);
                setNft(nftData);

                if (nftData.uri) {
                    const response = await fetch(nftData.uri);
                    const meta = await response.json();
                    setMetadata(meta);
                }

                // Check if NFT is listed
                const listingsResponse = await fetch(`${API_BASE_URL}listings`);
                if (listingsResponse.ok) {
                    const data = await listingsResponse.json();
                    const foundListing = data.listings?.find((l: Listing) => l.asset === id);
                    setListing(foundListing || null);
                }

            } catch (error) {
                console.error('Error loading NFT:', error);
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to load NFT details",
                });
            } finally {
                setLoading(false);
            }
        };

        loadNftDetails();
    }, [id, toast]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast({
            title: "Copied!",
            description: "Address copied to clipboard",
        });
        setTimeout(() => setCopied(false), 2000);
    };

    const handleBuy = async () => {
        if (!listing || !walletPublicKey || !signTransaction) {
            toast({
                variant: "destructive",
                title: "Wallet Not Connected",
                description: "Please connect your wallet to buy NFTs.",
            });
            return;
        }

        setIsBuying(true);
        const loadingToast = toast({
            title: "Processing Purchase",
            description: `Buying ${listing.name} for ${listing.price} SOL...`,
        });

        try {
            console.log('Buying NFT:', listing.asset, 'for', listing.price, 'SOL');

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

            loadingToast.dismiss();
            toast({
                title: "Purchase Successful!",
                description: `You successfully bought ${listing.name} for ${listing.price} SOL.`,
            });

            // Refresh data
            navigate('/my-nfts');
        } catch (error) {
            console.error('Error buying NFT:', error);
            loadingToast.dismiss();
            toast({
                variant: "destructive",
                title: "Purchase Failed",
                description: `Failed to buy NFT: ${error instanceof Error ? error.message : String(error)}`,
            });
        } finally {
            setIsBuying(false);
        }
    };

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-7xl">
                <Skeleton className="h-10 w-32 mb-6" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div>
                        <Skeleton className="w-full aspect-square rounded-lg" />
                    </div>
                    <div className="space-y-6">
                        <div>
                            <Skeleton className="h-10 w-3/4 mb-2" />
                            <Skeleton className="h-6 w-1/2" />
                        </div>
                        <Skeleton className="h-24 w-full" />
                        <div className="space-y-3">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-16 w-full" />
                        </div>
                        <Skeleton className="h-12 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    const isOwner = walletPublicKey && (
        nft?.owner === walletPublicKey.toString() ||
        (!!listing && listing.seller === walletPublicKey.toString())
    );
    const isListed = !!listing;

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <Button
                variant="ghost"
                onClick={() => navigate(-1)}
                className="mb-6"
            >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
            </Button>

            <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
                {/* Media Section */}
                <div>
                    <Card className="overflow-hidden">
                        <div className="h-[500px] w-full bg-muted flex items-center justify-center">
                            {metadata?.animation_url ? (
                                metadata.properties?.category === 'audio' ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-500/10 to-pink-500/10 p-8">
                                        {metadata.image && (
                                            <img
                                                src={metadata.image}
                                                alt="Cover"
                                                className="w-full max-w-md object-cover rounded-lg mb-6 shadow-2xl"
                                            />
                                        )}
                                        <audio controls src={metadata.animation_url} className="w-full max-w-md" />
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
                                    alt={nft?.name || 'NFT'}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="text-muted-foreground">No media available</div>
                            )}
                        </div>
                    </Card>

                    {/* Attributes */}
                    {metadata?.attributes && metadata.attributes.length > 0 && (
                        <Card className="mt-6">
                            <CardContent className="p-4">
                                <h3 className="font-semibold text-lg mb-4">Attributes</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {metadata.attributes.map((attr: any, index: number) => (
                                        <div key={index} className="border rounded-lg p-3 bg-muted/50">
                                            <div className="text-xs text-muted-foreground uppercase">{attr.trait_type}</div>
                                            <div className="font-medium mt-1">{attr.value}</div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Details Section */}
                <div className="space-y-4">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">{nft?.name || 'Unnamed NFT'}</h1>
                        <p className="text-sm text-muted-foreground">
                            Owned by <span className="text-foreground font-medium">{nft?.owner?.slice(0, 4)}...{nft?.owner?.slice(-4)}</span>
                        </p>
                        {isListed && (
                            <div className="mt-2 inline-block bg-primary/10 text-primary px-3 py-1 rounded-full font-bold text-base">
                                Price: {listing?.price} SOL
                            </div>
                        )}
                    </div>

                    {metadata?.description && (
                        <Card>
                            <CardContent className="p-3">
                                <h3 className="font-semibold text-sm mb-1">Description</h3>
                                <p className="text-sm text-muted-foreground max-h-24 overflow-y-auto pr-2">{metadata.description}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Details */}
                    <Card>
                        <CardContent className="p-3 space-y-1">
                            <h3 className="font-semibold text-sm">Details</h3>

                            <div className="flex justify-between items-center py-1 border-b text-sm">
                                <span className="text-muted-foreground">Contract Address</span>
                                <div className="flex items-center">
                                    <span className="font-mono">{nft?.publicKey?.slice(0, 4)}...{nft?.publicKey?.slice(-4)}</span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 ml-1"
                                        onClick={() => copyToClipboard(nft?.publicKey || '')}
                                    >
                                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    </Button>
                                </div>
                            </div>

                            <div className="flex justify-between items-center py-1 border-b text-sm">
                                <span className="text-muted-foreground">Token Standard</span>
                                <span className="font-medium">MPL Core</span>
                            </div>

                            <div className="flex justify-between items-center py-1 border-b text-sm">
                                <span className="text-muted-foreground">Blockchain</span>
                                <span className="font-medium">Solana (Devnet)</span>
                            </div>

                            {metadata?.properties?.category && (
                                <div className="flex justify-between items-center py-1 text-sm">
                                    <span className="text-muted-foreground">Media Type</span>
                                    <span className="font-medium capitalize">{metadata.properties.category}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Actions */}
                    <div className="flex gap-3">
                        {isListed && !isOwner && (
                            <Button
                                className="flex-1"
                                size="lg"
                                onClick={handleBuy}
                                disabled={isBuying}
                            >
                                {isBuying ? 'Processing...' : `Buy for ${listing?.price} SOL`}
                            </Button>
                        )}
                        {isOwner && (
                            <Button
                                className="flex-1"
                                size="lg"
                                variant="secondary"
                                disabled
                            >
                                You Own This
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="lg"
                            onClick={() => window.open(`https://core.metaplex.com/explorer/${nft?.publicKey}?env=devnet`, '_blank')}
                        >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            View on Explorer
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
