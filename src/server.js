const Alpaca = require('@alpacahq/alpaca-trade-api');
const express = require('express');
require('dotenv').config(); // Load .env variables

// Create an Express application
const app = express();
const PORT = 3000;

// Alpaca API configuration
const alpaca = new Alpaca({
  keyId: process.env.ALPCA_SANDBOX_TRADING_PUBLIC_KEY, 
  secretKey: process.env.ALPCA_SANDBOX_TRADING_SECRET_KEY, 
  baseUrl: process.env.ALPCA_SANDBOX_TRADING_ENDPOINT, 
});

// Function to place an after-market buy order
const buyMetaSharesAfterMarket = async () => {
  try {
    const order = await alpaca.createOrder({
      symbol: 'META',
      qty: 10,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',    // or 'gtc'
      extended_hours: true,    // ensures it's eligible for after-hours
    });
    console.log('After-market order placed:', order);
    return { success: true, order };
  } catch (error) {
    console.error('Error placing after-market order:', error);
    return { success: false, error };
  }
};

// Endpoint to trigger the regular buy order
app.get('/buy-meta', async (req, res) => {
  const result = await buyMetaShares();
  if (result.success) {
    res.status(200).send({ message: 'Order placed successfully.', order: result.order });
  } else {
    res.status(500).send({ message: 'Failed to place order.', error: result.error });
  }
});

// Endpoint to trigger the after-market buy order
app.get('/buy-meta-aftermarket', async (req, res) => {
  const result = await buyMetaSharesAfterMarket();
  if (result.success) {
    res.status(200).send({ message: 'After-market order placed successfully.', order: result.order });
  } else {
    res.status(500).send({ message: 'Failed to place after-market order.', error: result.error });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


/**
 * magicFormulaBot.js
 *
 * A skeleton Node.js script that:
 *  1) Fetches relevant stock data.
 *  2) Calculates Magic Formula metrics (Earnings Yield & Return on Capital).
 *  3) Ranks stocks and selects a portfolio.
 *  4) Schedules trades to buy, and then sell just before & after 1 year for tax optimization.
 *  5) Logs important events to a text file.
 *
 * Dependencies (example):
 *  - node-cron (for scheduling)
 *  - axios or node-fetch (for API calls, if needed)
 *  - fs (for reading/writing logs and position tracking)
 */

//////////////////////////////
// 1. IMPORT DEPENDENCIES  //
//////////////////////////////

const cron = require('node-cron');
const fs = require('fs');
// const axios = require('axios'); // or use node-fetch

//////////////////////////////
// 2. CONFIG / CONSTANTS    //
//////////////////////////////

// Example: you might set your watchlist or define minMarketCap, etc.
const SETTINGS = {
  MIN_MARKET_CAP: 100e6,  // $100 million
  PORTFOLIO_SIZE: 30,     // Choose top 30 ranked stocks
  LOG_FILE: 'magic_formula_log.txt',
  POSITIONS_FILE: 'positions.json', // Track your current holdings and buy dates
  // Cron schedules (crontab format): https://crontab.guru/
  FETCH_CRON: '0 10 * * 1-5',  // Every weekday at 10:00 (example)
  REBALANCE_CRON: '0 11 * * 1', // Every Monday at 11:00 (example)
};

////////////////////////////////////////
// 3. UTILITY FUNCTIONS (STUB EXAMPLES)
////////////////////////////////////////

/**
 * logMessage: Logs a string to console and to a text file.
 */
function logMessage(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  
  // Log to console
  console.log(logLine.trim());

  // Append to text file
  fs.appendFileSync(SETTINGS.LOG_FILE, logLine, 'utf8');
}

/**
 * fetchStockData: Stub for fetching stock data (e.g., from an API or a local DB).
 * Returns an array of stock objects with at least: { ticker, marketCap, ebit, netFixedAssets, netWorkingCapital, enterpriseValue }.
 */
async function fetchStockData() {
  // Example placeholder
  logMessage('Fetching stock data...');
  // In reality, this might be an API call, or read from a local DB/file, etc.
  // Return an array of stock info
  return [
    {
      ticker: 'AAPL',
      marketCap: 2300e9,
      ebit: 100e9,
      enterpriseValue: 2400e9,
      netWorkingCapital: 50e9,
      netFixedAssets: 100e9,
    },
    {
      ticker: 'MSFT',
      marketCap: 2000e9,
      ebit: 80e9,
      enterpriseValue: 2100e9,
      netWorkingCapital: 40e9,
      netFixedAssets: 80e9,
    },
    // ... etc.
  ];
}

/**
 * calculateMetrics: Given a stock object, compute Earnings Yield (EY) and Return on Capital (ROC).
 * Returns an updated object with the computed values.
 */
function calculateMetrics(stock) {
  // Earnings Yield (EY) = EBIT / Enterprise Value
  const earningsYield = stock.ebit / stock.enterpriseValue;

  // Return on Capital (ROC) = EBIT / (Net Working Capital + Net Fixed Assets)
  const capital = stock.netWorkingCapital + stock.netFixedAssets;
  const returnOnCapital = capital ? (stock.ebit / capital) : 0;

  return {
    ...stock,
    earningsYield,
    returnOnCapital,
  };
}

/**
 * rankStocks: Sort stocks by their combined rank of EY and ROC.
 *  1) Sort by EY (descending)
 *  2) Sort by ROC (descending)
 *  3) Combine ranks
 */
function rankStocks(stocks) {
  // 1. Sort by EY descending
  const byEY = [...stocks].sort((a, b) => b.earningsYield - a.earningsYield);
  byEY.forEach((s, idx) => { s.eyRank = idx + 1; });

  // 2. Sort by ROC descending
  const byROC = [...stocks].sort((a, b) => b.returnOnCapital - a.returnOnCapital);
  byROC.forEach((s, idx) => { s.rocRank = idx + 1; });

  // 3. Combine ranks & sort by sum
  // Merge the eyRank and rocRank back into original array
  // An easy way is to just keep them in the same references, so each object has eyRank and rocRank set
  return [...stocks].sort((a, b) => (a.eyRank + a.rocRank) - (b.eyRank + b.rocRank));
}

/**
 * buildPortfolio: Select the top N stocks (from the ranked list) that meet any additional criteria (e.g., min market cap).
 */
function buildPortfolio(rankedStocks) {
  const filtered = rankedStocks.filter(stock => stock.marketCap >= SETTINGS.MIN_MARKET_CAP);
  return filtered.slice(0, SETTINGS.PORTFOLIO_SIZE);
}

/**
 * loadPositions: Reads current positions from a JSON file.
 */
function loadPositions() {
  if (!fs.existsSync(SETTINGS.POSITIONS_FILE)) {
    return [];
  }
  const data = fs.readFileSync(SETTINGS.POSITIONS_FILE, 'utf8');
  return JSON.parse(data);
}

/**
 * savePositions: Saves updated positions to a JSON file.
 */
function savePositions(positions) {
  fs.writeFileSync(SETTINGS.POSITIONS_FILE, JSON.stringify(positions, null, 2), 'utf8');
}

/**
 * placeBuyOrder: Stub function to simulate or interact with a broker API to buy a stock.
 */
async function placeBuyOrder(stock) {
  // e.g., call broker API or paper trade simulation
  logMessage(`Placing BUY order for ${stock.ticker}`);
}

/**
 * placeSellOrder: Stub function to simulate or interact with a broker API to sell a stock.
 */
async function placeSellOrder(stock) {
  logMessage(`Placing SELL order for ${stock.ticker}`);
}

/////////////////////////////////////////////
// 4. MAIN WORKFLOW (BUY & REBALANCE LOGIC)
/////////////////////////////////////////////

/**
 * performMagicFormulaRebalance:
 *  1) Fetch and compute metrics for all stocks.
 *  2) Rank and pick the top X.
 *  3) Compare to current positions.
 *  4) Place buy orders for newly selected stocks (not already held).
 *  5) Potentially sell positions that are no longer in the top X (up to you).
 *  6) Log events.
 */
async function performMagicFormulaRebalance() {
  try {
    logMessage('=== Starting Magic Formula Rebalance ===');

    // 1) Fetch & compute metrics
    const rawData = await fetchStockData();
    const withMetrics = rawData.map(calculateMetrics);

    // 2) Rank
    const ranked = rankStocks(withMetrics);

    // 3) Build portfolio
    const targetPortfolio = buildPortfolio(ranked);

    // 4) Load current positions
    let currentPositions = loadPositions();

    // 5) Determine buys (stocks in targetPortfolio but not in currentPositions)
    const currentTickers = currentPositions.map(pos => pos.ticker);
    const buyCandidates = targetPortfolio.filter(s => !currentTickers.includes(s.ticker));

    // 6) Place buy orders and update positions
    for (const stock of buyCandidates) {
      await placeBuyOrder(stock);
      currentPositions.push({
        ticker: stock.ticker,
        buyDate: new Date().toISOString(),
        // Store any other relevant info (like buy price, etc.)
      });
    }

    // OPTIONAL: Determine sells (stocks in currentPositions but not in targetPortfolio)
    // Depending on whether you want a strict top-X approach or to hold for 1 year, etc.
    // For the Magic Formula, typically you hold for a year. 
    // You might handle that logic separately in a "sell check" job (see below).

    // Save updated positions
    savePositions(currentPositions);

    logMessage('=== Magic Formula Rebalance Complete ===');
  } catch (error) {
    logMessage(`Error in performMagicFormulaRebalance: ${error.message}`);
  }
}

////////////////////////////////////////////////////
// 5. SCHEDULING SELL LOGIC (JUST BEFORE/AFTER 1YR)
////////////////////////////////////////////////////

/**
 * checkPositionsForSell:
 *  - Iterate over positions, check if they've been held for ~1 year.
 *  - If yes, place a SELL order just before 1yr for tax optimization, and possibly another one just after.
 *    (Implementation details depend on your local tax rules & strategy.)
 */
async function checkPositionsForSell() {
  try {
    logMessage('=== Checking positions for potential sells ===');
    let currentPositions = loadPositions();

    const now = new Date();

    // This is just an illustrative approach:
    //   - SellPart1Date = (365 - X) days after buyDate
    //   - SellPart2Date = (365 + X) days after buyDate
    // Adjust X for how many days before/after the 1 year threshold you want to sell.
    const DAYS_BEFORE_1_YEAR = 1;  // e.g., 1 day before 1 year
    const DAYS_AFTER_1_YEAR = 1;   // e.g., 1 day after 1 year

    // Helper to compare date difference
    function daysBetween(d1, d2) {
      return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    // Filter or map to find positions that need to be sold
    for (const position of currentPositions) {
      const buyDate = new Date(position.buyDate);
      const holdingDays = daysBetween(buyDate, now);

      // Example logic:
      // if (holdingDays >= (365 - DAYS_BEFORE_1_YEAR) && !position.preYearSellDone) {
      //   await placeSellOrder(position);
      //   position.preYearSellDone = true; // Mark that we've sold part or fully
      // }

      // if (holdingDays >= (365 + DAYS_AFTER_1_YEAR) && !position.postYearSellDone) {
      //   await placeSellOrder(position);
      //   position.postYearSellDone = true;
      // }

      // Or some variation that matches your actual strategy
    }

    // Save updated positions
    savePositions(currentPositions);
    logMessage('=== Finished checking positions for sells ===');
  } catch (error) {
    logMessage(`Error in checkPositionsForSell: ${error.message}`);
  }
}

///////////////////////////////////////////
// 6. CRON JOBS TO AUTOMATE THE WORKFLOW //
///////////////////////////////////////////

// 6a. Fetch and rebalance (e.g., once per week or once per month)
cron.schedule(SETTINGS.REBALANCE_CRON, async () => {
  // Example: run every Monday at 11:00 (see SETTINGS for the exact pattern)
  await performMagicFormulaRebalance();
});

// 6b. Check if any positions need to be sold for the 1yr logic (daily or weekly)
cron.schedule(SETTINGS.FETCH_CRON, async () => {
  // Example: run every weekday at 10:00
  await checkPositionsForSell();
});

/**
 * Start script
 */
(async function main() {
  logMessage('Starting Magic Formula Bot...');
  // Optionally perform an immediate rebalance check on startup
  // await performMagicFormulaRebalance();

  // The cron jobs are now scheduled and will run in the background
  logMessage('Magic Formula Bot is running (cron jobs scheduled).');
})();
