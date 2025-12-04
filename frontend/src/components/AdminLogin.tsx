import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock, Shield, ArrowLeft } from 'lucide-react';

interface AdminLoginProps {
    onLogin: (password: string) => void;
}

export const AdminLogin = ({ onLogin }: AdminLoginProps) => {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password.trim()) {
            setError('Please enter a password');
            return;
        }
        
        setLoading(true);
        setError('');
        
        try {
            onLogin(password);
        } catch (err: any) {
            setError(err.message || 'Invalid password. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-4">
            <Card className="w-full max-w-md shadow-lg border-2">
                <CardHeader className="space-y-1 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="rounded-full bg-primary/10 p-3">
                            <Shield className="h-8 w-8 text-primary" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-bold">Admin Portal</CardTitle>
                    <CardDescription>Enter your password to access the admin dashboard</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                                <Lock className="h-4 w-4" />
                                Password
                            </label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="Enter admin password"
                                className={error ? 'border-red-500 focus-visible:ring-red-500' : ''}
                                disabled={loading}
                                autoFocus
                            />
                            {error && (
                                <p className="text-sm text-red-500 flex items-center gap-1">
                                    <span>⚠️</span> {error}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col gap-2">
                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? 'Verifying...' : 'Login'}
                            </Button>
                            <Button 
                                type="button" 
                                variant="outline" 
                                className="w-full"
                                onClick={() => navigate('/marketplace')}
                                disabled={loading}
                            >
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                Back to Marketplace
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

