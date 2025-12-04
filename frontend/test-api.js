const API_BASE_URL = 'https://workerbackend.ansht.workers.dev/';

async function testAPI() {
    try {
        console.log('Testing API call to:', `${API_BASE_URL}?owner=11111111111111111111111111111111`);

        const response = await fetch(`${API_BASE_URL}?owner=11111111111111111111111111111111`);

        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));

        const data = await response.json();

        console.log('\nData type:', typeof data);
        console.log('Is array:', Array.isArray(data));
        console.log('Length:', data.length);

        if (data.length > 0) {
            console.log('\nFirst NFT:');
            console.log('  publicKey:', data[0].publicKey);
            console.log('  name:', data[0].name);
            console.log('  uri:', data[0].uri);
            console.log('  owner:', data[0].owner);
        }

        console.log('\n✅ API test successful!');
    } catch (error) {
        console.error('❌ API test failed:', error);
    }
}

testAPI();
