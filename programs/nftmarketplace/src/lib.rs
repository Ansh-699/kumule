use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use mpl_core::instructions::TransferV1Builder;

declare_id!("4WYfhmmEu1MoSMDQfiN2JEbQV28gSo6vhm9idEL7ArtG");

const ESCROW_SEED: &[u8] = b"escrow";

#[program]
pub mod nftmarketplace {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        price: u64,
        buyer: Option<Pubkey>,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        escrow.asset = ctx.accounts.asset.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.buyer = buyer;
        escrow.price = price;
        escrow.bump = ctx.bumps.escrow;
        escrow.status = EscrowStatus::Pending;
        escrow.reserved = [0; 5];

        Ok(())
    }

    pub fn deposit_asset<'info>(
        ctx: Context<'_, '_, '_, 'info, DepositAsset<'info>>,
    ) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Pending,
            EscrowError::EscrowNotPending
        );
        require_keys_eq!(
            ctx.accounts.escrow.seller,
            ctx.accounts.seller.key(),
            EscrowError::InvalidSeller
        );
        require_keys_eq!(
            ctx.accounts.escrow.asset,
            ctx.accounts.asset.key(),
            EscrowError::AssetMismatch
        );

        let ix = if ctx.remaining_accounts.len() >= 2 {
            TransferV1Builder::new()
                .asset(ctx.accounts.escrow.asset)
                .payer(ctx.accounts.seller.key())
                .new_owner(ctx.accounts.escrow.key())
                .collection(Some(ctx.remaining_accounts[1].key()))
                .instruction()
        } else {
            TransferV1Builder::new()
                .asset(ctx.accounts.escrow.asset)
                .payer(ctx.accounts.seller.key())
                .new_owner(ctx.accounts.escrow.key())
                .instruction()
        };

        let account_infos: &[AccountInfo<'info>] = &[
            &[
                ctx.accounts.asset.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            ctx.remaining_accounts,
        ]
        .concat();

        invoke(&ix, account_infos)?;

        ctx.accounts.escrow.status = EscrowStatus::Deposited;

        Ok(())
    }

    pub fn buy_asset<'info>(ctx: Context<'_, '_, '_, 'info, BuyAsset<'info>>) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Deposited,
            EscrowError::EscrowNotFunded
        );
        require_keys_eq!(
            ctx.accounts.escrow.asset,
            ctx.accounts.asset.key(),
            EscrowError::AssetMismatch
        );
        require_keys_eq!(
            ctx.accounts.escrow.seller,
            ctx.accounts.seller.key(),
            EscrowError::InvalidSeller
        );

        let transfer_sol_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.seller.key(),
            ctx.accounts.escrow.price,
        );

        invoke(
            &transfer_sol_ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        if let Some(expected_buyer) = ctx.accounts.escrow.buyer {
            require_keys_eq!(
                expected_buyer,
                ctx.accounts.buyer.key(),
                EscrowError::BuyerMismatch
            );
        } else {
            ctx.accounts.escrow.buyer = Some(ctx.accounts.buyer.key());
        }

        let asset_key = ctx.accounts.escrow.asset;
        let seller_key = ctx.accounts.escrow.seller;
        let bump = ctx.accounts.escrow.bump;

        let ix = if ctx.remaining_accounts.len() >= 2 {
            TransferV1Builder::new()
                .asset(asset_key)
                .payer(ctx.accounts.escrow.key())
                .new_owner(ctx.accounts.buyer.key())
                .collection(Some(ctx.remaining_accounts[1].key()))
                .instruction()
        } else {
            TransferV1Builder::new()
                .asset(asset_key)
                .payer(ctx.accounts.escrow.key())
                .new_owner(ctx.accounts.buyer.key())
                .instruction()
        };

        let account_infos: &[AccountInfo<'info>] = &[
            &[
                ctx.accounts.asset.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            ctx.remaining_accounts,
        ]
        .concat();

        let bump_seed = [bump];
        let signer_seeds: &[&[u8]] = &[
            ESCROW_SEED,
            asset_key.as_ref(),
            seller_key.as_ref(),
            &bump_seed,
        ];

        invoke_signed(&ix, account_infos, &[signer_seeds])?;

        ctx.accounts.escrow.status = EscrowStatus::Completed;

        Ok(())
    }

    pub fn cancel_escrow<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelEscrow<'info>>,
    ) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Deposited,
            EscrowError::EscrowNotFunded
        );
        require_keys_eq!(
            ctx.accounts.escrow.asset,
            ctx.accounts.asset.key(),
            EscrowError::AssetMismatch
        );
        require_keys_eq!(
            ctx.accounts.escrow.seller,
            ctx.accounts.seller.key(),
            EscrowError::InvalidSeller
        );

        let asset_key = ctx.accounts.escrow.asset;
        let seller_key = ctx.accounts.escrow.seller;
        let bump = ctx.accounts.escrow.bump;

        let ix = if ctx.remaining_accounts.len() >= 2 {
            TransferV1Builder::new()
                .asset(asset_key)
                .payer(ctx.accounts.escrow.key())
                .new_owner(ctx.accounts.seller.key())
                .collection(Some(ctx.remaining_accounts[1].key()))
                .instruction()
        } else {
            TransferV1Builder::new()
                .asset(asset_key)
                .payer(ctx.accounts.escrow.key())
                .new_owner(ctx.accounts.seller.key())
                .instruction()
        };

        let account_infos: &[AccountInfo<'info>] = &[
            &[
                ctx.accounts.asset.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            ctx.remaining_accounts,
        ]
        .concat();

        let bump_seed = [bump];
        let signer_seeds: &[&[u8]] = &[
            ESCROW_SEED,
            asset_key.as_ref(),
            seller_key.as_ref(),
            &bump_seed,
        ];

        invoke_signed(&ix, account_infos, &[signer_seeds])?;

        ctx.accounts.escrow.status = EscrowStatus::Cancelled;
        ctx.accounts.escrow.buyer = None;

        Ok(())
    }

    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            matches!(
                escrow.status,
                EscrowStatus::Completed | EscrowStatus::Cancelled
            ),
            EscrowError::EscrowStillActive
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub asset: UncheckedAccount<'info>,
    #[account(
        init,
        payer = seller,
        space = Escrow::SPACE,
        seeds = [ESCROW_SEED, asset.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositAsset<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = seller,
        seeds = [ESCROW_SEED, escrow.asset.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyAsset<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = seller,
        seeds = [ESCROW_SEED, escrow.asset.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = seller,
        seeds = [ESCROW_SEED, escrow.asset.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        close = seller,
        has_one = seller,
        seeds = [ESCROW_SEED, escrow.asset.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[account]
pub struct Escrow {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub buyer: Option<Pubkey>,
    pub price: u64,
    pub bump: u8,
    pub status: EscrowStatus,
    pub reserved: [u8; 5],
}

impl Escrow {
    pub const SPACE: usize = 8 + 32 + 32 + 33 + 8 + 1 + 1 + 5;
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Pending = 0,
    Deposited = 1,
    Completed = 2,
    Cancelled = 3,
}

impl Default for EscrowStatus {
    fn default() -> Self {
        EscrowStatus::Pending
    }
}

#[error_code]
pub enum EscrowError {
    #[msg("Escrow PDA bump is missing")]
    EscrowBumpMissing,
    #[msg("Escrow is not ready for this operation")]
    EscrowNotPending,
    #[msg("Unauthorized seller for escrow")]
    InvalidSeller,
    #[msg("Escrow asset account does not match")]
    AssetMismatch,
    #[msg("Escrow has not been funded")]
    EscrowNotFunded,
    #[msg("Escrow buyer does not match expected buyer")]
    BuyerMismatch,
    #[msg("Unable to resolve required CPI account")]
    MissingTransferAccount,
    #[msg("Escrow is still active")]
    EscrowStillActive,
}
