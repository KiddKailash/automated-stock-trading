# 🎯 Magic Formula Trader

A complete Node.js application that implements Joel Greenblatt's Magic Formula investing strategy with automated trading, web dashboard, and Docker deployment support.

## 🚀 Features

- **Automated Trading**: Quarterly buying and daily selling based on Magic Formula strategy
- **Web Dashboard**: Real-time monitoring and manual controls
- **RESTful API**: Complete API for portfolio management
- **Docker Support**: Easy deployment with Docker and Docker Compose
- **Email Notifications**: Automated trade notifications via Gmail
- **Cron Job Scheduling**: Built-in scheduling for automated operations
- **SQLite Database**: Local data storage for holdings and transactions
- **Health Monitoring**: System health checks and logging

## 🏗️ Architecture

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

## 📊 Trading Strategy Flow

1. **buyPositions.js** (Quarterly - 1st day of Jan, Apr, Jul, Oct)
   - Fetches NYSE stocks above specified market cap threshold
   - Retrieves financial metrics (`earningsYield`, `roic`) from FMP API
   - Ranks stocks using Magic Formula methodology
   - Buys top-ranked stocks based on configuration
   - Records transactions in SQLite database
   - Sends email notifications

2. **sellPositions.js** (Daily - Weekdays at 10 AM)
   - Checks open positions from Alpaca
   - Sells positions meeting criteria:
     - **Unprofitable** positions after X days (tax-loss harvesting)
     - **Profitable** positions after Y days (long-term capital gains)
   - Updates database records
   - Sends email notifications

3. **server.js** (Always Running)
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
   git clone <repository-url>
   cd Automated-Trading
   chmod +x scripts/*.sh
   ```

2. **Build and Configure**
   ```bash
   ./scripts/build.sh
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
   ./scripts/start.sh development
   
   # Production mode  
   ./scripts/start.sh production
   ```

5. **Access Dashboard**
   Open http://localhost:3000 in your browser

### Docker Deployment

1. **Build Docker Image**
   ```bash
   ./scripts/docker-build.sh
   ```

2. **Run with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Or run directly**
   ```bash
   docker run -p 3000:3000 --env-file .env magic-formula-trader
   ```

## 🔧 Configuration

Key environment variables in `.env`:

```bash
NODE_ENV=development
PORT=3000

LOG_DIR=./logs
DATABASE_DIR=./database

# ===== ALPACA TRADING API =====
# Get these from your Alpaca account: https://alpaca.markets/
ALPACA_API_KEY=your_alpaca_api_key_here
ALPACA_API_SECRET=your_alpaca_secret_key_here
# Use paper trading URL for testing: https://paper-api.alpaca.markets
# Use live trading URL for production: https://api.alpaca.markets
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# ===== FINANCIAL MODELING PREP API =====
# Get your API key from: https://financialmodelingprep.com/
FMP_API_KEY=your_fmp_api_key_here

# ===== TRADING STRATEGY PARAMETERS =====
# Number of stocks to buy in each batch (quarterly)
NUMBER_OF_STOCKS_PER_BATCH=20

# Maximum percentage of portfolio to invest in new positions
MAX_TOTAL_INVESTMENT_PERCENT=0.1

# Minimum market cap for stock screening (in dollars)
# Example: 1000000000 = $1 billion market cap minimum
STOCK_SCREENER_MARKET_CAP=1000000000

# ===== POSITION MANAGEMENT =====
# Number of days to hold unprofitable positions before selling (tax loss harvesting)
SELL_UNPROFITABLE_AFTER_DAYS=364

# Number of days to hold profitable positions before selling (long-term capital gains)
SELL_PROFITABLE_AFTER_DAYS=366

# ===== EMAIL NOTIFICATIONS =====
EMAIL_FROM=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_TO=recipient@example.com

# ===== OPTIONAL ADVANCED SETTINGS =====
LOG_LEVEL=info
TIMEZONE=America/New_York

# ===== DEVELOPMENT SETTINGS =====
# Set to true to enable detailed logging in development
DEBUG=false

# ===== SECURITY SETTINGS =====
# API rate limiting (requests per minute)
RATE_LIMIT=100

# Session secret for web dashboard (generate a random string)
SESSION_SECRET=your_random_session_secret_here 
```

## 📡 API Endpoints

### Dashboard & Health
- `GET /` - Web dashboard
- `GET /health` - System health check

### Portfolio Management
- `GET /api/holdings` - Get all portfolio holdings
- `GET /api/transactions` - Get transaction history
- `GET /api/stats` - Portfolio statistics

### Manual Controls
- `POST /api/manual/buy` - Trigger manual buy process
- `POST /api/manual/sell` - Trigger manual sell process

### System Management
- `GET /api/cron/status` - Cron job status
- `GET /api/logs/:logFile` - View system logs

## 📅 Scheduled Operations

The system runs automated operations using cron jobs:

- **Buying**: 1st day of Jan, Apr, Jul, Oct at 9:00 AM EST
- **Selling**: Daily at 10:00 AM EST (weekdays only)  
- **Health Check**: Every hour

Schedules can be customized in `server.js` or disabled by setting `NODE_ENV=development`.

## 📝 NPM Scripts

- `npm start` - Start in production mode
- `npm run dev` - Start in development mode  
- `npm run build` - Prepare for deployment
- `npm run buy` - Manual buy positions
- `npm run sell` - Manual sell positions
- `npm run logs` - Tail server logs
- `npm run docker:build` - Build Docker image
- `npm run docker:run` - Run Docker container

## 📂 Project Structure

```
Automated-Trading/
├── server.js              # Main Express server
├── scripts/
│   ├── buyPositions.js     # Quarterly buying logic
│   ├── sellPositions.js    # Daily selling logic
│   ├── build.sh           # Build script
│   ├── start.sh           # Start script
│   └── docker-build.sh    # Docker build script
├── database/              # SQLite database files
├── logs/                  # Application logs
├── cron/
│   └── cron-jobs          # Cron job definitions
├── config/                # Configuration files
├── Dockerfile             # Docker configuration
├── docker-compose.yml     # Docker Compose setup
├── env-template.txt       # Environment template
└── README.md             # This file
```

## 🔒 Security Notes

- Use paper trading (`ALPACA_BASE_URL=https://paper-api.alpaca.markets`) for testing
- Store API keys securely in `.env` file (never commit to version control)
- Use Gmail App Passwords for email authentication
- Run with non-root user in production (handled by Docker)
- Regular backup of SQLite database recommended

## 🐛 Troubleshooting

### Common Issues

1. **Application won't start**
   - Check `.env` file exists and has valid values
   - Ensure all dependencies installed: `npm install`
   - Check logs: `npm run logs`

2. **Trading operations fail**
   - Verify Alpaca API keys are correct
   - Check account has sufficient buying power
   - Ensure market is open for trading

3. **Email notifications not working**
   - Use Gmail App Password (not regular password)
   - Enable 2-factor authentication on Gmail
   - Check EMAIL_FROM and EMAIL_TO addresses

4. **Docker issues**
   - Ensure Docker is running
   - Check port 3000 is available
   - Verify `.env` file exists for docker-compose

### Logs
- Server logs: `logs/server.log`
- Buy operations: `logs/buyOrders.log`
- Sell operations: `logs/sellPositions.log`
- Cron errors: `logs/cron-errors.log`

## 📈 Monitoring & Maintenance

- Monitor system health via `/health` endpoint
- Review logs regularly for errors
- Backup SQLite database periodically
- Monitor trading performance via dashboard

## ⚠️ Disclaimer

This software is for educational purposes. Trading involves risk of financial loss. Always:
- Test with paper trading first
- Understand the Magic Formula strategy
- Monitor positions regularly
- Comply with tax and regulatory requirements
- Never invest more than you can afford to lose
