import { Context } from 'hono'
import { withPrisma, getConnectionString, ensureUserExists } from './db'

// Create a new album
export const createAlbum = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { name, artist, description, coverUrl, releaseDate, genre, price, creatorWallet } = body

        if (!name || !artist || !coverUrl || !creatorWallet) {
            return c.json({ error: 'Missing required fields: name, artist, coverUrl, creatorWallet' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const album = await withPrisma(connectionString, async (prisma) => {
            // Ensure user exists
            await ensureUserExists(prisma, creatorWallet)
            
            return await prisma.album.create({
                data: {
                    name,
                    artist,
                    description: description || null,
                    coverUrl,
                    releaseDate: releaseDate ? new Date(releaseDate) : null,
                    genre: genre || null,
                    price: price || null,
                    creatorWallet,
                    isPublished: false,
                    totalTracks: 0
                }
            })
        })

        return c.json({ success: true, album })
    } catch (error: any) {
        console.error('Create album error:', error)
        return c.json({ error: error.message || 'Failed to create album' }, 500)
    }
}

// Get all published albums
export const listAlbums = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const publishedOnly = c.req.query('published') !== 'false'
        const creatorWallet = c.req.query('creator')

        const albums = await withPrisma(connectionString, async (prisma) => {
            return await prisma.album.findMany({
                where: {
                    ...(publishedOnly && { isPublished: true }),
                    ...(creatorWallet && { creatorWallet })
                },
                include: {
                    tracks: {
                        orderBy: { trackNumber: 'asc' }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
        })

        return c.json({ albums })
    } catch (error: any) {
        console.error('List albums error:', error)
        return c.json({ error: error.message || 'Failed to list albums' }, 500)
    }
}

// Get single album with tracks
export const getAlbum = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const albumId = c.req.param('id')
        
        if (!albumId) {
            return c.json({ error: 'Album ID required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const album = await withPrisma(connectionString, async (prisma) => {
            return await prisma.album.findUnique({
                where: { id: albumId },
                include: {
                    tracks: {
                        orderBy: { trackNumber: 'asc' }
                    }
                }
            })
        })

        if (!album) {
            return c.json({ error: 'Album not found' }, 404)
        }

        return c.json({ album })
    } catch (error: any) {
        console.error('Get album error:', error)
        return c.json({ error: error.message || 'Failed to get album' }, 500)
    }
}

// Update album
export const updateAlbum = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const albumId = c.req.param('id')
        const body = await c.req.json()
        const { name, artist, description, coverUrl, releaseDate, genre, price, isPublished, metadataUri, nftAsset } = body

        if (!albumId) {
            return c.json({ error: 'Album ID required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const album = await withPrisma(connectionString, async (prisma) => {
            return await prisma.album.update({
                where: { id: albumId },
                data: {
                    ...(name && { name }),
                    ...(artist && { artist }),
                    ...(description !== undefined && { description }),
                    ...(coverUrl && { coverUrl }),
                    ...(releaseDate && { releaseDate: new Date(releaseDate) }),
                    ...(genre !== undefined && { genre }),
                    ...(price !== undefined && { price }),
                    ...(isPublished !== undefined && { isPublished }),
                    ...(metadataUri && { metadataUri }),
                    ...(nftAsset && { nftAsset })
                },
                include: {
                    tracks: {
                        orderBy: { trackNumber: 'asc' }
                    }
                }
            })
        })

        return c.json({ success: true, album })
    } catch (error: any) {
        console.error('Update album error:', error)
        return c.json({ error: error.message || 'Failed to update album' }, 500)
    }
}

// Delete album (and all tracks)
export const deleteAlbum = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const albumId = c.req.param('id')

        if (!albumId) {
            return c.json({ error: 'Album ID required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        await withPrisma(connectionString, async (prisma) => {
            await prisma.album.delete({
                where: { id: albumId }
            })
        })

        return c.json({ success: true })
    } catch (error: any) {
        console.error('Delete album error:', error)
        return c.json({ error: error.message || 'Failed to delete album' }, 500)
    }
}

// Add track to album
export const addTrack = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const albumId = c.req.param('id')
        const body = await c.req.json()
        const { title, description, audioUrl, artworkUrl, duration, trackNumber, price, integrityHash, isPreviewable, previewDuration } = body

        if (!albumId || !title || !audioUrl) {
            return c.json({ error: 'Missing required fields: albumId, title, audioUrl' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const result = await withPrisma(connectionString, async (prisma) => {
            // Get album to verify it exists and get current track count
            const album = await prisma.album.findUnique({
                where: { id: albumId },
                include: { tracks: true }
            })

            if (!album) {
                throw new Error('Album not found')
            }

            // Auto-assign track number if not provided
            const nextTrackNumber = trackNumber || album.tracks.length + 1

            // Create track
            const track = await prisma.track.create({
                data: {
                    albumId,
                    title,
                    description: description || null,
                    audioUrl,
                    artworkUrl: artworkUrl || null,
                    duration: duration || null,
                    trackNumber: nextTrackNumber,
                    price: price || null,
                    integrityHash: integrityHash || null,
                    isPreviewable: isPreviewable !== false,
                    previewDuration: previewDuration || 30
                }
            })

            // Update album total tracks
            await prisma.album.update({
                where: { id: albumId },
                data: { totalTracks: album.tracks.length + 1 }
            })

            return track
        })

        return c.json({ success: true, track: result })
    } catch (error: any) {
        console.error('Add track error:', error)
        return c.json({ error: error.message || 'Failed to add track' }, 500)
    }
}

// Update track
export const updateTrack = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const trackId = c.req.param('trackId')
        const body = await c.req.json()
        const { title, description, audioUrl, artworkUrl, duration, trackNumber, price, integrityHash, isPreviewable, previewDuration, metadataUri, nftAsset } = body

        if (!trackId) {
            return c.json({ error: 'Track ID required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const track = await withPrisma(connectionString, async (prisma) => {
            return await prisma.track.update({
                where: { id: trackId },
                data: {
                    ...(title && { title }),
                    ...(description !== undefined && { description }),
                    ...(audioUrl && { audioUrl }),
                    ...(artworkUrl !== undefined && { artworkUrl }),
                    ...(duration !== undefined && { duration }),
                    ...(trackNumber && { trackNumber }),
                    ...(price !== undefined && { price }),
                    ...(integrityHash && { integrityHash }),
                    ...(isPreviewable !== undefined && { isPreviewable }),
                    ...(previewDuration && { previewDuration }),
                    ...(metadataUri && { metadataUri }),
                    ...(nftAsset && { nftAsset })
                }
            })
        })

        return c.json({ success: true, track })
    } catch (error: any) {
        console.error('Update track error:', error)
        return c.json({ error: error.message || 'Failed to update track' }, 500)
    }
}

// Delete track
export const deleteTrack = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const trackId = c.req.param('trackId')

        if (!trackId) {
            return c.json({ error: 'Track ID required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        await withPrisma(connectionString, async (prisma) => {
            // Get track to find album
            const track = await prisma.track.findUnique({
                where: { id: trackId }
            })

            if (!track) {
                throw new Error('Track not found')
            }

            // Delete track
            await prisma.track.delete({
                where: { id: trackId }
            })

            // Update album total tracks
            const remainingTracks = await prisma.track.count({
                where: { albumId: track.albumId }
            })

            await prisma.album.update({
                where: { id: track.albumId },
                data: { totalTracks: remainingTracks }
            })
        })

        return c.json({ success: true })
    } catch (error: any) {
        console.error('Delete track error:', error)
        return c.json({ error: error.message || 'Failed to delete track' }, 500)
    }
}

// Generate track metadata JSON for NFT minting
export const generateTrackMetadata = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const trackId = c.req.param('trackId')

        if (!trackId) {
            return c.json({ error: 'Track ID required' }, 400)
        }

        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }

        const result = await withPrisma(connectionString, async (prisma) => {
            const track = await prisma.track.findUnique({
                where: { id: trackId },
                include: { album: true }
            })

            if (!track) {
                throw new Error('Track not found')
            }

            // Generate Metaplex-compatible metadata
            const metadata = {
                name: track.title,
                symbol: 'KUMELE',
                description: track.description || `${track.title} from ${track.album.name} by ${track.album.artist}`,
                image: track.artworkUrl || track.album.coverUrl,
                animation_url: track.audioUrl,
                external_url: `https://kumele.com/albums/${track.albumId}/tracks/${track.id}`,
                attributes: [
                    { trait_type: 'Artist', value: track.album.artist },
                    { trait_type: 'Album', value: track.album.name },
                    { trait_type: 'Track Number', value: track.trackNumber.toString() },
                    { trait_type: 'Category', value: 'Music' },
                    ...(track.album.genre ? [{ trait_type: 'Genre', value: track.album.genre }] : []),
                    ...(track.duration ? [{ trait_type: 'Duration', value: `${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, '0')}` }] : [])
                ],
                properties: {
                    category: 'audio',
                    files: [
                        {
                            uri: track.audioUrl,
                            type: 'audio/mpeg'
                        },
                        ...(track.artworkUrl ? [{
                            uri: track.artworkUrl,
                            type: 'image/png'
                        }] : [])
                    ],
                    creators: []
                },
                // Custom fields for integrity verification
                integrityHash: track.integrityHash,
                albumId: track.albumId,
                trackId: track.id
            }

            return metadata
        })

        return c.json({ metadata: result })
    } catch (error: any) {
        console.error('Generate track metadata error:', error)
        return c.json({ error: error.message || 'Failed to generate metadata' }, 500)
    }
}
