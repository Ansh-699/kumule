# NFT Marketplace

A decentralized NFT marketplace on Solana Devnet using Anchor, MPL Core, and Cloudflare Workers.

## Architecture Flow

1.  **Minting**:
    *   User uploads image and metadata to Irys (decentralized storage) via the Frontend.
    *   Frontend sends metadata URI to Backend (`/mint`).
    *   Backend creates a mint transaction, signs it with a generated asset signer (partial sign), and returns it.
    *   User signs the transaction with their wallet and submits it to Solana.

2.  **Listing (Escrow)**:
    *   User requests to list an NFT (`/list`).
    *   Backend builds a transaction to initialize an Escrow PDA and deposit the NFT into it.
    *   User signs and submits. The NFT is now held by the program.

3.  **Buying**:
    *   Buyer requests to buy an NFT (`/buy`).
    *   Backend builds a transaction that transfers SOL to the seller and the NFT to the buyer.
    *   Buyer signs and submits. The program validates the trade and executes the atomic swap.

4.  **Tech Stack**:
    *   **Frontend**: React, Vite, TailwindCSS, Shadcn UI.
    *   **Backend**: Cloudflare Workers (Hono), Metaplex Umi.
    *   **Blockchain**: Solana (Devnet), Anchor Framework, Metaplex MPL Core.
