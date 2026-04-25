const { WebSocketServer } = require('ws');
const readline = require('readline');

const wss = new WebSocketServer({ port: 8080 });

wss.on('listening', () => {
    console.log('Stub Trainer WebSocket server started on port 8080');
});

wss.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error('Error: Port 8080 is already in use. Is another stub server running?');
    } else {
        console.error('WebSocket server error:', error);
    }
    process.exit(1);
});


// Trainer State
let state = {
    // Basic metrics
    power: 100,
    cadence: 85,
    hr: 120,
    targetPower: 100,

    // Workout progression state
    activeWorkout: null,
    startTime: null,
    elapsedSeconds: 0,
    currentIntervalIndex: 0,
    isPaused: false,
    timeMultiplier: 1,
    pauseTime: null,
    totalPausedTime: 0,
};

// --- CLI for real-time control ---
console.log('\nEnter commands to control trainer:');
console.log('  power <watts>    (e.g., power 150)');
console.log('  cadence <rpm>    (e.g., cadence 90)');
console.log('  hr <bpm>         (e.g., hr 140)');
console.log('  pause / resume   (to toggle workout timer)');
console.log('  progress <%>     (e.g., progress 50)');
console.log('  speed <x>        (e.g., speed 2 for 2x time)');

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
        if (line.trim() === 'pause') {
            if (state.activeWorkout && !state.isPaused) {
                state.isPaused = true;
                state.pauseTime = Date.now();
                console.log('Workout progression paused.');
            }
        } else if (line.trim() === 'resume') {
            if (state.activeWorkout && state.isPaused) {
                state.isPaused = false;
                state.totalPausedTime += Date.now() - state.pauseTime;
                state.pauseTime = null;
                console.log('Workout progression resumed.');
            }
        } else {
            if (line.trim()) console.log(`Invalid command: "${line.trim()}"`);
        }
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
            case 'progress':
                if (state.activeWorkout) {
                    const totalDuration = getTotalWorkoutDuration(state.activeWorkout);
                    state.elapsedSeconds = totalDuration * (numValue / 100);
                    // Adjust start time to reflect new progress
                    state.startTime = Date.now() - (state.elapsedSeconds * 1000);
                    console.log(`Manually set progress to ${numValue}%`);
                    // Immediately update to reflect the change
                    updateWorkoutProgress(); 
                } else {
                    console.log('No active workout to set progress on.');
                }
                break;
            case 'speed':
                if (numValue > 0) {
                    // To prevent time jumps, adjust the start time to maintain the same elapsed percentage
                    const realElapsedMs = state.startTime && !state.isPaused ? (Date.now() - state.startTime) - state.totalPausedTime : 0;
                    const currentSimulatedMs = realElapsedMs * state.timeMultiplier;
                    state.startTime = Date.now() - state.totalPausedTime - (currentSimulatedMs / numValue);
                    
                    state.timeMultiplier = numValue;
                    console.log(`Set time speed to ${numValue}x`);
                } else {
                    console.log('Speed multiplier must be greater than 0.');
                }
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

function getTotalWorkoutDuration(workout) {
    if (!workout || !workout.intervals) return 0;
    return workout.intervals.reduce((sum, iv) => sum + iv.duration, 0);
}

function updateWorkoutProgress() {
    if (!state.activeWorkout || state.isPaused) return;

    const realElapsedMs = (Date.now() - state.startTime) - state.totalPausedTime;
    state.elapsedSeconds = (realElapsedMs * state.timeMultiplier) / 1000;

    const workout = state.activeWorkout;
    const totalDuration = getTotalWorkoutDuration(workout);

    if (state.elapsedSeconds >= totalDuration) {
        // Workout is complete
        console.log('Workout complete');
        state.activeWorkout = null;
        state.startTime = null;
        state.targetPower = 100; // Reset to a default
        return;
    }

    // Find current interval
    let cumulativeDuration = 0;
    let newIntervalIndex = 0;
    for (let i = 0; i < workout.intervals.length; i++) {
        cumulativeDuration += workout.intervals[i].duration;
        if (state.elapsedSeconds < cumulativeDuration) {
            newIntervalIndex = i;
            break;
        }
    }

    // If interval changes, update target power
    if (newIntervalIndex !== state.currentIntervalIndex) {
        state.currentIntervalIndex = newIntervalIndex;
        const currentInterval = workout.intervals[newIntervalIndex];
        state.targetPower = Math.round(workout.ftp * (currentInterval.percentage / 100));
        console.log(`Interval changed to "${currentInterval.name}", target power: ${state.targetPower}W`);
    }
}


wss.on('connection', ws => {
    console.log('Client connected');

    // Start sending metrics every second
    const metricsInterval = setInterval(() => {
        if (state.activeWorkout) {
            updateWorkoutProgress();
        }

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

        let progress = null;
        if (state.activeWorkout) {
            const totalDuration = getTotalWorkoutDuration(state.activeWorkout);
            progress = {
                percentageComplete: (state.elapsedSeconds / totalDuration) * 100,
                currentIntervalIndex: state.currentIntervalIndex,
                // Add more progress data if needed by the client
            };
        }

        ws.send(JSON.stringify({ type: 'metrics', data: metrics, progress: progress }));
    }, 1000);

    ws.on('message', message => {
        try {
            const msg = JSON.parse(message);
            console.log('Received:', msg.type);

            if (msg.type === 'setTargetPower') {
                // This can be used for manual mode, but workout mode will override it
                const newTarget = parseInt(msg.data.power, 10);
                if (!isNaN(newTarget)) {
                    state.targetPower = newTarget;
                    console.log(`Updated target power to ${state.targetPower}W`);
                }
            } else if (msg.type === 'startWorkout') {
                console.log('Starting workout:', msg.data.name);
                state.activeWorkout = msg.data;
                state.startTime = Date.now();
                state.elapsedSeconds = 0;
                state.currentIntervalIndex = -1; // Force an update on the first tick
                // Reset progression state
                state.isPaused = false;
                state.timeMultiplier = 1;
                state.pauseTime = null;
                state.totalPausedTime = 0;
            } else if (msg.type === 'stopWorkout') {
                console.log('Stopping workout');
                state.activeWorkout = null;
                state.startTime = null;
                state.targetPower = 100; // Reset to a default
                state.timeMultiplier = 1;
                state.isPaused = false;
            }

        } catch (e) {
            console.error('Failed to parse message:', message, e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        // Reset state on disconnect
        state.activeWorkout = null;
        state.startTime = null;
        clearInterval(metricsInterval);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(metricsInterval);
    });
});
