import { FTMSController } from './ftms.js';
import { StubFTMSController } from './stub-ftms.js';
import { WorkoutManager } from './workout-manager.js';
import { StravaIntegration } from './strava.js';

class TrainerAPI {
    static calcTargetPower(ftp, interval) {
        const powerType = interval.powerType || 'relative';
        if (powerType === 'absolute') return interval.power;
        if (powerType === 'ramp') return Math.round(ftp * interval.percentageLow / 100);
        return Math.round(ftp * (interval.percentage || 0) / 100);
    }

    constructor() {
        this.useStub = new URLSearchParams(window.location.search).get('stub') === 'true';
        this.ftms = this.useStub ? new StubFTMSController() : new FTMSController();

        this.workoutManager = new WorkoutManager()
        this.strava = new StravaIntegration()
        this.strava.onLog = (msg) => this._emit('log', { msg, type: 'info' })
        this.strava.onStatusChange = (status) => this._emit('stravastatus', status)

        this.state = {
            connected: false,
            trainerName: '',
            trainerBrand: '',
            hrConnected: false,
            hrName: '',
            activeWorkout: null,
            phase: 'connect',
            paused: false,
            startTime: null,
            pausedDuration: 0,
            pauseStartTime: null,
            currentIntervalIndex: 0,
            elapsedSeconds: 0,
            metricsHistory: [],
            timeWithoutPower: 0,
            isAutoPaused: false,
            metrics: { power: 0, cadence: 0, hr: 0 },
            intervalIndex: 0
        }

        this._events = {}
        this._timerInterval = null

        this.ftms.onMetricsUpdate = (metrics) => this._handleMetrics(metrics)
        this.ftms.onLog = (msg, type) => this._emit('log', { msg, type })
        this.workoutManager.onUpdate = () => this._emit('workoutsUpdated')

        // Load any workout JSON files from the local sessions/ folder
        this.workoutManager.syncFromDisk()
        this.strava.onStatusChange = (connected) => {
            this._emit('stravaStatus', connected)
        }
        this.strava.onLog = (msg, type) => this._emit('log', { msg, type })

        if (this.useStub) {
            this.ftms.onWorkoutUpdate = (progress) => this._handleStubProgress(progress)
        }
    }

    on(event, cb) {
        if (!this._events[event]) {
            this._events[event] = []
        }
        this._events[event].push(cb)
    }

    off(event, cb) {
        if (!this._events[event]) return
        this._events[event] = this._events[event].filter(fn => fn !== cb)
    }

    _emit(event, data) {
        if (!this._events[event]) return
        for (const cb of this._events[event]) {
            cb(data)
        }
    }

    setStubMode(enabled) {
        if (this.state.connected) {
            this.disconnectTrainer();
        }
        this.useStub = enabled;
        this.ftms = enabled ? new StubFTMSController() : new FTMSController();
        
        // Re-attach handlers
        this.ftms.onMetricsUpdate = (metrics) => this._handleMetrics(metrics)
        this.ftms.onLog = (msg, type) => this._emit('log', { msg, type })
        
        if (this.useStub) {
            this.ftms.onWorkoutUpdate = (progress) => this._handleStubProgress(progress)
        }
    }

    async connectTrainer() {
        const result = await this.ftms.connect();
        if (result.success) {
            this.state.connected = true;
            this.state.trainerName = this.ftms.trainerName || '';
            this.state.trainerBrand = this.ftms.trainerBrand || '';
            this.state.phase = 'ready';
            this._emit('connect');
            this._emit('phasechange');
        } else {
            this._emit('connectionfailed', { device: 'trainer', error: result.error });
        }
        return result.success;
    }

    async connectHR() {
        const result = await this.ftms.connectHRM();
        if (result.success) {
            this.state.hrConnected = true;
            this.state.hrName = this.ftms.hrName || '';
            this._emit('hrconnect');
        } else {
            this._emit('connectionfailed', { device: 'hr', error: result.error });
        }
        return result.success;
    }

    async tryReconnect() {
        const result = await this.ftms.reconnectToLastDevice()
        if (result) {
            this.state.connected = true
            this.state.trainerName = this.ftms.trainerName || ''
            this.state.trainerBrand = this.ftms.trainerBrand || ''
            this.state.phase = 'ready'
            this._emit('connect')
            this._emit('phasechange')
        }
        return result
    }

    disconnectTrainer() {
        this.ftms.disconnect()
        this.state.connected = false
        this.state.trainerName = ''
        this.state.trainerBrand = ''
        this.state.phase = 'connect'
        this._emit('disconnect')
    }

    async createWorkout(json) {
        return await this.workoutManager.createWorkout(json)
    }

    getWorkouts() {
        return this.workoutManager.getWorkouts()
    }

    getWorkout(id) {
        return this.workoutManager.getWorkout(id)
    }

    deleteWorkout(id) {
        return this.workoutManager.deleteWorkout(id)
    }

    getTodaysWorkout() {
        return this.workoutManager.getTodaysWorkout()
    }

    async startWorkout(workoutId) {
        const workout = this.workoutManager.getWorkout(workoutId)
        if (!workout) return false

        this.state.activeWorkout = workout
        this.state.startTime = Date.now()
        this.state.pausedDuration = 0
        this.state.elapsedSeconds = 0
        this.state.currentIntervalIndex = 0
        this.state.metricsHistory = []

        const firstInterval = workout.intervals[0]
        const targetPower = TrainerAPI.calcTargetPower(workout.ftp, firstInterval)
        
        if (this.useStub) {
            this.ftms.startWorkout(workout);
        } else {
            await this.ftms.setTargetPower(targetPower)
            this._timerInterval = setInterval(() => this._tick(), 100)
        }

        this._emit('workoutstart', workout)
        this._emit('intervalchange', {
            index: 0,
            interval: firstInterval,
            targetPower
        })

        return true
    }

    pauseWorkout() {
        this.state.paused = true
        this.state.pauseStartTime = Date.now()
        clearInterval(this._timerInterval)
        this._timerInterval = null
        this._emit('workoutpause')
    }

    resumeWorkout() {
        this.state.paused = false
        this.state.pausedDuration += (Date.now() - this.state.pauseStartTime)
        this.state.pauseStartTime = null
        this._timerInterval = setInterval(() => this._tick(), 100)
        this._emit('workoutresume')
    }

    autoPauseWorkout() {
        if (this.state.paused || !this.state.activeWorkout) return;
        this.state.isAutoPaused = true;
        this.pauseWorkout();
        this._emit('autopause');
    }

    autoResumeWorkout() {
        if (!this.state.isAutoPaused || !this.state.activeWorkout) return;
        this.resumeWorkout();
        this.state.isAutoPaused = false;
        this._emit('autoresume');
    }

    stopWorkout() {
        if (this.useStub) {
            this.ftms.stopWorkout();
        } else {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }

        const summary = this._calculateSummary();
        this.workoutManager.saveLastWorkoutSummary(summary);

        this.state.phase = 'summary'
        this._emit('workoutstop', summary)
        this._emit('phasechange')
    }

    discardWorkout() {
        if (this.useStub) {
            this.ftms.stopWorkout();
        } else {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }

        this.state.activeWorkout = null;
        this.state.phase = 'ready';
        this._emit('workoutdiscard');
        this._emit('phasechange');
    }

    _tick() {
        const elapsed = (Date.now() - this.state.startTime - this.state.pausedDuration) / 1000
        this.state.elapsedSeconds = elapsed

        const intervals = this.state.activeWorkout.intervals
        let cumulative = 0
        let newIntervalIndex = 0

        for (let i = 0; i < intervals.length; i++) {
            cumulative += intervals[i].duration
            if (elapsed < cumulative) {
                newIntervalIndex = i
                break
            }
            if (i === intervals.length - 1) {
                newIntervalIndex = i
            }
        }

        const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0)

        if (elapsed >= totalDuration) {
            this._emit('workoutcomplete')
            this.stopWorkout()
            return
        }

        if (newIntervalIndex !== this.state.currentIntervalIndex) {
            this.state.currentIntervalIndex = newIntervalIndex
            const interval = intervals[newIntervalIndex]
            const targetPower = TrainerAPI.calcTargetPower(this.state.activeWorkout.ftp, interval)
            this.ftms.setTargetPower(targetPower)
            this._emit('intervalchange', {
                index: newIntervalIndex,
                interval,
                targetPower
            })
        }
    }

    _handleStubProgress(progress) {
        if (!this.state.activeWorkout || !progress) return;

        // Update elapsed time from server
        const totalDuration = this.workoutManager.getTotalDuration(this.state.activeWorkout);
        this.state.elapsedSeconds = (progress.percentageComplete / 100) * totalDuration;

        // Check for interval changes
        if (progress.currentIntervalIndex !== this.state.currentIntervalIndex) {
            this.state.currentIntervalIndex = progress.currentIntervalIndex;
            const interval = this.state.activeWorkout.intervals[progress.currentIntervalIndex];
            if (interval) {
                const targetPower = TrainerAPI.calcTargetPower(this.state.activeWorkout.ftp, interval);
                
                this._emit('intervalchange', {
                    index: progress.currentIntervalIndex,
                    interval,
                    targetPower
                });
            }
        }

        // Check for workout completion
        if (progress.percentageComplete >= 100) {
            this.stopWorkout();
        }
    }

    _handleMetrics(metrics) {
        this.state.metrics = metrics;
        this._emit('metrics', metrics);

        const now = Date.now();
        const lastMetricsTime = this.state.metricsHistory.length > 0 ? this.state.metricsHistory[this.state.metricsHistory.length - 1].timestamp : now;
        const timeDelta = (now - lastMetricsTime) / 1000;

        if (this.state.activeWorkout) { // Run auto-pause logic for both real and stub trainers
            const isPowerPresent = metrics.power >= 10;

            if (isPowerPresent) {
                // Power is present
                if (this.state.isAutoPaused) {
                    if (this.timeWithPower === undefined) this.timeWithPower = 0;
                    this.timeWithPower += timeDelta;
                    if (this.timeWithPower >= 3) {
                        this.autoResumeWorkout();
                    }
                }
                this.state.timeWithoutPower = 0;
            } else {
                // Power is zero or negligible
                if (!this.state.paused) {
                    this.state.timeWithoutPower += timeDelta;
                    if (this.state.timeWithoutPower >= 5) {
                        this.autoPauseWorkout();
                    }
                }
                this.timeWithPower = 0; // Reset counter if power drops
            }
        }

        if (this.state.activeWorkout) {
            this.state.metricsHistory.push({
                timestamp: now,
                power: metrics.power,
                hr: metrics.hr,
                cadence: metrics.cadence,
                targetPower: metrics.targetPower,
                intervalIndex: this.state.currentIntervalIndex
            });
            if (this.state.metricsHistory.length > 10000) {
                this.state.metricsHistory.shift();
            }
        }
    }

    _calculateSummary() {
        const history = this.state.metricsHistory
        const workout = this.state.activeWorkout
        const duration = this.state.elapsedSeconds

        let avgPower = 0
        let maxPower = 0
        let avgHR = 0
        let maxHR = 0
        let kj = 0

        if (history.length > 0) {
            let totalPower = 0
            let totalHR = 0
            let hrCount = 0

            for (let i = 0; i < history.length; i++) {
                const entry = history[i]
                totalPower += entry.power
                if (entry.power > maxPower) maxPower = entry.power
                if (entry.hr) {
                    totalHR += entry.hr
                    hrCount++
                }
                if (entry.hr > maxHR) maxHR = entry.hr

                if (i > 0) {
                    const timeDelta = (entry.timestamp - history[i - 1].timestamp) / 1000
                    kj += (entry.power * timeDelta) / 1000
                }
            }

            avgPower = Math.round(totalPower / history.length)
            avgHR = hrCount > 0 ? Math.round(totalHR / hrCount) : 0
        }

        const ftp = workout ? workout.ftp : 0
        const tss = ftp > 0 && avgPower > 0
            ? (duration * avgPower * (avgPower / ftp)) / (ftp * 3600) * 100
            : 0

        return {
            workoutId: workout ? workout.id : null,
            workoutName: workout ? workout.name : '',
            name: workout ? workout.name : 'Indoor Trainer Workout',
            duration,
            avgPower,
            maxPower,
            avgHR,
            maxHR,
            tss: Math.round(tss * 10) / 10,
            kj: Math.round(kj * 10) / 10,
            timestamp: Date.now(),
            intervalCount: workout ? workout.intervals.length : 0,
            intervals: workout ? workout.intervals : [],
            ftp: workout ? workout.ftp : 200
        }
    }

    getUpcomingIntervals(count = 5) {
        if (!this.state.activeWorkout) return []
        const intervals = this.state.activeWorkout.intervals
        return intervals.slice(this.state.currentIntervalIndex, this.state.currentIntervalIndex + count)
    }

    getWorkoutProgress() {
        if (!this.state.activeWorkout) return null

        const intervals = this.state.activeWorkout.intervals
        const total = intervals.reduce((sum, iv) => sum + iv.duration, 0)
        const elapsed = this.state.elapsedSeconds
        const percentage = total > 0 ? Math.min((elapsed / total) * 100, 100) : 0

        const currentIndex = this.state.currentIntervalIndex
        const currentInterval = intervals[currentIndex] || null

        let timeInInterval = elapsed
        for (let i = 0; i < currentIndex; i++) {
            timeInInterval -= intervals[i].duration
        }
        const intervalProgress = currentInterval
            ? Math.min((timeInInterval / currentInterval.duration) * 100, 100)
            : 0

        return {
            elapsed,
            total,
            percentage,
            currentInterval,
            timeInInterval,
            intervalProgress,
            intervalIndex: currentIndex
        }
    }

    getLastWorkoutSummary() {
        return this.workoutManager.getLastWorkoutSummary()
    }

    getSettings() {
        return this.workoutManager.getSettings()
    }

    updateSettings(s) {
        return this.workoutManager.updateSettings(s)
    }

    async connectStrava() {
        return await this.strava.connect()
    }

    async uploadToStrava() {
        const summary = this.workoutManager.getLastWorkoutSummary()
        const metricsHistory = this.state.metricsHistory
        return await this.strava.uploadActivity(summary, metricsHistory)
    }

    isStravaConnected() {
        return this.strava.isConnected
    }
}

const trainer = new TrainerAPI();
export default trainer;
