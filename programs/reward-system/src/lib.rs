use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use mpl_core::instructions::TransferV1Builder;

declare_id!("RewardSystem111111111111111111111111111111");

#[program]
pub mod reward_system {
    use super::*;

    /// Initialize a reward account for a user
    pub fn initialize_reward(ctx: Context<InitializeReward>) -> Result<()> {
        let reward = &mut ctx.accounts.reward;
        reward.user = ctx.accounts.user.key();
        reward.interaction_count = 0;
        reward.claimed_nfts = 0;
        reward.bump = ctx.bumps.reward;
        
        msg!("Reward account initialized for user: {}", ctx.accounts.user.key());
        Ok(())
    }

    /// Record an interaction (called by backend/off-chain)
    pub fn record_interaction(ctx: Context<RecordInteraction>, points: u64) -> Result<()> {
        let reward = &mut ctx.accounts.reward;
        reward.interaction_count = reward.interaction_count.checked_add(points)
            .ok_or(RewardError::Overflow)?;
        
        msg!("Interaction recorded: points={}, total={}", points, reward.interaction_count);
        Ok(())
    }

    /// Claim NFT reward (transfer NFT to user)
    pub fn claim_nft_reward<'info>(
        ctx: Context<'_, '_, '_, 'info, ClaimNftReward<'info>>,
        required_points: u64,
    ) -> Result<()> {
        let reward = &ctx.accounts.reward;
        
        require!(
            reward.interaction_count >= required_points,
            RewardError::InsufficientPoints
        );

        // Transfer NFT from reward vault to user
        let ix = if ctx.remaining_accounts.len() >= 2 {
            TransferV1Builder::new()
                .asset(ctx.accounts.nft_asset.key())
                .payer(ctx.accounts.reward_vault.key())
                .new_owner(ctx.accounts.user.key())
                .collection(Some(ctx.remaining_accounts[1].key()))
                .instruction()
        } else {
            TransferV1Builder::new()
                .asset(ctx.accounts.nft_asset.key())
                .payer(ctx.accounts.reward_vault.key())
                .new_owner(ctx.accounts.user.key())
                .instruction()
        };

        let account_infos: &[AccountInfo<'info>] = &[
            &[
                ctx.accounts.nft_asset.to_account_info(),
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            ctx.remaining_accounts,
        ]
        .concat();

        let seeds = &[
            b"reward-vault",
            &[ctx.accounts.reward_vault.bump],
        ];
        let signer = &[&seeds[..]];

        invoke_signed(&ix, account_infos, signer)?;

        // Update reward account
        let reward = &mut ctx.accounts.reward;
        reward.interaction_count = reward.interaction_count.checked_sub(required_points)
            .ok_or(RewardError::Underflow)?;
        reward.claimed_nfts = reward.claimed_nfts.checked_add(1)
            .ok_or(RewardError::Overflow)?;

        msg!("NFT reward claimed: user={}, nft={}", ctx.accounts.user.key(), ctx.accounts.nft_asset.key());
        Ok(())
    }

    /// Mint and transfer NFT to user (for free NFT rewards)
    pub fn mint_and_transfer_nft<'info>(
        ctx: Context<'_, '_, '_, 'info, MintAndTransferNft<'info>>,
        required_points: u64,
    ) -> Result<()> {
        let reward = &ctx.accounts.reward;
        
        require!(
            reward.interaction_count >= required_points,
            RewardError::InsufficientPoints
        );

        // This instruction assumes the NFT is already minted and in the reward vault
        // The actual minting would be done off-chain or via another program
        // Here we just transfer it to the user

        let ix = if ctx.remaining_accounts.len() >= 2 {
            TransferV1Builder::new()
                .asset(ctx.accounts.nft_asset.key())
                .payer(ctx.accounts.reward_vault.key())
                .new_owner(ctx.accounts.user.key())
                .collection(Some(ctx.remaining_accounts[1].key()))
                .instruction()
        } else {
            TransferV1Builder::new()
                .asset(ctx.accounts.nft_asset.key())
                .payer(ctx.accounts.reward_vault.key())
                .new_owner(ctx.accounts.user.key())
                .instruction()
        };

        let account_infos: &[AccountInfo<'info>] = &[
            &[
                ctx.accounts.nft_asset.to_account_info(),
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            ctx.remaining_accounts,
        ]
        .concat();

        let seeds = &[
            b"reward-vault",
            &[ctx.accounts.reward_vault.bump],
        ];
        let signer = &[&seeds[..]];

        invoke_signed(&ix, account_infos, signer)?;

        // Update reward account
        let reward = &mut ctx.accounts.reward;
        reward.interaction_count = reward.interaction_count.checked_sub(required_points)
            .ok_or(RewardError::Underflow)?;
        reward.claimed_nfts = reward.claimed_nfts.checked_add(1)
            .ok_or(RewardError::Overflow)?;

        msg!("NFT minted and transferred: user={}, nft={}", ctx.accounts.user.key(), ctx.accounts.nft_asset.key());
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeReward<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + RewardAccount::LEN,
        seeds = [b"reward", user.key().as_ref()],
        bump
    )]
    pub reward: Account<'info, RewardAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordInteraction<'info> {
    /// CHECK: Can be called by authorized backend
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"reward", reward.user.as_ref()],
        bump = reward.bump
    )]
    pub reward: Account<'info, RewardAccount>,
}

#[derive(Accounts)]
pub struct ClaimNftReward<'info> {
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"reward", user.key().as_ref()],
        bump = reward.bump
    )]
    pub reward: Account<'info, RewardAccount>,
    /// CHECK: NFT asset to transfer
    pub nft_asset: UncheckedAccount<'info>,
    /// CHECK: Reward vault PDA that holds NFTs
    #[account(
        seeds = [b"reward-vault"],
        bump = reward_vault.bump
    )]
    pub reward_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Remaining accounts for collection, etc.
    /// CHECK: Remaining accounts for MPL Core
}

#[derive(Accounts)]
pub struct MintAndTransferNft<'info> {
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"reward", user.key().as_ref()],
        bump = reward.bump
    )]
    pub reward: Account<'info, RewardAccount>,
    /// CHECK: NFT asset to transfer
    pub nft_asset: UncheckedAccount<'info>,
    /// CHECK: Reward vault PDA that holds NFTs
    #[account(
        seeds = [b"reward-vault"],
        bump = reward_vault.bump
    )]
    pub reward_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Remaining accounts for collection, etc.
    /// CHECK: Remaining accounts for MPL Core
}

#[account]
pub struct RewardAccount {
    pub user: Pubkey,
    pub interaction_count: u64,
    pub claimed_nfts: u64,
    pub bump: u8,
}

impl RewardAccount {
    pub const LEN: usize = 8 + // discriminator
        32 + // user
        8 + // interaction_count
        8 + // claimed_nfts
        1; // bump
}

#[error_code]
pub enum RewardError {
    #[msg("Insufficient points to claim reward")]
    InsufficientPoints,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Arithmetic underflow")]
    Underflow,
}

