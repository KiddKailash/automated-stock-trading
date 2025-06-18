# Use the official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Create necessary directories
RUN mkdir -p logs database

# Create a non-root user to run the application
RUN addgroup -g 1001 -S nodejs
RUN adduser -S trading -u 1001

# Change ownership of the app directory to the nodejs user
RUN chown -R trading:nodejs /app

# Switch to the non-root user
USER trading

# Expose the port the app runs on
EXPOSE 3000

# Define environment variables
ENV NODE_ENV=prod
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application from src directory
CMD ["npm", "start"] 