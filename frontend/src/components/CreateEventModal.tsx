import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Calendar, FileText, Coins, Clock } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

interface CreateEventModalProps {
    isOpen: boolean;
    onClose: () => void;
    onEventCreated: () => void;
}

export const CreateEventModal = ({ isOpen, onClose, onEventCreated }: CreateEventModalProps) => {
    const { publicKey } = useWallet();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        entryFee: '',
        eventDate: '',
        eventTime: '',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!publicKey) {
            toast({
                title: 'Wallet not connected',
                description: 'Please connect your wallet to create an event',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.name) {
            toast({
                title: 'Missing information',
                description: 'Please provide an event name',
                variant: 'destructive',
            });
            return;
        }

        setLoading(true);

        try {
            // Combine date and time if both provided
            let eventDateTime = null;
            if (formData.eventDate) {
                eventDateTime = formData.eventTime
                    ? `${formData.eventDate}T${formData.eventTime}:00Z`
                    : `${formData.eventDate}T00:00:00Z`;
            }

            const response = await fetch('https://kumele-backend.ansht.workers.dev/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name,
                    description: formData.description || null,
                    entryFee: parseFloat(formData.entryFee) || 0,
                    eventDate: eventDateTime,
                    creatorWallet: publicKey.toBase58(),
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create event');
            }

            toast({
                title: 'Success!',
                description: 'Your event has been created successfully',
            });

            // Reset form
            setFormData({
                name: '',
                description: '',
                entryFee: '',
                eventDate: '',
                eventTime: '',
            });

            onEventCreated();
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error.message || 'Failed to create event',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px] bg-gradient-to-br from-white to-purple-50 dark:from-slate-900 dark:to-purple-950 border-2 border-purple-200 dark:border-purple-800">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                        Create New Event
                    </DialogTitle>
                    <DialogDescription>
                        Create an exclusive NFT event for your community. Set entry fees, dates, and watch your community grow!
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 mt-4">
                    {/* Event Name */}
                    <div className="space-y-2">
                        <Label htmlFor="name" className="flex items-center gap-2 font-semibold">
                            <FileText className="w-4 h-4 text-purple-600" />
                            Event Name *
                        </Label>
                        <Input
                            id="name"
                            placeholder="NFT Art Exhibition 2025"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="border-purple-200 dark:border-purple-800 focus:border-purple-400 dark:focus:border-purple-600"
                            required
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label htmlFor="description" className="flex items-center gap-2 font-semibold">
                            <FileText className="w-4 h-4 text-purple-600" />
                            Description
                        </Label>
                        <Textarea
                            id="description"
                            placeholder="Describe your event, what participants can expect, prizes, etc."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="border-purple-200 dark:border-purple-800 focus:border-purple-400 dark:focus:border-purple-600 min-h-[100px]"
                            rows={4}
                        />
                    </div>

                    {/* Entry Fee */}
                    <div className="space-y-2">
                        <Label htmlFor="entryFee" className="flex items-center gap-2 font-semibold">
                            <Coins className="w-4 h-4 text-purple-600" />
                            Entry Fee (SOL)
                        </Label>
                        <Input
                            id="entryFee"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.5"
                            value={formData.entryFee}
                            onChange={(e) => setFormData({ ...formData, entryFee: e.target.value })}
                            className="border-purple-200 dark:border-purple-800 focus:border-purple-400 dark:focus:border-purple-600"
                        />
                        <p className="text-xs text-muted-foreground">
                            Leave as 0 for free events. Entry fees go to the prize pool.
                        </p>
                    </div>

                    {/* Event Date & Time */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="eventDate" className="flex items-center gap-2 font-semibold">
                                <Calendar className="w-4 h-4 text-purple-600" />
                                Event Date
                            </Label>
                            <Input
                                id="eventDate"
                                type="date"
                                value={formData.eventDate}
                                onChange={(e) => setFormData({ ...formData, eventDate: e.target.value })}
                                className="border-purple-200 dark:border-purple-800 focus:border-purple-400 dark:focus:border-purple-600"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="eventTime" className="flex items-center gap-2 font-semibold">
                                <Clock className="w-4 h-4 text-purple-600" />
                                Event Time
                            </Label>
                            <Input
                                id="eventTime"
                                type="time"
                                value={formData.eventTime}
                                onChange={(e) => setFormData({ ...formData, eventTime: e.target.value })}
                                className="border-purple-200 dark:border-purple-800 focus:border-purple-400 dark:focus:border-purple-600"
                            />
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            className="flex-1"
                            disabled={loading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                            disabled={loading}
                        >
                            {loading ? 'Creating...' : 'Create Event'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
};
