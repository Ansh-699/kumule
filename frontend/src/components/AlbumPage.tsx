import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { 
    Play, 
    Pause, 
    Music, 
    Clock, 
    ExternalLink, 
    ArrowLeft,
    Disc3,
    User,
    Calendar
} from 'lucide-react';
import { API_BASE_URL } from '@/services/api';

interface Track {
    id: string;
    title: string;
    audioUrl: string;
    duration: number | null;
    trackNumber: number;
    nftAsset: string | null;
}

interface Album {
    id: string;
    name: string;
    artist: string;
    coverUrl: string | null;
    description: string | null;
    price: number | null;
    nftAsset: string | null;
    releaseDate: string | null;
    createdAt: string;
    tracks: Track[];
}

// Format duration from seconds to mm:ss
function formatDuration(seconds: number | null): string {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get Solana explorer URL
function getExplorerUrl(address: string): string {
    return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export const AlbumPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { toast } = useToast();
    
    const [album, setAlbum] = useState<Album | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentTrack, setCurrentTrack] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioRef] = useState<HTMLAudioElement>(new Audio());

    const fetchAlbum = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${API_BASE_URL}/api/albums/${id}`);
            if (!response.ok) {
                throw new Error('Album not found');
            }
            const data = await response.json();
            setAlbum(data.album);
        } catch (error) {
            console.error('Error fetching album:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to load album",
            });
        } finally {
            setLoading(false);
        }
    }, [id, toast]);

    useEffect(() => {
        if (id) {
            fetchAlbum();
        }
        return () => {
            audioRef.pause();
            audioRef.src = '';
        };
    }, [id, audioRef, fetchAlbum]);

    useEffect(() => {
        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTrack(null);
        };
        audioRef.addEventListener('ended', handleEnded);
        return () => audioRef.removeEventListener('ended', handleEnded);
    }, [audioRef]);

    const playTrack = (track: Track) => {
        if (currentTrack === track.id && isPlaying) {
            audioRef.pause();
            setIsPlaying(false);
        } else {
            if (currentTrack !== track.id) {
                audioRef.src = track.audioUrl;
            }
            audioRef.play();
            setCurrentTrack(track.id);
            setIsPlaying(true);
        }
    };

    if (loading) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Skeleton className="h-8 w-32 mb-6" />
                <div className="flex gap-6">
                    <Skeleton className="w-64 h-64 rounded-lg" />
                    <div className="flex-1 space-y-4">
                        <Skeleton className="h-10 w-3/4" />
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-20 w-full" />
                    </div>
                </div>
                <div className="mt-8 space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                    ))}
                </div>
            </div>
        );
    }

    if (!album) {
        return (
            <div className="container mx-auto px-4 py-8 text-center">
                <p className="text-muted-foreground mb-4">Album not found</p>
                <Link to="/">
                    <Button variant="outline">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Home
                    </Button>
                </Link>
            </div>
        );
    }

    const totalDuration = album.tracks.reduce((acc, track) => acc + (track.duration || 0), 0);

    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            {/* Back Navigation */}
            <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
            </Link>

            {/* Album Header */}
            <div className="flex flex-col md:flex-row gap-6 mb-8">
                {/* Cover Image */}
                <div className="w-64 h-64 flex-shrink-0 rounded-lg overflow-hidden bg-muted shadow-lg">
                    {album.coverUrl ? (
                        <img 
                            src={album.coverUrl} 
                            alt={album.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                            <Disc3 className="w-24 h-24 text-muted-foreground" />
                        </div>
                    )}
                </div>

                {/* Album Info */}
                <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                        <Music className="w-4 h-4" />
                        <span>Album</span>
                        {album.nftAsset && (
                            <a
                                href={getExplorerUrl(album.nftAsset)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                                <span>NFT</span>
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        )}
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold mb-2">{album.name}</h1>
                    <div className="flex items-center gap-4 text-muted-foreground mb-4">
                        <span className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            {album.artist}
                        </span>
                        {album.releaseDate && (
                            <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {new Date(album.releaseDate).getFullYear()}
                            </span>
                        )}
                        <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {formatDuration(totalDuration)}
                        </span>
                    </div>
                    {album.description && (
                        <p className="text-muted-foreground mb-4">{album.description}</p>
                    )}
                    {album.price && (
                        <div className="text-lg font-semibold text-primary">
                            {album.price} SOL
                        </div>
                    )}
                </div>
            </div>

            {/* Track List */}
            <Card>
                <CardHeader>
                    <CardTitle>Tracks ({album.tracks.length})</CardTitle>
                    <CardDescription>
                        Total duration: {formatDuration(totalDuration)}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {album.tracks.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            No tracks in this album yet
                        </p>
                    ) : (
                        <div className="space-y-1">
                            {album.tracks
                                .sort((a, b) => a.trackNumber - b.trackNumber)
                                .map((track) => (
                                    <div
                                        key={track.id}
                                        className={`flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors ${
                                            currentTrack === track.id ? 'bg-muted' : ''
                                        }`}
                                    >
                                        {/* Track Number / Play Button */}
                                        <button
                                            onClick={() => playTrack(track)}
                                            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-primary/10 transition-colors"
                                        >
                                            {currentTrack === track.id && isPlaying ? (
                                                <Pause className="w-4 h-4 text-primary" />
                                            ) : (
                                                <Play className="w-4 h-4 text-primary ml-0.5" />
                                            )}
                                        </button>

                                        {/* Track Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-medium truncate ${
                                                currentTrack === track.id ? 'text-primary' : ''
                                            }`}>
                                                {track.trackNumber}. {track.title}
                                            </p>
                                        </div>

                                        {/* NFT Badge */}
                                        {track.nftAsset && (
                                            <a
                                                href={getExplorerUrl(track.nftAsset)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-primary/10 text-primary hover:bg-primary/20"
                                            >
                                                NFT
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}

                                        {/* Duration */}
                                        <span className="text-sm text-muted-foreground">
                                            {formatDuration(track.duration)}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default AlbumPage;
