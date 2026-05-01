// FTMS Protocol Handler
export class FTMSController {
    constructor() {
        this.device = null;
        this.server = null;
        this.controlPointChar = null;
        this.metrics = { power: 0, hr: 0, cadence: 0, timestamp: Date.now() };
        this.onMetricsUpdate = null;
        this.onLog = null;
        this.lastDeviceId = null;

        // Track which service provides cadence (first one wins to prevent jumping values)
        this.cadenceSource = null;

        // Secondary heart rate monitor
        this.hrmDevice = null;
        this.hrmServer = null;

        // Track if trainer provides HR data
        this.hasTrainerHR = false;
    }

    // Save last connected device to localStorage
    saveLastDevice() {
        if (this.device && this.device.id) {
            const deviceInfo = {
                id: this.device.id,
                name: this.device.name
            };
            localStorage.setItem('lastBluetoothDevice', JSON.stringify(deviceInfo));
            this.log(`Saved device: ${this.device.name}`, 'info');
        }
    }

    // Get saved device info
    getLastDevice() {
        const saved = localStorage.getItem('lastBluetoothDevice');
        return saved ? JSON.parse(saved) : null;
    }

    // Try to reconnect to last device
    async reconnectToLastDevice() {
        const lastDevice = this.getLastDevice();
        if (!lastDevice || !navigator.bluetooth || !navigator.bluetooth.getDevices) {
            return false;
        }

        try {
            this.log(`Reconnecting to ${lastDevice.name}...`, 'info');

            // Get all previously paired devices
            const devices = await navigator.bluetooth.getDevices();
            const savedDevice = devices.find(d => d.id === lastDevice.id);

            if (!savedDevice) {
                this.log('Device not found in paired devices', 'warning');
                return false;
            }

            // Check if device is in range by trying to connect
            if (!savedDevice.gatt.connected) {
                this.device = savedDevice;
                this.server = await this.device.gatt.connect();
                this.log(`Reconnected to ${this.device.name}!`, 'success');

                this.trainerName = this.device.name;
                this.trainerBrand = this.getTrainerBrand(this.device.name);

                await this.subscribeToMetrics();
                await this.initializeFTMS();

                return true;
            }

            return false;
        } catch (error) {
            this.log(`Reconnection failed: ${error.message}`, 'warning');
            return false;
        }
    }

    // FTMS (Fitness Machine Service) UUIDs
    get FITNESS_MACHINE_SERVICE() { return 0x1826; }
    get FITNESS_MACHINE_CONTROL_POINT() { return 0x2AD9; }
    get FITNESS_MACHINE_STATUS() { return 0x2ADA; }
    get CYCLING_POWER_SERVICE() { return 0x1818; }
    get CYCLING_SPEED_CADENCE_SERVICE() { return 0x1816; }
    get HEART_RATE_SERVICE() { return 0x180d; }
    get DEVICE_INFO_SERVICE() { return 0x180a; }

    log(msg, type = 'info') {
        if (this.onLog) {
            this.onLog(msg, type);
        }
    }

    // Identify trainer brand from device name
    getTrainerBrand(deviceName) {
        const name = deviceName.toUpperCase();

        if (name.includes('ZWIFT')) return 'Zwift';
        if (name.includes('KICKR') || name.includes('WAHOO')) return 'Wahoo';
        if (name.includes('TACX') || name.includes('NEO') || name.includes('FLUX')) return 'Tacx';
        if (name.includes('ELITE') || name.includes('DRIVO') || name.includes('DIRETO') || name.includes('SUITO')) return 'Elite';
        if (name.includes('SARIS') || name.includes('H3') || name.includes('H2')) return 'Saris';
        if (name.includes('JETBLACK') || name.includes('VOLT')) return 'JetBlack';
        if (name.includes('KINETIC')) return 'Kinetic';
        if (name.includes('BKOOL')) return 'Bkool';
        if (name.includes('WATTBIKE') || name.includes('ATOM')) return 'Wattbike';

        return 'Unknown';
    }

    async connect() {
        try {
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const isHttps = window.location.protocol === 'https:';
            if (!isLocalhost && !isHttps) {
                alert('Requires HTTPS or localhost');
                return false;
            }

            this.log('Scanning for smart trainers...', 'info');

            // Support popular smart trainers via FTMS
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    // Zwift trainers
                    { namePrefix: 'Zwift' },
                    // Wahoo trainers
                    { namePrefix: 'KICKR' },
                    { namePrefix: 'Wahoo' },
                    // Tacx trainers
                    { namePrefix: 'Tacx' },
                    { namePrefix: 'Neo' },
                    { namePrefix: 'Flux' },
                    // Elite trainers
                    { namePrefix: 'Elite' },
                    { namePrefix: 'DRIVO' },
                    { namePrefix: 'DIRETO' },
                    { namePrefix: 'SUITO' },
                    // Saris trainers
                    { namePrefix: 'Saris' },
                    { namePrefix: 'H3' },
                    { namePrefix: 'H2' },
                    // JetBlack trainers
                    { namePrefix: 'JetBlack' },
                    { namePrefix: 'VOLT' },
                    // Kinetic trainers
                    { namePrefix: 'Kinetic' },
                    { namePrefix: 'ROCK AND ROLL' },
                    // Bkool trainers
                    { namePrefix: 'BKOOL' },
                    // Wattbike
                    { namePrefix: 'WATTBIKE' },
                    { namePrefix: 'Atom' },
                    { services: [this.FITNESS_MACHINE_SERVICE] }
                ],
                optionalServices: [
                    this.FITNESS_MACHINE_SERVICE,
                    this.CYCLING_POWER_SERVICE,
                    this.CYCLING_SPEED_CADENCE_SERVICE,
                    this.HEART_RATE_SERVICE,
                    this.DEVICE_INFO_SERVICE
                ]
            });

        this.log(`Found: ${this.device.name}`, 'success');
            this.server = await this.device.gatt.connect();
            this.log('Connected to GATT server', 'success');

            this.trainerName = this.device.name;
            this.trainerBrand = this.getTrainerBrand(this.device.name);

            await this.subscribeToMetrics();
            await this.initializeFTMS();

            // Save device for auto-reconnect
            this.saveLastDevice();

            return { success: true, error: null };
        } catch (error) {
            if (error.name !== 'NotAllowedError') {
                this.log(`Error: ${error.message}`, 'error');
            }
            return { success: false, error: error };
        }
    }

    // Connect to a separate heart rate monitor
    async connectHRM() {
        try {
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const isHttps = window.location.protocol === 'https:';
            if (!isLocalhost && !isHttps) {
                alert('Requires HTTPS or localhost');
                return false;
            }

            this.log('Scanning for heart rate monitors...', 'info');

            this.hrmDevice = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [this.HEART_RATE_SERVICE] }
                ],
                optionalServices: [
                    this.HEART_RATE_SERVICE,
                    this.DEVICE_INFO_SERVICE
                ]
            });

            this.log(`Found HR monitor: ${this.hrmDevice.name}`, 'success');
            this.hrmServer = await this.hrmDevice.gatt.connect();
            this.log('Connected to HR monitor', 'success');

            // Subscribe to heart rate notifications
            const hrService = await this.hrmServer.getPrimaryService(this.HEART_RATE_SERVICE);
            const hrChar = await hrService.getCharacteristic(0x2a37);
            hrChar.addEventListener('characteristicvaluechanged', (e) => {
                const flags = e.target.value.getUint8(0);
                this.metrics.hr = flags & 0x01 ? e.target.value.getUint16(1, true) : e.target.value.getUint8(1);
                this.metrics.timestamp = Date.now();
                if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
            });
            await hrChar.startNotifications();
            this.log('Subscribed to Heart Rate from HRM device', 'success');

            return { success: true, error: null };
        } catch (error) {
            if (error.name !== 'NotAllowedError') {
                this.log(`HRM Error: ${error.message}`, 'error');
            }
            return { success: false, error: error };
        }
    }

    disconnectHRM() {
        if (this.hrmDevice && this.hrmDevice.gatt) {
            this.hrmDevice.gatt.disconnect();
            this.hrmDevice = null;
            this.hrmServer = null;
            this.log('HR monitor disconnected', 'info');
        }
    }

    isHRMConnected() {
        return this.hrmDevice && this.hrmDevice.gatt && this.hrmDevice.gatt.connected;
    }

    async subscribeToMetrics() {
        this.log('Discovering services...', 'info');
        const services = await this.server.getPrimaryServices();
        this.log(`Found ${services.length} services`, 'info');

        const serviceMap = {};
        for (const s of services) {
            // Handle both 16-bit and 128-bit UUIDs
            const uuid = s.uuid.length <= 8 ? parseInt(s.uuid, 16) : s.uuid;
            serviceMap[uuid] = s;
            // Also map by full string for reliability
            serviceMap[s.uuid] = s;
        }

        // 1. FTMS Indoor Bike Data
        const ftmsService = serviceMap[this.FITNESS_MACHINE_SERVICE] || serviceMap['00001826-0000-1000-8000-00805f9b34fb'];
        if (ftmsService) {
            try {
                const indoorBikeChar = await ftmsService.getCharacteristic(0x2AD2);
                indoorBikeChar.addEventListener('characteristicvaluechanged', (e) => {
                    try {
                        const dv = new DataView(e.target.value.buffer);
                        const flags = dv.getUint16(0, true);
                        let offset = 2;
                        if (!(flags & 0x01)) offset += 2;
                        if (flags & 0x02) offset += 2;
                        if (flags & 0x04) {
                            const cadence = dv.getUint16(offset, true);
                            this.metrics.cadence = cadence;
                            offset += 2;
                        }
                        if (flags & 0x08) offset += 2;
                        if (flags & 0x10) offset += 3;
                        if (flags & 0x20) offset += 2;
                        if (flags & 0x40) {
                            this.metrics.power = dv.getInt16(offset, true);
                            offset += 2;
                        }
                        if (flags & 0x80) offset += 2;
                        if (flags & 0x100) offset += 2;
                        if (flags & 0x200) offset += 2;
                        if (flags & 0x400) offset += 1;
                        if (flags & 0x800) {
                            const hr = dv.getUint8(offset);
                            if (hr > 0) this.metrics.hr = hr;
                            offset += 1;
                        }
                        this.metrics.timestamp = Date.now();
                        if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                    } catch (err) { console.error('FTMS parse error:', err); }
                });
                await indoorBikeChar.startNotifications();
                this.log('Subscribed to Indoor Bike Data', 'success');
            } catch (e) { this.log(`FTMS char error: ${e.message}`, 'warning'); }
        }

        // 2. Cycling Speed and Cadence (CSC)
        const cscService = serviceMap[this.CYCLING_SPEED_CADENCE_SERVICE] || serviceMap['00001816-0000-1000-8000-00805f9b34fb'];
        if (cscService) {
            try {
                const cscChar = await cscService.getCharacteristic(0x2A5B);
                cscChar.addEventListener('characteristicvaluechanged', (e) => {
                    try {
                        const dv = new DataView(e.target.value.buffer);
                        const flags = dv.getUint8(0);
                        let offset = 1;
                        if (flags & 0x01) offset += 6;
                        if (flags & 0x02) {
                            const cumulativeCrankRevs = dv.getUint16(offset, true);
                            const lastCrankEventTime = dv.getUint16(offset + 2, true);
                            if (this.lastCSCCrankRevs !== undefined && this.lastCSCCrankTime !== undefined) {
                                const revDelta = (cumulativeCrankRevs - this.lastCSCCrankRevs) & 0xFFFF;
                                const timeDelta = ((lastCrankEventTime - this.lastCSCCrankTime) & 0xFFFF) / 1024.0;
                                if (timeDelta > 0 && revDelta > 0 && revDelta < 20) {
                                    const cadence = Math.round((revDelta / timeDelta) * 60);
                                    if (!this.cadenceSource || this.cadenceSource === 'csc') {
                                        this.cadenceSource = 'csc';
                                        this.metrics.cadence = cadence;
                                    }
                                    this.lastValidCadenceTime = Date.now();
                                } else if (timeDelta === 0 && revDelta === 0) {
                                    if (this.lastValidCadenceTime && (Date.now() - this.lastValidCadenceTime) > 2000) this.metrics.cadence = 0;
                                }
                            }
                            this.lastCSCCrankRevs = cumulativeCrankRevs;
                            this.lastCSCCrankTime = lastCrankEventTime;
                        }
                        this.metrics.timestamp = Date.now();
                        if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                    } catch (err) { console.error('CSC parse error:', err); }
                });
                await cscChar.startNotifications();
                this.log('Subscribed to CSC', 'success');
            } catch (e) { this.log(`CSC char error: ${e.message}`, 'warning'); }
        }

        // 3. Heart Rate
        const hrService = serviceMap[this.HEART_RATE_SERVICE] || serviceMap['0000180d-0000-1000-8000-00805f9b34fb'];
        if (hrService) {
            try {
                const hrChar = await hrService.getCharacteristic(0x2a37);
                hrChar.addEventListener('characteristicvaluechanged', (e) => {
                    const flags = e.target.value.getUint8(0);
                    this.metrics.hr = flags & 0x01 ? e.target.value.getUint16(1, true) : e.target.value.getUint8(1);
                    this.metrics.timestamp = Date.now();
                    if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                });
                await hrChar.startNotifications();
                this.hasTrainerHR = true;
                this.log('Subscribed to Heart Rate', 'success');
            } catch (e) { this.log(`HR char error: ${e.message}`, 'warning'); }
        }

        // 4. Cycling Power
        const cpService = serviceMap[this.CYCLING_POWER_SERVICE] || serviceMap['00001818-0000-1000-8000-00805f9b34fb'];
        if (cpService) {
            try {
                const cpChar = await cpService.getCharacteristic(0x2a63);
                cpChar.addEventListener('characteristicvaluechanged', (e) => {
                    try {
                        const dv = new DataView(e.target.value.buffer);
                        const flags = dv.getUint16(0, true);
                        const power = dv.getInt16(2, true);
                        if (power > 0) this.metrics.power = power;
                        let offset = 4;
                        if (flags & 0x01) offset += 1;
                        if (flags & 0x04) offset += 2;
                        if (flags & 0x10) offset += 6;
                        if (flags & 0x20) {
                            const cumulativeCrankRevs = dv.getUint16(offset, true);
                            const lastCrankEventTime = dv.getUint16(offset + 2, true);
                            if (this.lastCrankRevs !== undefined && this.lastCrankTime !== undefined) {
                                const revDelta = (cumulativeCrankRevs - this.lastCrankRevs) & 0xFFFF;
                                const timeDelta = ((lastCrankEventTime - this.lastCrankTime) & 0xFFFF) / 1024.0;
                                if (timeDelta > 0 && revDelta > 0 && revDelta < 20) {
                                    const cadence = Math.round((revDelta / timeDelta) * 60);
                                    if (this.cadenceSource !== 'csc') {
                                        this.cadenceSource = 'power';
                                        this.metrics.cadence = cadence;
                                    }
                                    this.lastValidCadenceTime = Date.now();
                                } else if (timeDelta === 0 && revDelta === 0) {
                                    if (this.lastValidCadenceTime && (Date.now() - this.lastValidCadenceTime) > 2000) this.metrics.cadence = 0;
                                }
                            }
                            this.lastCrankRevs = cumulativeCrankRevs;
                            this.lastCrankTime = lastCrankEventTime;
                        }
                        this.metrics.timestamp = Date.now();
                        if (this.onMetricsUpdate) this.onMetricsUpdate(this.metrics);
                    } catch (err) { console.error('Power parse error:', err); }
                });
                await cpChar.startNotifications();
                this.log('Subscribed to Cycling Power', 'success');
            } catch (e) { this.log(`Power char error: ${e.message}`, 'warning'); }
        }
    }

    async initializeFTMS() {
        try {
            this.log('Initializing FTMS...', 'info');
            const ftmsService = await this.server.getPrimaryService(this.FITNESS_MACHINE_SERVICE);

            // Get the control point characteristic
            this.controlPointChar = await ftmsService.getCharacteristic(this.FITNESS_MACHINE_CONTROL_POINT);

            // Subscribe to control point responses
            this.controlPointChar.addEventListener('characteristicvaluechanged', (e) => {
                const data = new Uint8Array(e.target.value.buffer);
                const responseStr = Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');

                // Decode response
                if (data[0] === 0x80) {
                    const opcode = data[1];
                    const result = data[2];
                    const resultCodes = ['', 'Success', 'Not Supported', 'Invalid Param', 'Failed', 'Control Not Permitted'];
                    this.log(`FTMS Response: ${responseStr} (${resultCodes[result] || 'Unknown'})`, result === 0x01 ? 'success' : 'error');
                } else {
                    this.log(`FTMS Response: ${responseStr}`, 'info');
                }
            });
            await this.controlPointChar.startNotifications();

            // Send Request Control command (0x00) - no parameters needed
            const requestControl = new Uint8Array([0x00]);
            await this.controlPointChar.writeValue(requestControl);
            this.log('Sent Request Control (0x00)', 'info');

            // Wait for response
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (e) {
            this.log(`FTMS init error: ${e.message}`, 'error');
        }
    }

    async sendCommand(data) {
        try {
            if (!this.controlPointChar) {
                this.log('FTMS not initialized', 'error');
                return false;
            }

            await this.controlPointChar.writeValue(data);
            return true;
        } catch (error) {
            this.log(`Write failed: ${error.message}`, 'error');
            return false;
        }
    }

    async setTargetPower(power) {
        const data = new Uint8Array(3);
        data[0] = 0x05; // Set Target Power opcode
        data[1] = power & 0xFF; // Power low byte
        data[2] = (power >> 8) & 0xFF; // Power high byte
        return await this.sendCommand(data);
    }

    disconnect() {
        if (this.device) {
            this.device.gatt.disconnect();
            this.device = null;
            this.server = null;
            this.controlPointChar = null;
            this.hasTrainerHR = false;
            this.log('Disconnected', 'info');
        }
        // Also disconnect HRM if connected
        this.disconnectHRM();
    }

    isConnected() {
        return this.device && this.device.gatt.connected;
    }
}
