# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source files
COPY . .

# Build the app (Strava credentials can be passed as build args)
ARG VITE_STRAVA_CLIENT_ID
ARG VITE_STRAVA_CLIENT_SECRET
ENV VITE_STRAVA_CLIENT_ID=$VITE_STRAVA_CLIENT_ID
ENV VITE_STRAVA_CLIENT_SECRET=$VITE_STRAVA_CLIENT_SECRET

RUN npm run build

# Final stage
FROM node:20-slim

WORKDIR /app

# Copy only the necessary files for production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prod-server.js ./
COPY --from=builder /app/samples ./samples

# Install only production dependencies
RUN npm install --omit=dev

# Create sessions directory
RUN mkdir -p sessions/completed

EXPOSE 5173

# Default command is to run the app server
CMD ["node", "prod-server.js"]
