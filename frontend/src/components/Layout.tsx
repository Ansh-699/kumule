import { Link, NavLink, Outlet } from 'react-router-dom'
import { Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WalletButton } from './WalletButton'

const NAV = [
    { to: '/', label: 'Marketplace', end: true },
    { to: '/collections', label: 'Collections' },
    { to: '/events', label: 'Events' },
    { to: '/create', label: 'Create' },
]

export const Layout = () => (
    <div className="min-h-screen bg-[#07080d] text-white">
        {/* Ambient wash behind the fold, matching the mockup without costing a background image. */}
        <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.16),transparent_60%)]"
        />

        <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#07080d]/85 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 sm:px-6 lg:px-8">
                <Link to="/" className="flex shrink-0 items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
                        <Boxes className="h-4.5 w-4.5 text-white" />
                    </span>
                    <span className="text-lg font-bold tracking-tight">Kumule</span>
                </Link>

                <nav className="hidden items-center gap-1 md:flex">
                    {NAV.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) =>
                                cn(
                                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                    isActive ? 'text-white' : 'text-white/55 hover:text-white'
                                )
                            }
                        >
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div className="ml-auto flex items-center gap-3">
                    <WalletButton />
                </div>
            </div>

            {/* Mobile nav sits below the bar so the wallet button keeps its room. */}
            <nav className="flex items-center gap-1 overflow-x-auto border-t border-white/[0.05] px-4 py-2 md:hidden">
                {NAV.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                            cn(
                                'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                                isActive ? 'bg-white/[0.06] text-white' : 'text-white/55'
                            )
                        }
                    >
                        {item.label}
                    </NavLink>
                ))}
            </nav>
        </header>

        <main className="relative">
            <Outlet />
        </main>

        <footer className="mt-16 border-t border-white/[0.07] py-8">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
                <p>Kumule — multi-chain NFT marketplace</p>
                <p>Solana devnet · Base Sepolia · testnets only, no real funds</p>
            </div>
        </footer>
    </div>
)
