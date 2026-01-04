import { useState, useEffect } from 'react';
import { Calendar, Users, Coins, Eye, TrendingUp, Award, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

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

export const AdminEventsPanel = () => {
    const { toast } = useToast();
    const [events, setEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [eventToDelete, setEventToDelete] = useState<Event | null>(null);

    const fetchEvents = async () => {
        try {
            setLoading(true);
            const response = await fetch('https://kumele-backend.ansht.workers.dev/api/events');
            if (!response.ok) throw new Error('Failed to fetch events');
            const data = await response.json();
            setEvents(data);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load events';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEvents();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleDeleteClick = (event: Event) => {
        setEventToDelete(event);
        setDeleteConfirmOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!eventToDelete) return;

        setDeletingEventId(eventToDelete.id);
        try {
            // Get admin API key from localStorage
            const adminApiKey = localStorage.getItem('adminApiKey');
            if (!adminApiKey) {
                throw new Error('Admin API key not found');
            }

            const response = await fetch(`https://kumele-backend.ansht.workers.dev/api/events/${eventToDelete.id}`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-API-Key': adminApiKey,
                },
            });

            if (!response.ok) throw new Error('Failed to delete event');

            toast({
                title: 'Success',
                description: 'Event deleted successfully',
            });

            fetchEvents();
            setDeleteConfirmOpen(false);
            setEventToDelete(null);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to delete event';
            toast({
                title: 'Error',
                description: message,
                variant: 'destructive',
            });
        } finally {
            setDeletingEventId(null);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const totalParticipants = events.reduce((acc, event) => acc + event.entries.length, 0);
    const totalRevenue = events.reduce(
        (acc, event) => acc + event.entries.reduce((sum, entry) => sum + Number(entry.amount), 0),
        0
    );

    return (
        <div className="space-y-6">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-purple-600 dark:text-purple-400">
                            Total Events
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            <span className="text-3xl font-bold text-purple-700 dark:text-purple-300">
                                {events.length}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-pink-50 to-pink-100 dark:from-pink-950 dark:to-pink-900 border-pink-200 dark:border-pink-800">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-pink-600 dark:text-pink-400">
                            Total Participants
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <Users className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                            <span className="text-3xl font-bold text-pink-700 dark:text-pink-300">
                                {totalParticipants}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">
                            Total Revenue
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <Coins className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <span className="text-3xl font-bold text-green-700 dark:text-green-300">
                                {totalRevenue.toFixed(2)} SOL
                            </span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            Avg. Participants
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            <span className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                                {events.length > 0 ? (totalParticipants / events.length).toFixed(1) : 0}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Events Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Award className="w-5 h-5" />
                        All Events
                    </CardTitle>
                    <CardDescription>Manage and monitor all NFT events</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading events...</div>
                    ) : events.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">No events found</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Event Name</TableHead>
                                        <TableHead>Creator</TableHead>
                                        <TableHead>Entry Fee</TableHead>
                                        <TableHead>Participants</TableHead>
                                        <TableHead>Revenue</TableHead>
                                        <TableHead>Event Date</TableHead>
                                        <TableHead>Created</TableHead>
                                        <TableHead>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {events.map((event) => (
                                        <TableRow key={event.id}>
                                            <TableCell className="font-medium">{event.name}</TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {event.creatorWallet.slice(0, 4)}...{event.creatorWallet.slice(-4)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950">
                                                    {Number(event.entryFee).toFixed(2)} SOL
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="bg-pink-50 dark:bg-pink-950">
                                                    {event.entries.length}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
                                                    {event.entries.reduce((sum, e) => sum + Number(e.amount), 0).toFixed(2)} SOL
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {event.eventDate ? formatDate(event.eventDate) : 'TBA'}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {formatDate(event.createdAt)}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setSelectedEvent(event)}
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDeleteClick(event)}
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        disabled={deletingEventId === event.id}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Event Details Modal */}
            {selectedEvent && (
                <Card className="border-2 border-purple-200 dark:border-purple-800">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>{selectedEvent.name}</CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(null)}>
                                Close
                            </Button>
                        </div>
                        <CardDescription>{selectedEvent.description || 'No description'}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Entry Fee</p>
                                    <p className="text-lg font-semibold">{Number(selectedEvent.entryFee).toFixed(2)} SOL</p>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                                    <p className="text-lg font-semibold">
                                        {selectedEvent.entries.reduce((sum, e) => sum + Number(e.amount), 0).toFixed(2)} SOL
                                    </p>
                                </div>
                            </div>

                            <div>
                                <h4 className="font-semibold mb-2">Participants ({selectedEvent.entries.length})</h4>
                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                    {selectedEvent.entries.length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center py-4">
                                            No participants yet
                                        </p>
                                    ) : (
                                        selectedEvent.entries.map((entry) => (
                                            <div
                                                key={entry.id}
                                                className="p-3 bg-muted rounded-lg space-y-2"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="font-mono text-sm font-medium">
                                                        {entry.walletAddress.slice(0, 12)}...{entry.walletAddress.slice(-12)}
                                                    </span>
                                                    <Badge variant="outline" className="bg-green-50 dark:bg-green-950">
                                                        {Number(entry.amount).toFixed(2)} SOL
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>Joined: {formatDate(entry.createdAt)}</span>
                                                    {entry.txHash && (
                                                        <span className="font-mono">
                                                            TX: {entry.txHash.slice(0, 8)}...
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Event</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete "{eventToDelete?.name}"? This action cannot be undone.
                            All participants and entries will be removed.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteConfirmOpen(false)}
                            disabled={deletingEventId !== null}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteConfirm}
                            disabled={deletingEventId !== null}
                        >
                            {deletingEventId ? 'Deleting...' : 'Delete Event'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
