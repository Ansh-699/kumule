import { useState, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { createPayment, getPaymentStatus } from '../services/api';

interface CoinbasePaymentProps {
    onSuccess: (chargeId: string) => void;
}

export const CoinbasePayment = ({ onSuccess }: CoinbasePaymentProps) => {
    const { address, isConnected } = useAccount();
    const { connectors, connect } = useConnect();
    const { disconnect } = useDisconnect();
    const { sendTransaction, data: hash, isPending } = useSendTransaction();
    const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
        hash,
    });

    const [charge, setCharge] = useState<{ chargeId: string, address: string } | null>(null);
    const [status, setStatus] = useState('');

    useEffect(() => {
        if (isConfirmed && charge) {
            setStatus('Payment confirmed! Verifying with backend...');
            // Verify with backend
            getPaymentStatus(charge.chargeId).then((res) => {
                if (res.status === 'confirmed') {
                    onSuccess(charge.chargeId);
                }
            });
        }
    }, [isConfirmed, charge, onSuccess]);

    const handleCreateCharge = async () => {
        try {
            setStatus('Creating charge...');
            const data = await createPayment(0.01); // Example amount
            setCharge(data);
            setStatus('Charge created. Please pay.');
        } catch (e) {
            console.error(e);
            setStatus('Failed to create charge.');
        }
    };

    const handlePay = () => {
        if (!charge) return;
        sendTransaction({
            to: charge.address as `0x${string}`,
            value: parseEther('0.0001'), // Example amount
        });
    };

    if (!charge) {
        return (
            <div className="p-4 border rounded-lg space-y-4">
                <h3 className="font-bold">Pay with Coinbase</h3>
                <button
                    onClick={handleCreateCharge}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    Start Payment
                </button>
                {status && <p className="text-sm text-gray-500">{status}</p>}
            </div>
        );
    }

    return (
        <div className="p-4 border rounded-lg space-y-4">
            <h3 className="font-bold">Complete Payment</h3>
            <p className="text-sm">Send 0.0001 ETH/USDC to {charge.address}</p>

            {!isConnected ? (
                <div className="flex gap-2">
                    {connectors.map((connector) => (
                        <button
                            key={connector.uid}
                            onClick={() => connect({ connector })}
                            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        >
                            Connect {connector.name}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm text-green-600">Connected: {address}</p>
                    <button
                        onClick={handlePay}
                        disabled={isPending || isConfirming}
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isPending ? 'Confirming...' : isConfirming ? 'Waiting for Receipt...' : 'Pay Now'}
                    </button>
                    <button onClick={() => disconnect()} className="text-xs text-red-500 underline">Disconnect</button>
                </div>
            )}

            {hash && <div className="text-xs break-all">Tx: {hash}</div>}
            {status && <p className="text-sm text-gray-500">{status}</p>}
        </div>
    );
};
