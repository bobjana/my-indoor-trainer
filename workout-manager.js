export class WorkoutManager {
    constructor() {
        this.storageKey = 'indoor-trainer-workouts'
        this.summaryKey = 'indoor-trainer-last-summary'
        this.settingsKey = 'indoor-trainer-settings'
        this.workouts = this._loadWorkouts()
        this.onUpdate = null
    }

    createWorkout(json) {
        if (json == null || typeof json !== 'object') {
            return { success: false, id: null, errors: ['Workout must be a valid object'] }
        }

        const validation = this._validateWorkout(json)
        if (!validation.valid) {
            return { success: false, id: null, errors: validation.errors }
        }

        const workout = {
            id: json.id || (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : 'w-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9)),
            name: String(json.name),
            description: json.description != null ? String(json.description) : '',
            ftp: json.ftp != null ? Number(json.ftp) : this.getSettings().ftp,
            agent: json.agent != null ? String(json.agent) : '',
            scheduledDate: json.scheduledDate != null ? String(json.scheduledDate) : null,
            intervals: json.intervals.map((interval) => ({
                name: String(interval.name),
                type: interval.type != null ? String(interval.type) : 'active',
                duration: Number(interval.duration),
                percentage: Number(interval.percentage)
            })),
            created: json.created || new Date().toISOString()
        }

        const existingIndex = this.workouts.findIndex((w) => w.id === workout.id)
        if (existingIndex !== -1) {
            workout.created = this.workouts[existingIndex].created
            this.workouts[existingIndex] = workout
        } else {
            this.workouts.push(workout)
        }

        this._saveWorkouts()
        if (this.onUpdate) this.onUpdate(this.getWorkouts())

        return { success: true, id: workout.id, errors: [] }
    }

    getWorkouts() {
        return [...this.workouts].sort((a, b) => {
            if (!a.created) return 1
            if (!b.created) return -1
            return new Date(b.created) - new Date(a.created)
        })
    }

    getWorkout(id) {
        if (id == null) return null
        return this.workouts.find((w) => w.id === id) || null
    }

    deleteWorkout(id) {
        if (id == null) return false

        const index = this.workouts.findIndex((w) => w.id === id)
        if (index === -1) return false

        this.workouts.splice(index, 1)
        this._saveWorkouts()
        if (this.onUpdate) this.onUpdate(this.getWorkouts())

        return true
    }

    getTodaysWorkout() {
        const today = new Date()
        const year = today.getFullYear()
        const month = String(today.getMonth() + 1).padStart(2, '0')
        const day = String(today.getDate()).padStart(2, '0')
        const todayStr = `${year}-${month}-${day}`

        return this.workouts.find((w) => w.scheduledDate === todayStr) || null
    }

    getTotalDuration(workout) {
        if (workout == null || !Array.isArray(workout.intervals)) return 0
        return workout.intervals.reduce((sum, interval) => {
            return sum + (typeof interval.duration === 'number' ? interval.duration : 0)
        }, 0)
    }

    saveLastWorkoutSummary(summary) {
        if (summary == null) return
        try {
            localStorage.setItem(this.summaryKey, JSON.stringify(summary))
        } catch (e) {
            console.error('Failed to save workout summary:', e)
        }
    }

    getLastWorkoutSummary() {
        try {
            const saved = localStorage.getItem(this.summaryKey)
            return saved ? JSON.parse(saved) : null
        } catch (e) {
            console.error('Failed to load workout summary:', e)
            return null
        }
    }

    getSettings() {
        const defaults = { ftp: 200, maxHR: 190 }
        try {
            const saved = localStorage.getItem(this.settingsKey)
            if (saved) {
                const parsed = JSON.parse(saved)
                return { ...defaults, ...parsed }
            }
        } catch (e) {
            console.error('Failed to load settings:', e)
        }
        return defaults
    }

    updateSettings(settings) {
        if (settings == null || typeof settings !== 'object') return
        try {
            const current = this.getSettings()
            const merged = { ...current, ...settings }
            localStorage.setItem(this.settingsKey, JSON.stringify(merged))
        } catch (e) {
            console.error('Failed to save settings:', e)
        }
    }

    importWorkouts(jsonString) {
        const result = { imported: 0, errors: [] }

        if (typeof jsonString !== 'string' || jsonString.trim() === '') {
            result.errors.push('Input must be a non-empty JSON string')
            return result
        }

        let parsed
        try {
            parsed = JSON.parse(jsonString)
        } catch (e) {
            result.errors.push('Invalid JSON: ' + e.message)
            return result
        }

        const workouts = Array.isArray(parsed) ? parsed : [parsed]

        for (let i = 0; i < workouts.length; i++) {
            const item = workouts[i]
            const validation = this._validateWorkout(item)

            if (!validation.valid) {
                result.errors.push(`Workout ${i + 1}: ${validation.errors.join(', ')}`)
                continue
            }

            if (item.id != null && this.getWorkout(item.id)) {
                result.errors.push(`Workout ${i + 1}: duplicate ID "${item.id}" skipped`)
                continue
            }

            const createResult = this.createWorkout(item)
            if (createResult.success) {
                result.imported++
            } else {
                result.errors.push(`Workout ${i + 1}: ${createResult.errors.join(', ')}`)
            }
        }

        return result
    }

    exportWorkouts() {
        return JSON.stringify(this.getWorkouts(), null, 2)
    }

    _loadWorkouts() {
        try {
            const saved = localStorage.getItem(this.storageKey)
            if (saved) {
                const parsed = JSON.parse(saved)
                if (Array.isArray(parsed)) return parsed
            }
        } catch (e) {
            console.error('Failed to load workouts:', e)
        }
        return []
    }

    _saveWorkouts() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.workouts))
        } catch (e) {
            console.error('Failed to save workouts:', e)
        }
    }

    _validateWorkout(json) {
        const errors = []

        if (json == null || typeof json !== 'object') {
            errors.push('Workout must be an object')
            return { valid: false, errors }
        }

        if (!json.name || typeof json.name !== 'string' || json.name.trim() === '') {
            errors.push('name is required and must be a non-empty string')
        }

        if (!Array.isArray(json.intervals) || json.intervals.length === 0) {
            errors.push('intervals must be a non-empty array')
        } else {
            for (let i = 0; i < json.intervals.length; i++) {
                const interval = json.intervals[i]
                const prefix = `interval[${i}]`

                if (interval == null || typeof interval !== 'object') {
                    errors.push(`${prefix} must be an object`)
                    continue
                }

                if (!interval.name || typeof interval.name !== 'string' || interval.name.trim() === '') {
                    errors.push(`${prefix}.name is required and must be a non-empty string`)
                }

                if (typeof interval.duration !== 'number' || isNaN(interval.duration) || interval.duration <= 0) {
                    errors.push(`${prefix}.duration must be a positive number`)
                }

                if (typeof interval.percentage !== 'number' || isNaN(interval.percentage) || interval.percentage < 0 || interval.percentage > 200) {
                    errors.push(`${prefix}.percentage must be a number between 0 and 200`)
                }
            }
        }

        return { valid: errors.length === 0, errors }
    }
}
