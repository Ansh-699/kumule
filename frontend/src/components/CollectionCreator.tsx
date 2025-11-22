import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useWallet } from '@solana/wallet-adapter-react';
import { useUmi } from '@/hooks/useUmi';
import { createGenericFile, generateSigner } from '@metaplex-foundation/umi';
import { createCollection } from '@metaplex-foundation/mpl-core';

export const CollectionCreator = () => {
    const { publicKey } = useWallet();
    const umi = useUmi();
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [createdCollection, setCreatedCollection] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        symbol: '',
        description: '',
        externalUrl: '',
    });
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!publicKey) {
            setError('Please connect your wallet first.');
            return;
        }
        if (!imageFile) {
            setError('Please select a collection image.');
            return;
        }

        setLoading(true);
        setError('');
        setCreatedCollection(null);

        try {
            // 1. Upload Collection Image
            setStatus('Uploading collection image to Irys (1/2)... Please sign.');
            const buffer = await imageFile.arrayBuffer();
            const file = createGenericFile(new Uint8Array(buffer), imageFile.name, { contentType: imageFile.type });
            const [imageUri] = await umi.uploader.upload([file]);
            console.log('Collection Image uploaded:', imageUri);

            // 2. Upload Collection Metadata
            setStatus('Uploading collection metadata to Irys (2/2)... Please sign.');
            const metadata = {
                name: formData.name,
                symbol: formData.symbol,
                description: formData.description,
                image: imageUri,
                external_url: formData.externalUrl || undefined,
            };
            const metadataUri = await umi.uploader.uploadJson(metadata);
            console.log('Collection Metadata uploaded:', metadataUri);

            // 3. Create Collection On-Chain
            setStatus('Creating collection on-chain... Please sign the transaction.');
            const collectionSigner = generateSigner(umi);

            await createCollection(umi, {
                collection: collectionSigner,
                name: formData.name,
                uri: metadataUri,
            }).sendAndConfirm(umi);

            console.log('Collection created:', collectionSigner.publicKey);
            setCreatedCollection(collectionSigner.publicKey);
            setStatus('Success! Collection Created.');

            // Reset form
            setFormData({ name: '', symbol: '', description: '', externalUrl: '' });
            setImageFile(null);
            setPreviewUrl(null);

        } catch (err: unknown) {
            console.error('Error creating collection:', err);
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError(String(err) || 'Failed to create collection');
            }
            setStatus('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Create Collection</CardTitle>
                <CardDescription>Create a new NFT collection on Solana Devnet</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="name" className="text-sm font-medium">Collection Name</label>
                        <input
                            id="name"
                            name="name"
                            type="text"
                            required
                            value={formData.name}
                            onChange={handleInputChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="My NFT Collection"
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
                            placeholder="MNFT"
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
                            placeholder="Description of your collection"
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="externalUrl" className="text-sm font-medium">External URL (Optional)</label>
                        <input
                            id="externalUrl"
                            name="externalUrl"
                            type="url"
                            value={formData.externalUrl}
                            onChange={handleInputChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="https://example.com"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Collection Image</label>
                        <input
                            type="file"
                            onChange={handleFileChange}
                            accept="image/*"
                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            required
                        />
                        {previewUrl && (
                            <div className="mt-2 rounded-md overflow-hidden border bg-muted">
                                <img src={previewUrl} alt="Preview" className="max-h-64 w-full object-contain" />
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md border border-red-200">
                            {error}
                        </div>
                    )}

                    {createdCollection && (
                        <div className="p-3 text-sm text-green-600 bg-green-50 rounded-md border border-green-200">
                            Collection Created! Address: <span className="font-mono font-bold">{createdCollection}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !publicKey}
                        className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                    >
                        {loading ? status : 'Create Collection'}
                    </button>
                </form>
            </CardContent>
        </Card>
    );
};
