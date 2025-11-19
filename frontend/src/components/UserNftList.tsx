import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { fetchNftByOwner, type NftAsset, API_BASE_URL } from '@/services/api';
import { NftCard } from './NftCard';
import { ListNftModal } from './ListNftModal';
import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const UserNftList = () => {
    const { publicKey: walletPublicKey, signTransaction } = useWallet();
    const { connection } = useConnection();
    const [nfts, setNfts] = useState<NftAsset[]>([]);
    const [loading, setLoading] = useState(false);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedNft, setSelectedNft] = useState<NftAsset | null>(null);


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

        try {
            console.log('Listing NFT:', selectedNft.publicKey, 'for', price, 'SOL');

            // Call backend to create escrow and deposit NFT
            const response = await fetch(`${API_BASE_URL}list`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    assetId: selectedNft.publicKey,
                    seller: walletPublicKey.toString(),
                    price: price, // Price in SOL
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Backend error: ${errorText}`);
            }

            const { transaction, escrow } = await response.json();
            console.log('Escrow PDA:', escrow);

            // Deserialize the transaction
            const txBuffer = Buffer.from(transaction, 'base64');
            const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));

            // Sign the transaction
            const signedTx = await signTransaction(tx);

            // Send the transaction
            const signature = await connection.sendRawTransaction(signedTx.serialize());

            // Confirm the transaction
            await connection.confirmTransaction(signature, 'confirmed');

            console.log('NFT listed successfully! Signature:', signature);
            alert(`NFT listed successfully for ${price} SOL!`);
            closeListingModal();
            loadNfts(); // Refresh list
        } catch (error) {
            console.error('Error listing NFT:', error);
            alert(`Failed to list NFT: ${error}`);
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
            <h2 className="text-2xl font-bold mb-4">My NFTs</h2>
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
        </div>
    );
};
