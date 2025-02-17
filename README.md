# Magic Formula Trader

A Node.js application implementing Joel Greenblatt’s **Magic Formula** investing strategy. This project automatically selects and buys stocks every quarter based on **earnings yield** and **return on capital**, and then periodically checks all holdings to determine if they meet certain sell conditions (e.g., unprofitable or profitable over a specific duration). The goal is to simplify and automate the Magic Formula approach—while giving you full insight into, and control over, the trading flow.

---

## Table of Contents
1. [Disclaimer](#disclaimer)  
2. [Overview](#overview)  
3. [Features](#features) 
4. [Installation](#installation)  
5. [Configuration](#configuration)  
6. [Usage](#usage)  
7. [How It Works](#how-it-works)  
8. [Project Structure](#project-structure)  
9. [Scheduling (Cron)](#scheduling-cron)  
10. [License](#license)  

---

## Disclaimer

**This project is built for personal use.** It is provided “as is” and “with all faults.”  
No liability is assumed for those who choose to download, modify, or use this software.  
Trading in financial markets involves risk, and **you** are solely responsible for any financial losses. Always conduct your own research or consult with a professional before investing.

---

## Overview

**Magic Formula Trader** automates a portion of the Magic Formula investment strategy popularized by Joel Greenblatt in his book *The Little Book That Still Beats the Market*. By tapping into the [Alpaca API](https://alpaca.markets/) for commission-free trading, it processes real-time data from [FinancialModelingPrep](https://financialmodelingprep.com/) to rank and buy top stocks. The system also manages the selling of positions daily based on profitability and holding duration thresholds.

---

## Features

- **Automated Stock Ranking & Selection**  
  Ranks NYSE stocks by *Earnings Yield* and *Return on Invested Capital* (ROIC).

- **Quarterly Rebalancing**  
  Places buy orders every quarter (e.g., Jan/Apr/Jul/Oct) to maintain a diversified portfolio aligned with Magic Formula principles.

- **Daily Portfolio Management**  
  Checks open positions daily to see if they meet the sell criteria (profitable or unprofitable holdings exceeding a user-defined holding period).

- **SQLite Database Logging**  
  Records all buys and sells in a local ```portfolio.db``` file for easy historical reference.

- **Email Notifications**  
  Sends email updates for successful or failed buys and sells, including relevant transaction details.

- **Configurable Thresholds**  
  Environment variables allow you to easily tweak the number of stocks to buy, portfolio allocation percentage, holding duration thresholds, etc.

---

## Installation

1. **Clone the repository**  
   ```bash
   git clone https://github.com/<YourUsername>/MagicFormulaTrader.git
   cd MagicFormulaTrader
   ```

2. **Install dependencies**  
   ```bash
   npm install
   ```

3. **Create a database folder (optional)**  
   If you plan to keep the default path for the SQLite database, create a ```database``` folder in the project root:
   ```bash
   mkdir database
   ```

4. **Ensure logs folder exists**  
   If you have a configured log folder (e.g., ```logs``` in your ```.env```), make sure it exists:
   ```bash
   mkdir logs
   ```

---

## Configuration

All configuration is handled via a ```.env``` file located in the project root directory. **Below is an example** of possible environment variables:

```bash
#----------------------------------------------
# Alpaca Credentials
#----------------------------------------------
ALPACA_API_KEY=YOUR_ALPACA_API_KEY
ALPACA_API_SECRET=YOUR_ALPACA_API_SECRET
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_ENV=paper
# Set ALPACA_ENV=live if using real trading

#----------------------------------------------
# Financial Modeling Prep API Key
#----------------------------------------------
FMP_API_KEY=YOUR_FMP_API_KEY

#----------------------------------------------
# Magic Formula Strategy Variables
#----------------------------------------------
NUMBER_OF_STOCKS_PER_BATCH=20
MAX_TOTAL_INVESTMENT_PERCENT=0.20
STOCK_SCREENER_MARKET_CAP=1000000000

#----------------------------------------------
# Sell Criteria (days)
#----------------------------------------------
SELL_UNPROFITABLE_AFTER_DAYS=365
SELL_PROFITABLE_AFTER_DAYS=365

#----------------------------------------------
# Email Settings
#----------------------------------------------
EMAIL_FROM=your.email@gmail.com
EMAIL_PASS=your-gmail-app-password
EMAIL_TO=recipient.email@example.com

#----------------------------------------------
# Logging
#----------------------------------------------
LOG_DIR=./logs
```

> **Note**:  
> - For Alpaca paper trading, make sure ```ALPACA_BASE_URL``` points to the Paper trading endpoint.  
> - ```EMAIL_PASS``` should be an App Password or appropriately configured for Gmail.  
> - Set ```LOG_DIR``` to control where log files are stored.

---

## Usage

1. **Buy Script (Quarterly Rebalance)**  
   The script ```buyPositions.js``` executes the Magic Formula approach to screen, rank, and purchase top stocks.  
   ```bash
   node buyPositions.js
   ```

2. **Sell Script (Daily Management)**  
   The script ```sellPositions.js``` checks each open position on Alpaca and sells them based on profitability and holding duration.  
   ```bash
   node sellPositions.js
   ```

3. **Verification**  
   - Check ```logs/buyOrders.log``` and ```logs/sellPositions.log``` for transaction details.  
   - View the local SQLite file (```database/portfolio.db```) using any SQLite viewer to confirm holdings data.

---

## How It Works

1. **Screen & Rank Stocks**  
   - Fetches large-cap NYSE stocks (above a user-defined ```STOCK_SCREENER_MARKET_CAP```).  
   - Uses the [FinancialModelingPrep API](https://financialmodelingprep.com/) to retrieve key metrics: **Return on Invested Capital (ROIC)** and **Earnings Yield**.  
   - Assigns each stock a rank for both metrics and combines them for an overall rank.

2. **Buy the Top Stocks**  
   - Slices the top ```NUMBER_OF_STOCKS_PER_BATCH``` results.  
   - Buys each stock with an allocated portion of ```MAX_TOTAL_INVESTMENT_PERCENT``` of the portfolio.  
   - Records each purchase in ```portfolio.db``` and sends an email notification.

3. **Daily Sell Check**  
   - Fetches open positions from Alpaca.  
   - Determines “profitable” vs. “unprofitable” by comparing ```current_price``` and ```avg_entry_price```.  
   - Sells if the holding duration is above either ```SELL_PROFITABLE_AFTER_DAYS``` or ```SELL_UNPROFITABLE_AFTER_DAYS```, depending on profitability status.  
   - Updates ```portfolio.db``` to mark positions as “sold” and sends an email notification.

---

## Project Structure

``` 
magic-formula-trader/
  ├─ buyPositions.js
  ├─ sellPositions.js
  ├─ .env                # Environment configs
  ├─ database/
  │   └─ portfolio.db    # SQLite DB file (created automatically)
  ├─ logs/
  │   ├─ buyOrders.log
  │   └─ sellPositions.log
  ├─ package.json
  └─ README.md
```  

> **Note**:  
> The ```database/``` and ```logs/``` directories may not exist by default. Create them if needed.

---

## Scheduling (Cron)

Below are example cron entries for a Linux environment:

1. **Buy Positions Quarterly**  
   Executes on the 1st day of January, April, July, and October at 09:00 AM:
   ```bash
   0 9 1 1,4,7,10 * /usr/bin/node /path/to/buyPositions.js >> /path/to/logs/magic-formula-trader.log 2>&1
   ```

2. **Sell Positions Daily**  
   Executes daily at 10:00 AM to check and sell if conditions are met:
   ```bash
   0 10 * * * /usr/bin/node /path/to/sellPositions.js >> /path/to/logs/manage-portfolio.log 2>&1
   ```

Adjust times and paths to fit your own preferences and server configuration.

---

## License

[MIT License](./LICENSE)

> **Disclaimer**:  
> This project is built for personal use, and is offered **as is**, without warranty of any kind. The author assumes **no liability** for any loss or damages incurred by using this software. Always trade responsibly, do your own research, and consider professional advice.

---

**Happy Trading!**
