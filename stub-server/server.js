const { WebSocketServer } = require('ws');
const readline = require('readline');

const wss = new WebSocketServer({ port: 8080 });

console.log('Stub Trainer WebSocket server started on port 8080');


// Trainer State
let state = {
    power: 100,
    cadence: 85,
    hr: 120,
    targetPower: 100,
    resistance: 25
};

// --- CLI for real-time control ---
console.log('\nEnter commands to control trainer:');
console.log('  power <watts>    (e.g., power 150)');
console.log('  cadence <rpm>    (e.g., cadence 90)');
console.log('  hr <bpm>         (e.g., hr 140)\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

rl.prompt();

rl.on('line', (line) => {
    const [command, value] = line.trim().split(' ');
    const numValue = parseInt(value, 10);

    if (isNaN(numValue)) {
        if (line.trim()) console.log(`Invalid value: "${value}"`);
    } else {
        switch (command) {
            case 'power':
                state.power = numValue;
                // Also update target power so the simulation logic doesn't fight the manual override
                state.targetPower = numValue;
                console.log(`Manually set power to ${numValue}W`);
                break;
            case 'cadence':
                state.cadence = numValue;
                console.log(`Manually set cadence to ${numValue} RPM`);
                break;
            case 'hr':
                state.hr = numValue;
                console.log(`Manually set heart rate to ${numValue} BPM`);
                break;
            default:
                if (command) console.log(`Unknown command: "${command}"`);
                break;
        }
    }
    rl.prompt();
}).on('close', () => {
    console.log('CLI exited.');
    process.exit(0);
});
// --- End CLI ---

wss.on('connection', ws => {
    console.log('Client connected');

    // Start sending metrics every second
    const metricsInterval = setInterval(() => {
        // Simulate slight variations
        state.power += (state.targetPower - state.power) * 0.1; // Gradually move towards target
        state.power += Math.round((Math.random() - 0.5) * 4); // Fluctuation
        state.cadence += Math.round((Math.random() - 0.5) * 2);
        if (state.cadence < 70) state.cadence = 70;
        if (state.cadence > 110) state.cadence = 110;

        const metrics = {
            power: Math.round(state.power),
            cadence: state.cadence,
            hr: state.hr,
            timestamp: Date.now()
        };

        ws.send(JSON.stringify({ type: 'metrics', data: metrics }));
    }, 1000);

    ws.on('message', message => {
        try {
            const msg = JSON.parse(message);
            console.log('Received:', msg);

            if (msg.type === 'setTargetPower') {
                const newTarget = parseInt(msg.data.power, 10);
                if (!isNaN(newTarget)) {
                    state.targetPower = newTarget;
                    console.log(`Updated target power to ${state.targetPower}W`);
                }
            }
        } catch (e) {
            console.error('Failed to parse message:', message, e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(metricsInterval);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(metricsInterval);
    });
});
