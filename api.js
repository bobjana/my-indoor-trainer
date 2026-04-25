import { FTMSController } from './ftms.js';
import { WorkoutManager } from './workout-manager.js';
import { StravaIntegration } from './strava.js';

class TrainerAPI {
    constructor() {
        this.ftms = new FTMSController()
        this.workoutManager = new WorkoutManager()
        this.strava = new StravaIntegration()

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
            metricsHistory: []
        }

        this._events = {}
        this._timerInterval = null

        this.ftms.onMetricsUpdate = (metrics) => this._handleMetrics(metrics)
        this.ftms.onLog = (msg, type) => this._emit('log', { msg, type })
        this.workoutManager.onUpdate = () => this._emit('workoutsUpdated')
        this.strava.onStatusChange = (connected) => {
            this._emit('stravaStatus', connected)
        }
        this.strava.onLog = (msg, type) => this._emit('log', { msg, type })
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

    async connectTrainer() {
        const result = await this.ftms.connect();
        if (result.success) {
            this.state.connected = true;
            this.state.trainerName = this.ftms.trainerName || '';
            this.state.trainerBrand = this.ftms.getTrainerBrand();
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
            this.state.trainerBrand = this.ftms.getTrainerBrand()
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
        this.state.currentIntervalIndex = 0
        this.state.metricsHistory = []

        const firstInterval = workout.intervals[0]
        const targetPower = Math.round(workout.ftp * firstInterval.percentage / 100)
        await this.ftms.setTargetPower(targetPower)

        this._timerInterval = setInterval(() => this._tick(), 100)

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

    stopWorkout() {
        clearInterval(this._timerInterval)
        this._timerInterval = null

        const summary = this._calculateSummary()
        this.workoutManager.saveLastWorkoutSummary(summary)

        this.state.phase = 'summary'
        this._emit('workoutstop', summary)
        this._emit('phasechange')
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
            const targetPower = Math.round(this.state.activeWorkout.ftp * interval.percentage / 100)
            this.ftms.setTargetPower(targetPower)
            this._emit('intervalchange', {
                index: newIntervalIndex,
                interval,
                targetPower
            })
        }
    }

    _handleMetrics(metrics) {
        this._emit('metrics', metrics)

        if (this.state.activeWorkout) {
            this.state.metricsHistory.push({
                timestamp: Date.now(),
                power: metrics.power,
                hr: metrics.hr,
                cadence: metrics.cadence,
                targetPower: metrics.targetPower,
                intervalIndex: this.state.currentIntervalIndex
            })
            if (this.state.metricsHistory.length > 10000) {
                this.state.metricsHistory = this.state.metricsHistory.slice(-10000)
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
            duration,
            avgPower,
            maxPower,
            avgHR,
            maxHR,
            tss: Math.round(tss * 10) / 10,
            kj: Math.round(kj * 10) / 10,
            timestamp: Date.now(),
            intervalCount: workout ? workout.intervals.length : 0
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
            intervalProgress
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

    async connectStrava(clientId) {
        return await this.strava.connect(clientId)
    }

    async uploadToStrava() {
        const summary = this.workoutManager.getLastWorkoutSummary()
        const metricsHistory = this.state.metricsHistory
        return await this.strava.uploadActivity(summary, metricsHistory)
    }

    isStravaConnected() {
        return this.strava.isConnected()
    }
}

const trainer = new TrainerAPI();
export default trainer;
