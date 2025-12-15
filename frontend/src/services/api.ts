// Local dev backend (Cloudflare Worker via `bun run dev` / `wrangler dev`)
// Make sure this port matches the one shown in your worker dev logs.
export const API_BASE_URL = 'http://localhost:8787'; // Production Worker URL https://kumele-backend.ansht.workers.dev

// Upload image to R2 (for admin reward NFT minting and marketplace)
export const uploadImageToR2 = async (file: File, apiKey?: string): Promise<{ url: string; filename: string }> => {
    const formData = new FormData()
    formData.append('image', file)

    const url = apiKey 
        ? `${API_BASE_URL}/api/upload/image?apiKey=${apiKey}`
        : `${API_BASE_URL}/api/upload/image`

    const response = await fetch(url, {
        method: 'POST',
        body: formData,
    })

    if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload image')
    }

    const data = await response.json()
    return { url: data.url, filename: data.filename }
}

// Upload multiple files to R2 (main file + optional cover file)
export const uploadFilesToR2 = async (mainFile: File, coverFile?: File | null): Promise<{ files: Array<{ url: string; contentType: string }>, mainFile: { url: string; contentType: string }, coverFile: { url: string; contentType: string } | null }> => {
    const formData = new FormData()
    formData.append('mainFile', mainFile)
    if (coverFile) {
        formData.append('coverFile', coverFile)
    }

    const response = await fetch(`${API_BASE_URL}/api/upload/files`, {
        method: 'POST',
        body: formData,
    })

    if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload files')
    }

    const data = await response.json()
    return {
        files: data.files,
        mainFile: data.mainFile,
        coverFile: data.coverFile
    }
}

// Upload metadata to R2 (for admin reward NFT minting and marketplace)
export const uploadMetadataToR2 = async (metadata: any, apiKey?: string, filename?: string): Promise<{ url: string }> => {
    const url = apiKey 
        ? `${API_BASE_URL}/api/upload/metadata?apiKey=${apiKey}`
        : `${API_BASE_URL}/api/upload/metadata`

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata, filename }),
    })

    if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload metadata')
    }

    const data = await response.json()
    return { url: data.url }
}

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

// Check payment status and update database (active check)
export const checkPaymentStatus = async (chargeId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/payment/check-status/${chargeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to check payment status' }));
        throw new Error(error.error || 'Failed to check payment status');
    }
    return response.json();
};

// Cancel payment when window is closed
export const cancelPayment = async (chargeId: string) => {
    const response = await fetch(`${API_BASE_URL}/api/payment/cancel/${chargeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to cancel payment' }));
        throw new Error(error.error || 'Failed to cancel payment');
    }
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

// Reward system APIs
export const getRewardAccount = async (walletAddress: string) => {
    const response = await fetch(`${API_BASE_URL}/api/rewards/account?walletAddress=${walletAddress}`);
    if (!response.ok) throw new Error('Failed to get reward account');
    return response.json();
};

export const recordInteraction = async (walletAddress: string, interactionType: string = 'CLICK', points: number = 10) => {
    const response = await fetch(`${API_BASE_URL}/api/rewards/interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, interactionType, points })
    });
    if (!response.ok) throw new Error('Failed to record interaction');
    return response.json();
};

export const claimNftReward = async (walletAddress: string, nftAsset: string, requiredPoints: number, rewardType: string = 'MUSIC_NFT') => {
    const response = await fetch(`${API_BASE_URL}/api/rewards/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, nftAsset, requiredPoints, rewardType })
    });
    if (!response.ok) throw new Error('Failed to claim reward');
    return response.json();
};

export const getAvailableRewards = async () => {
    const response = await fetch(`${API_BASE_URL}/api/rewards/available`);
    if (!response.ok) throw new Error('Failed to get available rewards');
    return response.json();
};

export const fetchNftByAsset = async (assetAddress: string): Promise<NftAsset> => {
    console.log('API: fetchNftByAsset', assetAddress);
    
    // Clean the address
    const cleanAddress = assetAddress.trim().replace(/[^A-Za-z0-9]/g, '');
    
    if (!cleanAddress || cleanAddress.length < 32) {
        throw new Error('Invalid asset address');
    }
    
    try {
        // Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(`${API_BASE_URL}?asset=${encodeURIComponent(cleanAddress)}`, {
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        clearTimeout(timeoutId);
        
        console.log('API Response:', response.status, response.ok);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            throw new Error(`Failed to fetch NFT by asset: ${response.statusText}`);
        }
        const data = await response.json();
        console.log('API Data:', data);
        return data;
    } catch (error: any) {
        console.error('Error in fetchNftByAsset:', error);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        throw error;
    }
};

export const fetchNftByOwner = async (ownerAddress: string): Promise<NftAsset[]> => {
    console.log('API: fetchNftByOwner', ownerAddress);
    
    // Clean the address - remove any invalid characters
    const cleanAddress = ownerAddress.trim().replace(/[^A-Za-z0-9]/g, '');
    
    if (!cleanAddress || cleanAddress.length < 32) {
        console.error('Invalid wallet address:', ownerAddress);
        return [];
    }
    
    const url = `${API_BASE_URL}/owner?owner=${encodeURIComponent(cleanAddress)}`;
    console.log('API URL:', url);
    
    try {
        // Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        clearTimeout(timeoutId);
        
        console.log('API Response:', response.status, response.ok);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            // Return empty array instead of throwing for better UX
            return [];
        }
        
        const data = await response.json();
        console.log('API Data:', { type: typeof data, isArray: Array.isArray(data), length: data?.length });
        
        // Handle both array and object responses
        if (Array.isArray(data)) {
            return data;
        } else if (data && Array.isArray(data.items)) {
            return data.items;
        } else if (data && typeof data === 'object' && !data.error) {
            // If it's a single asset object, wrap it in an array
            return [data];
        }
        return [];
    } catch (error: any) {
        console.error('Error in fetchNftByOwner:', error);
        if (error.name === 'AbortError') {
            console.error('Request timed out');
        }
        // Return empty array instead of throwing for better UX
        return [];
    }
};

