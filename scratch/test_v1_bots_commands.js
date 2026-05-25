const axios = require('axios');
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfdCI6IjgzMDU5NjgxMTMwOTk3NzYwMCIsImlkIjoiNzQwOTk4NTczMjM3ODI1NTM2IiwiaWF0IjoxNzc1ODY2NTExfQ.gWUaypWAb3YzL75keJ8XPHiYzuWH8V6kq6aDPL72RZM';

async function test() {
    try {
        console.log('Testing Top.gg v1 /bots/commands...');
        const res = await axios.post(`https://top.gg/api/v1/bots/commands`, [
            { name: 'test', description: 'test', type: 1 }
        ], {
            headers: {
                'Authorization': AUTH_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        console.log('Commands v1 success:', res.status, res.data);
    } catch (error) {
        console.error('Commands v1 failed:', error.response ? error.response.status : error.message);
    }
}
test();
