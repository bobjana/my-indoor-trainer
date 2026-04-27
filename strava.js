export class StravaIntegration {
    constructor() {
        this.clientId = null
        this.tokens = null
        this.onStatusChange = null
        this.onLog = null
        this._loadTokens()
    }

    get isConnected() {
        return !!(this.tokens && this.tokens.access_token)
    }

    async connect() {
        console.log("STRAVA CONNECT CALLED");
        try {
            const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID;
            const clientSecret = import.meta.env.VITE_STRAVA_CLIENT_SECRET;
            
            console.log("CLIENT ID:", clientId);

            if (!clientId || !clientSecret) {
                throw new Error('Strava credentials missing in environment variables (.env)');
            }

            this.clientId = clientId;
            const redirectUri = window.location.origin + '/strava-callback.html'
            const oauthUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=activity:write&approval_prompt=auto`

            const width = 600
            const height = 800
            const left = (window.screen.width - width) / 2
            const top = (window.screen.height - height) / 2

            const popup = window.open(
                oauthUrl,
                'strava-auth',
                `width=${width},height=${height},top=${top},left=${left}`
            )

            const code = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    window.removeEventListener('message', handler)
                    reject(new Error('OAuth flow timed out'))
                }, 300000)

                function handler(event) {
                    if (event.data && event.data.type === 'strava-callback') {
                        clearTimeout(timeout)
                        window.removeEventListener('message', handler)
                        if (event.data.code) {
                            resolve(event.data.code)
                        } else {
                            reject(new Error(event.data.error || 'OAuth denied'))
                        }
                    }
                }

                window.addEventListener('message', handler)
            })

            const response = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                    grant_type: 'authorization_code'
                })
            })

            if (!response.ok) {
                throw new Error(`Token exchange failed: ${response.status}`)
            }

            const tokenData = await response.json()
            this.tokens = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: tokenData.expires_at,
                athlete: {
                    id: tokenData.athlete.id,
                    firstname: tokenData.athlete.firstname,
                    lastname: tokenData.athlete.lastname
                }
            }
            this._storeTokens(this.tokens)

            if (this.onStatusChange) {
                this.onStatusChange(true)
            }

            return true
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Strava connect error: ${err.message}`)
            }
            return false
        }
    }

    async disconnect() {
        try {
            localStorage.removeItem('indoor-trainer-strava')
            this.tokens = null
            if (this.onStatusChange) {
                this.onStatusChange(false)
            }
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Strava disconnect error: ${err.message}`)
            }
        }
    }

    async ensureTokenValid() {
        try {
            if (!this.tokens) {
                return false
            }
            const now = Math.floor(Date.now() / 1000)
            if (this.tokens.expires_at < now) {
                return await this._refreshToken()
            }
            return true
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Token validation error: ${err.message}`)
            }
            return false
        }
    }

    async _refreshToken() {
        try {
            const clientSecret = import.meta.env.VITE_STRAVA_CLIENT_SECRET;
            const response = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: this.clientId,
                    client_secret: clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: this.tokens.refresh_token
                })
            })

            if (!response.ok) {
                throw new Error(`Token refresh failed: ${response.status}`)
            }

            const tokenData = await response.json()
            this.tokens = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: tokenData.expires_at,
                athlete: this.tokens.athlete
            }
            this._storeTokens(this.tokens)
            return true
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Token refresh error: ${err.message}`)
            }
            return false
        }
    }

    async uploadActivity(workoutSummary, metricsData) {
        try {
            const valid = await this.ensureTokenValid()
            if (!valid) {
                return { success: false, error: 'Not authenticated' }
            }

            const tcx = this._generateTCX(workoutSummary, metricsData)
            const blob = new Blob([tcx], { type: 'application/xml' })

            const formData = new FormData()
            formData.append('file', blob, 'activity.tcx')
            formData.append('data_type', 'tcx')
            formData.append('activity_type', 'VirtualRide')
            formData.append('name', `Indoor Trainer - ${workoutSummary.name || 'Workout'}`)
            
            const description = `Completed on My Indoor Trainer 🚴‍♂️
Workout: ${workoutSummary.name || 'Custom'}
Duration: ${Math.floor((workoutSummary.duration||0)/60)}m ${(workoutSummary.duration||0)%60}s
TSS: ${workoutSummary.tss || 0} | Work: ${workoutSummary.kj || 0} kJ
Avg Power: ${workoutSummary.avgPower || 0} W | Max Power: ${workoutSummary.maxPower || 0} W`;

        formData.append('description', description);

            const response = await fetch('https://www.strava.com/api/v3/uploads', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.tokens.access_token}`
                },
                body: formData
            })

            if (!response.ok) {
                const errBody = await response.text()
                throw new Error(`Upload failed: ${response.status} ${errBody}`)
            }

            const result = await response.json()
            return { success: true, activityId: result.id }
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Upload error: ${err.message}`)
            }
            return { success: false, error: err.message }
        }
    }

    async getAthlete() {
        try {
            const valid = await this.ensureTokenValid()
            if (!valid) {
                return null
            }

            const response = await fetch('https://www.strava.com/api/v3/athlete', {
                headers: {
                    Authorization: `Bearer ${this.tokens.access_token}`
                }
            })

            if (!response.ok) {
                throw new Error(`Get athlete failed: ${response.status}`)
            }

            return await response.json()
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Get athlete error: ${err.message}`)
            }
            return null
        }
    }

    _generateTCX(workoutSummary, metricsData) {
        const startTime = workoutSummary.startTime || new Date()
        const startStr = new Date(startTime).toISOString()
        const totalSeconds = workoutSummary.duration || 0
        const distanceMeters = (workoutSummary.distance || 0)
        const calories = workoutSummary.energy || Math.round((workoutSummary.kj || 0))

        let trackpoints = ''
        const data = metricsData || []

        if (data.length > 0) {
            for (let i = 0; i < data.length; i++) {
                const point = data[i]
                const pointTime = new Date(new Date(startTime).getTime() + (point.elapsed || i) * 1000).toISOString()
                const hr = point.heartRate || point.hr || 0
                const cadence = point.cadence || point.rpm || 0
                const power = point.power || point.watts || 0

                trackpoints += `
        <Trackpoint>
          <Time>${pointTime}</Time>
          <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>
          <Cadence>${cadence}</Cadence>
          <Extensions>
            <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
              <Watts>${power}</Watts>
            </TPX>
          </Extensions>
        </Trackpoint>`
            }
        } else {
            const intervals = workoutSummary.intervals || [{ duration: totalSeconds }]
            let elapsed = 0
            for (let i = 0; i < intervals.length; i++) {
                const interval = intervals[i]
                const duration = interval.duration || interval.length || 60
                const power = interval.power || interval.watts || 150
                const cadence = interval.cadence || interval.rpm || 85
                const hr = interval.heartRate || interval.hr || 0
                const steps = Math.max(1, Math.floor(duration / 10))

                for (let s = 0; s < steps; s++) {
                    const pointTime = new Date(new Date(startTime).getTime() + (elapsed + s * 10) * 1000).toISOString()
                    trackpoints += `
        <Trackpoint>
          <Time>${pointTime}</Time>
          <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>
          <Cadence>${cadence}</Cadence>
          <Extensions>
            <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
              <Watts>${power}</Watts>
            </TPX>
          </Extensions>
        </Trackpoint>`
                }
                elapsed += duration
            }
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startStr}</Id>
      <Lap StartTime="${startStr}">
        <TotalTimeSeconds>${totalSeconds}</TotalTimeSeconds>
        <DistanceMeters>${distanceMeters}</DistanceMeters>
        <Calories>${calories}</Calories>
        <Track>${trackpoints}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`
    }

    _loadTokens() {
        try {
            const stored = localStorage.getItem('indoor-trainer-strava')
            if (stored) {
                this.tokens = JSON.parse(stored)
            }
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Load tokens error: ${err.message}`)
            }
            this.tokens = null
        }
    }

    _storeTokens(tokenData) {
        try {
            localStorage.setItem('indoor-trainer-strava', JSON.stringify(tokenData))
        } catch (err) {
            if (this.onLog) {
                this.onLog(`Store tokens error: ${err.message}`)
            }
        }
    }
}
