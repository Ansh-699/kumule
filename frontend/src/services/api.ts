// Local dev backend (Cloudflare Worker via `bun run dev` / `wrangler dev`)
// Make sure this port matches the one shown in your worker dev logs.
export const API_BASE_URL = 'http://localhost:8787'; // Production Worker URL https://kumele-backend.ansht.workers.dev

export const createPayment = async (amount: number, currency: string = 'USDC') => {
    const response = await fetch(`${API_BASE_URL}/api/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency })
    });
    if (!response.ok) throw new Error('Failed to create payment');
    return response.json();
};

export const getPaymentStatus = async (chargeId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/payment/status/${chargeId}`);
    if (!response.ok) throw new Error('Failed to get payment status');
    return response.json();
};

// Notify backend of Solana payment (for webhook-style logging)
export const notifySolanaPayment = async (
    solanaSignature: string, 
    walletAddress: string, 
    amount: number,
    chargeId?: string,
    transactionType: string = 'PAYMENT'
) => {
    const response = await fetch(`${API_BASE_URL}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            solanaSignature,
            walletAddress,
            amount,
            chargeId,
            transactionType
        })
    });
    if (!response.ok) throw new Error('Failed to notify payment');
    return response.json();
};

// Get transaction history for a wallet
export const getTransactionHistory = async (walletAddress?: string, limit: number = 50) => {
    const params = new URLSearchParams();
    if (walletAddress) params.append('walletAddress', walletAddress);
    params.append('limit', limit.toString());
    
    const response = await fetch(`${API_BASE_URL}/api/payments/transactions?${params}`);
    if (!response.ok) throw new Error('Failed to get transaction history');
    return response.json();
};

// Get payment logs (for debugging/admin)
export const getPaymentLogs = async (chargeId?: string, walletAddress?: string, limit: number = 50) => {
    const params = new URLSearchParams();
    if (chargeId) params.append('chargeId', chargeId);
    if (walletAddress) params.append('walletAddress', walletAddress);
    params.append('limit', limit.toString());
    
    const response = await fetch(`${API_BASE_URL}/api/payments/logs?${params}`);
    if (!response.ok) throw new Error('Failed to get payment logs');
    return response.json();
};

//https://workerbackend.ansht.workers.dev --->main cloudflare worker 
export interface NftAsset {
    publicKey: string;
    owner: string;
    uri: string;
    name: string;
    updateAuthority?: {
        type: string;
        address: string;
    };
    [key: string]: any;
}

export interface NftMetadata {
    name: string;
    description: string;
    image: string;
    animation_url?: string;
    attributes?: {
        trait_type: string;
        value: string;
    }[];
    properties?: {
        files?: {
            uri: string;
            type: string;
        }[];
        category?: string;
        [key: string]: any;
    };
}

export const fetchNftByAsset = async (assetAddress: string): Promise<NftAsset> => {
    console.log('API: fetchNftByAsset', assetAddress);
    const response = await fetch(`${API_BASE_URL}?asset=${assetAddress}`);
    console.log('API Response:', response.status, response.ok);
    if (!response.ok) {
        throw new Error('Failed to fetch NFT by asset');
    }
    const data = await response.json();
    console.log('API Data:', data);
    return data;
};

export const fetchNftByOwner = async (ownerAddress: string): Promise<NftAsset[]> => {
    console.log('API: fetchNftByOwner', ownerAddress);
    const url = `${API_BASE_URL}?owner=${ownerAddress}`;
    console.log('API URL:', url);
    const response = await fetch(url);
    console.log('API Response:', response.status, response.ok);
    if (!response.ok) {
        throw new Error('Failed to fetch NFTs by owner');
    }
    const data = await response.json();
    console.log('API Data:', { type: typeof data, isArray: Array.isArray(data), length: data?.length });
    return data;
};

