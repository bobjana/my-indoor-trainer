export class WorkoutManager {
    constructor() {
        this.storageKey = 'indoor-trainer-workouts'
        this.summaryKey = 'indoor-trainer-last-summary'
        this.historyKey = 'indoor-trainer-session-history'
        this.settingsKey = 'indoor-trainer-settings'
        this.workouts = this._loadWorkouts()
        this.onUpdate = null
        this._diskReady = false
    }

    /**
     * Fetch workout definitions from the local sessions/ folder via the
     * Vite dev-server middleware and merge them into the in-memory list.
     * Safe to call multiple times — disk workouts are merged by ID.
     */
    async syncFromDisk() {
        try {
            const res = await fetch('/api/sessions')
            if (!res.ok) return false
            const { sessions } = await res.json()
            if (!Array.isArray(sessions)) return false

            let added = 0
            for (const { filename, data } of sessions) {
                // Only treat files that look like workout definitions
                // (have intervals array and name).  Completed-session files
                // will lack a proper intervals structure or are prefixed.
                if (!data || !Array.isArray(data.intervals) || !data.name) continue
                // Skip completed-session files
                if (filename.startsWith('completed-')) continue

                const existing = this.workouts.find(w => w.id === data.id)
                if (existing) continue

                const result = this.createWorkout(data)
                if (result.success) added++
            }

            this._diskReady = true
            if (added > 0) {
                console.log(`[sessions] Imported ${added} workout(s) from disk`)
            }
            return true
        } catch (e) {
            // Endpoint not available (e.g. production build without server)
            console.log('[sessions] Disk sync unavailable:', e.message)
            return false
        }
    }

    /**
     * Save a completed session summary to the local sessions/ folder.
     */
    async saveSessionToDisk(summary) {
        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary)
            })
            if (!res.ok) {
                console.error('[sessions] Failed to save session to disk')
                return false
            }
            const { filename } = await res.json()
            console.log(`[sessions] Session saved to disk: ${filename}`)
            return true
        } catch (e) {
            console.error('[sessions] Disk save unavailable:', e.message)
            return false
        }
    }

    // ── Session history (localStorage) ──────────────────────────────

    /**
     * Append a completed session to the local history array.
     */
    appendSessionHistory(summary) {
        const history = this.getSessionHistory()
        history.push(summary)
        // Keep last 50 sessions
        if (history.length > 50) history.splice(0, history.length - 50)
        try {
            localStorage.setItem(this.historyKey, JSON.stringify(history))
        } catch (e) {
            console.error('Failed to save session history:', e)
        }
    }

    getSessionHistory() {
        try {
            const saved = localStorage.getItem(this.historyKey)
            return saved ? JSON.parse(saved) : []
        } catch (e) {
            return []
        }
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
                powerType: interval.powerType != null ? String(interval.powerType) : 'relative',
                percentage: interval.percentage != null ? Number(interval.percentage) : null,
                power: interval.power != null ? Number(interval.power) : null,
                percentageLow: interval.percentageLow != null ? Number(interval.percentageLow) : null,
                percentageHigh: interval.percentageHigh != null ? Number(interval.percentageHigh) : null
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
        const sorted = [...this.workouts].sort((a, b) => {
            if (!a.created) return 1
            if (!b.created) return -1
            return new Date(b.created) - new Date(a.created)
        });
        
        const unique = [];
        const seenNames = new Set();
        for (const w of sorted) {
            if (!seenNames.has(w.name)) {
                seenNames.add(w.name);
                unique.push(w);
            }
        }
        return unique;
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
        // Also persist to disk and history
        this.saveSessionToDisk(summary)
        this.appendSessionHistory(summary)
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

                const powerType = interval.powerType || 'relative'

                if (powerType === 'relative') {
                    if (typeof interval.percentage !== 'number' || isNaN(interval.percentage) || interval.percentage < 0 || interval.percentage > 200) {
                        errors.push(`${prefix}.percentage must be a number between 0 and 200`)
                    }
                } else if (powerType === 'absolute') {
                    if (typeof interval.power !== 'number' || isNaN(interval.power) || interval.power < 0) {
                        errors.push(`${prefix}.power must be a positive number for absolute power type`)
                    }
                } else if (powerType === 'ramp') {
                    if (typeof interval.percentageLow !== 'number' || isNaN(interval.percentageLow) || interval.percentageLow < 0) {
                        errors.push(`${prefix}.percentageLow must be a positive number for ramp power type`)
                    }
                    if (typeof interval.percentageHigh !== 'number' || isNaN(interval.percentageHigh) || interval.percentageHigh < 0) {
                        errors.push(`${prefix}.percentageHigh must be a positive number for ramp power type`)
                    }
                } else {
                    errors.push(`${prefix}.powerType must be 'relative', 'absolute', or 'ramp'`)
                }
            }
        }

        return { valid: errors.length === 0, errors }
    }
}
