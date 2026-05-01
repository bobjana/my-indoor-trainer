const http = require('http');
const fs = require('fs');
const path = require('path');
const { parse } = require('url');

// Port and Directory Configuration
const PORT = process.env.PORT || 5173;
const DIST_DIR = path.resolve(__dirname, 'dist');
const SESSIONS_DIR = path.resolve(__dirname, 'sessions');
const SAMPLES_DIR = path.resolve(__dirname, 'samples');

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Seed sessions from samples if empty
try {
    const sessionsFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    if (sessionsFiles.length === 0 && fs.existsSync(SAMPLES_DIR)) {
        const sampleFiles = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.json'));
        console.log(`Seeding sessions directory with ${sampleFiles.length} samples...`);
        sampleFiles.forEach(file => {
            fs.copyFileSync(path.join(SAMPLES_DIR, file), path.join(SESSIONS_DIR, file));
        });
    }
} catch (e) {
    console.error('Failed to seed sessions:', e.message);
}

// MIME Types
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

function getBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => { resolve(body); });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    let pathname = parsedUrl.pathname;

    // --- API SESSIONS HANDLER ---
    if (pathname.startsWith('/api/sessions')) {
        res.setHeader('Content-Type', 'application/json');

        // GET /api/sessions
        if (pathname === '/api/sessions' && req.method === 'GET') {
            try {
                const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
                const sessions = files.map(filename => {
                    try {
                        const content = fs.readFileSync(path.join(SESSIONS_DIR, filename), 'utf-8');
                        return { filename, data: JSON.parse(content), source: 'disk' };
                    } catch (e) {
                        return null;
                    }
                }).filter(f => f !== null);
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, sessions }));
            } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // POST /api/sessions
        if (pathname === '/api/sessions' && req.method === 'POST') {
            try {
                const body = await getBody(req);
                const data = JSON.parse(body);
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                const slug = (data.workoutName || data.name || 'workout')
                    .replace(/[^a-zA-Z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .substring(0, 40);
                const filename = `completed-${ts}-${slug}.json`;
                const completedDir = path.join(SESSIONS_DIR, 'completed');
                if (!fs.existsSync(completedDir)) {
                    fs.mkdirSync(completedDir, { recursive: true });
                }
                const filePath = path.join(completedDir, filename);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                res.statusCode = 201;
                res.end(JSON.stringify({ success: true, filename }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // GET /api/sessions/:filename
        const getMatch = pathname.match(/^\/api\/sessions\/(.+\.json)$/);
        if (getMatch && req.method === 'GET') {
            const filename = path.basename(getMatch[1]);
            const filePath = path.join(SESSIONS_DIR, filename);
            if (fs.existsSync(filePath)) {
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, data: JSON.parse(fs.readFileSync(filePath, 'utf-8')) }));
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ success: false, error: 'File not found' }));
            }
            return;
        }

        // DELETE /api/sessions/:filename
        const deleteMatch = pathname.match(/^\/api\/sessions\/(.+\.json)$/);
        if (deleteMatch && req.method === 'DELETE') {
            const filename = path.basename(deleteMatch[1]);
            const filePath = path.join(SESSIONS_DIR, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ success: false, error: 'File not found' }));
            }
            return;
        }
    }

    // --- STATIC FILES HANDLER ---
    // Handle SPA routing: if file doesn't exist, serve index.html
    let filePath = path.join(DIST_DIR, pathname);
    if (pathname === '/') filePath = path.join(DIST_DIR, 'index.html');

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.statusCode = 500;
            res.end(`Server Error: ${err.code}`);
        } else {
            res.setHeader('Content-Type', contentType);
            res.statusCode = 200;
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Production server running at http://0.0.0.0:${PORT}/`);
    console.log(`Serving static files from ${DIST_DIR}`);
    console.log(`Managing sessions in ${SESSIONS_DIR}`);
});
