use anchor_lang::prelude::*;

declare_id!("EventEscrow1111111111111111111111111111111");

#[program]
pub mod event_escrow {
    use super::*;

    /// Create an event escrow account
    pub fn create_event_escrow(
        ctx: Context<CreateEventEscrow>,
        event_id: u64,
        amount: u64,
        event_date: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.event_id = event_id;
        escrow.participant = ctx.accounts.participant.key();
        escrow.event_creator = ctx.accounts.event_creator.key();
        escrow.amount = amount;
        escrow.status = EscrowStatus::Pending;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.event_date = event_date;
        escrow.confirmed_at = None;
        escrow.bump = ctx.bumps.escrow;
        
        msg!("Event escrow created: event_id={}, amount={}", event_id, amount);
        Ok(())
    }

    /// Deposit SOL into escrow (participant joins event)
    pub fn deposit_entry_fee(ctx: Context<DepositEntryFee>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Pending,
            EscrowError::EscrowNotPending
        );
        require!(
            ctx.accounts.escrow.amount == amount,
            EscrowError::AmountMismatch
        );

        // Transfer SOL from participant to escrow PDA
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.participant.key(),
                &ctx.accounts.escrow.key(),
                amount,
            ),
            &[
                ctx.accounts.participant.to_account_info(),
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Funded;
        msg!("Entry fee deposited: amount={}", amount);
        Ok(())
    }

    /// Confirm event happened (by event creator or guest)
    pub fn confirm_event(ctx: Context<ConfirmEvent>) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Funded,
            EscrowError::EscrowNotFunded
        );
        require!(
            ctx.accounts.confirmer.key() == ctx.accounts.escrow.event_creator
                || ctx.accounts.confirmer.key() == ctx.accounts.escrow.participant,
            EscrowError::UnauthorizedConfirmer
        );

        ctx.accounts.escrow.status = EscrowStatus::Confirmed;
        ctx.accounts.escrow.confirmed_at = Some(Clock::get()?.unix_timestamp);
        
        msg!("Event confirmed");
        Ok(())
    }

    /// Release payment to event creator
    pub fn release_payment(ctx: Context<ReleasePayment>) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Confirmed,
            EscrowError::EscrowNotConfirmed
        );

        // Transfer SOL from escrow PDA to event creator
        let seeds = &[
            b"event-escrow",
            &ctx.accounts.escrow.event_id.to_le_bytes(),
            ctx.accounts.escrow.participant.as_ref(),
            &[ctx.accounts.escrow.bump],
        ];
        let signer = &[&seeds[..]];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.escrow.key(),
                &ctx.accounts.event_creator.key(),
                ctx.accounts.escrow.amount,
            ),
            &[
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.event_creator.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Released;
        msg!("Payment released: amount={}", ctx.accounts.escrow.amount);
        Ok(())
    }

    /// Auto-release after 7 days (can be called by anyone after time passes)
    pub fn auto_release(ctx: Context<AutoRelease>) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Funded
                || ctx.accounts.escrow.status == EscrowStatus::Confirmed,
            EscrowError::InvalidStatusForRelease
        );

        let current_time = Clock::get()?.unix_timestamp;
        let event_date = ctx.accounts.escrow.event_date;
        let days_since_event = (current_time - event_date) / 86400; // 86400 seconds in a day

        require!(
            days_since_event >= 7,
            EscrowError::SevenDaysNotPassed
        );

        // Transfer SOL from escrow PDA to event creator
        let seeds = &[
            b"event-escrow",
            &ctx.accounts.escrow.event_id.to_le_bytes(),
            ctx.accounts.escrow.participant.as_ref(),
            &[ctx.accounts.escrow.bump],
        ];
        let signer = &[&seeds[..]];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.escrow.key(),
                &ctx.accounts.event_creator.key(),
                ctx.accounts.escrow.amount,
            ),
            &[
                ctx.accounts.escrow.to_account_info(),
                ctx.accounts.event_creator.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Released;
        msg!("Auto-released after 7 days: amount={}", ctx.accounts.escrow.amount);
        Ok(())
    }

    /// Dispute payment (move to disputed state)
    pub fn dispute_payment(ctx: Context<DisputePayment>) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Funded
                || ctx.accounts.escrow.status == EscrowStatus::Confirmed,
            EscrowError::InvalidStatusForDispute
        );
        require!(
            ctx.accounts.escrow.participant == ctx.accounts.disputer.key(),
            EscrowError::UnauthorizedDisputer
        );

        ctx.accounts.escrow.status = EscrowStatus::Disputed;
        msg!("Payment disputed");
        Ok(())
    }

    /// Admin resolve dispute (refund or release)
    pub fn admin_resolve_dispute(
        ctx: Context<AdminResolveDispute>,
        refund_participant: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.escrow.status == EscrowStatus::Disputed,
            EscrowError::EscrowNotDisputed
        );

        let seeds = &[
            b"event-escrow",
            &ctx.accounts.escrow.event_id.to_le_bytes(),
            ctx.accounts.escrow.participant.as_ref(),
            &[ctx.accounts.escrow.bump],
        ];
        let signer = &[&seeds[..]];

        if refund_participant {
            // Refund to participant
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.escrow.key(),
                    &ctx.accounts.participant.key(),
                    ctx.accounts.escrow.amount,
                ),
                &[
                    ctx.accounts.escrow.to_account_info(),
                    ctx.accounts.participant.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
            ctx.accounts.escrow.status = EscrowStatus::Refunded;
            msg!("Dispute resolved: refunded to participant");
        } else {
            // Release to event creator
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.escrow.key(),
                    &ctx.accounts.event_creator.key(),
                    ctx.accounts.escrow.amount,
                ),
                &[
                    ctx.accounts.escrow.to_account_info(),
                    ctx.accounts.event_creator.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;
            ctx.accounts.escrow.status = EscrowStatus::Released;
            msg!("Dispute resolved: released to creator");
        }

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct CreateEventEscrow<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    /// CHECK: Event creator wallet
    pub event_creator: UncheckedAccount<'info>,
    #[account(
        init,
        payer = participant,
        space = 8 + EventEscrow::LEN,
        seeds = [b"event-escrow", &event_id.to_le_bytes(), participant.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, EventEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositEntryFee<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(
        mut,
        seeds = [b"event-escrow", &escrow.event_id.to_le_bytes(), escrow.participant.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EventEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmEvent<'info> {
    pub confirmer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"event-escrow", &escrow.event_id.to_le_bytes(), escrow.participant.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EventEscrow>,
}

#[derive(Accounts)]
pub struct ReleasePayment<'info> {
    /// CHECK: Event creator receives payment
    #[account(mut)]
    pub event_creator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"event-escrow", &escrow.event_id.to_le_bytes(), escrow.participant.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EventEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AutoRelease<'info> {
    /// CHECK: Event creator receives payment
    #[account(mut)]
    pub event_creator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"event-escrow", &escrow.event_id.to_le_bytes(), escrow.participant.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EventEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DisputePayment<'info> {
    pub disputer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"event-escrow", &escrow.event_id.to_le_bytes(), escrow.participant.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EventEscrow>,
}

#[derive(Accounts)]
pub struct AdminResolveDispute<'info> {
    /// CHECK: Admin account
    pub admin: Signer<'info>,
    /// CHECK: Participant wallet
    #[account(mut)]
    pub participant: UncheckedAccount<'info>,
    /// CHECK: Event creator wallet
    #[account(mut)]
    pub event_creator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"event-escrow", &escrow.event_id.to_le_bytes(), escrow.participant.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EventEscrow>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct EventEscrow {
    pub event_id: u64,
    pub participant: Pubkey,
    pub event_creator: Pubkey,
    pub amount: u64,
    pub status: EscrowStatus,
    pub created_at: i64,
    pub event_date: i64,
    pub confirmed_at: Option<i64>,
    pub bump: u8,
}

impl EventEscrow {
    pub const LEN: usize = 8 + // discriminator
        8 + // event_id
        32 + // participant
        32 + // event_creator
        8 + // amount
        1 + // status
        8 + // created_at
        8 + // event_date
        9 + // confirmed_at (Option<i64>)
        1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Pending,
    Funded,
    Confirmed,
    Released,
    Disputed,
    Refunded,
}

#[error_code]
pub enum EscrowError {
    #[msg("Escrow is not in pending status")]
    EscrowNotPending,
    #[msg("Escrow is not funded")]
    EscrowNotFunded,
    #[msg("Escrow is not confirmed")]
    EscrowNotConfirmed,
    #[msg("Escrow is not disputed")]
    EscrowNotDisputed,
    #[msg("Amount mismatch")]
    AmountMismatch,
    #[msg("Unauthorized confirmer")]
    UnauthorizedConfirmer,
    #[msg("Unauthorized disputer")]
    UnauthorizedDisputer,
    #[msg("Invalid status for release")]
    InvalidStatusForRelease,
    #[msg("Invalid status for dispute")]
    InvalidStatusForDispute,
    #[msg("Seven days have not passed since event")]
    SevenDaysNotPassed,
}

