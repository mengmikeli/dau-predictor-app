# Use Node.js 18 LTS
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy root package.json
COPY package*.json ./

# Copy frontend and backend directories
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build the application
RUN npm run build

# Expose port
EXPOSE 8000

# Start the application
CMD ["npm", "start"]