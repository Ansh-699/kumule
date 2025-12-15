import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { API_BASE_URL } from '@/services/api';
import { useUmi } from '@/hooks/useUmi';
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi';
import { fetchCollectionV1 } from '@metaplex-foundation/mpl-core';
import { Buffer } from 'buffer';
import { uploadFilesToR2, uploadMetadataToR2 } from '@/services/api';

export const CollectionNftMinter = () => {
    const { publicKey, signTransaction } = useWallet();
    const { connection } = useConnection();
    const umi = useUmi();
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [createdNft, setCreatedNft] = useState<string | null>(null);

    const [collectionAddress, setCollectionAddress] = useState('');
    const [collectionInfo, setCollectionInfo] = useState<any>(null);
    const [formData, setFormData] = useState({
        name: '',
        symbol: '',
        description: '',
    });
    const [mainFile, setMainFile] = useState<File | null>(null);
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setMainFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setCoverFile(null);
            setCoverPreviewUrl(null);
        }
    };

    const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setCoverFile(file);
            setCoverPreviewUrl(URL.createObjectURL(file));
        }
    };

    const isMultimedia = mainFile && (mainFile.type.startsWith('video/') || mainFile.type.startsWith('audio/'));

    const loadCollection = async () => {
        if (!collectionAddress) return;

        try {
            const collection = await fetchCollectionV1(umi, umiPublicKey(collectionAddress));
            setCollectionInfo(collection);
            setError('');
        } catch (err) {
            setError('Failed to load collection. Please check the address.');
            setCollectionInfo(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!publicKey) {
            setError('Please connect your wallet first.');
            return;
        }
        if (!mainFile) {
            setError('Please select a main file.');
            return;
        }
        if (isMultimedia && !coverFile) {
            setError('Please select a cover image for your video/audio.');
            return;
        }
        if (!signTransaction) {
            setError('Wallet does not support signing transactions.');
            return;
        }
        if (!collectionAddress) {
            setError('Please enter a collection address.');
            return;
        }

        setLoading(true);
        setError('');
        setCreatedNft(null);

        try {
            // 1. Upload files to R2 (free, instant, no signatures needed)
            setStatus('Uploading files to R2...');
            
            // Upload files to R2
            const uploadResult = await uploadFilesToR2(mainFile, coverFile || null);
            console.log('R2 upload successful:', uploadResult);

            const fileUri = uploadResult.mainFile.url;
            let imageUri = fileUri;
            let animationUri = undefined;
            let category = 'image';

            // Handle multimedia files
            if (isMultimedia) {
                category = mainFile.type.startsWith('video/') ? 'video' : 'audio';
                animationUri = fileUri;
                // Cover was uploaded if provided
                if (uploadResult.coverFile) {
                    imageUri = uploadResult.coverFile.url;
                }
            }

            // 2. Upload Metadata to R2
            setStatus('Uploading metadata to R2...');
            const metadata = {
                name: formData.name,
                symbol: formData.symbol,
                description: formData.description,
                image: imageUri,
                animation_url: animationUri,
                properties: {
                    files: [
                        { uri: fileUri, type: mainFile.type },
                        ...(animationUri && imageUri !== fileUri && uploadResult.coverFile ? [{ uri: imageUri, type: uploadResult.coverFile.contentType }] : [])
                    ],
                    category
                }
            };
            const { url: metadataUri } = await uploadMetadataToR2(metadata);
            console.log('Metadata Uploaded:', metadataUri);

            // 3. Mint NFT into Collection
            setStatus('Building mint transaction...');
            const response = await fetch(`${API_BASE_URL}/mint`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    uri: metadataUri,
                    name: formData.name,
                    owner: publicKey.toString(),
                    collection: collectionAddress, // Pass collection address to backend
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Backend error: ${errorText}`);
            }

            const data = await response.json();
            const { transaction, mint } = data;

            setStatus('Signing mint transaction... Please approve.');

            const txBuffer = Buffer.from(transaction, 'base64');
            const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));

            const signedTx = await signTransaction(tx);

            setStatus('Sending transaction to Solana...');
            const signature = await connection.sendRawTransaction(signedTx.serialize());

            setStatus('Confirming transaction...');
            await connection.confirmTransaction(signature, 'confirmed');

            console.log('Transaction signature:', signature);
            console.log('NFT minted:', mint);
            setCreatedNft(mint);
            setStatus('Success! NFT Minted into Collection.');

            // Reset form
            setFormData({ name: '', symbol: '', description: '' });
            setMainFile(null);
            setCoverFile(null);
            setPreviewUrl(null);
            setCoverPreviewUrl(null);

        } catch (err: unknown) {
            console.error('Error creating NFT:', err);
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError(String(err) || 'Failed to create NFT');
            }
            setStatus('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Mint NFT into Collection</CardTitle>
                <CardDescription>Mint a new NFT into an existing collection</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="collection" className="text-sm font-medium">Collection Address</label>
                        <div className="flex gap-2">
                            <input
                                id="collection"
                                type="text"
                                required
                                value={collectionAddress}
                                onChange={(e) => setCollectionAddress(e.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="Enter collection address"
                            />
                            <button
                                type="button"
                                onClick={loadCollection}
                                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
                            >
                                Load
                            </button>
                        </div>
                        {collectionInfo && (
                            <div className="text-sm text-green-600 bg-green-50 p-2 rounded-md border border-green-200">
                                ✓ Collection loaded: {collectionInfo.name}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="name" className="text-sm font-medium">NFT Name</label>
                        <input
                            id="name"
                            name="name"
                            type="text"
                            required
                            value={formData.name}
                            onChange={handleInputChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="My NFT #1"
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="symbol" className="text-sm font-medium">Symbol</label>
                        <input
                            id="symbol"
                            name="symbol"
                            type="text"
                            required
                            value={formData.symbol}
                            onChange={handleInputChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="NFT"
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="description" className="text-sm font-medium">Description</label>
                        <textarea
                            id="description"
                            name="description"
                            required
                            value={formData.description}
                            onChange={handleInputChange}
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Description of your NFT"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Main File (Image, Video, Audio)</label>
                        <input
                            type="file"
                            onChange={handleFileChange}
                            accept="image/*,video/*,audio/*"
                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            required
                        />
                        {previewUrl && (
                            <div className="mt-2 rounded-md overflow-hidden border bg-muted">
                                {mainFile?.type.startsWith('video/') ? (
                                    <video src={previewUrl} controls className="max-h-64 w-full object-contain" />
                                ) : mainFile?.type.startsWith('audio/') ? (
                                    <audio src={previewUrl} controls className="w-full p-4" />
                                ) : (
                                    <img src={previewUrl} alt="Preview" className="max-h-64 w-full object-contain" />
                                )}
                            </div>
                        )}
                    </div>

                    {isMultimedia && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Cover Image (Required for Video/Audio)</label>
                            <input
                                type="file"
                                onChange={handleCoverChange}
                                accept="image/*"
                                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                required
                            />
                            {coverPreviewUrl && (
                                <div className="mt-2 rounded-md overflow-hidden border bg-muted">
                                    <img src={coverPreviewUrl} alt="Cover Preview" className="max-h-64 w-full object-contain" />
                                </div>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md border border-red-200">
                            {error}
                        </div>
                    )}

                    {createdNft && (
                        <div className="p-3 text-sm text-green-600 bg-green-50 rounded-md border border-green-200">
                            NFT Minted into Collection! Address: <span className="font-mono font-bold">{createdNft}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !publicKey}
                        className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                    >
                        {loading ? status : 'Mint NFT into Collection'}
                    </button>
                </form>
            </CardContent>
        </Card>
    );
};
