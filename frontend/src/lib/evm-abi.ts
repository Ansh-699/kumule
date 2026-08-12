// Minimal ABIs for the two Base Sepolia contracts.
//
// Only the functions the UI actually calls. A full artifact would drag build output into the
// bundle for no benefit, and these signatures are stable across upgrades because the proxies
// keep their interface.

export const NFT_ABI = [
    {
        type: 'function',
        name: 'mint',
        stateMutability: 'payable',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'uri', type: 'string' },
        ],
        outputs: [{ name: 'tokenId', type: 'uint256' }],
    },
    {
        type: 'function',
        name: 'setApprovalForAll',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'operator', type: 'address' },
            { name: 'approved', type: 'bool' },
        ],
        outputs: [],
    },
    {
        type: 'function',
        name: 'isApprovedForAll',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'operator', type: 'address' },
        ],
        outputs: [{ type: 'bool' }],
    },
    {
        type: 'function',
        name: 'ownerOf',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ type: 'address' }],
    },
    {
        type: 'function',
        name: 'tokenURI',
        stateMutability: 'view',
        inputs: [{ name: 'tokenId', type: 'uint256' }],
        outputs: [{ type: 'string' }],
    },
    {
        type: 'function',
        name: 'mintFee',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint256' }],
    },
    {
        type: 'event',
        name: 'Minted',
        inputs: [
            { name: 'tokenId', type: 'uint256', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'uri', type: 'string', indexed: false },
        ],
    },
] as const

export const MARKET_ABI = [
    {
        type: 'function',
        name: 'list',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'nft', type: 'address' },
            { name: 'tokenId', type: 'uint256' },
            { name: 'price', type: 'uint256' },
        ],
        outputs: [{ name: 'listingId', type: 'uint256' }],
    },
    {
        // Requires msg.value to equal the listing price exactly - overpaying reverts rather
        // than the contract keeping the surplus.
        type: 'function',
        name: 'buy',
        stateMutability: 'payable',
        inputs: [{ name: 'listingId', type: 'uint256' }],
        outputs: [],
    },
    {
        type: 'function',
        name: 'cancel',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'listingId', type: 'uint256' }],
        outputs: [],
    },
    {
        type: 'function',
        name: 'updatePrice',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'listingId', type: 'uint256' },
            { name: 'newPrice', type: 'uint256' },
        ],
        outputs: [],
    },
    {
        type: 'function',
        name: 'isFillable',
        stateMutability: 'view',
        inputs: [{ name: 'listingId', type: 'uint256' }],
        outputs: [{ type: 'bool' }],
    },
    {
        type: 'function',
        name: 'feeBps',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'uint96' }],
    },
    {
        type: 'event',
        name: 'Listed',
        inputs: [
            { name: 'listingId', type: 'uint256', indexed: true },
            { name: 'seller', type: 'address', indexed: true },
            { name: 'nft', type: 'address', indexed: true },
            { name: 'tokenId', type: 'uint256', indexed: false },
            { name: 'price', type: 'uint256', indexed: false },
        ],
    },
    {
        type: 'event',
        name: 'Purchased',
        inputs: [
            { name: 'listingId', type: 'uint256', indexed: true },
            { name: 'buyer', type: 'address', indexed: true },
            { name: 'seller', type: 'address', indexed: true },
            { name: 'nft', type: 'address', indexed: false },
            { name: 'tokenId', type: 'uint256', indexed: false },
            { name: 'price', type: 'uint256', indexed: false },
            { name: 'fee', type: 'uint256', indexed: false },
        ],
    },
] as const
