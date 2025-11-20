export const API_BASE_URL = 'https://workerbackend.ansht.workers.dev/';

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
    attributes?: {
        trait_type: string;
        value: string;
    }[];
    properties?: any;
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

