import fs from 'fs'
import path from 'path'

/**
 * Vite plugin that adds local filesystem access for workout JSON sessions.
 *
 * Endpoints (dev/preview server only):
 *   GET  /api/sessions              — list all JSON files in the sessions dir
 *   GET  /api/sessions/:filename    — read a specific JSON file
 *   POST /api/sessions              — write a completed session JSON file
 *   DELETE /api/sessions/:filename  — remove a JSON file
 */
export default function localSessionsPlugin(options = {}) {
    const sessionsDir = path.resolve(options.dir || './sessions')

    function ensureDir() {
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true })
        }
    }

    function readJsonFiles() {
        ensureDir()
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
        return files.map(filename => {
            try {
                const content = fs.readFileSync(path.join(sessionsDir, filename), 'utf-8')
                const data = JSON.parse(content)
                return { filename, data, source: 'disk' }
            } catch (e) {
                console.error(`[local-sessions] Error reading ${filename}:`, e.message)
                return { filename, data: null, source: 'disk', error: e.message }
            }
        }).filter(f => f.data !== null)
    }

    function readJsonFile(filename) {
        const safeName = path.basename(filename)
        const filePath = path.join(sessionsDir, safeName)
        if (!fs.existsSync(filePath)) {
            return null
        }
        try {
            const content = fs.readFileSync(filePath, 'utf-8')
            return JSON.parse(content)
        } catch (e) {
            return null
        }
    }

    function writeSessionFile(data) {
        ensureDir()
        const completedDir = path.join(sessionsDir, 'completed')
        if (!fs.existsSync(completedDir)) {
            fs.mkdirSync(completedDir, { recursive: true })
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const slug = (data.workoutName || data.name || 'workout')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 40)
        const filename = `completed-${ts}-${slug}.json`
        const filePath = path.join(completedDir, filename)
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
        return { filename, path: filePath }
    }

    function deleteJsonFile(filename) {
        const safeName = path.basename(filename)
        const filePath = path.join(sessionsDir, safeName)
        if (!fs.existsSync(filePath)) {
            return false
        }
        fs.unlinkSync(filePath)
        return true
    }

    function isJson(req) {
        return req.headers['content-type']?.includes('application/json')
    }

    function sendJson(res, status, data) {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
    }

    function readBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = []
            req.on('data', chunk => chunks.push(chunk))
            req.on('end', () => resolve(Buffer.concat(chunks).toString()))
            req.on('error', reject)
        })
    }

    function middleware(req, res, next) {
        // Only handle /api/sessions routes
        if (!req.url?.startsWith('/api/sessions')) {
            return next()
        }

        // GET /api/sessions — list files
        if (req.url === '/api/sessions' && req.method === 'GET') {
            const files = readJsonFiles()
            sendJson(res, 200, { success: true, sessions: files })
            return
        }

        // POST /api/sessions — write completed session
        if (req.url === '/api/sessions' && req.method === 'POST') {
            if (!isJson(req)) {
                sendJson(res, 400, { success: false, error: 'Content-Type must be application/json' })
                return
            }
            readBody(req).then(body => {
                try {
                    const data = JSON.parse(body)
                    const result = writeSessionFile(data)
                    console.log(`[local-sessions] Saved completed session: ${result.filename}`)
                    sendJson(res, 201, { success: true, filename: result.filename })
                } catch (e) {
                    sendJson(res, 400, { success: false, error: e.message })
                }
            }).catch(() => {
                sendJson(res, 500, { success: false, error: 'Failed to read request body' })
            })
            return
        }

        // GET /api/sessions/:filename — read file
        const getMatch = req.url?.match(/^\/api\/sessions\/(.+\.json)$/)
        if (getMatch && req.method === 'GET') {
            const data = readJsonFile(getMatch[1])
            if (!data) {
                sendJson(res, 404, { success: false, error: 'File not found' })
                return
            }
            sendJson(res, 200, { success: true, data })
            return
        }

        // DELETE /api/sessions/:filename
        const deleteMatch = req.url?.match(/^\/api\/sessions\/(.+\.json)$/)
        if (deleteMatch && req.method === 'DELETE') {
            const ok = deleteJsonFile(deleteMatch[1])
            sendJson(res, ok ? 200 : 404, { success: ok })
            return
        }

        next()
    }

    return {
        name: 'local-sessions',
        configureServer(server) {
            server.middlewares.use(middleware)
            console.log(`[local-sessions] Serving sessions from ${sessionsDir}`)
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware)
            console.log(`[local-sessions] Preview serving sessions from ${sessionsDir}`)
        }
    }
}
