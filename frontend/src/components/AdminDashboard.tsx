import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { SystemProgram, PublicKey, LAMPORTS_PER_SOL, Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { Buffer } from 'buffer';
// Removed unused imports: useUmi, createGenericFile
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { API_BASE_URL, uploadImageToR2, uploadMetadataToR2 } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, RefreshCw, LogOut, Users, Image, AlertTriangle, ArrowLeftRight, Wallet, Eye, ExternalLink, Copy, MoreVertical, Info, Gift, Plus, Trash2, Pencil } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

interface DashboardData {
    users: any[];
    transactions: any[];
    nfts: any[];
    disputes: any[];
    escrows: any[];
    events: any[];
    stats: {
        totalUsers: number;
        totalNfts: number;
        totalTransactions: number;
        totalDisputes: number;
        pendingDisputes: number;
        approvedDisputes: number;
        totalEvents: number;
        totalEscrows: number;
    };
}

export const AdminDashboard = ({ apiKey, onLogout }: { apiKey: string; onLogout: () => void }) => {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [resolvingDispute, setResolvingDispute] = useState<string | null>(null);
    const [approveDialogOpen, setApproveDialogOpen] = useState(false);
    const [selectedDispute, setSelectedDispute] = useState<any>(null);
    const [transferring, setTransferring] = useState(false);
    const [disputeDetailOpen, setDisputeDetailOpen] = useState(false);
    const [selectedDisputeDetail, setSelectedDisputeDetail] = useState<any>(null);
    const [userDetailOpen, setUserDetailOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [nftMetadata, setNftMetadata] = useState<Record<string, any>>({});
    const [rewardNfts, setRewardNfts] = useState<any[]>([]);
    const [rewardNftLoading, setRewardNftLoading] = useState(false);
    const [rewardDrafts, setRewardDrafts] = useState<any[]>([]);
    const [draftsLoading, setDraftsLoading] = useState(false);
    const [mintRewardDialogOpen, setMintRewardDialogOpen] = useState(false);
    const [selectedDraft, setSelectedDraft] = useState<any | null>(null);
    const [editSupplyDialogOpen, setEditSupplyDialogOpen] = useState(false);
    const [selectedRewardForEdit, setSelectedRewardForEdit] = useState<any | null>(null);
    const [newSupply, setNewSupply] = useState<string>('');
    const [mintingReward, setMintingReward] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const [uploadedImageUri, setUploadedImageUri] = useState<string | null>(null);
    const [uploadedMetadataUri, setUploadedMetadataUri] = useState<string | null>(null);
    const [rewardFormData, setRewardFormData] = useState({
        name: '',
        description: '',
        requiredPoints: '100',
        rewardType: 'MUSIC_NFT',
        totalSupply: '1'
    });
    const { toast } = useToast();
    const { publicKey, signTransaction, connected } = useWallet();
    const { connection } = useConnection();

    const fetchDashboard = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/dashboard?apiKey=${apiKey}`);
            if (!response.ok) {
                if (response.status === 401) {
                    toast({
                        variant: "destructive",
                        title: "Unauthorized",
                        description: "Invalid API key. Please login again.",
                    });
                    onLogout();
                    return;
                }
                throw new Error('Failed to fetch dashboard data');
            }
            const dashboardData = await response.json();
            setData(dashboardData);
        } catch (error) {
            console.error('Error fetching dashboard:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to load dashboard data",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboard();
        fetchRewardNfts();
        fetchRewardDrafts();
    }, [apiKey]);

    const fetchRewardNfts = async () => {
        setRewardNftLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/rewards?apiKey=${apiKey}`);
            if (response.ok) {
                const data = await response.json();
                setRewardNfts(data.rewardNfts || []);
            }
        } catch (error) {
            console.error('Failed to fetch reward NFTs:', error);
        } finally {
            setRewardNftLoading(false);
        }
    };

    const fetchRewardDrafts = async () => {
        setDraftsLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/rewards/drafts?apiKey=${apiKey}`);
            if (response.ok) {
                const data = await response.json();
                setRewardDrafts(data.drafts || []);
            }
        } catch (error) {
            console.error('Failed to fetch reward drafts:', error);
        } finally {
            setDraftsLoading(false);
        }
    };

    // Fetch NFT metadata for all NFTs
    useEffect(() => {
        if (!data?.nfts) return;
        
        const fetchAllMetadata = async () => {
            const metadataMap: Record<string, any> = {};
            await Promise.all(
                data.nfts.map(async (nft) => {
                    if (nft.metadataUri) {
                        try {
                            const response = await fetch(nft.metadataUri);
                            const meta = await response.json();
                            metadataMap[nft.id] = meta;
                        } catch (error) {
                            console.error(`Failed to fetch metadata for NFT ${nft.nftId}:`, error);
                        }
                    }
                })
            );
            setNftMetadata(metadataMap);
        };
        
        fetchAllMetadata();
    }, [data?.nfts]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast({
            title: "Copied",
            description: "Copied to clipboard",
        });
    };

    const getExplorerUrl = (signature: string) => {
        // Check if it's a Solana transaction hash (base58, 88 chars) or charge ID
        if (signature.length === 88 || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signature)) {
            return `https://solscan.io/tx/${signature}?cluster=devnet`;
        }
        return null;
    };

    const handleApproveClick = (dispute: any) => {
        if (!connected || !publicKey) {
            toast({
                variant: "destructive",
                title: "Wallet Not Connected",
                description: "Please connect your wallet to approve and transfer SOL",
            });
            return;
        }
        setSelectedDispute(dispute);
        setApproveDialogOpen(true);
    };

    const handleTransferSOL = async () => {
        if (!selectedDispute || !publicKey || !signTransaction) {
            return;
        }

        setTransferring(true);
        try {
            // Validate and clean wallet address
            let walletAddress = selectedDispute.walletAddress.trim();
            
            // Remove any invalid characters
            const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
            const invalidChars = walletAddress.split('').filter((char: string) => !base58Chars.includes(char));
            
            if (invalidChars.length > 0) {
                throw new Error(`Invalid characters in wallet address: ${invalidChars.join(', ')}. Solana addresses only use base58 characters (no 0, O, I, l).`);
            }

            const recipientPubkey = new PublicKey(walletAddress);
            const amountLamports = Math.floor(parseFloat(selectedDispute.amount.toString()) * LAMPORTS_PER_SOL);

            // Check sender's balance
            const senderBalance = await connection.getBalance(publicKey);
            if (senderBalance < amountLamports) {
                throw new Error(`Insufficient SOL balance. You need ${selectedDispute.amount} SOL.`);
            }

            // Create transfer instruction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: recipientPubkey,
                    lamports: amountLamports,
                })
            );

            // Get recent blockhash
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = publicKey;

            // Sign transaction
            const signedTransaction = await signTransaction(transaction);

            // Send transaction
            const signature = await connection.sendRawTransaction(signedTransaction.serialize());

            // Confirm transaction
            await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

            // Update dispute status to APPROVED and mark as refunded
            const response = await fetch(`${API_BASE_URL}/api/disputes/${selectedDispute.id}/resolve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': apiKey,
                },
                body: JSON.stringify({
                    status: 'APPROVED',
                    adminNotes: `Refunded via SOL transfer: ${signature}`,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to update dispute status');
            }

            // Mark as refunded with transaction hash
            const refundResponse = await fetch(`${API_BASE_URL}/api/disputes/${selectedDispute.id}/refunded`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': apiKey,
                },
                body: JSON.stringify({ refundTxHash: signature }),
            });

            if (!refundResponse.ok) {
                throw new Error('Failed to mark dispute as refunded');
            }

            toast({
                title: "Success",
                description: `Transferred ${selectedDispute.amount} SOL successfully. Transaction: ${signature.slice(0, 8)}...`,
            });

            setApproveDialogOpen(false);
            setSelectedDispute(null);
            fetchDashboard();
        } catch (error: any) {
            console.error('Error transferring SOL:', error);
            let errorMessage = 'Failed to transfer SOL. Please try again.';
            
            if (error.message) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
            
            toast({
                variant: "destructive",
                title: "Transfer Failed",
                description: errorMessage,
            });
        } finally {
            setTransferring(false);
        }
    };

    const handleResolveDispute = async (disputeId: string, status: 'APPROVED' | 'REJECTED', adminNotes?: string) => {
        if (status === 'APPROVED') {
            // Find the dispute and open approve dialog
            const dispute = data?.disputes.find(d => d.id === disputeId);
            if (dispute) {
                handleApproveClick(dispute);
            }
            return;
        }

        // Handle REJECTED status
        setResolvingDispute(disputeId);
        try {
            const response = await fetch(`${API_BASE_URL}/api/disputes/${disputeId}/resolve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': apiKey,
                },
                body: JSON.stringify({
                    status,
                    adminNotes: adminNotes || `Dispute ${status.toLowerCase()} by admin`,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to resolve dispute');
            }

            toast({
                title: "Success",
                description: `Dispute ${status.toLowerCase()} successfully`,
            });

            fetchDashboard();
        } catch (error) {
            console.error('Error resolving dispute:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to resolve dispute",
            });
        } finally {
            setResolvingDispute(null);
        }
    };

    const handleMarkRefunded = async (disputeId: string, refundTxHash: string) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/disputes/${disputeId}/refunded`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-API-Key': apiKey,
                },
                body: JSON.stringify({ refundTxHash }),
            });

            if (!response.ok) {
                throw new Error('Failed to mark dispute as refunded');
            }

            toast({
                title: "Success",
                description: "Dispute marked as refunded",
            });

            fetchDashboard();
        } catch (error) {
            console.error('Error marking dispute as refunded:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to mark dispute as refunded",
            });
        }
    };

    if (loading) {
        return (
            <div className="container mx-auto p-6 space-y-6 bg-white min-h-screen">
                <Skeleton className="h-10 w-48" />
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Skeleton className="h-32" />
                    <Skeleton className="h-32" />
                    <Skeleton className="h-32" />
                    <Skeleton className="h-32" />
                </div>
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="container mx-auto p-6 bg-white min-h-screen">
                <Card className="border border-gray-200 shadow-sm">
                    <CardContent className="p-6">
                        <p className="text-gray-500">No data available</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 space-y-6 bg-white min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage your NFT marketplace</p>
                </div>
                <div className="flex items-center gap-3">
                    {!connected && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                            <Wallet className="h-3 w-3 mr-1" />
                            Connect wallet to approve disputes
                        </Badge>
                    )}
                    <WalletMultiButton className="!bg-primary hover:!bg-primary/90 !text-primary-foreground" />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="border-gray-300 hover:bg-gray-50">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={fetchDashboard}>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Refresh Data
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onLogout} className="text-red-600">
                                <LogOut className="h-4 w-4 mr-2" />
                                Logout
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-gray-600">Total Users</CardTitle>
                        <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                            <Users className="h-5 w-5 text-emerald-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900">{data.stats.totalUsers}</div>
                        <p className="text-xs text-gray-500 mt-1">Registered users</p>
                    </CardContent>
                </Card>
                <Card className="border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-gray-600">Total NFTs</CardTitle>
                        <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                            <Image className="h-5 w-5 text-purple-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900">{data.stats.totalNfts}</div>
                        <p className="text-xs text-gray-500 mt-1">Minted NFTs</p>
                    </CardContent>
                </Card>
                <Card className="border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-gray-600">Pending Disputes</CardTitle>
                        <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                            <AlertTriangle className="h-5 w-5 text-amber-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-amber-600">{data.stats.pendingDisputes}</div>
                        <p className="text-xs text-gray-500 mt-1">Requires attention</p>
                    </CardContent>
                </Card>
                <Card className="border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-gray-600">Total Transactions</CardTitle>
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <ArrowLeftRight className="h-5 w-5 text-blue-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-gray-900">{data.stats.totalTransactions}</div>
                        <p className="text-xs text-gray-500 mt-1">All transactions</p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="disputes" className="space-y-4">
                <TabsList className="bg-gray-100 border border-gray-200">
                    <TabsTrigger value="disputes" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 text-gray-600">
                        Disputes ({data.disputes.length})
                    </TabsTrigger>
                    <TabsTrigger value="users" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 text-gray-600">
                        Users ({data.users.length})
                    </TabsTrigger>
                    <TabsTrigger value="transactions" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 text-gray-600">
                        Transactions ({data.transactions.length})
                    </TabsTrigger>
                    <TabsTrigger value="nfts" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 text-gray-600">
                        NFTs ({data.nfts.length})
                    </TabsTrigger>
                    <TabsTrigger value="events" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 text-gray-600">
                        Events ({data.events.length})
                    </TabsTrigger>
                    <TabsTrigger value="rewards" className="data-[state=active]:bg-white data-[state=active]:text-gray-900 text-gray-600">
                        <Gift className="h-4 w-4 mr-2" />
                        Rewards ({rewardNfts.length})
                    </TabsTrigger>
                </TabsList>

                {/* Disputes Tab */}
                <TabsContent value="disputes" className="space-y-4">
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-gray-900">Disputes</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {data.disputes.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No disputes found</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-gray-200 hover:bg-gray-50">
                                                <TableHead className="text-gray-600">ID</TableHead>
                                                <TableHead className="text-gray-600">Wallet</TableHead>
                                                <TableHead className="text-gray-600">Amount (SOL)</TableHead>
                                                <TableHead className="text-gray-600">Reason</TableHead>
                                                <TableHead className="text-gray-600">Status</TableHead>
                                                <TableHead className="text-gray-600">Created</TableHead>
                                                <TableHead className="text-gray-600">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.disputes.map((dispute) => (
                                                <TableRow key={dispute.id} className="border-gray-200 hover:bg-gray-50 cursor-pointer" onClick={() => {
                                                    setSelectedDisputeDetail(dispute);
                                                    setDisputeDetailOpen(true);
                                                }}>
                                                    <TableCell className="font-mono text-xs text-gray-700">{dispute.id.slice(0, 8)}...</TableCell>
                                                    <TableCell className="font-mono text-xs text-gray-700">{dispute.walletAddress.slice(0, 4)}...{dispute.walletAddress.slice(-4)}</TableCell>
                                                    <TableCell className="text-gray-700">{Number(dispute.amount).toFixed(4)}</TableCell>
                                                    <TableCell className="max-w-xs truncate text-gray-700">{dispute.reason}</TableCell>
                                                    <TableCell>
                                                        <Badge 
                                                            variant={
                                                                dispute.status === 'PENDING' ? 'outline' :
                                                                dispute.status === 'APPROVED' ? 'default' :
                                                                'destructive'
                                                            }
                                                            className={
                                                                dispute.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-300' :
                                                                dispute.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                                                                'bg-red-50 text-red-700 border-red-300'
                                                            }
                                                        >
                                                            {dispute.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-gray-500">{new Date(dispute.createdAt).toLocaleDateString()}</TableCell>
                                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                                    <MoreVertical className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-48">
                                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem onClick={() => {
                                                                    setSelectedDisputeDetail(dispute);
                                                                    setDisputeDetailOpen(true);
                                                                }}>
                                                                    <Eye className="h-4 w-4 mr-2" />
                                                                    View Details
                                                                </DropdownMenuItem>
                                                                {dispute.status === 'PENDING' && (
                                                                    <>
                                                                        <DropdownMenuSeparator />
                                                                        <DropdownMenuItem 
                                                                            onClick={() => handleResolveDispute(dispute.id, 'APPROVED')}
                                                                            disabled={resolvingDispute === dispute.id || !connected}
                                                                            className="text-emerald-600"
                                                                        >
                                                                            <Check className="h-4 w-4 mr-2" />
                                                                            Approve & Transfer
                                                                        </DropdownMenuItem>
                                                                        <DropdownMenuItem 
                                                                            onClick={() => handleResolveDispute(dispute.id, 'REJECTED')}
                                                                            disabled={resolvingDispute === dispute.id}
                                                                            className="text-red-600"
                                                                        >
                                                                            <X className="h-4 w-4 mr-2" />
                                                                            Reject
                                                                        </DropdownMenuItem>
                                                                    </>
                                                                )}
                                                                {dispute.status === 'APPROVED' && !dispute.refundTxHash && (
                                                                    <>
                                                                        <DropdownMenuSeparator />
                                                                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                                                            <div className="w-full">
                                                                                <p className="text-xs text-gray-500 mb-1">Mark as refunded:</p>
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder="Refund TX Hash"
                                                                                    className="text-xs p-2 bg-gray-50 border border-gray-300 rounded w-full text-gray-700 placeholder-gray-400 focus:outline-none focus:border-gray-400"
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === 'Enter') {
                                                                                            const txHash = (e.target as HTMLInputElement).value;
                                                                                            if (txHash) {
                                                                                                handleMarkRefunded(dispute.id, txHash);
                                                                                            }
                                                                                        }
                                                                                    }}
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                />
                                                                            </div>
                                                                        </DropdownMenuItem>
                                                                    </>
                                                                )}
                                                                {dispute.refundTxHash && (
                                                                    <DropdownMenuItem disabled>
                                                                        <span className="text-xs text-emerald-600">Refunded: {dispute.refundTxHash.slice(0, 8)}...</span>
                                                                    </DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Users Tab */}
                <TabsContent value="users" className="space-y-4">
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-gray-900">Users</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-gray-200 hover:bg-gray-50">
                                            <TableHead className="text-gray-600">ID</TableHead>
                                            <TableHead className="text-gray-600">Wallets</TableHead>
                                            <TableHead className="text-gray-600">Created</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.users.map((user) => (
                                            <TableRow 
                                                key={user.id} 
                                                className="border-gray-200 hover:bg-gray-50 cursor-pointer"
                                                onClick={() => {
                                                    setSelectedUser(user);
                                                    setUserDetailOpen(true);
                                                }}
                                            >
                                                <TableCell className="font-mono text-xs text-gray-700">{user.id.slice(0, 8)}...</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        {user.wallets.map((w: any) => (
                                                            <Badge key={w.id} variant="outline" className="font-mono text-xs">
                                                                {w.walletAddress.slice(0, 8)}...{w.walletAddress.slice(-4)}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-xs text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                                                <TableCell onClick={(e) => e.stopPropagation()}>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                                <MoreVertical className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onClick={() => {
                                                                setSelectedUser(user);
                                                                setUserDetailOpen(true);
                                                            }}>
                                                                <Eye className="h-4 w-4 mr-2" />
                                                                View Details
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Transactions Tab */}
                <TabsContent value="transactions" className="space-y-4">
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-gray-900">Transactions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-gray-200 hover:bg-gray-50">
                                            <TableHead className="text-gray-600">ID</TableHead>
                                            <TableHead className="text-gray-600">Type</TableHead>
                                            <TableHead className="text-gray-600">Amount</TableHead>
                                            <TableHead className="text-gray-600">Status</TableHead>
                                            <TableHead className="text-gray-600">Wallet</TableHead>
                                            <TableHead className="text-gray-600">Created</TableHead>
                                            <TableHead className="text-gray-600">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.transactions.map((tx) => (
                                            <TableRow key={tx.id} className="border-gray-200 hover:bg-gray-50">
                                                <TableCell className="font-mono text-xs text-gray-700">{tx.transactionId.slice(0, 12)}...</TableCell>
                                                <TableCell className="text-gray-700">{tx.transactionType}</TableCell>
                                                <TableCell className="text-gray-700">{Number(tx.amount).toFixed(4)} {tx.currency || 'SOL'}</TableCell>
                                                <TableCell>
                                                    <Badge 
                                                        variant={
                                                            tx.status === 'COMPLETED' ? 'default' :
                                                            tx.status === 'PENDING' ? 'outline' :
                                                            'destructive'
                                                        }
                                                        className={
                                                            tx.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                                                            tx.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-300' :
                                                            'bg-red-50 text-red-700 border-red-300'
                                                        }
                                                    >
                                                        {tx.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs text-gray-700">
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-auto p-0 font-mono text-xs">
                                                                {tx.walletAddress?.slice(0, 8)}...{tx.walletAddress?.slice(-4)}
                                                                <Info className="h-3 w-3 ml-1 opacity-50" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-64">
                                                            <div className="space-y-2">
                                                                <p className="text-xs font-medium text-gray-600">Wallet Address</p>
                                                                <div className="flex items-center gap-2">
                                                                    <p className="font-mono text-xs text-gray-700 break-all">{tx.walletAddress || 'N/A'}</p>
                                                                    {tx.walletAddress && (
                                                                        <Button
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            onClick={() => copyToClipboard(tx.walletAddress!)}
                                                                            className="h-6 w-6 p-0"
                                                                        >
                                                                            <Copy className="h-3 w-3" />
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </PopoverContent>
                                                    </Popover>
                                                </TableCell>
                                                <TableCell className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                                <MoreVertical className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                            <DropdownMenuSeparator />
                                                            {tx.txHash && (() => {
                                                                const explorerUrl = getExplorerUrl(tx.txHash);
                                                                return explorerUrl ? (
                                                                    <DropdownMenuItem onClick={() => window.open(explorerUrl, '_blank')}>
                                                                        <ExternalLink className="h-4 w-4 mr-2" />
                                                                        View on Explorer
                                                                    </DropdownMenuItem>
                                                                ) : null;
                                                            })()}
                                                            {tx.transactionId && !tx.txHash && (() => {
                                                                const explorerUrl = getExplorerUrl(tx.transactionId);
                                                                return explorerUrl ? (
                                                                    <DropdownMenuItem onClick={() => window.open(explorerUrl, '_blank')}>
                                                                        <ExternalLink className="h-4 w-4 mr-2" />
                                                                        View on Explorer
                                                                    </DropdownMenuItem>
                                                                ) : null;
                                                            })()}
                                                            <DropdownMenuItem onClick={() => copyToClipboard(tx.transactionId)}>
                                                                <Copy className="h-4 w-4 mr-2" />
                                                                Copy Transaction ID
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* NFTs Tab */}
                <TabsContent value="nfts" className="space-y-4">
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-gray-900">NFTs</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-gray-200 hover:bg-gray-50">
                                            <TableHead className="text-gray-600">Preview</TableHead>
                                            <TableHead className="text-gray-600">NFT ID</TableHead>
                                            <TableHead className="text-gray-600">Name</TableHead>
                                            <TableHead className="text-gray-600">Metadata</TableHead>
                                            <TableHead className="text-gray-600">Owner</TableHead>
                                            <TableHead className="text-gray-600">Minted</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.nfts.map((nft) => {
                                            const metadata = nftMetadata[nft.id];
                                            const imageUrl = metadata?.image || null;
                                            return (
                                                <TableRow key={nft.id} className="border-gray-200 hover:bg-gray-50">
                                                    <TableCell>
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <div className="cursor-pointer">
                                                                    {imageUrl ? (
                                                                        <img 
                                                                            src={imageUrl} 
                                                                            alt={nft.name}
                                                                            className="w-12 h-12 object-cover rounded border border-gray-200 hover:border-gray-300 transition-colors"
                                                                            onError={(e) => {
                                                                                (e.target as HTMLImageElement).style.display = 'none';
                                                                            }}
                                                                        />
                                                                    ) : (
                                                                        <div className="w-12 h-12 bg-gray-100 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-200 transition-colors">
                                                                            <Image className="h-4 w-4 text-gray-400" />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-80">
                                                                <div className="space-y-3">
                                                                    {imageUrl && (
                                                                        <img 
                                                                            src={imageUrl} 
                                                                            alt={nft.name}
                                                                            className="w-full h-48 object-cover rounded border border-gray-200"
                                                                        />
                                                                    )}
                                                                    <div>
                                                                        <p className="text-sm font-medium text-gray-900">{nft.name}</p>
                                                                        <p className="font-mono text-xs text-gray-500 mt-1">{nft.nftId}</p>
                                                                    </div>
                                                                    {metadata && (
                                                                        <div className="space-y-2">
                                                                            {metadata.description && (
                                                                                <div>
                                                                                    <p className="text-xs font-medium text-gray-600">Description</p>
                                                                                    <p className="text-xs text-gray-700 mt-1">{metadata.description}</p>
                                                                                </div>
                                                                            )}
                                                                            {metadata.attributes && metadata.attributes.length > 0 && (
                                                                                <div>
                                                                                    <p className="text-xs font-medium text-gray-600 mb-1">Attributes</p>
                                                                                    <div className="flex flex-wrap gap-1">
                                                                                        {metadata.attributes.slice(0, 3).map((attr: any, idx: number) => (
                                                                                            <Badge key={idx} variant="outline" className="text-xs">
                                                                                                {attr.trait_type}: {attr.value}
                                                                                            </Badge>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs text-gray-700">{nft.nftId.slice(0, 8)}...{nft.nftId.slice(-4)}</TableCell>
                                                    <TableCell className="text-gray-700 font-medium">{nft.name}</TableCell>
                                                    <TableCell>
                                                        {nft.metadataUri ? (
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <Button variant="ghost" size="sm" className="h-auto p-1 text-xs">
                                                                        <span className="truncate max-w-[120px]">{nft.metadataUri}</span>
                                                                        <Info className="h-3 w-3 ml-1 opacity-50" />
                                                                    </Button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-80">
                                                                    <div className="space-y-2">
                                                                        <p className="text-xs font-medium text-gray-600">Metadata URI</p>
                                                                        <div className="flex items-center gap-2">
                                                                            <p className="font-mono text-xs text-gray-700 break-all">{nft.metadataUri}</p>
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                onClick={() => copyToClipboard(nft.metadataUri)}
                                                                                className="h-6 w-6 p-0"
                                                                            >
                                                                                <Copy className="h-3 w-3" />
                                                                            </Button>
                                                                        </div>
                                                                        <Button
                                                                            size="sm"
                                                                            variant="outline"
                                                                            onClick={() => window.open(nft.metadataUri, '_blank')}
                                                                            className="w-full"
                                                                        >
                                                                            <ExternalLink className="h-3 w-3 mr-2" />
                                                                            Open in New Tab
                                                                        </Button>
                                                                    </div>
                                                                </PopoverContent>
                                                            </Popover>
                                                        ) : (
                                                            <Badge variant="outline" className="text-xs text-gray-400">No metadata</Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs text-gray-700">
                                                        <Popover>
                                                            <PopoverTrigger asChild>
                                                                <Button variant="ghost" size="sm" className="h-auto p-0 font-mono text-xs">
                                                                    {nft.wallet?.walletAddress?.slice(0, 8)}...{nft.wallet?.walletAddress?.slice(-4)}
                                                                    <Info className="h-3 w-3 ml-1 opacity-50" />
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-64">
                                                                <div className="space-y-2">
                                                                    <p className="text-xs font-medium text-gray-600">Owner Wallet</p>
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="font-mono text-xs text-gray-700 break-all">{nft.wallet?.walletAddress || 'N/A'}</p>
                                                                        {nft.wallet?.walletAddress && (
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                onClick={() => copyToClipboard(nft.wallet.walletAddress)}
                                                                                className="h-6 w-6 p-0"
                                                                            >
                                                                                <Copy className="h-3 w-3" />
                                                                            </Button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </PopoverContent>
                                                        </Popover>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-gray-500">{new Date(nft.mintTimestamp).toLocaleDateString()}</TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Events Tab */}
                <TabsContent value="events" className="space-y-4">
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-gray-900">Events</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {data.events.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No events found</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-gray-200 hover:bg-gray-50">
                                                <TableHead className="text-gray-600">Name</TableHead>
                                                <TableHead className="text-gray-600">Entry Fee</TableHead>
                                                <TableHead className="text-gray-600">Status</TableHead>
                                                <TableHead className="text-gray-600">Entries</TableHead>
                                                <TableHead className="text-gray-600">Created</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {data.events.map((event) => (
                                                <TableRow key={event.id} className="border-gray-200 hover:bg-gray-50">
                                                    <TableCell className="text-gray-700 font-medium">{event.name}</TableCell>
                                                    <TableCell className="text-gray-700">{Number(event.entryFee).toFixed(4)} SOL</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className={
                                                            event.status === 'ACTIVE' ? 'bg-blue-50 text-blue-700 border-blue-300' :
                                                            event.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                                                            'bg-gray-50 text-gray-700 border-gray-300'
                                                        }>
                                                            {event.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="bg-gray-50">
                                                            {event.entries.length} entries
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-gray-500">{new Date(event.createdAt).toLocaleDateString()}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Rewards Tab */}
                <TabsContent value="rewards" className="space-y-4">
                    {/* Drafts Section */}
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-gray-900 flex items-center gap-2">
                                <Image className="h-5 w-5" />
                                Draft Rewards ({rewardDrafts.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {draftsLoading ? (
                                <div className="text-center py-8">
                                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                                    <p className="text-gray-500 mt-2">Loading drafts...</p>
                                </div>
                            ) : rewardDrafts.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No drafts yet. Upload image and metadata to create drafts!</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {rewardDrafts.map((draft) => (
                                        <Card key={draft.id} className="border border-gray-200 hover:shadow-md transition-shadow max-w-xs">
                                            <CardContent className="p-4">
                                                {draft.imageUrl && (
                                                    <div className="w-full h-48 overflow-hidden rounded-lg border border-gray-200 mb-3">
                                                        <img 
                                                            src={draft.imageUrl} 
                                                            alt={draft.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                )}
                                                <h3 className="font-bold text-sm text-gray-900 mb-1">{draft.name}</h3>
                                                <p className="text-xs text-gray-600 mb-2 line-clamp-2">{draft.description || 'No description'}</p>
                                                <div className="flex items-center justify-between text-xs mb-3">
                                                    <span className="text-gray-600">Points:</span>
                                                    <span className="font-medium">{draft.requiredPoints}</span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant={draft.isListed ? "default" : "outline"}
                                                        onClick={async () => {
                                                            try {
                                                                const response = await fetch(`${API_BASE_URL}/api/admin/rewards/drafts/${draft.id}?apiKey=${apiKey}`, {
                                                                    method: 'PUT',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ isListed: !draft.isListed })
                                                                });
                                                                if (response.ok) {
                                                                    fetchRewardDrafts();
                                                                    toast({
                                                                        title: "Success",
                                                                        description: draft.isListed ? "Draft unlisted" : "Draft listed as reward",
                                                                    });
                                                                }
                                                            } catch (error) {
                                                                toast({
                                                                    variant: "destructive",
                                                                    title: "Error",
                                                                    description: "Failed to update draft",
                                                                });
                                                            }
                                                        }}
                                                        className="flex-1 text-xs"
                                                    >
                                                        {draft.isListed ? 'Unlist' : 'List'}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => {
                                                            setSelectedDraft(draft);
                                                            setRewardFormData({
                                                                name: draft.name,
                                                                description: draft.description || '',
                                                                requiredPoints: draft.requiredPoints.toString(),
                                                                rewardType: draft.rewardType,
                                                                totalSupply: draft.totalSupply.toString()
                                                            });
                                                            setUploadedImageUri(draft.imageUrl);
                                                            setUploadedMetadataUri(draft.metadataUri);
                                                            setMintRewardDialogOpen(true);
                                                        }}
                                                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs"
                                                    >
                                                        Mint
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={async () => {
                                                            if (confirm(`Delete ${draft.name}?`)) {
                                                                try {
                                                                    const response = await fetch(`${API_BASE_URL}/api/admin/rewards/drafts/${draft.id}?apiKey=${apiKey}`, {
                                                                        method: 'DELETE'
                                                                    });
                                                                    if (response.ok) {
                                                                        fetchRewardDrafts();
                                                                        toast({
                                                                            title: "Success",
                                                                            description: "Draft deleted",
                                                                        });
                                                                    }
                                                                } catch (error) {
                                                                    toast({
                                                                        variant: "destructive",
                                                                        title: "Error",
                                                                        description: "Failed to delete draft",
                                                                    });
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Minted Rewards Section */}
                    <Card className="border border-gray-200 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle className="text-gray-900 flex items-center gap-2">
                                <Gift className="h-5 w-5" />
                                Minted Reward NFTs ({rewardNfts.length})
                            </CardTitle>
                            <Button
                                onClick={() => {
                                    setSelectedDraft(null);
                                    setRewardFormData({
                                        name: '',
                                        description: '',
                                        requiredPoints: '100',
                                        rewardType: 'MUSIC_NFT',
                                        totalSupply: '1'
                                    });
                                    setImageFile(null);
                                    setImagePreviewUrl(null);
                                    setUploadedImageUri(null);
                                    setUploadedMetadataUri(null);
                                    setMintRewardDialogOpen(true);
                                }}
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Create New Draft
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {rewardNftLoading ? (
                                <div className="text-center py-8">
                                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                                    <p className="text-gray-500 mt-2">Loading reward NFTs...</p>
                                </div>
                            ) : rewardNfts.length === 0 ? (
                                <p className="text-gray-500 text-center py-8">No reward NFTs found. Mint one to get started!</p>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                    {rewardNfts.map((reward) => (
                                        <Card key={reward.id} className="border border-gray-200 hover:shadow-md transition-shadow max-w-xs">
                                            <CardContent className="p-4">
                                                {reward.imageUrl && (
                                                    <div className="w-full h-48 overflow-hidden rounded-lg border border-gray-200 mb-3">
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
                                                <div className="flex items-start justify-between mb-2">
                                                    <h3 className="font-bold text-sm text-gray-900 flex-1">{reward.name}</h3>
                                                    <Badge variant={reward.isActive ? "default" : "secondary"} className="ml-2">
                                                        {reward.isActive ? 'Listed' : 'Unlisted'}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-gray-600 mb-2 line-clamp-2">{reward.description || 'No description'}</p>
                                                
                                                <div className="space-y-1 mb-3 text-xs">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-gray-600">Points:</span>
                                                        <span className="font-medium">{reward.requiredPoints}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-gray-600">Type:</span>
                                                        <Badge variant="outline" className="text-xs">{reward.rewardType}</Badge>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-gray-600">Supply:</span>
                                                        <span className="font-medium">{reward.totalSupply}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-gray-600">Claimed:</span>
                                                        <span className={`font-medium ${
                                                            reward.claimedCount >= reward.totalSupply ? 'text-red-600' : 'text-gray-900'
                                                        }`}>
                                                            {reward.claimedCount || 0}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-gray-600">Available:</span>
                                                        <span className={`font-medium ${
                                                            (reward.totalSupply - (reward.claimedCount || 0)) <= 0 ? 'text-red-600' : 'text-gray-900'
                                                        }`}>
                                                            {reward.totalSupply - (reward.claimedCount || 0)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex gap-2 flex-wrap">
                                                    <Button
                                                        size="sm"
                                                        variant={reward.isActive ? "outline" : "default"}
                                                        onClick={async () => {
                                                            try {
                                                                const response = await fetch(`${API_BASE_URL}/api/admin/rewards/${reward.id}?apiKey=${apiKey}`, {
                                                                    method: 'PUT',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ isActive: !reward.isActive })
                                                                });
                                                                if (response.ok) {
                                                                    fetchRewardNfts();
                                                                    toast({
                                                                        title: "Success",
                                                                        description: reward.isActive ? "Reward unlisted" : "Reward listed",
                                                                    });
                                                                }
                                                            } catch (error) {
                                                                toast({
                                                                    variant: "destructive",
                                                                    title: "Error",
                                                                    description: "Failed to update reward",
                                                                });
                                                            }
                                                        }}
                                                        className="flex-1 text-xs"
                                                    >
                                                        {reward.isActive ? 'Unlist' : 'List'}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => {
                                                            setSelectedRewardForEdit(reward);
                                                            setNewSupply(reward.totalSupply.toString());
                                                            setEditSupplyDialogOpen(true);
                                                        }}
                                                        className="flex-1 text-xs"
                                                    >
                                                        <Pencil className="h-3 w-3 mr-1" />
                                                        Edit Supply
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={async () => {
                                                            if (confirm(`Delete ${reward.name}?`)) {
                                                                try {
                                                                    const response = await fetch(`${API_BASE_URL}/api/admin/rewards/${reward.id}?apiKey=${apiKey}`, {
                                                                        method: 'DELETE'
                                                                    });
                                                                    if (response.ok) {
                                                                        fetchRewardNfts();
                                                                        toast({
                                                                            title: "Success",
                                                                            description: "Reward NFT deleted",
                                                                        });
                                                                    }
                                                                } catch (error) {
                                                                    toast({
                                                                        variant: "destructive",
                                                                        title: "Error",
                                                                        description: "Failed to delete reward NFT",
                                                                    });
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                                
                                                <div className="mt-2 pt-2 border-t border-gray-200">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => copyToClipboard(reward.nftAsset)}
                                                        className="w-full text-xs font-mono text-gray-600 hover:text-gray-900"
                                                    >
                                                        {reward.nftAsset.slice(0, 8)}...{reward.nftAsset.slice(-4)}
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Edit Supply Dialog */}
                    <Dialog open={editSupplyDialogOpen} onOpenChange={setEditSupplyDialogOpen}>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Edit Supply</DialogTitle>
                                <DialogDescription>
                                    Change the total supply for {selectedRewardForEdit?.name}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <label htmlFor="supply" className="text-sm font-medium">
                                        Total Supply
                                    </label>
                                    <Input
                                        id="supply"
                                        type="number"
                                        min="1"
                                        value={newSupply}
                                        onChange={(e) => setNewSupply(e.target.value)}
                                        placeholder="Enter total supply"
                                    />
                                    {selectedRewardForEdit && (
                                        <p className="text-xs text-gray-500">
                                            Currently claimed: {selectedRewardForEdit.claimedCount || 0} / {selectedRewardForEdit.totalSupply}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setEditSupplyDialogOpen(false);
                                        setSelectedRewardForEdit(null);
                                        setNewSupply('');
                                    }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={async () => {
                                        if (!selectedRewardForEdit || !newSupply || isNaN(parseInt(newSupply)) || parseInt(newSupply) < 1) {
                                            toast({
                                                variant: "destructive",
                                                title: "Error",
                                                description: "Please enter a valid supply number",
                                            });
                                            return;
                                        }

                                        if (parseInt(newSupply) < (selectedRewardForEdit.claimedCount || 0)) {
                                            toast({
                                                variant: "destructive",
                                                title: "Error",
                                                description: `Supply cannot be less than claimed count (${selectedRewardForEdit.claimedCount || 0})`,
                                            });
                                            return;
                                        }

                                        try {
                                            const response = await fetch(`${API_BASE_URL}/api/admin/rewards/${selectedRewardForEdit.id}?apiKey=${apiKey}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ totalSupply: parseInt(newSupply) })
                                            });
                                            if (response.ok) {
                                                fetchRewardNfts();
                                                toast({
                                                    title: "Success",
                                                    description: "Supply updated successfully",
                                                });
                                                setEditSupplyDialogOpen(false);
                                                setSelectedRewardForEdit(null);
                                                setNewSupply('');
                                            } else {
                                                const error = await response.json();
                                                throw new Error(error.error || 'Failed to update supply');
                                            }
                                        } catch (error: any) {
                                            toast({
                                                variant: "destructive",
                                                title: "Error",
                                                description: error.message || "Failed to update supply",
                                            });
                                        }
                                    }}
                                >
                                    Save Changes
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>
            </Tabs>

            {/* Mint Reward NFT Dialog */}
            <Dialog open={mintRewardDialogOpen} onOpenChange={setMintRewardDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Mint Reward NFT</DialogTitle>
                        <DialogDescription>
                            Upload image and metadata, then mint your reward NFT
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                        {/* Left Column: Form */}
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700 mb-1 block">Upload Image *</label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                            const file = e.target.files[0];
                                            setImageFile(file);
                                            setImagePreviewUrl(URL.createObjectURL(file));
                                            setUploadedImageUri(null);
                                        }
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                />
                                {imagePreviewUrl && (
                                    <div className="mt-2">
                                        <img src={imagePreviewUrl} alt="Preview" className="w-full h-48 object-cover rounded-md border border-gray-200" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700 mb-1 block">Name *</label>
                                <input
                                    type="text"
                                    value={rewardFormData.name}
                                    onChange={(e) => setRewardFormData({ ...rewardFormData, name: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                    placeholder="Music NFT #1"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700 mb-1 block">Description</label>
                                <textarea
                                    value={rewardFormData.description}
                                    onChange={(e) => setRewardFormData({ ...rewardFormData, description: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                    rows={3}
                                    placeholder="Exclusive music NFT reward"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-700 mb-1 block">Required Points *</label>
                                    <input
                                        type="number"
                                        value={rewardFormData.requiredPoints}
                                        onChange={(e) => setRewardFormData({ ...rewardFormData, requiredPoints: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                        min="1"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700 mb-1 block">Total Supply *</label>
                                    <input
                                        type="number"
                                        value={rewardFormData.totalSupply}
                                        onChange={(e) => setRewardFormData({ ...rewardFormData, totalSupply: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                        min="1"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-gray-700 mb-1 block">Reward Type</label>
                                <select
                                    value={rewardFormData.rewardType}
                                    onChange={(e) => setRewardFormData({ ...rewardFormData, rewardType: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                >
                                    <option value="MUSIC_NFT">Music NFT</option>
                                    <option value="BADGE">Badge</option>
                                    <option value="ART_NFT">Art NFT</option>
                                </select>
                            </div>
                            <Button
                                onClick={async () => {
                                    if (!publicKey || !connected) {
                                        toast({
                                            variant: "destructive",
                                            title: "Error",
                                            description: "Please connect your wallet",
                                        });
                                        return;
                                    }

                                    if (!imageFile || !rewardFormData.name || !rewardFormData.requiredPoints) {
                                        toast({
                                            variant: "destructive",
                                            title: "Error",
                                            description: "Please upload image and fill in all required fields",
                                        });
                                        return;
                                    }

                                    setUploadingFiles(true);
                                    try {
                                        // Upload image to R2 (free, instant, no signatures needed)
                                        toast({
                                            title: "Uploading",
                                            description: "Uploading image to R2...",
                                        });
                                        
                                        const { url: imageUri } = await uploadImageToR2(imageFile, apiKey);
                                        setUploadedImageUri(imageUri);

                                        // Upload metadata to R2
                                        const metadata = {
                                            name: rewardFormData.name,
                                            description: rewardFormData.description || '',
                                            image: imageUri,
                                            properties: {
                                                rewardType: rewardFormData.rewardType,
                                                requiredPoints: parseInt(rewardFormData.requiredPoints)
                                            }
                                        };
                                        
                                        toast({
                                            title: "Uploading",
                                            description: "Uploading metadata to R2...",
                                        });
                                        
                                        const { url: metadataUri } = await uploadMetadataToR2(metadata, apiKey);
                                        setUploadedMetadataUri(metadataUri);

                                        // Save as draft
                                        try {
                                            const draftResponse = await fetch(`${API_BASE_URL}/api/admin/rewards/drafts?apiKey=${apiKey}`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    name: rewardFormData.name,
                                                    description: rewardFormData.description,
                                                    metadataUri: metadataUri,
                                                    imageUrl: imageUri,
                                                    imageFile: imageFile.name,
                                                    requiredPoints: rewardFormData.requiredPoints,
                                                    rewardType: rewardFormData.rewardType,
                                                    totalSupply: rewardFormData.totalSupply
                                                })
                                            });
                                            if (draftResponse.ok) {
                                                fetchRewardDrafts();
                                            }
                                        } catch (draftError) {
                                            console.error('Failed to save draft:', draftError);
                                        }

                                        toast({
                                            title: "Success",
                                            description: "Files uploaded and saved as draft! Ready to mint.",
                                        });
                                    } catch (error: any) {
                                        toast({
                                            variant: "destructive",
                                            title: "Error",
                                            description: error.message || "Failed to upload files",
                                        });
                                    } finally {
                                        setUploadingFiles(false);
                                    }
                                }}
                                disabled={uploadingFiles || !imageFile || !rewardFormData.name}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                {uploadingFiles ? (
                                    <>
                                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Image className="h-4 w-4 mr-2" />
                                        Upload Image & Metadata
                                    </>
                                )}
                            </Button>
                        </div>

                        {/* Right Column: Preview Card */}
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">Preview</label>
                            <Card className="border-2 border-gray-200">
                                <CardContent className="p-4">
                                    {uploadedImageUri && uploadedMetadataUri ? (
                                        <div className="space-y-4">
                                            <div className="aspect-square w-full overflow-hidden rounded-lg border border-gray-200">
                                                <img 
                                                    src={uploadedImageUri} 
                                                    alt={rewardFormData.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-gray-900">{rewardFormData.name || 'Untitled'}</h3>
                                                <p className="text-sm text-gray-600 mt-1">{rewardFormData.description || 'No description'}</p>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-600">Required Points:</span>
                                                <span className="font-medium">{rewardFormData.requiredPoints}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-600">Type:</span>
                                                <Badge variant="outline">{rewardFormData.rewardType}</Badge>
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-gray-600">Supply:</span>
                                                <span className="font-medium">{rewardFormData.totalSupply}</span>
                                            </div>
                                            <Button
                                                onClick={async () => {
                                                    if (!publicKey || !connected) {
                                                        toast({
                                                            variant: "destructive",
                                                            title: "Error",
                                                            description: "Please connect your wallet",
                                                        });
                                                        return;
                                                    }

                                                    if (!uploadedMetadataUri || !rewardFormData.name || !rewardFormData.requiredPoints) {
                                                        toast({
                                                            variant: "destructive",
                                                            title: "Error",
                                                            description: "Please upload files first",
                                                        });
                                                        return;
                                                    }

                                                    setMintingReward(true);
                                                    try {
                                                        const response = await fetch(`${API_BASE_URL}/api/admin/rewards/mint?apiKey=${apiKey}`, {
                                                            method: 'POST',
                                                            headers: {
                                                                'Content-Type': 'application/json'
                                                            },
                                                            body: JSON.stringify({
                                                                name: rewardFormData.name,
                                                                description: rewardFormData.description,
                                                                metadataUri: uploadedMetadataUri,
                                                                imageUrl: uploadedImageUri,
                                                                adminWallet: publicKey.toString(),
                                                                requiredPoints: parseInt(rewardFormData.requiredPoints),
                                                                totalSupply: parseInt(rewardFormData.totalSupply),
                                                                rewardType: rewardFormData.rewardType
                                                            })
                                                        });

                                                        if (!response.ok) {
                                                            const error = await response.json();
                                                            throw new Error(error.error || 'Failed to mint reward NFT');
                                                        }

                                                        const data = await response.json();

                                                        // Sign and send transaction
                                                        if (data.transaction && signTransaction) {
                                                            const connection = new Connection('https://api.devnet.solana.com');
                                                            
                                                            const transactionBuffer = Buffer.from(data.transaction, 'base64');
                                                            const transaction = VersionedTransaction.deserialize(transactionBuffer);
                                                            
                                                            const signedTransaction = await signTransaction(transaction);
                                                            const signature = await connection.sendRawTransaction(signedTransaction.serialize());
                                                            
                                                            await connection.confirmTransaction(signature, 'confirmed');
                                                            
                                                            toast({
                                                                title: "Success",
                                                                description: `Reward NFT minted! Transaction: ${signature.slice(0, 8)}...`,
                                                            });
                                                        } else {
                                                            toast({
                                                                title: "Success",
                                                                description: "Reward NFT created!",
                                                            });
                                                        }

                                                        setMintRewardDialogOpen(false);
                                                        setRewardFormData({
                                                            name: '',
                                                            description: '',
                                                            requiredPoints: '100',
                                                            rewardType: 'MUSIC_NFT',
                                                            totalSupply: '1'
                                                        });
                                                        setImageFile(null);
                                                        setImagePreviewUrl(null);
                                                        setUploadedImageUri(null);
                                                        setUploadedMetadataUri(null);
                                                        setSelectedDraft(null);
                                                        fetchRewardNfts();
                                                        fetchRewardDrafts();
                                                        
                                                        // Delete draft if it was minted from a draft
                                                        if (selectedDraft) {
                                                            try {
                                                                await fetch(`${API_BASE_URL}/api/admin/rewards/drafts/${selectedDraft.id}?apiKey=${apiKey}`, {
                                                                    method: 'DELETE'
                                                                });
                                                                fetchRewardDrafts();
                                                            } catch (e) {
                                                                console.error('Failed to delete draft:', e);
                                                            }
                                                        }
                                                    } catch (error: any) {
                                                        toast({
                                                            variant: "destructive",
                                                            title: "Error",
                                                            description: error.message || "Failed to mint reward NFT",
                                                        });
                                                    } finally {
                                                        setMintingReward(false);
                                                    }
                                                }}
                                                disabled={mintingReward || !uploadedMetadataUri}
                                                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                                            >
                                                {mintingReward ? (
                                                    <>
                                                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                        Minting...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Gift className="h-4 w-4 mr-2" />
                                                        MINT this NFT
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                                            <Image className="h-12 w-12 mb-2 opacity-50" />
                                            <p className="text-sm">Upload image and metadata to see preview</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setMintRewardDialogOpen(false);
                                setRewardFormData({
                                    name: '',
                                    description: '',
                                    requiredPoints: '100',
                                    rewardType: 'MUSIC_NFT',
                                    totalSupply: '1'
                                });
                                setImageFile(null);
                                setImagePreviewUrl(null);
                                setUploadedImageUri(null);
                                setUploadedMetadataUri(null);
                            }}
                        >
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Approve & Transfer Dialog */}
            <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
                <DialogContent className="bg-white border border-gray-200 text-gray-900 max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-gray-900 text-xl">Approve Dispute & Transfer SOL</DialogTitle>
                        <DialogDescription className="text-gray-600 pt-2">
                            Review the transfer details below. You will be prompted to sign a transaction.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedDispute && (
                        <div className="space-y-4 py-4">
                            <div className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 text-sm">Recipient Wallet:</span>
                                    <span className="font-mono text-xs text-gray-700 bg-white px-2 py-1 rounded border border-gray-200">
                                        {selectedDispute.walletAddress.slice(0, 8)}...{selectedDispute.walletAddress.slice(-4)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 text-sm">Amount:</span>
                                    <span className="font-bold text-lg text-emerald-600">{Number(selectedDispute.amount).toFixed(4)} SOL</span>
                                </div>
                                {publicKey && (
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-600 text-sm">From Wallet:</span>
                                        <span className="font-mono text-xs text-gray-700 bg-white px-2 py-1 rounded border border-gray-200">
                                            {publicKey.toString().slice(0, 8)}...{publicKey.toString().slice(-4)}
                                        </span>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-gray-200">
                                    <span className="text-gray-600 text-sm block mb-1">Reason:</span>
                                    <p className="text-gray-700 text-sm">{selectedDispute.reason}</p>
                                </div>
                            </div>
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                <p className="text-sm text-amber-700 flex items-start gap-2">
                                    <span>⚠️</span>
                                    <span>You will be prompted to sign a transaction in your wallet to transfer {Number(selectedDispute.amount).toFixed(4)} SOL.</span>
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setApproveDialogOpen(false);
                                setSelectedDispute(null);
                            }}
                            disabled={transferring}
                            className="border-gray-300 hover:bg-gray-50"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleTransferSOL}
                            disabled={transferring || !connected || !publicKey}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {transferring ? (
                                <>
                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Check className="h-4 w-4 mr-2" />
                                    Approve & Transfer SOL
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dispute Detail Dialog */}
            <Dialog open={disputeDetailOpen} onOpenChange={setDisputeDetailOpen}>
                <DialogContent className="bg-white border border-gray-200 text-gray-900 max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-gray-900 text-xl">Dispute Details</DialogTitle>
                        <DialogDescription className="text-gray-600 pt-2">
                            Complete information about this dispute
                        </DialogDescription>
                    </DialogHeader>
                    {selectedDisputeDetail && (
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Dispute ID</label>
                                    <div className="flex items-center gap-2">
                                        <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedDisputeDetail.id}</p>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => copyToClipboard(selectedDisputeDetail.id)}
                                            className="h-8 w-8 p-0"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Status</label>
                                    <Badge 
                                        variant={
                                            selectedDisputeDetail.status === 'PENDING' ? 'outline' :
                                            selectedDisputeDetail.status === 'APPROVED' ? 'default' :
                                            'destructive'
                                        }
                                        className={
                                            selectedDisputeDetail.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-300' :
                                            selectedDisputeDetail.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                                            'bg-red-50 text-red-700 border-red-300'
                                        }
                                    >
                                        {selectedDisputeDetail.status}
                                    </Badge>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Wallet Address</label>
                                    <div className="flex items-center gap-2">
                                        <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedDisputeDetail.walletAddress}</p>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => copyToClipboard(selectedDisputeDetail.walletAddress)}
                                            className="h-8 w-8 p-0"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Amount</label>
                                    <p className="text-lg font-bold text-emerald-600">{Number(selectedDisputeDetail.amount).toFixed(4)} SOL</p>
                                </div>
                                {selectedDisputeDetail.eventId && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600">Event ID</label>
                                        <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedDisputeDetail.eventId}</p>
                                    </div>
                                )}
                                {selectedDisputeDetail.eventEntryId && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600">Event Entry ID</label>
                                        <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedDisputeDetail.eventEntryId}</p>
                                    </div>
                                )}
                                {selectedDisputeDetail.transactionId && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600">Transaction ID</label>
                                        <div className="flex items-center gap-2">
                                            <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedDisputeDetail.transactionId}</p>
                                            {getExplorerUrl(selectedDisputeDetail.transactionId) && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => window.open(getExplorerUrl(selectedDisputeDetail.transactionId)!, '_blank')}
                                                    className="h-8 w-8 p-0"
                                                >
                                                    <ExternalLink className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Created At</label>
                                    <p className="text-sm text-gray-700">{new Date(selectedDisputeDetail.createdAt).toLocaleString()}</p>
                                </div>
                                {selectedDisputeDetail.resolvedAt && (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-600">Resolved At</label>
                                        <p className="text-sm text-gray-700">{new Date(selectedDisputeDetail.resolvedAt).toLocaleString()}</p>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-600">Reason</label>
                                <p className="text-sm text-gray-700 bg-gray-50 px-4 py-3 rounded border border-gray-200 whitespace-pre-wrap">{selectedDisputeDetail.reason}</p>
                            </div>
                            {selectedDisputeDetail.adminNotes && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Admin Notes</label>
                                    <p className="text-sm text-gray-700 bg-gray-50 px-4 py-3 rounded border border-gray-200 whitespace-pre-wrap">{selectedDisputeDetail.adminNotes}</p>
                                </div>
                            )}
                            {selectedDisputeDetail.refundTxHash && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Refund Transaction</label>
                                    <div className="flex items-center gap-2">
                                        <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedDisputeDetail.refundTxHash}</p>
                                        {getExplorerUrl(selectedDisputeDetail.refundTxHash) && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => window.open(getExplorerUrl(selectedDisputeDetail.refundTxHash)!, '_blank')}
                                                className="h-8 w-8 p-0"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => copyToClipboard(selectedDisputeDetail.refundTxHash)}
                                            className="h-8 w-8 p-0"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                            {selectedDisputeDetail.user && (
                                <div className="space-y-2 border-t border-gray-200 pt-4">
                                    <label className="text-sm font-medium text-gray-600">User Information</label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-xs text-gray-500">User ID</p>
                                            <p className="font-mono text-sm text-gray-700">{selectedDisputeDetail.user.id}</p>
                                        </div>
                                        {selectedDisputeDetail.user.wallets && selectedDisputeDetail.user.wallets.length > 0 && (
                                            <div>
                                                <p className="text-xs text-gray-500">Wallets</p>
                                                {selectedDisputeDetail.user.wallets.map((w: any) => (
                                                    <p key={w.id} className="font-mono text-xs text-gray-700">{w.walletAddress}</p>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {selectedDisputeDetail.event && (
                                <div className="space-y-2 border-t border-gray-200 pt-4">
                                    <label className="text-sm font-medium text-gray-600">Event Information</label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-xs text-gray-500">Event Name</p>
                                            <p className="text-sm text-gray-700">{selectedDisputeDetail.event.name}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500">Entry Fee</p>
                                            <p className="text-sm text-gray-700">{Number(selectedDisputeDetail.event.entryFee).toFixed(4)} SOL</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDisputeDetailOpen(false)}
                            className="border-gray-300 hover:bg-gray-50"
                        >
                            Close
                        </Button>
                        {selectedDisputeDetail?.status === 'PENDING' && (
                            <>
                                <Button
                                    onClick={() => {
                                        setDisputeDetailOpen(false);
                                        handleResolveDispute(selectedDisputeDetail.id, 'APPROVED');
                                    }}
                                    disabled={!connected}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                                >
                                    <Check className="h-4 w-4 mr-2" />
                                    Approve & Transfer
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => {
                                        setDisputeDetailOpen(false);
                                        handleResolveDispute(selectedDisputeDetail.id, 'REJECTED');
                                    }}
                                >
                                    <X className="h-4 w-4 mr-2" />
                                    Reject
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* User Detail Dialog */}
            <Dialog open={userDetailOpen} onOpenChange={setUserDetailOpen}>
                <DialogContent className="bg-white border border-gray-200 text-gray-900 max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-gray-900 text-xl">User Details</DialogTitle>
                        <DialogDescription className="text-gray-600 pt-2">
                            Complete information about this user and all associated data
                        </DialogDescription>
                    </DialogHeader>
                    {selectedUser && (
                        <div className="space-y-6 py-4">
                            {/* User Basic Info */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">User ID</label>
                                    <div className="flex items-center gap-2">
                                        <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded border border-gray-200">{selectedUser.id}</p>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => copyToClipboard(selectedUser.id)}
                                            className="h-8 w-8 p-0"
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-600">Created At</label>
                                    <p className="text-sm text-gray-700">{new Date(selectedUser.createdAt).toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Wallets */}
                            <div className="space-y-2 border-t border-gray-200 pt-4">
                                <label className="text-sm font-medium text-gray-600">Wallets ({selectedUser.wallets?.length || 0})</label>
                                <div className="space-y-2">
                                    {selectedUser.wallets && selectedUser.wallets.length > 0 ? (
                                        selectedUser.wallets.map((w: any) => (
                                            <div key={w.id} className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded border border-gray-200">
                                                <div>
                                                    <p className="font-mono text-sm text-gray-700">{w.walletAddress}</p>
                                                    <p className="text-xs text-gray-500">Type: {w.walletType}</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => copyToClipboard(w.walletAddress)}
                                                        className="h-8 w-8 p-0"
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                    {getExplorerUrl(w.walletAddress) && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => window.open(`https://solscan.io/account/${w.walletAddress}?cluster=devnet`, '_blank')}
                                                            className="h-8 w-8 p-0"
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-gray-500">No wallets found</p>
                                    )}
                                </div>
                            </div>

                            {/* Transactions */}
                            <div className="space-y-2 border-t border-gray-200 pt-4">
                                <label className="text-sm font-medium text-gray-600">Transactions ({selectedUser.transactions?.length || 0})</label>
                                {selectedUser.transactions && selectedUser.transactions.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-gray-200">
                                                    <TableHead className="text-gray-600 text-xs">ID</TableHead>
                                                    <TableHead className="text-gray-600 text-xs">Type</TableHead>
                                                    <TableHead className="text-gray-600 text-xs">Amount</TableHead>
                                                    <TableHead className="text-gray-600 text-xs">Status</TableHead>
                                                    <TableHead className="text-gray-600 text-xs">Date</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {selectedUser.transactions.map((tx: any) => (
                                                    <TableRow key={tx.id} className="border-gray-200">
                                                        <TableCell className="font-mono text-xs text-gray-700">{tx.transactionId.slice(0, 12)}...</TableCell>
                                                        <TableCell className="text-xs text-gray-700">{tx.transactionType}</TableCell>
                                                        <TableCell className="text-xs text-gray-700">{Number(tx.amount).toFixed(4)} {tx.currency || 'SOL'}</TableCell>
                                                        <TableCell>
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                                tx.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                                                                tx.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                                                'bg-red-100 text-red-700'
                                                            }`}>
                                                                {tx.status}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">No transactions found</p>
                                )}
                            </div>

                            {/* Disputes */}
                            <div className="space-y-2 border-t border-gray-200 pt-4">
                                <label className="text-sm font-medium text-gray-600">Disputes ({selectedUser.disputes?.length || 0})</label>
                                {selectedUser.disputes && selectedUser.disputes.length > 0 ? (
                                    <div className="space-y-2">
                                        {selectedUser.disputes.map((dispute: any) => (
                                            <div key={dispute.id} className="bg-gray-50 px-4 py-3 rounded border border-gray-200">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="font-mono text-xs text-gray-700">{dispute.id.slice(0, 8)}...</p>
                                                        <p className="text-sm text-gray-700 mt-1">{dispute.reason}</p>
                                                        <p className="text-xs text-gray-500 mt-1">{Number(dispute.amount).toFixed(4)} SOL - {dispute.status}</p>
                                                    </div>
                                                    <Badge 
                                                        variant={
                                                            dispute.status === 'PENDING' ? 'outline' :
                                                            dispute.status === 'APPROVED' ? 'default' :
                                                            'destructive'
                                                        }
                                                        className={
                                                            dispute.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-300' :
                                                            dispute.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                                                            'bg-red-50 text-red-700 border-red-300'
                                                        }
                                                    >
                                                        {dispute.status}
                                                    </Badge>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">No disputes found</p>
                                )}
                            </div>

                            {/* NFTs */}
                            <div className="space-y-2 border-t border-gray-200 pt-4">
                                <label className="text-sm font-medium text-gray-600">NFTs ({(() => {
                                    const totalNfts = selectedUser.wallets?.reduce((sum: number, w: any) => sum + (w.nfts?.length || 0), 0) || 0;
                                    return totalNfts;
                                })()})</label>
                                {selectedUser.wallets && selectedUser.wallets.some((w: any) => w.nfts && w.nfts.length > 0) ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {selectedUser.wallets.map((wallet: any) => 
                                            wallet.nfts?.map((nft: any) => (
                                                <div key={nft.id} className="bg-gray-50 px-4 py-3 rounded border border-gray-200">
                                                    <p className="font-medium text-sm text-gray-700">{nft.name}</p>
                                                    <p className="font-mono text-xs text-gray-500 mt-1">{nft.nftId.slice(0, 8)}...{nft.nftId.slice(-4)}</p>
                                                    <p className="text-xs text-gray-500 mt-1">Minted: {new Date(nft.mintTimestamp).toLocaleDateString()}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">No NFTs found</p>
                                )}
                            </div>

                            {/* Event Entries */}
                            {selectedUser.eventEntries && selectedUser.eventEntries.length > 0 && (
                                <div className="space-y-2 border-t border-gray-200 pt-4">
                                    <label className="text-sm font-medium text-gray-600">Event Entries ({selectedUser.eventEntries.length})</label>
                                    <div className="space-y-2">
                                        {selectedUser.eventEntries.map((entry: any) => (
                                            <div key={entry.id} className="bg-gray-50 px-4 py-3 rounded border border-gray-200">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-700">{entry.event?.name || 'Unknown Event'}</p>
                                                        <p className="text-xs text-gray-500 mt-1">{Number(entry.amount).toFixed(4)} SOL - {entry.status}</p>
                                                    </div>
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                        entry.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' :
                                                        entry.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-gray-100 text-gray-700'
                                                    }`}>
                                                        {entry.status}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setUserDetailOpen(false)}
                            className="border-gray-300 hover:bg-gray-50"
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
