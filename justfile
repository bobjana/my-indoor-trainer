# Indoor Trainer Project Justfile

# List all recipes
default:
    @just --list

# --- Development ---

# Start the Vite development server
dev:
    npm run dev

# Start the stub FTMS server
stub:
    cd stub-server && npm start

# Setup the project (install deps)
setup:
    npm install
    cd stub-server && npm install

# --- Production & Build ---

# Build the project for production
build:
    npm run build

# Preview the production build using Vite
preview:
    npm run preview

# Run the production server (serves dist/ and handles session API)
serve:
    node prod-server.js

# --- Docker ---

# Start services using Docker Compose
up:
    docker-compose up -d

# Stop Docker Compose services
down:
    docker-compose down

# Show Docker Compose logs
logs:
    docker-compose logs -f

# Build the docker image
docker-build:
    docker-compose build

# --- Maintenance ---

# Clean build artifacts and node_modules
clean:
    rm -rf dist
    rm -rf node_modules
    rm -rf stub-server/node_modules

# --- Issue Tracking (Beads) ---

# Show available issues in beads
ready:
    bd ready

# Show details for an issue
show id:
    bd show {{id}}

# Claim an issue
claim id:
    bd update {{id}} --claim

# Close an issue
close id:
    bd close {{id}}

# Push all changes (rebase, bd push, git push)
push:
    git pull --rebase
    bd dolt push
    git push
    git status

# Full session completion workflow (as per AGENTS.md)
finish:
    git pull --rebase
    bd dolt push
    git push
    git status
    @echo "Session finished. Check if all issues are closed/updated."
