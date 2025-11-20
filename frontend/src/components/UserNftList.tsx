import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { fetchNftByOwner, type NftAsset, API_BASE_URL } from '@/services/api';
import { NftCard } from './NftCard';
import { ListNftModal } from './ListNftModal';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { StatusModal, type StatusType } from './StatusModal';

export const UserNftList = () => {
    const { publicKey: walletPublicKey, signTransaction } = useWallet();
    const { connection } = useConnection();
    const [nfts, setNfts] = useState<NftAsset[]>([]);
    const [loading, setLoading] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedNft, setSelectedNft] = useState<NftAsset | null>(null);

    const [statusModal, setStatusModal] = useState<{ isOpen: boolean; status: StatusType; title: string; message: string }>({
        isOpen: false,
        status: 'idle',
        title: '',
        message: '',
    });


    useEffect(() => {
        if (walletPublicKey) {
            loadNfts();
        } else {
            setNfts([]);
        }
    }, [walletPublicKey]);

    const loadNfts = async () => {
        if (!walletPublicKey) return;
        setLoading(true);
        try {
            const data = await fetchNftByOwner(walletPublicKey.toString());
            setNfts(data);
        } catch (error) {
            console.error('Error fetching user NFTs:', error);
        } finally {
            setLoading(false);
        }
    };

    const openListingModal = (nft: NftAsset) => {
        setSelectedNft(nft);
        setIsModalOpen(true);
    };

    const closeListingModal = () => {
        setIsModalOpen(false);
        setSelectedNft(null);
    };

    const handleConfirmListing = async (price: number) => {
        if (!walletPublicKey || !signTransaction || !selectedNft) return;

        closeListingModal();
        setStatusModal({
            isOpen: true,
            status: 'loading',
            title: 'Listing NFT',
            message: `Listing ${selectedNft.name} for ${price} SOL...`,
        });

        try {
            console.log('Listing NFT:', selectedNft.publicKey, 'for', price, 'SOL');

            const response = await fetch(`${API_BASE_URL}list`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    assetId: selectedNft.publicKey,
                    seller: walletPublicKey.toString(),
                    price: price,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Backend error: ${errorText}`);
            }

            const { transaction, escrow } = await response.json();
            console.log('Escrow PDA:', escrow);

            const txBuffer = Buffer.from(transaction, 'base64');
            const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));

            const signedTx = await signTransaction(tx);

            const signature = await connection.sendRawTransaction(signedTx.serialize());

            await connection.confirmTransaction(signature, 'confirmed');

            console.log('NFT listed successfully! Signature:', signature);
            setStatusModal({
                isOpen: true,
                status: 'success',
                title: 'Listing Successful!',
                message: `Successfully listed ${selectedNft.name} for ${price} SOL.`,
            });
            loadNfts();
        } catch (error) {
            console.error('Error listing NFT:', error);
            setStatusModal({
                isOpen: true,
                status: 'error',
                title: 'Listing Failed',
                message: `Failed to list NFT: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    };

    if (!walletPublicKey) {
        return (
            <div className="text-center p-10">
                <p className="text-muted-foreground">Connect your wallet to view your NFTs.</p>
            </div>
        );
    }

    if (loading) {
        return <div className="text-center p-10">Loading your NFTs...</div>;
    }

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">My NFTs</h2>
                <button
                    onClick={loadNfts}
                    disabled={loading}
                    className="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-9 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>
            {nfts.length === 0 ? (
                <p className="text-muted-foreground">You don't have any NFTs.</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {nfts.map((nft) => (
                        <div key={nft.publicKey} className="h-full">
                            <NftCard nft={nft} onList={openListingModal} />
                        </div>
                    ))}
                </div>
            )}

            <ListNftModal
                nft={selectedNft}
                isOpen={isModalOpen}
                onClose={closeListingModal}
                onConfirm={handleConfirmListing}
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
