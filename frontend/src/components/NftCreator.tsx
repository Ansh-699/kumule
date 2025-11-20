import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { API_BASE_URL } from '@/services/api';
import { useUmi } from '@/hooks/useUmi';
import { createGenericFile } from '@metaplex-foundation/umi';
import { Buffer } from 'buffer';

export const NftCreator = () => {
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
    const [imageFile, setImageFile] = useState<File | null>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setImageFile(e.target.files[0]);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!publicKey) {
            setError('Please connect your wallet first.');
            return;
        }
        if (!imageFile) {
            setError('Please select an image.');
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
            setStatus('Uploading image to Irys (1/3)... Please sign the upload request.');
            const buffer = await imageFile.arrayBuffer();
            const file = createGenericFile(new Uint8Array(buffer), imageFile.name, { contentType: imageFile.type });

            const [imageUri] = await umi.uploader.upload([file]);
            console.log('Image uploaded:', imageUri);

            setStatus('Uploading metadata to Irys (2/3)... Please sign the upload request.');
            const metadata = {
                name: formData.name,
                symbol: formData.symbol,
                description: formData.description,
                image: imageUri,
            };
            const metadataUri = await umi.uploader.uploadJson(metadata);
            console.log('Metadata uploaded:', metadataUri);

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

            setFormData({ name: '', symbol: '', description: '' });
            setImageFile(null);

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

                        <div className="space-y-2">
                            <label htmlFor="image" className="text-sm font-medium">Image</label>
                            <input
                                id="image"
                                name="image"
                                type="file"
                                accept="image/*"
                                required
                                onChange={handleFileChange}
                                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>

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
        </div>
    );
};
