import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { NftAsset } from '@/services/api';
import { Loader2 } from 'lucide-react';

interface ListingDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    nft: NftAsset | null;
    status: 'idle' | 'listing' | 'success' | 'error';
}

export const ListingDialog: React.FC<ListingDialogProps> = ({
    isOpen,
    onClose,
    onConfirm,
    nft,
    status
}) => {
    if (!nft) return null;

    const isListing = status === 'listing';
    const isSuccess = status === 'success';
    const isError = status === 'error';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open && !isListing) {
                onClose();
            }
        }}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        {isSuccess ? 'Listing Successful!' :
                            isError ? 'Listing Failed' :
                                'List NFT for Sale'}
                    </DialogTitle>
                    <DialogDescription>
                        {isSuccess ? `Your NFT "${nft.name}" has been successfully listed on the marketplace.` :
                            isError ? 'There was an error listing your NFT. Please try again.' :
                                `Are you sure you want to list "${nft.name}"? This will transfer ownership to the marketplace.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {isListing && (
                        <div className="flex flex-col items-center justify-center py-4 space-y-4">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Processing transaction...</p>
                        </div>
                    )}

                    {!isListing && !isSuccess && !isError && (
                        <div className="flex items-center space-x-4 rounded-md border p-4">
                            <div className="flex-1 space-y-1">
                                <p className="text-sm font-medium leading-none">
                                    {nft.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {nft.publicKey}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {isSuccess ? (
                        <Button onClick={onClose}>Close</Button>
                    ) : isError ? (
                        <Button onClick={onClose} variant="secondary">Close</Button>
                    ) : (
                        <>
                            <Button variant="outline" onClick={onClose} disabled={isListing}>
                                Cancel
                            </Button>
                            <Button onClick={onConfirm} disabled={isListing}>
                                {isListing ? 'Listing...' : 'Confirm Listing'}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
