import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface SearchProps {
    onSearch: (type: 'asset' | 'owner', query: string) => void;
    loading: boolean;
}

export const Search: React.FC<SearchProps> = ({ onSearch, loading }) => {
    const [searchType, setSearchType] = useState<'asset' | 'owner'>('asset');
    const [query, setQuery] = useState('');

    const handleSearch = () => {
        if (query.trim()) {
            onSearch(searchType, query.trim());
        }
    };

    return (
        <div className="flex flex-col sm:flex-row gap-4 items-center w-full max-w-2xl mx-auto p-4">
            <Select
                value={searchType}
                onValueChange={(value) => setSearchType(value as 'asset' | 'owner')}
            >
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Search by" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="asset">Asset Address</SelectItem>
                    <SelectItem value="owner">Owner Address</SelectItem>
                </SelectContent>
            </Select>
            <Input
                type="text"
                placeholder={
                    searchType === 'asset'
                        ? 'Enter Asset Address...'
                        : 'Enter Owner Address...'
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={loading}>
                {loading ? 'Searching...' : 'Search'}
            </Button>
        </div>
    );
};
