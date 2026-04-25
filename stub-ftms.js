// Stub FTMS Protocol Handler (using WebSockets)
export class StubFTMSController {
    constructor() {
        this.ws = null;
        this.device = { id: 'STUB-TRAINER', name: 'Stub Trainer' };
        this.metrics = { power: 0, hr: 0, cadence: 0, timestamp: Date.now() };
        this.onMetricsUpdate = null;
        this.onWorkoutUpdate = null;
        this.onLog = null;
    }

    log(msg, type = 'info') {
        console.log(`[StubFTMS] ${type.toUpperCase()}: ${msg}`);
        if (this.onLog) {
            this.onLog(msg, type);
        }
    }

    async connect() {
        return new Promise((resolve) => {
            const host = window.location.hostname || '127.0.0.1';
            const url = `ws://${host}:8080`;
            this.log(`Connecting to stub server at ${url}...`, 'info');
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.log('Connected to stub server', 'success');
                resolve({ success: true, error: null });
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'metrics') {
                        this.metrics = msg.data;
                        if (this.onMetricsUpdate) {
                            this.onMetricsUpdate(this.metrics);
                        }
                        // Also handle workout progress if it's included
                        if (msg.progress && this.onWorkoutUpdate) {
                            this.onWorkoutUpdate(msg.progress);
                        }
                    }
                } catch (e) {
                    this.log(`Error parsing message: ${e.message}`, 'error');
                }
            };

            this.ws.onclose = () => {
                this.log('Disconnected from stub server', 'info');
            };

            this.ws.onerror = (error) => {
                this.log('WebSocket error. Is the stub server running?', 'error');
                // The native WebSocket API doesn't give detailed errors.
                const err = new Error("Connection to stub server failed. Run 'npm start' in the /stub-server directory.");
                err.name = "StubConnectionError";
                resolve({ success: false, error: err });
            };
        });
    }

    async setTargetPower(power) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = {
                type: 'setTargetPower',
                data: { power }
            };
            this.ws.send(JSON.stringify(msg));
            this.log(`Sent target power: ${power}W`, 'info');
            return true;
        }
        return false;
    }

    startWorkout(workout) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = { type: 'startWorkout', data: workout };
            this.ws.send(JSON.stringify(msg));
            this.log(`Sent startWorkout for "${workout.name}"`, 'info');
        }
    }

    stopWorkout() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = { type: 'stopWorkout' };
            this.ws.send(JSON.stringify(msg));
            this.log('Sent stopWorkout', 'info');
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // Mock other methods from the real controller to avoid errors
    getTrainerBrand() { return 'StubBrand'; }
    async connectHRM() {
        this.log('HRM connection not supported in stub mode', 'warning');
        return { success: false, error: new Error('Not supported') };
    }
    async reconnectToLastDevice() { return this.connect(); }
}
