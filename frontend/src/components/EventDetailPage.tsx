import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    Calendar, Users, Coins, Award, Star, Trophy, Medal,
    CheckCircle2, Clock, Share2, Heart, ArrowLeft,
    Sparkles, Target, Gift
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

interface Event {
    id: string;
    name: string;
    description: string | null;
    entryFee: number;
    eventDate: string | null;
    creatorWallet: string;
    creatorId: string;
    createdAt: string;
    status: string;
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

interface Medal {
    type: 'bronze' | 'silver' | 'gold';
    title: string;
    description: string;
    requirement: string;
    reward: string;
    color: string;
    icon: string;
}

const medals: Medal[] = [
    {
        type: 'bronze',
        title: 'Bronze Status',
        description: 'User created a minimum of 2 events or user attended a minimum of 2 events without fail in the last 30 days.',
        requirement: '2 events',
        reward: '2% discount on in-app purchase of choice',
        color: 'from-amber-700 to-amber-900',
        icon: '🥉'
    },
    {
        type: 'silver',
        title: 'Silver Status',
        description: 'User created a minimum of 3 events or user attended a minimum of 3 events without fail in the last 30 days.',
        requirement: '3 events',
        reward: '4% discount on in-app purchase of choice',
        color: 'from-gray-400 to-gray-600',
        icon: '🥈'
    },
    {
        type: 'gold',
        title: 'Gold Status',
        description: 'User created a minimum of 4 events or user attended a minimum of 4 events without fail in the last 30 days.',
        requirement: '4 events',
        reward: '8% discount on in-app purchase of choice',
        color: 'from-yellow-400 to-yellow-600',
        icon: '🥇'
    }
];

export const EventDetailPage = () => {
    const { eventId } = useParams<{ eventId: string }>();
    const navigate = useNavigate();
    const { publicKey } = useWallet();
    const { toast } = useToast();

    const [event, setEvent] = useState<Event | null>(null);
    const [loading, setLoading] = useState(true);
    const [isJoining, setIsJoining] = useState(false);
    const [showMedalsDialog, setShowMedalsDialog] = useState(false);
    const [_userProgress, _setUserProgress] = useState({
        eventsAttended: 0,
        eventsCreated: 0,
        currentMedal: null as Medal | null
    });

    useEffect(() => {
        if (eventId) {
            fetchEventDetails();
        }
    }, [eventId]);

    const fetchEventDetails = async () => {
        try {
            setLoading(true);
            const response = await fetch(`https://kumele-backend.ansht.workers.dev/api/events`);
            if (!response.ok) throw new Error('Failed to fetch events');
            const allEvents = await response.json();
            const foundEvent = allEvents.find((e: Event) => e.id === eventId);
            if (foundEvent) {
                setEvent(foundEvent);
            } else {
                throw new Error('Event not found');
            }
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Failed to load event',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleJoinEvent = async () => {
        if (!publicKey || !event) {
            toast({
                title: 'Wallet not connected',
                description: 'Please connect your wallet to join this event',
                variant: 'destructive',
            });
            return;
        }

        setIsJoining(true);
        try {
            // TODO: Implement Solana payment transaction
            const txHash = 'simulated_tx_hash_' + Date.now();

            const response = await fetch(`https://kumele-backend.ansht.workers.dev/api/events/${event.id}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: publicKey.toBase58(),
                    amount: Number(event.entryFee),
                    txHash,
                }),
            });

            if (!response.ok) throw new Error('Failed to join event');

            toast({
                title: 'Success!',
                description: 'You have successfully joined the event',
            });

            fetchEventDetails();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Failed to join event',
                variant: 'destructive',
            });
        } finally {
            setIsJoining(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const isUserJoined = event?.entries.some(
        entry => entry.walletAddress === publicKey?.toBase58()
    );

    const isEventOwner = event?.creatorWallet === publicKey?.toBase58();

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-pink-50 dark:from-slate-950 dark:via-purple-950 dark:to-pink-950 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-600 mx-auto"></div>
                    <p className="mt-4 text-muted-foreground">Loading event details...</p>
                </div>
            </div>
        );
    }

    if (!event) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-pink-50 dark:from-slate-950 dark:via-purple-950 dark:to-pink-950 flex items-center justify-center">
                <Card className="max-w-md">
                    <CardContent className="pt-6 text-center">
                        <p className="text-muted-foreground">Event not found</p>
                        <Button onClick={() => navigate('/events')} className="mt-4">
                            Back to Events
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-pink-50 dark:from-slate-950 dark:via-purple-950 dark:to-pink-950">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 text-white py-6">
                <div className="max-w-7xl mx-auto px-4">
                    <Button
                        variant="ghost"
                        onClick={() => navigate('/events')}
                        className="text-white hover:bg-white/20 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Events
                    </Button>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Event Header Card */}
                        <Card className="overflow-hidden border-2 border-purple-200 dark:border-purple-800">
                            <div className="h-48 bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 relative">
                                <div className="absolute inset-0 bg-black/20"></div>
                                <div className="absolute bottom-4 left-4 right-4">
                                    <h1 className="text-4xl font-bold text-white drop-shadow-lg">
                                        {event.name}
                                    </h1>
                                </div>
                            </div>
                            <CardContent className="pt-6">
                                {/* Host Info */}
                                <div className="flex items-start gap-4 mb-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950 rounded-lg">
                                    <Avatar className="w-16 h-16 border-4 border-white dark:border-slate-900 shadow-lg">
                                        <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xl">
                                            {event.creatorWallet.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-semibold text-lg">Host</span>
                                            <Badge className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-white border-0">
                                                <Trophy className="w-3 h-3 mr-1" />
                                                Gold
                                            </Badge>
                                        </div>
                                        <p className="text-sm font-mono text-muted-foreground">
                                            {event.creatorWallet.slice(0, 8)}...{event.creatorWallet.slice(-8)}
                                        </p>
                                        <div className="flex items-center gap-4 mt-2">
                                            <div className="flex items-center gap-1">
                                                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                                <span className="text-sm font-semibold">4.5</span>
                                                <span className="text-xs text-muted-foreground">Overall Rating</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-sm">
                                                <Users className="w-4 h-4" />
                                                <span className="font-semibold">{event.entries.length}</span>
                                                <span className="text-muted-foreground">followers</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Event Details */}
                                <div className="space-y-4">
                                    <div>
                                        <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                                            <Sparkles className="w-5 h-5 text-purple-600" />
                                            About This Event
                                        </h3>
                                        <p className="text-muted-foreground leading-relaxed">
                                            {event.description || 'Welcome to this exciting NFT event! Join us for an amazing experience in the world of digital collectibles. Participate in challenges, earn rewards, and connect with fellow NFT enthusiasts.'}
                                        </p>
                                    </div>

                                    {/* Event Info Grid */}
                                    <div className="grid grid-cols-2 gap-4 pt-4">
                                        <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                                            <Calendar className="w-5 h-5 text-purple-600" />
                                            <div>
                                                <p className="text-xs text-muted-foreground">Event Date</p>
                                                <p className="font-semibold text-sm">
                                                    {event.eventDate ? formatDate(event.eventDate) : 'TBA'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 p-3 bg-pink-50 dark:bg-pink-950 rounded-lg">
                                            <Coins className="w-5 h-5 text-pink-600" />
                                            <div>
                                                <p className="text-xs text-muted-foreground">Entry Fee</p>
                                                <p className="font-semibold text-sm">
                                                    {Number(event.entryFee).toFixed(2)} SOL
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                                            <Users className="w-5 h-5 text-green-600" />
                                            <div>
                                                <p className="text-xs text-muted-foreground">Participants</p>
                                                <p className="font-semibold text-sm">{event.entries.length} joined</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                                            <Clock className="w-5 h-5 text-blue-600" />
                                            <div>
                                                <p className="text-xs text-muted-foreground">Status</p>
                                                <p className="font-semibold text-sm">{event.status}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Tasks & Challenges */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Target className="w-5 h-5 text-purple-600" />
                                    Tasks & Challenges
                                </CardTitle>
                                <CardDescription>
                                    Complete these tasks to earn rewards and medals
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Sample Tasks */}
                                <div className="space-y-3">
                                    <div className="p-4 border-2 border-green-200 dark:border-green-800 rounded-lg bg-green-50 dark:bg-green-950">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                                                <h4 className="font-semibold">Join the Event</h4>
                                            </div>
                                            <Badge className="bg-green-600">+10 pts</Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground ml-7">
                                            Successfully register for the event
                                        </p>
                                        <Progress value={isUserJoined ? 100 : 0} className="mt-2 ml-7" />
                                    </div>

                                    <div className="p-4 border-2 border-purple-200 dark:border-purple-800 rounded-lg">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Share2 className="w-5 h-5 text-purple-600" />
                                                <h4 className="font-semibold">Share Event</h4>
                                            </div>
                                            <Badge variant="outline">+15 pts</Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground ml-7">
                                            Share this event on social media
                                        </p>
                                        <Progress value={0} className="mt-2 ml-7" />
                                    </div>

                                    <div className="p-4 border-2 border-pink-200 dark:border-pink-800 rounded-lg">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Heart className="w-5 h-5 text-pink-600" />
                                                <h4 className="font-semibold">Engage with Community</h4>
                                            </div>
                                            <Badge variant="outline">+20 pts</Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground ml-7">
                                            Like and comment on event posts
                                        </p>
                                        <Progress value={0} className="mt-2 ml-7" />
                                    </div>
                                </div>

                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => setShowMedalsDialog(true)}
                                >
                                    <Award className="w-4 h-4 mr-2" />
                                    View All Medals & Rewards
                                </Button>
                            </CardContent>
                        </Card>

                        {/* Participants */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Users className="w-5 h-5 text-purple-600" />
                                    Participants ({event.entries.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {event.entries.slice(0, 6).map((entry) => (
                                        <div key={entry.id} className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                                            <Avatar className="w-8 h-8">
                                                <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs">
                                                    {entry.walletAddress.slice(0, 2).toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <span className="text-xs font-mono truncate">
                                                {entry.walletAddress.slice(0, 6)}...
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                {event.entries.length > 6 && (
                                    <p className="text-sm text-muted-foreground text-center mt-3">
                                        +{event.entries.length - 6} more participants
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        {/* Action Card */}
                        <Card className="sticky top-4 border-2 border-purple-200 dark:border-purple-800">
                            <CardContent className="pt-6 space-y-4">
                                <div className="text-center p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950 rounded-lg">
                                    <Coins className="w-12 h-12 mx-auto mb-2 text-purple-600" />
                                    <p className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                                        {Number(event.entryFee).toFixed(2)} SOL
                                    </p>
                                    <p className="text-sm text-muted-foreground">Entry Fee</p>
                                </div>

                                {isEventOwner ? (
                                    <Badge className="w-full justify-center py-2 bg-gradient-to-r from-purple-600 to-pink-600">
                                        You are the host
                                    </Badge>
                                ) : isUserJoined ? (
                                    <Badge className="w-full justify-center py-2 bg-gradient-to-r from-green-600 to-emerald-600">
                                        <CheckCircle2 className="w-4 h-4 mr-2" />
                                        You've joined this event
                                    </Badge>
                                ) : (
                                    <div className="space-y-2">
                                        <Button
                                            onClick={handleJoinEvent}
                                            disabled={isJoining}
                                            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                                            size="lg"
                                        >
                                            {isJoining ? 'Joining...' : 'Join Event'}
                                        </Button>
                                        <Button variant="outline" className="w-full" size="lg">
                                            Interested
                                        </Button>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <Button variant="outline" className="flex-1">
                                        <Share2 className="w-4 h-4 mr-2" />
                                        Share
                                    </Button>
                                    <Button variant="outline" className="flex-1">
                                        <Heart className="w-4 h-4 mr-2" />
                                        Save
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Rewards Card */}
                        <Card className="border-2 border-yellow-200 dark:border-yellow-800">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-yellow-600">
                                    <Gift className="w-5 h-5" />
                                    Event Rewards
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="p-3 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950 dark:to-amber-950 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Trophy className="w-4 h-4 text-yellow-600" />
                                        <span className="font-semibold text-sm">Exclusive NFT</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Complete all tasks to claim
                                    </p>
                                </div>
                                <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950 dark:to-pink-950 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Medal className="w-4 h-4 text-purple-600" />
                                        <span className="font-semibold text-sm">Achievement Badges</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Bronze, Silver, Gold status
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            {/* Medals Dialog */}
            <Dialog open={showMedalsDialog} onOpenChange={setShowMedalsDialog}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl flex items-center gap-2">
                            <Award className="w-6 h-6 text-purple-600" />
                            Earn Medals
                        </DialogTitle>
                        <DialogDescription>
                            Complete events to earn status medals and unlock exclusive rewards
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                        {medals.map((medal) => (
                            <div
                                key={medal.type}
                                className="p-6 border-2 rounded-lg bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800"
                            >
                                <div className="flex items-start gap-4">
                                    <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${medal.color} flex items-center justify-center text-3xl shadow-lg`}>
                                        {medal.icon}
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-xl font-bold mb-2">{medal.title}</h3>
                                        <p className="text-sm text-muted-foreground mb-3">
                                            {medal.description}
                                        </p>
                                        <div className="flex items-center gap-4 text-sm">
                                            <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950">
                                                <Target className="w-3 h-3 mr-1" />
                                                {medal.requirement}
                                            </Badge>
                                            <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
                                                <Gift className="w-3 h-3 mr-1" />
                                                {medal.reward}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-6">
                        <Button onClick={() => setShowMedalsDialog(false)} className="w-full">
                            Continue
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
