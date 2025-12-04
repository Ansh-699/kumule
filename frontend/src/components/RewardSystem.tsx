import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { API_BASE_URL } from '@/services/api';
import { Music, Gift, Zap, Trophy, Loader2, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface RewardAccount {
    id: string;
    userId: string;
    walletAddress: string;
    interactionCount: number;
    claimedNfts: number;
    lastInteractionAt: string | null;
    createdAt: string;
}

interface AvailableReward {
    id: string;
    name: string;
    description?: string | null;
    requiredPoints: number;
    rewardType: string;
    nftAsset: string;
    imageUrl?: string | null;
    metadataUri?: string;
    adminWallet?: string;
    totalSupply?: number;
    claimedCount?: number;
    isActive?: boolean;
    isDraft?: boolean; // Flag to indicate this is a draft (not minted yet)
}

const POINTS_PER_INTERACTION = 10;

export const RewardSystem = () => {
    const { publicKey, connected, signTransaction } = useWallet();
    const { toast } = useToast();
    const [rewardAccount, setRewardAccount] = useState<RewardAccount | null>(null);
    const [availableRewards, setAvailableRewards] = useState<AvailableReward[]>([]);
    const [loading, setLoading] = useState(true);
    const [interacting, setInteracting] = useState(false);
    const [claiming, setClaiming] = useState<string | null>(null);

    useEffect(() => {
        if (connected && publicKey) {
            fetchRewardAccount();
            fetchAvailableRewards();
        } else {
            setLoading(false);
            setRewardAccount(null);
        }
    }, [connected, publicKey]);

    const fetchRewardAccount = async () => {
        if (!publicKey) return;
        
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/rewards/account?walletAddress=${publicKey.toString()}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || 'Failed to fetch reward account');
            }
            const data = await response.json();
            if (data.rewardAccount) {
                setRewardAccount(data.rewardAccount);
            } else {
                // If no reward account, create one by making a request
                setRewardAccount({
                    id: '',
                    userId: '',
                    walletAddress: publicKey.toString(),
                    interactionCount: 0,
                    claimedNfts: 0,
                    lastInteractionAt: null,
                    createdAt: new Date().toISOString()
                });
            }
        } catch (error: any) {
            console.error('Error fetching reward account:', error);
            // Don't show error toast on initial load, just set default values
            setRewardAccount({
                id: '',
                userId: '',
                walletAddress: publicKey.toString(),
                interactionCount: 0,
                claimedNfts: 0,
                lastInteractionAt: null,
                createdAt: new Date().toISOString()
            });
        } finally {
            setLoading(false);
        }
    };

    const fetchAvailableRewards = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/rewards/available`);
            if (!response.ok) {
                console.warn('Failed to fetch available rewards, using defaults');
                // Set default rewards if API fails
                setAvailableRewards([
                    {
                        id: 'music-nft-1',
                        name: 'Music NFT #1',
                        description: 'Exclusive music NFT reward',
                        requiredPoints: 100,
                        rewardType: 'MUSIC_NFT',
                        nftAsset: '',
                        imageUrl: '/rewards/music-nft-1.png'
                    },
                    {
                        id: 'music-nft-2',
                        name: 'Music NFT #2',
                        description: 'Rare music NFT reward',
                        requiredPoints: 250,
                        rewardType: 'MUSIC_NFT',
                        nftAsset: '',
                        imageUrl: '/rewards/music-nft-2.png'
                    }
                ]);
                return;
            }
            const data = await response.json();
            setAvailableRewards((data.rewards || []).map((r: any) => ({
                ...r,
                description: r.description || null,
                imageUrl: r.imageUrl || null,
                nftAsset: r.nftAsset || ''
            })));
        } catch (error) {
            console.error('Error fetching available rewards:', error);
            // Set default rewards on error
            setAvailableRewards([
                {
                    id: 'music-nft-1',
                    name: 'Music NFT #1',
                    description: 'Exclusive music NFT reward',
                    requiredPoints: 100,
                    rewardType: 'MUSIC_NFT',
                    nftAsset: '',
                    imageUrl: '/rewards/music-nft-1.png'
                }
            ]);
        }
    };

    const handleInteraction = async (type: string = 'CLICK') => {
        if (!publicKey || interacting) return;

        setInteracting(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/rewards/interaction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: publicKey.toString(),
                    interactionType: type,
                    points: POINTS_PER_INTERACTION
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to record interaction');
            }

            const data = await response.json();
            setRewardAccount(data.rewardAccount);
            
            toast({
                title: "Points Earned!",
                description: `You earned ${POINTS_PER_INTERACTION} points!`,
            });

            // Animate progress bar
            setTimeout(() => {
                fetchRewardAccount();
            }, 500);
        } catch (error: any) {
            console.error('Error recording interaction:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to record interaction",
            });
        } finally {
            setInteracting(false);
        }
    };

    const handleFillMeter = async () => {
        if (!publicKey) return;
        
        const points = prompt('Enter points to add:');
        if (!points || isNaN(parseInt(points))) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "Please enter a valid number",
            });
            return;
        }

        try {
            // Use the admin password for admin endpoints
            const apiKey = 'anshtyagi';
            
            const response = await fetch(`${API_BASE_URL}/api/admin/rewards/fill-meter?apiKey=${apiKey}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': apiKey
                },
                body: JSON.stringify({ 
                    walletAddress: publicKey.toString(), 
                    points: parseInt(points) 
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fill meter');
            }

            await fetchRewardAccount();
            toast({
                title: "Success",
                description: `Added ${points} points!`,
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to fill meter",
            });
        }
    };

    const handleResetMeter = async () => {
        if (!publicKey) return;
        
        if (!confirm('Are you sure you want to reset your points to 0?')) {
            return;
        }

        try {
            // Use the admin password for admin endpoints
            const apiKey = 'anshtyagi';
            
            const response = await fetch(`${API_BASE_URL}/api/admin/rewards/reset-meter?apiKey=${apiKey}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': apiKey
                },
                body: JSON.stringify({ 
                    walletAddress: publicKey.toString()
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to reset meter');
            }

            await fetchRewardAccount();
            toast({
                title: "Success",
                description: "Points reset to 0",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to reset meter",
            });
        }
    };

    const handleClaimReward = async (reward: AvailableReward) => {
        if (!publicKey || claiming || !signTransaction) return;

        // Use displayAccount for checking
        const account = rewardAccount || {
            id: '',
            userId: '',
            walletAddress: publicKey.toString(),
            interactionCount: 0,
            claimedNfts: 0,
            lastInteractionAt: null,
            createdAt: new Date().toISOString()
        };

        if (account.interactionCount < reward.requiredPoints) {
            toast({
                variant: "destructive",
                title: "Insufficient Points",
                description: `You need ${reward.requiredPoints} points to claim this reward. You have ${account.interactionCount} points.`,
            });
            return;
        }

        // Check if this is a draft (not minted yet)
        if (reward.isDraft || !reward.nftAsset) {
            toast({
                variant: "destructive",
                title: "Not Available",
                description: "This reward is not yet minted. Please wait for the admin to mint it.",
            });
            return;
        }

        setClaiming(reward.id);
        try {
            const response = await fetch(`${API_BASE_URL}/api/rewards/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: publicKey.toString(),
                    rewardNftId: reward.id,
                    requiredPoints: reward.requiredPoints
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to claim reward');
            }

            const data = await response.json();
            
            // Sign and send transaction if provided
            if (data.transaction && signTransaction) {
                const { Connection, VersionedTransaction } = await import('@solana/web3.js');
                const connection = new Connection('https://api.devnet.solana.com');
                
                const transactionBuffer = Buffer.from(data.transaction, 'base64');
                const transaction = VersionedTransaction.deserialize(transactionBuffer);
                
                const signedTransaction = await signTransaction(transaction);
                const signature = await connection.sendRawTransaction(signedTransaction.serialize());
                
                await connection.confirmTransaction(signature, 'confirmed');
                
                toast({
                    title: "Reward Claimed!",
                    description: `You've successfully claimed ${reward.name}! Transaction: ${signature.slice(0, 8)}...`,
                });
            } else {
                toast({
                    title: "Reward Claimed!",
                    description: `You've successfully claimed ${reward.name}!`,
                });
            }

            setRewardAccount(data.rewardAccount);

            // Refresh data
            fetchRewardAccount();
            fetchAvailableRewards();
        } catch (error: any) {
            console.error('Error claiming reward:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to claim reward",
            });
        } finally {
            setClaiming(null);
        }
    };

    // Use default values if rewardAccount is null
    const displayAccount = rewardAccount || {
        id: '',
        userId: '',
        walletAddress: publicKey?.toString() || '',
        interactionCount: 0,
        claimedNfts: 0,
        lastInteractionAt: null,
        createdAt: new Date().toISOString()
    };

    const getProgressPercentage = () => {
        if (!displayAccount || availableRewards.length === 0) return 0;
        
        // Find the next available reward
        const nextReward = availableRewards
            .filter(r => displayAccount.interactionCount < r.requiredPoints)
            .sort((a, b) => a.requiredPoints - b.requiredPoints)[0];
        
        if (!nextReward) return 100;
        
        return Math.min((displayAccount.interactionCount / nextReward.requiredPoints) * 100, 100);
    };

    const getNextReward = () => {
        if (!displayAccount || availableRewards.length === 0) return null;
        
        return availableRewards
            .filter(r => displayAccount.interactionCount < r.requiredPoints)
            .sort((a, b) => a.requiredPoints - b.requiredPoints)[0];
    };

    if (!connected) {
        return (
            <Card className="w-full max-w-2xl mx-auto">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Gift className="h-5 w-5" />
                        Reward System
                    </CardTitle>
                    <CardDescription>Connect your wallet to start earning rewards!</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-gray-500 py-8">
                        Please connect your Solana wallet to participate in the reward system.
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (loading && !rewardAccount) {
        return (
            <Card className="w-full max-w-2xl mx-auto">
                <CardHeader>
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-64 mt-2" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-32 w-full" />
                </CardContent>
            </Card>
        );
    }

    const nextReward = getNextReward();
    const progress = getProgressPercentage();

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 p-6">
            {/* Main Reward Card */}
            <Card className="border-2 border-primary/20 shadow-lg">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
                    <CardTitle className="flex items-center gap-2 text-2xl">
                        <Trophy className="h-6 w-6 text-yellow-500" />
                        Your Reward Progress
                    </CardTitle>
                    <CardDescription className="text-base">
                        Interact with the platform to earn points and claim exclusive NFTs!
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                    {/* Points Display */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Total Points</p>
                            <p className="text-3xl font-bold text-primary">
                                {displayAccount.interactionCount}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-gray-600">NFTs Claimed</p>
                            <p className="text-3xl font-bold text-emerald-600">
                                {displayAccount.claimedNfts}
                            </p>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">Progress to Next Reward</span>
                            <span className="font-medium text-primary">
                                {Math.round(progress)}%
                            </span>
                        </div>
                        <Progress value={progress} className="h-4" />
                        {nextReward && (
                            <p className="text-xs text-gray-500 text-center">
                                {displayAccount.interactionCount} / {nextReward.requiredPoints} points needed for {nextReward.name}
                            </p>
                        )}
                    </div>

                    {/* Interaction Button */}
                    <div className="flex gap-3">
                        <Button
                            onClick={() => handleInteraction('CLICK')}
                            disabled={interacting}
                            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                            size="lg"
                        >
                            {interacting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Earning Points...
                                </>
                            ) : (
                                <>
                                    <Zap className="h-4 w-4 mr-2" />
                                    Earn Points
                                </>
                            )}
                        </Button>
                        <Button
                            onClick={handleFillMeter}
                            variant="outline"
                            className="bg-blue-50 hover:bg-blue-100"
                            size="lg"
                        >
                            Fill Meter
                        </Button>
                        <Button
                            onClick={handleResetMeter}
                            variant="outline"
                            className="bg-red-50 hover:bg-red-100"
                            size="lg"
                        >
                            Reset Meter
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Available Rewards */}
            <div className="space-y-4">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Gift className="h-6 w-6" />
                    Available Rewards
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {availableRewards.map((reward) => {
                        const canClaim = displayAccount && displayAccount.interactionCount >= reward.requiredPoints;
                        const isClaiming = claiming === reward.id;
                        
                        return (
                            <Card key={reward.id} className={`transition-all hover:shadow-lg ${
                                canClaim ? 'border-2 border-emerald-500' : 'border'
                            }`}>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            {reward.rewardType === 'MUSIC_NFT' ? (
                                                <Music className="h-5 w-5 text-purple-600" />
                                            ) : (
                                                <Gift className="h-5 w-5 text-blue-600" />
                                            )}
                                            {reward.name}
                                        </CardTitle>
                                        <Badge variant={canClaim ? "default" : "outline"}>
                                            {reward.requiredPoints} pts
                                        </Badge>
                                    </div>
                                    <CardDescription>{reward.description}</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {/* Image Preview */}
                                    {reward.imageUrl && (
                                        <div className="w-full h-32 overflow-hidden rounded-lg border border-gray-200">
                                            <img 
                                                src={reward.imageUrl} 
                                                alt={reward.name}
                                                className="w-full h-full object-cover"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-gray-600">Required Points:</span>
                                        <span className="font-medium">{reward.requiredPoints}</span>
                                    </div>
                                    {displayAccount && (
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-600">Your Points:</span>
                                            <span className={`font-medium ${
                                                canClaim ? 'text-emerald-600' : 'text-gray-900'
                                            }`}>
                                                {displayAccount.interactionCount}
                                            </span>
                                        </div>
                                    )}
                                    {reward.totalSupply !== undefined && reward.claimedCount !== undefined && (
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-600">Available:</span>
                                            <span className={`font-medium ${
                                                reward.claimedCount >= reward.totalSupply ? 'text-red-600' : 'text-gray-900'
                                            }`}>
                                                {reward.totalSupply - reward.claimedCount} / {reward.totalSupply}
                                            </span>
                                        </div>
                                    )}
                                    <Button
                                        onClick={() => handleClaimReward(reward)}
                                        disabled={!canClaim || isClaiming || (reward.claimedCount !== undefined && reward.totalSupply !== undefined && reward.claimedCount >= reward.totalSupply) || reward.isDraft || !reward.nftAsset}
                                        className="w-full"
                                        variant={canClaim ? "default" : "outline"}
                                    >
                                        {isClaiming ? (
                                            <>
                                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                Claiming...
                                            </>
                                        ) : reward.isDraft || !reward.nftAsset ? (
                                            <>
                                                <Clock className="h-4 w-4 mr-2" />
                                                Not Minted Yet
                                            </>
                                        ) : reward.claimedCount !== undefined && reward.totalSupply !== undefined && reward.claimedCount >= reward.totalSupply ? (
                                            <>
                                                Out of Stock
                                            </>
                                        ) : canClaim ? (
                                            <>
                                                <Gift className="h-4 w-4 mr-2" />
                                                Claim NFT
                                            </>
                                        ) : (
                                            <>
                                                <Trophy className="h-4 w-4 mr-2" />
                                                Not Enough Points
                                            </>
                                        )}
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

