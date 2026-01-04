import { Context } from 'hono'
import { adminAuth } from './admin'

// Upload single image to R2
export const uploadImageToR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const formData = await c.req.formData()
        const file = formData.get('image') as File
        
        if (!file) {
            return c.json({ error: 'No file provided' }, 400)
        }

        // Validate file type (allow images, videos, audio)
        const allowedTypes = ['image/', 'video/', 'audio/']
        if (!allowedTypes.some(type => file.type.startsWith(type))) {
            return c.json({ error: 'File must be an image, video, or audio' }, 400)
        }

        // Validate file size (max 50MB for videos/audio, 10MB for images)
        const maxSize = file.type.startsWith('image/') ? 10 * 1024 * 1024 : 50 * 1024 * 1024
        if (file.size > maxSize) {
            return c.json({ error: `File too large. Max ${maxSize / 1024 / 1024}MB` }, 400)
        }

        // Generate unique filename
        const timestamp = Date.now()
        const randomId = Math.random().toString(36).substring(2, 15)
        const extension = file.name.split('.').pop() || (file.type.startsWith('image/') ? 'png' : 'mp4')
        const filename = `images/${timestamp}-${randomId}.${extension}`

        // Upload to R2
        const arrayBuffer = await file.arrayBuffer()
        await c.env.NFT_IMAGES.put(filename, arrayBuffer, {
            httpMetadata: {
                contentType: file.type,
                cacheControl: 'public, max-age=31536000', // Cache for 1 year
            },
        })

        // Generate public URL - using Worker proxy route
        // Use PUBLIC_URL env var if available, otherwise extract from request
        const baseUrl = c.env.PUBLIC_URL || c.req.url.split('/api')[0]
        const publicUrl = `${baseUrl}/cdn/images/${timestamp}-${randomId}.${extension}`

        return c.json({
            success: true,
            url: publicUrl,
            filename: filename,
            size: file.size,
            contentType: file.type
        })
    } catch (error: any) {
        console.error('Upload image error:', error)
        return c.json({ error: error.message || 'Failed to upload image' }, 500)
    }
}

// Upload multiple files to R2 (for main file + cover file)
export const uploadFilesToR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const formData = await c.req.formData()
        const mainFile = formData.get('mainFile') as File
        const coverFile = formData.get('coverFile') as File | null
        
        if (!mainFile) {
            return c.json({ error: 'Main file is required' }, 400)
        }

        // Use PUBLIC_URL env var if available, otherwise extract from request
        const baseUrl = c.env.PUBLIC_URL || c.req.url.split('/api')[0]
        const uploadedFiles: Array<{ url: string; filename: string; contentType: string }> = []

        // Upload main file
        const timestamp = Date.now()
        const mainRandomId = Math.random().toString(36).substring(2, 15)
        const mainExtension = mainFile.name.split('.').pop() || (mainFile.type.startsWith('image/') ? 'png' : 'mp4')
        const mainFilename = `images/${timestamp}-${mainRandomId}.${mainExtension}`

        // Validate main file
        const allowedTypes = ['image/', 'video/', 'audio/']
        if (!allowedTypes.some(type => mainFile.type.startsWith(type))) {
            return c.json({ error: 'Main file must be an image, video, or audio' }, 400)
        }

        const maxSize = mainFile.type.startsWith('image/') ? 10 * 1024 * 1024 : 50 * 1024 * 1024
        if (mainFile.size > maxSize) {
            return c.json({ error: `Main file too large. Max ${maxSize / 1024 / 1024}MB` }, 400)
        }

        const mainArrayBuffer = await mainFile.arrayBuffer()
        await c.env.NFT_IMAGES.put(mainFilename, mainArrayBuffer, {
            httpMetadata: {
                contentType: mainFile.type,
                cacheControl: 'public, max-age=31536000',
            },
        })

        const mainUrl = `${baseUrl}/cdn/images/${timestamp}-${mainRandomId}.${mainExtension}`
        uploadedFiles.push({
            url: mainUrl,
            filename: mainFilename,
            contentType: mainFile.type
        })

        // Upload cover file if provided
        if (coverFile) {
            if (!coverFile.type.startsWith('image/')) {
                return c.json({ error: 'Cover file must be an image' }, 400)
            }

            if (coverFile.size > 10 * 1024 * 1024) {
                return c.json({ error: 'Cover file too large. Max 10MB' }, 400)
            }

            const coverRandomId = Math.random().toString(36).substring(2, 15)
            const coverExtension = coverFile.name.split('.').pop() || 'png'
            const coverFilename = `images/${timestamp}-${coverRandomId}.${coverExtension}`

            const coverArrayBuffer = await coverFile.arrayBuffer()
            await c.env.NFT_IMAGES.put(coverFilename, coverArrayBuffer, {
                httpMetadata: {
                    contentType: coverFile.type,
                    cacheControl: 'public, max-age=31536000',
                },
            })

            const coverUrl = `${baseUrl}/cdn/images/${timestamp}-${coverRandomId}.${coverExtension}`
            uploadedFiles.push({
                url: coverUrl,
                filename: coverFilename,
                contentType: coverFile.type
            })
        }

        return c.json({
            success: true,
            files: uploadedFiles,
            mainFile: uploadedFiles[0],
            coverFile: uploadedFiles[1] || null
        })
    } catch (error: any) {
        console.error('Upload files error:', error)
        return c.json({ error: error.message || 'Failed to upload files' }, 500)
    }
}

// Upload metadata JSON to R2
export const uploadMetadataToR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { metadata, filename } = body

        if (!metadata) {
            return c.json({ error: 'Metadata required' }, 400)
        }

        // Generate filename if not provided
        const timestamp = Date.now()
        const randomId = Math.random().toString(36).substring(2, 15)
        const metadataFilename = filename || `metadata/${timestamp}-${randomId}.json`

        // Upload JSON to R2
        const jsonString = JSON.stringify(metadata, null, 2)
        await c.env.NFT_IMAGES.put(metadataFilename, jsonString, {
            httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'public, max-age=31536000',
            },
        })

        // Generate public URL - using Worker proxy route
        // Use PUBLIC_URL env var if available, otherwise extract from request
        const baseUrl = c.env.PUBLIC_URL || c.req.url.split('/api')[0]
        const publicUrl = `${baseUrl}/cdn/metadata/${timestamp}-${randomId}.json`

        return c.json({
            success: true,
            url: publicUrl,
            filename: metadataFilename
        })
    } catch (error: any) {
        console.error('Upload metadata error:', error)
        return c.json({ error: error.message || 'Failed to upload metadata' }, 500)
    }
}

// Serve images from R2 (public access)
export const serveImageFromR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const filename = c.req.param('filename')
        
        if (!filename) {
            return c.json({ error: 'Filename required' }, 400)
        }

        // Get object from R2 (look in images/ folder)
        const object = await c.env.NFT_IMAGES.get(`images/${filename}`)
        
        if (!object) {
            return c.json({ error: 'Image not found' }, 404)
        }

        // Get content type
        const contentType = object.httpMetadata?.contentType || 'image/png'
        
        // Return image with proper headers
        return new Response(object.body, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000',
                'Access-Control-Allow-Origin': '*',
            },
        })
    } catch (error: any) {
        console.error('Serve image error:', error)
        return c.json({ error: error.message || 'Failed to serve image' }, 500)
    }
}

// Serve metadata from R2 (public access)
export const serveMetadataFromR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const filename = c.req.param('filename')
        
        if (!filename) {
            return c.json({ error: 'Filename required' }, 400)
        }

        // Get object from R2 (look in metadata/ folder)
        const object = await c.env.NFT_IMAGES.get(`metadata/${filename}`)
        
        if (!object) {
            return c.json({ error: 'Metadata not found' }, 404)
        }

        // Return JSON with proper headers
        return new Response(object.body, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=31536000',
                'Access-Control-Allow-Origin': '*',
            },
        })
    } catch (error: any) {
        console.error('Serve metadata error:', error)
        return c.json({ error: error.message || 'Failed to serve metadata' }, 500)
    }
}

// Upload audio file to R2 with integrity hash
export const uploadAudioToR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const formData = await c.req.formData()
        const file = formData.get('audio') as File
        const title = formData.get('title') as string
        const artist = formData.get('artist') as string
        const albumId = formData.get('albumId') as string | null
        const trackNumber = formData.get('trackNumber') as string | null
        
        if (!file) {
            return c.json({ error: 'No audio file provided' }, 400)
        }

        // Validate audio file type
        const allowedAudioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/m4a']
        if (!file.type.startsWith('audio/') && !allowedAudioTypes.includes(file.type)) {
            return c.json({ error: 'File must be an audio file (MP3, WAV, OGG, FLAC, AAC, M4A)' }, 400)
        }

        // Validate file size (max 100MB for audio)
        const maxSize = 100 * 1024 * 1024
        if (file.size > maxSize) {
            return c.json({ error: 'Audio file too large. Max 100MB' }, 400)
        }

        // Generate unique filename
        const timestamp = Date.now()
        const randomId = Math.random().toString(36).substring(2, 15)
        const extension = file.name.split('.').pop() || 'mp3'
        const filename = `audio/${timestamp}-${randomId}.${extension}`

        // Read file and compute SHA-256 hash for integrity verification
        const arrayBuffer = await file.arrayBuffer()
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const integrityHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

        // Upload to R2
        await c.env.NFT_IMAGES.put(filename, arrayBuffer, {
            httpMetadata: {
                contentType: file.type,
                cacheControl: 'public, max-age=31536000',
            },
            customMetadata: {
                title: title || file.name,
                artist: artist || 'Unknown',
                albumId: albumId || '',
                trackNumber: trackNumber || '0',
                integrityHash: integrityHash,
                originalFilename: file.name,
                uploadedAt: new Date().toISOString()
            }
        })

        // Generate public URL
        const baseUrl = c.env.PUBLIC_URL || c.req.url.split('/api')[0]
        const publicUrl = `${baseUrl}/cdn/audio/${timestamp}-${randomId}.${extension}`

        return c.json({
            success: true,
            url: publicUrl,
            filename: filename,
            size: file.size,
            contentType: file.type,
            integrityHash: integrityHash,
            duration: null, // Duration would need to be extracted client-side
            metadata: {
                title: title || file.name,
                artist: artist || 'Unknown',
                albumId: albumId || null,
                trackNumber: trackNumber ? parseInt(trackNumber) : null
            }
        })
    } catch (error: any) {
        console.error('Upload audio error:', error)
        return c.json({ error: error.message || 'Failed to upload audio' }, 500)
    }
}

// Serve audio from R2 with range request support for streaming
export const serveAudioFromR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const filename = c.req.param('filename')
        
        if (!filename) {
            return c.json({ error: 'Filename required' }, 400)
        }

        // Check for range header (for audio streaming)
        const range = c.req.header('range')
        
        // Get object from R2 (look in audio/ folder)
        const object = await c.env.NFT_IMAGES.get(`audio/${filename}`)
        
        if (!object) {
            return c.json({ error: 'Audio not found' }, 404)
        }

        const contentType = object.httpMetadata?.contentType || 'audio/mpeg'
        const size = object.size

        // Handle range requests for streaming
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-')
            const start = parseInt(parts[0], 10)
            const end = parts[1] ? parseInt(parts[1], 10) : size - 1
            const chunkSize = end - start + 1
            
            // Get partial content from R2 with range
            const partialObject = await c.env.NFT_IMAGES.get(`audio/${filename}`, {
                range: { offset: start, length: chunkSize }
            })
            
            if (!partialObject) {
                return c.json({ error: 'Audio not found' }, 404)
            }

            return new Response(partialObject.body, {
                status: 206,
                headers: {
                    'Content-Type': contentType,
                    'Content-Range': `bytes ${start}-${end}/${size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize.toString(),
                    'Access-Control-Allow-Origin': '*',
                },
            })
        }

        // Return full audio file
        return new Response(object.body, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': size.toString(),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=31536000',
                'Access-Control-Allow-Origin': '*',
            },
        })
    } catch (error: any) {
        console.error('Serve audio error:', error)
        return c.json({ error: error.message || 'Failed to serve audio' }, 500)
    }
}

