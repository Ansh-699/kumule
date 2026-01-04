import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Coins, Users, Award } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface EventCardProps {
    event: {
        id: string;
        name: string;
        description: string | null;
        entryFee: number;
        eventDate: string | null;
        creatorWallet: string;
        creatorId: string;
        createdAt: string;
        entries: Array<{
            id: string;
            userId: string;
            walletAddress: string;
            amount: number;
        }>;
    };
    onJoin: (eventId: string, entryFee: number) => void;
    isOwner: boolean;
}

export const EventCard = ({ event, onJoin, isOwner }: EventCardProps) => {
    const { publicKey } = useWallet();
    const navigate = useNavigate();
    const [isJoining, setIsJoining] = useState(false);

    const isUserJoined = event.entries.some(
        entry => entry.walletAddress === publicKey?.toBase58()
    );

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Date TBA';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const handleJoin = async (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click
        setIsJoining(true);
        try {
            await onJoin(event.id, Number(event.entryFee));
        } finally {
            setIsJoining(false);
        }
    };

    const handleCardClick = () => {
        navigate(`/events/${event.id}`);
    };

    const gradients = [
        'from-purple-500 to-pink-500',
        'from-blue-500 to-cyan-500',
        'from-green-500 to-emerald-500',
        'from-orange-500 to-red-500',
        'from-indigo-500 to-purple-500',
    ];

    const gradient = gradients[event.id.charCodeAt(0) % gradients.length];

    return (
        <Card
            className="overflow-hidden hover:shadow-2xl transition-all duration-300 border-2 border-transparent hover:border-purple-300 dark:hover:border-purple-700 cursor-pointer"
            onClick={handleCardClick}
        >
            {/* Gradient Header */}
            <div className={`h-32 bg-gradient-to-r ${gradient} relative overflow-hidden`}>
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
                <div className="absolute bottom-4 left-4 right-4">
                    <h3 className="text-2xl font-bold text-white truncate drop-shadow-lg">
                        {event.name}
                    </h3>
                </div>
                {isOwner && (
                    <Badge className="absolute top-4 right-4 bg-white/90 text-purple-600 hover:bg-white">
                        <Award className="w-3 h-3 mr-1" />
                        Your Event
                    </Badge>
                )}
            </div>

            <CardHeader className="pb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(event.eventDate)}</span>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Description */}
                {event.description && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                        {event.description}
                    </p>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                        <Coins className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        <div>
                            <p className="text-xs text-muted-foreground">Entry Fee</p>
                            <p className="font-semibold text-purple-600 dark:text-purple-400">
                                {Number(event.entryFee).toFixed(2)} SOL
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 p-3 bg-pink-50 dark:bg-pink-950 rounded-lg">
                        <Users className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                        <div>
                            <p className="text-xs text-muted-foreground">Participants</p>
                            <p className="font-semibold text-pink-600 dark:text-pink-400">
                                {event.entries.length}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Participants Preview */}
                {event.entries.length > 0 && (
                    <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                            {event.entries.slice(0, 3).map((entry) => (
                                <Avatar key={entry.id} className="w-8 h-8 border-2 border-white dark:border-slate-900">
                                    <AvatarFallback className="text-xs bg-gradient-to-br from-purple-400 to-pink-400 text-white">
                                        {entry.walletAddress.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                            ))}
                        </div>
                        {event.entries.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                                +{event.entries.length - 3} more
                            </span>
                        )}
                    </div>
                )}
            </CardContent>

            <CardFooter>
                {!publicKey ? (
                    <Button className="w-full" variant="outline" disabled>
                        Connect Wallet to Join
                    </Button>
                ) : isUserJoined ? (
                    <Button className="w-full bg-green-600 hover:bg-green-700" disabled>
                        ✓ Joined
                    </Button>
                ) : isOwner ? (
                    <Button className="w-full" variant="outline" disabled>
                        Your Event
                    </Button>
                ) : (
                    <Button
                        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                        onClick={handleJoin}
                        disabled={isJoining}
                    >
                        {isJoining ? 'Joining...' : `Join Event (${Number(event.entryFee).toFixed(2)} SOL)`}
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
};
