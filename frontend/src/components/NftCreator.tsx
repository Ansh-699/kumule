import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { API_BASE_URL } from '@/services/api';
import { useUmi } from '@/hooks/useUmi';
import { createGenericFile } from '@metaplex-foundation/umi';
import { Buffer } from 'buffer';
import { CollectionCreator } from './CollectionCreator';
import { CollectionNftMinter } from './CollectionNftMinter';

type Tab = 'nft' | 'create-collection' | 'mint-to-collection';

export const NftCreator = () => {
    const [activeTab, setActiveTab] = useState<Tab>('nft');
    const { publicKey, signTransaction } = useWallet();
    const { connection } = useConnection();
    const umi = useUmi();
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [createdNft, setCreatedNft] = useState<string | null>(null);

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

            // Reset cover if main file is changed
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

        setLoading(true);
        setError('');
        setCreatedNft(null);

        try {
            // 1. Upload Main File
            setStatus('Uploading main file to Irys (1/3)... Please sign the upload request.');
            const fileBuffer = await mainFile.arrayBuffer();
            const genericFile = createGenericFile(new Uint8Array(fileBuffer), mainFile.name, { contentType: mainFile.type });
            const [fileUri] = await umi.uploader.upload([genericFile]);
            console.log('Main File Uploaded:', fileUri);

            let imageUri = fileUri;
            let animationUri = undefined;
            let category = 'image';

            // 2. Upload Cover if needed
            if (isMultimedia) {
                category = mainFile.type.startsWith('video/') ? 'video' : 'audio';
                animationUri = fileUri;

                if (coverFile) {
                    setStatus('Uploading cover image to Irys... Please sign.');
                    const coverBuffer = await coverFile.arrayBuffer();
                    const genericCover = createGenericFile(new Uint8Array(coverBuffer), coverFile.name, { contentType: coverFile.type });
                    const [coverUri] = await umi.uploader.upload([genericCover]);
                    console.log('Cover Uploaded:', coverUri);
                    imageUri = coverUri;
                }
            }

            // 3. Upload Metadata
            setStatus('Uploading metadata to Irys (2/3)... Please sign the upload request.');
            const metadata = {
                name: formData.name,
                symbol: formData.symbol,
                description: formData.description,
                image: imageUri,
                animation_url: animationUri,
                properties: {
                    files: [
                        { uri: fileUri, type: mainFile.type },
                        ...(animationUri && imageUri !== fileUri ? [{ uri: imageUri, type: coverFile?.type || 'image/png' }] : [])
                    ],
                    category
                }
            };
            const metadataUri = await umi.uploader.uploadJson(metadata);
            console.log('Metadata Uploaded:', metadataUri);

            // 4. Mint NFT
            setStatus('Building mint transaction (3/3)...');
            const response = await fetch(`${API_BASE_URL}/mint`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    uri: metadataUri,
                    name: formData.name,
                    owner: publicKey.toString(),
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Backend error: ${errorText}`);
            }

            const data = await response.json();
            const { transaction, mint } = data;

            setStatus('Signing mint transaction (3/3)... Please approve the transaction.');

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
            setStatus('Success! NFT Minted.');

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
        <div className="w-full max-w-2xl mx-auto">
            {/* Tabs */}
            <div className="flex gap-1 mb-6 p-1 bg-muted rounded-lg border border-border">
                <button
                    onClick={() => setActiveTab('nft')}
                    className={`flex-1 px-4 py-2.5 rounded-md font-medium transition-all ${activeTab === 'nft'
                            ? 'bg-background text-foreground shadow-sm border border-border'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                >
                    Create NFT
                </button>
                <button
                    onClick={() => setActiveTab('create-collection')}
                    className={`flex-1 px-4 py-2.5 rounded-md font-medium transition-all ${activeTab === 'create-collection'
                            ? 'bg-background text-foreground shadow-sm border border-border'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                >
                    Create Collection
                </button>
                <button
                    onClick={() => setActiveTab('mint-to-collection')}
                    className={`flex-1 px-4 py-2.5 rounded-md font-medium transition-all ${activeTab === 'mint-to-collection'
                            ? 'bg-background text-foreground shadow-sm border border-border'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                >
                    Mint to Collection
                </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'nft' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Create NFT</CardTitle>
                        <CardDescription>Mint a new NFT on the Solana Devnet. You will pay for the upload and transaction fees.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="name" className="text-sm font-medium">Name</label>
                                <input
                                    id="name"
                                    name="name"
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="My Cool NFT"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="symbol" className="text-sm font-medium">Ticker (Symbol)</label>
                                <input
                                    id="symbol"
                                    name="symbol"
                                    type="text"
                                    required
                                    value={formData.symbol}
                                    onChange={handleInputChange}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="COOL"
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

                            {/* Main File Upload */}
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

                            {/* Cover Image Upload (Conditional) */}
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
                                    NFT Created Successfully! Address: <span className="font-mono font-bold">{createdNft}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !publicKey}
                                className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                            >
                                {loading ? status : 'Create NFT'}
                            </button>
                        </form>
                    </CardContent>
                </Card>
            )}

            {activeTab === 'create-collection' && <CollectionCreator />}
            {activeTab === 'mint-to-collection' && <CollectionNftMinter />}
        </div>
    );
};
