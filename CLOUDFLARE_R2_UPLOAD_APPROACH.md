# Cloudflare R2 Upload Approach

## Overview
Replace Irys uploader with Cloudflare R2 for free, instant image uploads. Only minting will cost (on-chain transaction).

## Why R2 Instead of KV/D1?

- **KV**: Key-value store, not ideal for binary files (images)
- **D1**: SQL database, not designed for file storage
- **R2**: Object storage (S3-compatible), perfect for images
  - Free tier: 10GB storage, 1M Class A operations/month
  - Public URLs available
  - Fast CDN delivery

## Architecture

```
Frontend → Upload Image → Cloudflare Worker → R2 Bucket → Public URL
                ↓
         Store URL in Database
                ↓
         Use URL in NFT Metadata
                ↓
         Only Minting Costs (on-chain)
```

## Implementation Steps

### 1. Setup R2 Bucket

```bash
# Create R2 bucket
wrangler r2 bucket create nft-images

# Or via Cloudflare Dashboard:
# R2 → Create bucket → Name: "nft-images"
```

### 2. Update Worker Configuration

Add R2 binding to `wrangler.toml` or Worker settings:

```toml
[[r2_buckets]]
binding = "NFT_IMAGES"
bucket_name = "nft-images"
```

### 3. Create Upload Endpoint

**Backend: `workerbackend/src/upload.ts`**

```typescript
import { Context } from 'hono'
import { adminAuth } from './admin'

// Upload image to R2
export const uploadImageToR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const formData = await c.req.formData()
        const file = formData.get('image') as File
        
        if (!file) {
            return c.json({ error: 'No file provided' }, 400)
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            return c.json({ error: 'File must be an image' }, 400)
        }

        // Validate file size (e.g., max 10MB)
        const maxSize = 10 * 1024 * 1024 // 10MB
        if (file.size > maxSize) {
            return c.json({ error: 'File too large. Max 10MB' }, 400)
        }

        // Generate unique filename
        const timestamp = Date.now()
        const randomId = Math.random().toString(36).substring(2, 15)
        const extension = file.name.split('.').pop() || 'png'
        const filename = `images/${timestamp}-${randomId}.${extension}`

        // Upload to R2
        const arrayBuffer = await file.arrayBuffer()
        await c.env.NFT_IMAGES.put(filename, arrayBuffer, {
            httpMetadata: {
                contentType: file.type,
                cacheControl: 'public, max-age=31536000', // Cache for 1 year
            },
        })

        // Generate public URL
        // Option 1: Use custom domain (recommended)
        const publicUrl = `https://cdn.yourdomain.com/${filename}`
        
        // Option 2: Use R2 public URL (if public access enabled)
        // const publicUrl = `https://pub-xxxxx.r2.dev/${filename}`
        
        // Option 3: Proxy through Worker (see below)
        // const publicUrl = `${c.req.url.split('/api')[0]}/cdn/${filename}`

        return c.json({
            success: true,
            url: publicUrl,
            filename: filename,
            size: file.size,
            contentType: file.type
        })
    } catch (error: any) {
        console.error('Upload error:', error)
        return c.json({ error: error.message || 'Failed to upload image' }, 500)
    }
}

// Serve images from R2 (public access)
export const serveImageFromR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const filename = c.req.param('filename')
        
        if (!filename) {
            return c.json({ error: 'Filename required' }, 400)
        }

        // Get object from R2
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

// Upload metadata JSON to R2
export const uploadMetadataToR2 = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { metadata, filename } = body

        if (!metadata) {
            return c.json({ error: 'Metadata required' }, 400)
        }

        // Generate filename if not provided
        const metadataFilename = filename || `metadata/${Date.now()}-${Math.random().toString(36).substring(2, 15)}.json`

        // Upload JSON to R2
        const jsonString = JSON.stringify(metadata, null, 2)
        await c.env.NFT_IMAGES.put(metadataFilename, jsonString, {
            httpMetadata: {
                contentType: 'application/json',
                cacheControl: 'public, max-age=31536000',
            },
        })

        // Generate public URL
        const publicUrl = `https://cdn.yourdomain.com/${metadataFilename}`

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
```

### 4. Add Routes

**Backend: `workerbackend/src/index.ts`**

```typescript
import { uploadImageToR2, serveImageFromR2, uploadMetadataToR2 } from './upload'

// Upload routes
app.post('/api/upload/image', adminAuth, uploadImageToR2)
app.post('/api/upload/metadata', adminAuth, uploadMetadataToR2)
app.get('/cdn/images/:filename', serveImageFromR2)
```

### 5. Update Frontend

**Frontend: `frontend/src/services/api.ts`**

```typescript
// Upload image to R2
export const uploadImageToR2 = async (file: File): Promise<{ url: string; filename: string }> => {
    const formData = new FormData()
    formData.append('image', file)

    const response = await fetch(`${API_BASE_URL}/api/upload/image?apiKey=anshtyagi`, {
        method: 'POST',
        body: formData,
    })

    if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload image')
    }

    return response.json()
}

// Upload metadata to R2
export const uploadMetadataToR2 = async (metadata: any, filename?: string): Promise<{ url: string }> => {
    const response = await fetch(`${API_BASE_URL}/api/upload/metadata?apiKey=anshtyagi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata, filename }),
    })

    if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload metadata')
    }

    return response.json()
}
```

### 6. Update Admin Dashboard

**Frontend: `frontend/src/components/AdminDashboard.tsx`**

Replace Irys upload with R2 upload:

```typescript
// OLD (Irys):
const imageBuffer = await imageFile.arrayBuffer();
const imageGenericFile = createGenericFile(
    new Uint8Array(imageBuffer),
    imageFile.name,
    { contentType: imageFile.type }
);
const [imageUri] = await umi.uploader.upload([imageGenericFile]);

// NEW (R2):
const { url: imageUri } = await uploadImageToR2(imageFile);
```

```typescript
// OLD (Irys):
const metadataUri = await umi.uploader.uploadJson(metadata);

// NEW (R2):
const { url: metadataUri } = await uploadMetadataToR2(metadata);
```

## Public URL Options

### Option 1: Custom Domain (Recommended)
1. Add custom domain to R2 bucket
2. Configure DNS CNAME to R2 endpoint
3. Use: `https://cdn.yourdomain.com/images/filename.png`

### Option 2: R2 Public URL
1. Enable public access on R2 bucket
2. Get public URL from Cloudflare dashboard
3. Use: `https://pub-xxxxx.r2.dev/images/filename.png`

### Option 3: Worker Proxy (No Domain Needed)
1. Serve images through Worker route `/cdn/images/:filename`
2. Use: `https://your-worker.workers.dev/cdn/images/filename.png`
3. Already implemented in `serveImageFromR2` above

## Benefits

✅ **Free**: No upload fees (within free tier limits)
✅ **Fast**: Instant uploads, no blockchain signatures needed
✅ **CDN**: Cloudflare's global CDN for fast delivery
✅ **Reliable**: 99.9% uptime SLA
✅ **Scalable**: Handles millions of requests
✅ **Cost-effective**: Only minting costs (on-chain transaction)

## Cost Comparison

**Irys (Current)**:
- Upload image: ~$0.01-0.05 per upload (paid in SOL/AR)
- Upload metadata: ~$0.01-0.05 per upload
- Total per NFT: ~$0.02-0.10

**R2 (Proposed)**:
- Upload image: FREE (within free tier)
- Upload metadata: FREE (within free tier)
- Total per NFT: $0 (only minting costs ~$0.00025 SOL)

## Migration Path

1. **Phase 1**: Add R2 upload alongside Irys (dual support)
2. **Phase 2**: Migrate new uploads to R2
3. **Phase 3**: Keep Irys URLs for existing NFTs (backward compatible)

## Security Considerations

- ✅ Admin auth required for uploads
- ✅ File type validation (images only)
- ✅ File size limits (10MB default)
- ✅ Unique filenames prevent overwrites
- ✅ CORS headers for public access

## Example Flow

```
1. Admin selects image file
2. Frontend calls POST /api/upload/image
3. Worker validates & uploads to R2
4. Returns public URL: https://cdn.yourdomain.com/images/1234567890-abc123.png
5. Frontend uses URL in metadata JSON
6. Upload metadata to R2: POST /api/upload/metadata
7. Returns metadata URL: https://cdn.yourdomain.com/metadata/1234567890-xyz789.json
8. Use metadata URL when minting NFT
9. Only minting transaction costs money!
```

## Next Steps

1. Create R2 bucket in Cloudflare dashboard
2. Add R2 binding to Worker configuration
3. Implement upload endpoints
4. Update frontend to use R2 uploads
5. Test with sample images
6. Deploy and verify public URLs work

