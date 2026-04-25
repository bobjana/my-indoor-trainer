const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('Connected successfully to stub server');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('Failed to connect to stub server:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Connection timed out');
  process.exit(1);
}, 2000);
