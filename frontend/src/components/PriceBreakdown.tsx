import type { PriceBreakdown as Breakdown } from '@/lib/api'

/**
 * The price the buyer is about to pay, itemised.
 *
 * Every string rendered here was formatted by the backend. Nothing on this side divides an
 * amount by 100 or calls Number() on money - the API sends integer minor units for
 * arithmetic and ready-made display strings for the screen, which is what keeps the number
 * on the button identical to the number Stripe charges.
 *
 * The fee line is labelled from the quote rather than hardcoded, because the backend owns
 * what that charge is called.
 */
export const PriceBreakdown = ({
    breakdown,
    feeLabel = 'NFT minting fee',
    feeNote,
}: {
    breakdown: Breakdown
    feeLabel?: string
    feeNote?: string
}) => {
    const rows: Array<{ label: string; value: string; note?: string }> = [
        { label: 'Mint', value: breakdown.display.base },
    ]
    // A zero tax line is noise, not information.
    if (breakdown.tax_amount_minor > 0) {
        rows.push({ label: 'Tax', value: breakdown.display.tax })
    }
    rows.push({ label: feeLabel, value: breakdown.display.nft_minting_fee, note: feeNote })

    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <dl className="space-y-2.5">
                {rows.map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between gap-4">
                        <dt className="text-sm text-white/55">
                            {row.label}
                            {row.note && (
                                <span className="mt-0.5 block text-[11px] leading-snug text-white/35">
                                    {row.note}
                                </span>
                            )}
                        </dt>
                        <dd className="shrink-0 font-mono text-sm text-white/80">{row.value}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-white/10 pt-3">
                <dt className="text-sm font-medium text-white">Total</dt>
                <dd className="shrink-0 font-mono text-base font-semibold text-white">
                    {breakdown.display.total}
                </dd>
            </div>
        </div>
    )
}
