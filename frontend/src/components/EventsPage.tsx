import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Calendar, Users, Coins, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { CreateEventModal } from './CreateEventModal';
import { EventCard } from './EventCard';

interface Event {
    id: string;
    name: string;
    description: string | null;
    entryFee: number;
    eventDate: string | null;
    creatorWallet: string;
    creatorId: string;
    createdAt: string;
    entries: EventEntry[];
}

interface EventEntry {
    id: string;
    eventId: string;
    userId: string;
    walletAddress: string;
    amount: number;
    txHash: string | null;
    createdAt: string;
}

export const EventsPage = () => {
    const { publicKey } = useWallet();
    const { toast } = useToast();
    const [events, setEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const fetchEvents = async () => {
        try {
            setLoading(true);
            const response = await fetch('https://kumele-backend.ansht.workers.dev/api/events');
            if (!response.ok) throw new Error('Failed to fetch events');
            const data = await response.json();
            setEvents(data);
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Failed to load events',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEvents();
    }, []);

    const handleEventCreated = () => {
        fetchEvents();
        setIsCreateModalOpen(false);
    };

    const handleJoinEvent = async (eventId: string, entryFee: number) => {
        if (!publicKey) {
            toast({
                title: 'Wallet not connected',
                description: 'Please connect your wallet to join events',
                variant: 'destructive',
            });
            return;
        }

        try {
            // TODO: Implement Solana payment transaction here
            const txHash = 'simulated_tx_hash_' + Date.now();

            const response = await fetch(`https://kumele-backend.ansht.workers.dev/api/events/${eventId}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: publicKey.toBase58(),
                    amount: entryFee,
                    txHash,
                }),
            });

            if (!response.ok) throw new Error('Failed to join event');

            toast({
                title: 'Success!',
                description: 'You have successfully joined the event',
            });

            fetchEvents();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Failed to join event',
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-pink-50 dark:from-slate-950 dark:via-purple-950 dark:to-pink-950">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-4 py-20 sm:px-6 lg:px-8">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-4">
                            <Sparkles className="w-8 h-8 animate-pulse" />
                            <h1 className="text-5xl font-bold tracking-tight">NFT Events</h1>
                            <Sparkles className="w-8 h-8 animate-pulse" />
                        </div>
                        <p className="mt-4 text-xl text-purple-100 max-w-2xl mx-auto">
                            Join exclusive NFT events, exhibitions, and competitions. Create your own events and build your community.
                        </p>
                        {publicKey && (
                            <Button
                                onClick={() => setIsCreateModalOpen(true)}
                                size="lg"
                                className="mt-8 bg-white text-purple-600 hover:bg-purple-50 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105"
                            >
                                <Plus className="w-5 h-5 mr-2" />
                                Create Event
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-4 -mt-10 mb-12">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-purple-200 dark:border-purple-800 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                                    <Calendar className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{events.length}</p>
                                    <p className="text-sm text-muted-foreground">Total Events</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-pink-200 dark:border-pink-800 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-pink-100 dark:bg-pink-900 rounded-lg">
                                    <Users className="w-6 h-6 text-pink-600 dark:text-pink-400" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-pink-600 dark:text-pink-400">
                                        {events.reduce((acc, event) => acc + event.entries.length, 0)}
                                    </p>
                                    <p className="text-sm text-muted-foreground">Total Participants</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-red-200 dark:border-red-800 shadow-xl">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-red-100 dark:bg-red-900 rounded-lg">
                                    <Coins className="w-6 h-6 text-red-600 dark:text-red-400" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                                        {events.reduce((acc, event) => acc + Number(event.entryFee), 0).toFixed(2)} SOL
                                    </p>
                                    <p className="text-sm text-muted-foreground">Total Prize Pool</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Events Grid */}
            <div className="max-w-7xl mx-auto px-4 pb-20">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                        Upcoming Events
                    </h2>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <Card key={i} className="animate-pulse">
                                <CardHeader>
                                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mt-2"></div>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : events.length === 0 ? (
                    <Card className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                        <CardContent className="py-20 text-center">
                            <Calendar className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                            <h3 className="text-xl font-semibold mb-2">No events yet</h3>
                            <p className="text-muted-foreground mb-6">Be the first to create an event!</p>
                            {publicKey && (
                                <Button onClick={() => setIsCreateModalOpen(true)}>
                                    <Plus className="w-4 h-4 mr-2" />
                                    Create Event
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {events.map((event) => (
                            <EventCard
                                key={event.id}
                                event={event}
                                onJoin={handleJoinEvent}
                                isOwner={publicKey?.toBase58() === event.creatorWallet}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Create Event Modal */}
            <CreateEventModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onEventCreated={handleEventCreated}
            />
        </div>
    );
};
