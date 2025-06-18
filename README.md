# Magic Formula Trader

An application that implements and automatically executed Joel Greenblatt's Magic Formula stock investing strategy. This system operates entirely via scheduled automation with a monitoring dashboard for oversight.

## Features

- **Fully Automated Trading**: Quarterly buying and daily selling based on Magic Formula strategy
- **Monitoring Dashboard**: Real-time portfolio monitoring and system health
- **RESTful API**: Complete API for portfolio data and system monitoring
- **Docker Support**: Easy deployment with Docker and Docker Compose
- **Email Notifications**: Automated trade notifications via Gmail
- **Cron Job Scheduling**: Built-in scheduling for automated operations
- **SQLite Database**: Local data storage for holdings and transactions
- **Security-First**: No manual trading capabilities for maximum consistency and security

## Architecture

**Magic Formula Trader** uses:
- [Express.js](https://expressjs.com/) for the web server and API
- [Alpaca](https://alpaca.markets/) for trade execution
- [FinancialModelingPrep](https://financialmodelingprep.com/) for financial metrics and screening
- [SQLite](https://sqlite.org/) for local holdings and transaction data
- [Nodemailer](https://nodemailer.com/) (Gmail) for transaction notifications
- [Node-cron](https://github.com/node-cron/node-cron) for automated scheduling
- [Docker](https://docker.com/) for containerization

The strategy selects stocks ranked by:
- **High earnings yield** (EBIT/Enterprise Value)
- **High return on invested capital (ROIC)** (EBIT/(Net Working Capital + Net Fixed Assets))

## Trading Strategy Flow

1. **src/scripts/buyPositions.js** (Quarterly - 1st day of Jan, Apr, Jul, Oct)
   - Fetches NYSE stocks above specified market cap threshold
   - Retrieves financial metrics (`earningsYield`, `roic`) from FMP API
   - Ranks stocks using Magic Formula methodology
   - Buys top-ranked stocks based on configuration
   - Records transactions in SQLite database
   - Sends email notifications

2. **src/scripts/sellPositions.js** (Daily - Weekdays at 10 AM)
   - Checks open positions from Alpaca
   - Sells positions meeting criteria:
     - **Unprofitable** positions after 364 days (tax-loss harvesting)
     - **Profitable** positions after 366 days (long-term capital gains)
   - Updates database records
   - Sends email notifications

3. **src/server.js** (Always Running)
   - Provides web dashboard and API endpoints
   - Manages cron job scheduling
   - Handles manual trading triggers
   - Serves real-time portfolio data

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- Docker (optional, for containerized deployment)
- Alpaca trading account
- Financial Modeling Prep API key

### Quick Start

1. **Clone and Setup**
   ```bash
   git clone https://github.com/KiddKailash/automated-stock-trading
   cd automated-stock-trading
   chmod +x config/*.sh
   ```

2. **Build and Configure**
   ```bash
   ./config/build.sh
   ```
   This will:
   - Install dependencies
   - Create necessary directories
   - Copy environment template to `.env`

3. **Configure Environment**
   ```bash
   # Edit .env file with your API keys
   cp env-template.txt .env
   # Update .env with your actual values
   ```

4. **Start the Application**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode  
   npm start
   ```

5. **Access Dashboard**
   Open http://localhost:3000 in your browser

### Docker Deployment

1. **Build Docker Image**
   ```bash
   ./config/docker-build.sh
   ```

2. **Run with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Or run directly**
   ```bash
   docker run -p 3000:3000 --env-file .env magic-formula-trader
   ```

## 📡 API Endpoints

### Dashboard & Health
- `GET /` - Monitoring dashboard
- `GET /health` - System health check

### Portfolio Data
- `GET /api/holdings` - Get all portfolio holdings
- `GET /api/transactions` - Get transaction history
- `GET /api/stats` - Portfolio statistics

### System Monitoring
- `GET /api/cron/status` - Automated job status
- `GET /api/logs/:logFile` - View system logs

**⚠️ Note:** This system operates fully automatically via scheduled cron jobs. All trades are executed automatically.

## 📅 Scheduled Operations

The system runs automated operations using cron jobs:

- **Buying**: 1st day of Jan, Apr, Jul, Oct at 9:00 AM EST
- **Selling**: Daily at 10:00 AM EST (weekdays only)  
- **Health Check**: Every hour

Schedules can be customized in `src/server.js` or disabled by setting `NODE_ENV=development`.

## 📝 Available Commands

### NPM Scripts
- `npm start` - Start in production mode (enables automated trading)
- `npm run dev` - Start in development mode (monitoring only)
- `npm run build` - Prepare for deployment
- `npm run logs` - Tail server logs
- `npm run docker:build` - Build Docker image
- `npm run docker:run` - Run Docker container

### Build Scripts
- `./config/build.sh` - Setup and build project
- `./config/start.sh` - Start with environment selection
- `./config/docker-build.sh` - Build Docker image with custom options

**Note:** Manual trading scripts have been removed. All trading operations are handled automatically by the system's cron jobs when running in production mode.

## 📂 Project Structure

```
Automated-Trading/
├── src/                   # Source code directory
│   ├── server.js          # Main Express server
│   └── scripts/           # Trading scripts
│       ├── buyPositions.js    # Quarterly buying logic
│       └── sellPositions.js   # Daily selling logic
├── config/                # Build and deployment scripts
│   ├── build.sh           # Build script
│   ├── start.sh           # Start script
│   └── docker-build.sh    # Docker build script
├── database/              # SQLite database files
├── logs/                  # Application logs
├── cron/
│   └── cron-jobs          # Cron job definitions
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose setup
├── .dockerignore          # Docker ignore file
├── env-template.txt       # Environment template
├── package.json           # NPM dependencies and scripts
└── README.md             # This file
```

## 🔒 Security Notes

- Use paper trading (`ALPACA_BASE_URL=https://paper-api.alpaca.markets`) for testing
- Store API keys securely in `.env` file (never commit to version control)
- Use Gmail App Passwords for email authentication
- Run with non-root user in production (handled by Docker)
- Regular backup of SQLite database recommended

## 🐛 Troubleshooting

## ⚠️ Disclaimer

This software is for educational purposes. Trading involves risk of financial loss. Always:
- Test with paper trading first
- Understand the Magic Formula strategy
- Monitor positions regularly
- Comply with tax and regulatory requirements
- Never invest more than you can afford to lose
