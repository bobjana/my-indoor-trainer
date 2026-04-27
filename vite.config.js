import { defineConfig } from 'vite'
import localSessionsPlugin from './vite-plugin-local-sessions.js'

export default defineConfig({
    server: {
        allowedHosts: [
            'indoor.zynafin.cc'
        ]
    },
    plugins: [
        localSessionsPlugin({
            dir: './sessions'
        })
    ]
})
