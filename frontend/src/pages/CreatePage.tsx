import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAccount, useWriteContract } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { Upload, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type Chain, type Category } from '@/lib/api'
import { CHAIN_UI } from '@/lib/chain-ui'
import { ChainMark } from '@/components/ChainBadge'
import { CATEGORIES } from '@/lib/chain-ui'
import { NFT_ABI } from '@/lib/evm-abi'
import { signAndSend, describeError } from '@/lib/solana-tx'

/**
 * Minting, deliberately kept lean per the brief.
 *
 * The image goes to R2 first, then metadata JSON referencing it, and only then does the mint
 * transaction get built. That ordering means a token is never created pointing at a URI that
 * does not resolve - the v1 failure that left 152 unrenderable NFTs.
 */

type State =
    | { kind: 'idle' }
    | { kind: 'busy'; step: string }
    | { kind: 'done'; assetId: string; explorerUrl?: string }
    | { kind: 'error'; message: string }

export const CreatePage = () => {
    const [chain, setChain] = useState<Chain>('SOLANA')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [category, setCategory] = useState<Category>('ART')
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<string | null>(null)
    const [state, setState] = useState<State>({ kind: 'idle' })

    const solana = useWallet()
    const evm = useAccount()
    const { writeContractAsync } = useWriteContract()
    const { data: contracts } = useQuery({
        queryKey: ['evm-contracts'],
        queryFn: () => api.evmContracts(),
        enabled: chain === 'ETHEREUM',
    })

    const address = chain === 'SOLANA' ? solana.publicKey?.toBase58() : evm.address
    const ui = CHAIN_UI[chain]

    const pickFile = (f: File | null) => {
        setFile(f)
        setPreview(f ? URL.createObjectURL(f) : null)
    }

    const mint = async () => {
        if (!file || !name || !address) return
        try {
            setState({ kind: 'busy', step: 'Uploading image…' })
            const { url: imageUrl } = await api.uploadImage(file)

            setState({ kind: 'busy', step: 'Uploading metadata…' })
            const { url: metadataUri } = await api.uploadMetadata({
                name,
                description,
                image: imageUrl,
                attributes: [{ trait_type: 'Category', value: category }],
            })

            if (chain === 'ETHEREUM') {
                if (!contracts) throw new Error('Contract addresses unavailable')
                setState({ kind: 'busy', step: 'Confirm the mint in your wallet…' })
                const hash = await writeContractAsync({
                    address: contracts.nft as `0x${string}`,
                    abi: NFT_ABI,
                    functionName: 'mint',
                    args: [evm.address!, metadataUri],
                })
                setState({ kind: 'done', assetId: metadataUri, explorerUrl: ui.explorerTx(hash) })
                return
            }

            setState({ kind: 'busy', step: 'Building the mint transaction…' })
            const { transaction, mint: mintAddress } = await api.solanaMint({
                uri: metadataUri,
                name,
                owner: address,
            })

            setState({ kind: 'busy', step: 'Approve the mint in your wallet…' })
            // signAndSend handles the versioned wire format umi emits, and throws if the
            // transaction lands but errors on chain rather than reporting a false success.
            const { signature } = await signAndSend(solana, transaction)

            setState({ kind: 'done', assetId: mintAddress, explorerUrl: ui.explorerTx(signature) })
        } catch (e: any) {
            setState({ kind: 'error', message: describeError(e) })
        }
    }

    const busy = state.kind === 'busy'

    return (
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
            <h1 className="text-3xl font-bold text-white">Create an NFT</h1>
            <p className="mt-2 text-sm text-white/50">
                Mint on Solana devnet or Base Sepolia. You sign and pay your own network fee.
            </p>

            <div className="mt-6 space-y-5 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-6">
                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Chain</label>
                    <div className="flex gap-2">
                        {(['SOLANA', 'ETHEREUM'] as Chain[]).map((c) => (
                            <button
                                key={c}
                                onClick={() => setChain(c)}
                                className={cn(
                                    'inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                                    chain === c
                                        ? 'bg-indigo-500/20 text-white ring-1 ring-indigo-400/40'
                                        : 'bg-white/[0.03] text-white/55 hover:text-white'
                                )}
                            >
                                <ChainMark chain={c} className={cn('h-4 w-4', CHAIN_UI[c].accent)} />
                                {CHAIN_UI[c].label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Image</label>
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center hover:border-white/30">
                        {preview ? (
                            <img src={preview} alt="" className="h-40 w-40 rounded-lg object-cover" />
                        ) : (
                            <>
                                <Upload className="h-6 w-6 text-white/35" />
                                <span className="text-sm text-white/50">Choose an image</span>
                            </>
                        )}
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                            className="sr-only"
                        />
                    </label>
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Name</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My NFT"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Description</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Category</label>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as Category)}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white focus:border-indigo-400/60 focus:outline-none"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value} className="bg-[#0e1018]">{c.label}</option>
                        ))}
                    </select>
                </div>

                {state.kind === 'busy' && (
                    <div className="flex items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.07] p-3.5 text-sm text-white" role="status">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
                        {state.step}
                    </div>
                )}
                {state.kind === 'error' && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3.5 text-sm text-white" role="status">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                        {state.message}
                    </div>
                )}
                {state.kind === 'done' && (
                    <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5 text-sm text-white" role="status">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        <span>
                            Minted.
                            {state.explorerUrl && (
                                <a href={state.explorerUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-indigo-300 underline">
                                    view <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </span>
                    </div>
                )}

                <button
                    onClick={mint}
                    disabled={busy || !file || !name || !address}
                    className="w-full rounded-xl bg-indigo-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:bg-white/[0.05] disabled:text-white/40"
                >
                    {!address ? `Connect a ${ui.label} wallet` : busy ? 'Working…' : `Mint on ${ui.label}`}
                </button>
            </div>
        </div>
    )
}
