import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAccount } from 'wagmi'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatCount } from '@/lib/chain-ui'

/**
 * The heart on cards and detail pages.
 *
 * Previously this rendered likeCount with nothing able to change it. Liking needs an identity, so
 * either connected wallet works - the backend keys users on (chain, address), so the same person
 * liking from their Solana or EVM wallet counts once.
 */
export const LikeButton = ({
    assetId,
    likeCount,
    size = 'sm',
    className,
}: {
    assetId: string
    likeCount: number
    size?: 'sm' | 'lg'
    className?: string
}) => {
    const queryClient = useQueryClient()
    const solana = useWallet()
    const evm = useAccount()
    // Solana first when both are connected, since that is the chain most of this app runs on.
    const wallet = solana.publicKey?.toBase58() ?? evm.address ?? null

    const { data: state } = useQuery({
        queryKey: ['liked', assetId, wallet],
        queryFn: () => api.likeState(assetId, wallet!),
        enabled: Boolean(wallet),
        staleTime: 30_000,
    })

    const toggle = useMutation({
        mutationFn: () => api.toggleLike(assetId, wallet!),
        onSuccess: (r) => {
            // Both the flag and any list holding this asset's count are refreshed, so the number
            // on a card matches the number on its detail page.
            queryClient.setQueryData(['liked', assetId, wallet], { liked: r.liked })
            queryClient.invalidateQueries({ queryKey: ['nfts'] })
            queryClient.invalidateQueries({ queryKey: ['nft', assetId] })
        },
    })

    const liked = state?.liked ?? false
    // Reflect the pending change immediately; the invalidate above corrects it either way.
    const shown = toggle.isPending ? likeCount + (liked ? -1 : 1) : likeCount

    const lg = size === 'lg'

    return (
        <button
            onClick={(e) => {
                // Cards wrap this in a link to the detail page.
                e.preventDefault()
                e.stopPropagation()
                if (wallet) toggle.mutate()
            }}
            disabled={!wallet || toggle.isPending}
            title={wallet ? (liked ? 'Remove like' : 'Like') : 'Connect a wallet to like'}
            aria-pressed={liked}
            aria-label={liked ? 'Remove like' : 'Like'}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-lg backdrop-blur-md transition-colors',
                lg ? 'px-3 py-1.5 text-sm' : 'bg-black/50 px-2 py-1 text-xs',
                liked ? 'text-rose-400' : 'text-white/80 hover:text-rose-300',
                !wallet && 'cursor-not-allowed opacity-70',
                className
            )}
        >
            <Heart className={cn(lg ? 'h-4 w-4' : 'h-3.5 w-3.5', liked && 'fill-current')} />
            {formatCount(Math.max(shown, 0))}
        </button>
    )
}
