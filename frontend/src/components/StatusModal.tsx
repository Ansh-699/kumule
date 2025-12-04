import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type StatusType = "idle" | "loading" | "success" | "error";

interface StatusModalProps {
    isOpen: boolean;
    onClose: () => void;
    status: StatusType;
    title: string;
    message: string;
}

export const StatusModal = ({
    isOpen,
    onClose,
    status,
    title,
    message,
}: StatusModalProps) => {
    const isClosable = status === "success" || status === "error";

    return (
        <Dialog open={isOpen} onOpenChange={isClosable ? onClose : undefined}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {status === "loading" && <Loader2 className="h-6 w-6 animate-spin text-blue-500" />}
                        {status === "success" && <CheckCircle2 className="h-6 w-6 text-green-500" />}
                        {status === "error" && <XCircle className="h-6 w-6 text-red-500" />}
                        {title}
                    </DialogTitle>
                    <DialogDescription className="pt-2">
                        {message}
                    </DialogDescription>
                </DialogHeader>
                {isClosable && (
                    <div className="flex justify-end mt-4">
                        <Button onClick={onClose}>Close</Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
