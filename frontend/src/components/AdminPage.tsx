import { useState, useEffect } from 'react';
import { AdminLogin } from './AdminLogin';
import { AdminDashboard } from './AdminDashboard';

const ADMIN_PASSWORD = 'anshtyagi';

export const AdminPage = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const apiKey = 'admin-secret-key-change-in-production';

    useEffect(() => {
        // Check if user is already authenticated
        const authStatus = sessionStorage.getItem('adminAuthenticated');
        if (authStatus === 'true') {
            setIsAuthenticated(true);
        }
    }, []);

    const handleLogin = (password: string) => {
        if (password === ADMIN_PASSWORD) {
            sessionStorage.setItem('adminAuthenticated', 'true');
            setIsAuthenticated(true);
        } else {
            throw new Error('Invalid password');
        }
    };

    const handleLogout = () => {
        sessionStorage.removeItem('adminAuthenticated');
        setIsAuthenticated(false);
    };

    if (!isAuthenticated) {
        return <AdminLogin onLogin={handleLogin} />;
    }

    return (
        <div className="min-h-screen bg-background">
            <AdminDashboard apiKey={apiKey} onLogout={handleLogout} />
        </div>
    );
};

