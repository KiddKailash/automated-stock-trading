/**
 * @file buyPositions.js
 * @description Implements the Magic Formula trading strategy for automated stock buying.
 * This script handles the buying of stocks based on Joel Greenblatt's Magic Formula strategy,
 * which ranks stocks based on their return on capital and earnings yield. The script:
 * 1. Fetches NYSE stocks above a certain market cap threshold
 * 2. Calculates financial metrics for each stock
 * 3. Ranks stocks using the Magic Formula methodology
 * 4. Places buy orders for the top-ranked stocks
 * 5. Records transactions in a SQLite database
 * 6. Sends email notifications for each purchase
 * 
 * @requires dotenv - For environment variable management
 * @requires axios - For making HTTP requests to FMP API
 * @requires @alpacahq/alpaca-trade-api - For trading operations
 * @requires sqlite3 - For database operations
 * @requires nodemailer - For sending email notifications
 */

require("dotenv").config();
const axios = require("axios");
const Alpaca = require("@alpacahq/alpaca-trade-api");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

// ----------------------- Configuration ----------------------- //

// Load environment variables
const {
  FMP_API_KEY,
  ALPACA_API_KEY,
  ALPACA_API_SECRET,
  ALPACA_BASE_URL,
  NUMBER_OF_STOCKS_PER_BATCH,
  MAX_TOTAL_INVESTMENT_PERCENT,
  STOCK_SCREENER_MARKET_CAP,
  EMAIL_FROM,
  EMAIL_PASS,
  EMAIL_TO,
  LOG_DIR,
} = process.env;

// Ensure LOG_DIR exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// FMP API endpoints
const FMP_API_BASE_URL = "https://financialmodelingprep.com/api/v3";

// Initialize Alpaca API client
const alpaca = new Alpaca({
  keyId: ALPACA_API_KEY,
  secretKey: ALPACA_API_SECRET,
  paper: ALPACA_BASE_URL.includes("paper"), // true for paper trading, false for live
  usePolygon: false, // Optional: Set to true if you need Polygon data
});

// Initialize SQLite Database
const db = new sqlite3.Database(
  path.join(__dirname, "../database/portfolio.db"),
  (err) => {
    if (err) {
      console.error("Error connecting to SQLite database:", err.message);
    } else {
      console.log("Connected to SQLite database.");
    }
  }
);

// Create table if not exists
db.run(
  `
    CREATE TABLE IF NOT EXISTS holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        acquisition_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'sold'))
    )
`,
  (err) => {
    if (err) {
      console.error("Error creating holdings table:", err.message);
    }
  }
);

// Initialize Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_FROM,
    pass: EMAIL_PASS,
  },
});

/**
 * Logs a message to both console and a log file
 * @param {string} message - The message to log
 */
function logMessage(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(
    path.join(LOG_DIR, "/buyOrders.log"),
    `[${timestamp}] ${message}\n`
  );
  console.log(message);
}

/**
 * Sends a styled HTML email notification about a stock purchase
 * @param {string} subject - Email subject line
 * @param {string} symbol - Stock symbol
 * @param {number} quantity - Number of shares purchased
 * @param {number} price - Price per share
 */
async function sendEmail(subject, symbol, quantity, price) {
  const mailOptions = {
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: subject,
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>${subject}</title>
            <style>
              /* Basic MUI-like styling */
              body {
                font-family: 'Roboto', Arial, sans-serif;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
              }
              .container {
                max-width: 600px;
                margin: 40px auto;
                background-color: #ffffff;
                border-radius: 4px;
                box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                overflow: hidden;
              }
              .header {
                background-color: #1976d2;
                padding: 16px;
                color: #ffffff;
              }
              .header h1 {
                margin: 0;
                font-size: 24px;
              }
              .content {
                padding: 16px;
              }
              .content h2 {
                margin-top: 0;
                color: #333;
              }
              .report-table {
                width: 100%;
                border-collapse: collapse;
                margin: 16px 0;
              }
              .report-table th,
              .report-table td {
                text-align: left;
                padding: 12px 8px;
                border-bottom: 1px solid #e0e0e0;
              }
              .footer {
                background-color: #fafafa;
                padding: 12px 16px;
                text-align: center;
                font-size: 14px;
                color: #999999;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>${subject}</h1>
              </div>
              <div class="content">
                <h2>Hello Admin,</h2>
                <p>A new position has been purchased:</p>
                <table class="report-table">
                  <tr>
                    <th>Symbol</th>
                    <td>${symbol}</td>
                  </tr>
                  <tr>
                    <th>Quantity</th>
                    <td>${quantity}</td>
                  </tr>
                  <tr>
                    <th>Price per Share</th>
                    <td>$${price.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <th>Total Investment</th>
                    <td>$${(quantity * price).toFixed(2)}</td>
                  </tr>
                </table>
                <p>Regards,<br/>Magic Formula Trader Bot</p>
              </div>
              <div class="footer">
                &copy; ${new Date().getFullYear()} Magic Formula Trader
              </div>
            </div>
          </body>
        </html>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logMessage(`Email sent: ${subject} for ${symbol}`);
  } catch (error) {
    logMessage(`Error sending email for ${symbol}: ${error.message}`);
  }
}

/**
 * Fetches NYSE stocks with market cap above the defined threshold
 * @returns {Promise<string[]>} Array of stock symbols
 */
async function fetchNYSEStocks() {
  try {
    const response = await axios.get(`${FMP_API_BASE_URL}/stock-screener`, {
      params: {
        exchange: "NYSE",
        marketCapMoreThan: STOCK_SCREENER_MARKET_CAP,
        limit: 248,
        apikey: FMP_API_KEY,
      },
    });
    return response.data.map((stock) => stock.symbol);
  } catch (error) {
    logMessage(`Error fetching NYSE stocks: ${error.message}`);
    return [];
  }
}

/**
 * Fetches financial metrics for a list of stock symbols
 * @param {string[]} symbols - Array of stock symbols to fetch metrics for
 * @returns {Promise<Array<{symbol: string, returnOnCapital: number, earningsYield: number}>>}
 * Array of objects containing financial metrics for each stock
 */
async function fetchFinancialMetrics(symbols) {
  const metrics = [];

  // To handle API rate limits, process symbols in batches with delays if necessary
  const BATCH_SIZE = 50; // Number of concurrent requests
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (symbol) => {
      try {
        // Fetch Return on Capital
        const metricsResponse = await axios.get(
          `${FMP_API_BASE_URL}/key-metrics/${symbol}`,
          {
            params: {
              period: "quarter",
              apikey: FMP_API_KEY,
            },
          }
        );
        const companyData = metricsResponse.data[0];

        const returnOnCapital = companyData
          ? parseFloat(companyData.roic)
          : null;
        const earningsYield = companyData
          ? parseFloat(companyData.earningsYield)
          : null;

        if (returnOnCapital && earningsYield) {
          metrics.push({
            symbol,
            returnOnCapital,
            earningsYield,
          });
        }
      } catch (symbolError) {
        logMessage(`Error fetching data for ${symbol}: ${symbolError.message}`);
      }
    });

    await Promise.all(promises);

    // Optional: Add a delay between batches to respect API rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
  }

  return metrics;
}

/**
 * Computes Magic Formula rankings for a list of stocks based on their financial metrics
 * The Magic Formula combines two rankings:
 * 1. Earnings Yield (EBIT/Enterprise Value) - Higher is better
 * 2. Return on Capital (EBIT/(Net Working Capital + Net Fixed Assets)) - Higher is better
 * 
 * @param {Array<{symbol: string, returnOnCapital: number, earningsYield: number}>} metrics
 * Array of objects containing financial metrics for each stock
 * @returns {Array<{symbol: string, returnOnCapital: number, earningsYield: number, eyRank: number, rocRank: number, combinedRank: number}>}
 * Sorted array of stocks with their individual and combined rankings
 */
function computeMagicFormulaRankings(metrics) {
  // Filter out any entries with missing data
  const validMetrics = metrics.filter(
    (m) => m.returnOnCapital != null && m.earningsYield != null
  );

  // Sort by Earnings Yield (descending) and assign rank
  const sortedByEarningsYield = [...validMetrics].sort(
    (a, b) => b.earningsYield - a.earningsYield
  );
  sortedByEarningsYield.forEach((m, index) => {
    m.eyRank = index + 1;
  });

  // Sort by Return on Capital (descending) and assign rank
  const sortedByROC = [...validMetrics].sort(
    (a, b) => b.returnOnCapital - a.returnOnCapital
  );
  sortedByROC.forEach((m, index) => {
    m.rocRank = index + 1;
  });

  // Calculate combined rank
  validMetrics.forEach((m) => {
    m.combinedRank = m.eyRank + m.rocRank;
  });

  // Sort by combined rank (ascending)
  const sortedByCombinedRank = validMetrics.sort(
    (a, b) => a.combinedRank - b.combinedRank
  );
  console.log("The final sorted list is", sortedByCombinedRank);
  return sortedByCombinedRank;
}

/**
 * Fetches account information from Alpaca
 * @returns {Promise<Object|null>} Account information or null if fetch fails
 */
async function getAccountInfo() {
  try {
    const account = await alpaca.getAccount();
    return account;
  } catch (error) {
    logMessage(`Error fetching Alpaca account info: ${error.message}`);
    return null;
  }
}

/**
 * Places a buy order for a stock and records the transaction
 * @param {string} symbol - Stock symbol to buy
 * @param {number} qty - Number of shares to buy
 * @param {number} price - Current price per share
 */
async function placeBuyOrder(symbol, qty, price) {
  try {
    const order = await alpaca.createOrder({
      symbol: symbol,
      qty: qty,
      side: "buy",
      type: "market",
      time_in_force: "day",
    });
    logMessage(
      `Successfully placed buy order for ${symbol}: ${JSON.stringify(order)}`
    );

    // Record the purchase in the SQLite database
    const acquisitionDate = new Date().toISOString();
    db.run(
      `
            INSERT INTO holdings (symbol, quantity, acquisition_date, status)
            VALUES (?, ?, ?, 'active')
        `,
      [symbol, qty, acquisitionDate],
      function (err) {
        if (err) {
          logMessage(
            `Error recording purchase of ${symbol} in database: ${err.message}`
          );
        } else {
          logMessage(
            `Recorded purchase of ${qty} shares of ${symbol} on ${acquisitionDate}`
          );
        }
      }
    );

    // Send styled HTML email notification
    const subject = `Bought ${qty} shares of ${symbol}`;
    await sendEmail(subject, symbol, qty, price);
  } catch (error) {
    logMessage(`Failed to place buy order for ${symbol}: ${error.message}`);
  }
}

/**
 * Main function that executes the Magic Formula trading strategy
 * The strategy follows these steps:
 * 1. Fetches NYSE stocks above market cap threshold
 * 2. Calculates financial metrics for each stock
 * 3. Ranks stocks using Magic Formula methodology
 * 4. Selects top-ranked stocks based on configuration
 * 5. Calculates position sizes based on portfolio value
 * 6. Places buy orders for selected stocks
 */
async function executeMagicFormulaStrategy() {
  logMessage("Starting Magic Formula Strategy...");

  // Step 1: Fetch NYSE stocks with market cap > defined threshold
  logMessage(
    `Fetching NYSE stocks with market cap > $${(
      STOCK_SCREENER_MARKET_CAP / 1e6
    ).toFixed(2)}M...`
  );
  const symbols = await fetchNYSEStocks();
  logMessage(`Fetched ${symbols.length} symbols.`);

  if (symbols.length === 0) {
    logMessage("No symbols to process. Exiting.");
    return;
  }

  // Step 2: Fetch financial metrics
  logMessage("Fetching financial metrics for each symbol...");
  const metrics = await fetchFinancialMetrics(symbols);
  logMessage(`Fetched financial metrics for ${metrics.length} symbols.`);

  if (metrics.length === 0) {
    logMessage("No financial metrics available. Exiting.");
    return;
  }

  // Step 3: Compute Magic Formula rankings
  logMessage("Computing Magic Formula rankings...");
  const rankedMetrics = computeMagicFormulaRankings(metrics);
  logMessage("Rankings computed.");

  // Step 4: Select top stocks
  const topStocks = rankedMetrics.slice(
    0,
    parseInt(NUMBER_OF_STOCKS_PER_BATCH)
  );
  logMessage(
    `Top ${NUMBER_OF_STOCKS_PER_BATCH} Stocks: ${topStocks
      .map((m) => m.symbol)
      .join(", ")}`
  );

  // Step 5: Fetch Alpaca account info
  logMessage("Fetching Alpaca account information...");
  const account = await getAccountInfo();

  if (!account) {
    logMessage("Unable to retrieve account information. Exiting.");
    return;
  }

  const portfolioValue = parseFloat(account.portfolio_value);
  const availableCash = parseFloat(account.cash); // Available cash for buying
  const maxTotalInvestment =
    portfolioValue * parseFloat(MAX_TOTAL_INVESTMENT_PERCENT);
  const investmentPerStock =
    maxTotalInvestment / parseInt(NUMBER_OF_STOCKS_PER_BATCH);

  logMessage(`Portfolio Value: $${portfolioValue.toFixed(2)}`);
  logMessage(`Available Cash: $${availableCash.toFixed(2)}`);
  logMessage(
    `Max Total Investment (${(MAX_TOTAL_INVESTMENT_PERCENT * 100).toFixed(
      2
    )}%): $${maxTotalInvestment.toFixed(2)}`
  );
  logMessage(
    `Investment per Stock (${(
      (MAX_TOTAL_INVESTMENT_PERCENT * 100) /
      NUMBER_OF_STOCKS_PER_BATCH
    ).toFixed(2)}%): $${investmentPerStock.toFixed(2)}`
  );

  // Step 6: Adjust investment based on available cash to prevent overspending
  const actualInvestmentPerStock =
    availableCash / parseInt(NUMBER_OF_STOCKS_PER_BATCH);
  if (actualInvestmentPerStock < investmentPerStock) {
    logMessage(
      `Adjusted Investment per Stock based on available cash: $${actualInvestmentPerStock.toFixed(
        2
      )}`
    );
  } else {
    logMessage(
      `Using defined Investment per Stock: $${investmentPerStock.toFixed(2)}`
    );
  }

  // Step 7: Calculate number of shares to buy for each stock
  for (const stock of topStocks) {
    try {
      // Fetch current price
      const quoteResponse = await axios.get(
        `${FMP_API_BASE_URL}/quote/${stock.symbol}`,
        {
          params: { apikey: FMP_API_KEY },
        }
      );

      const currentPrice = parseFloat(quoteResponse.data[0].price);
      if (isNaN(currentPrice) || currentPrice <= 0) {
        logMessage(`Invalid price for ${stock.symbol}. Skipping...`);
        continue;
      }

      // Calculate number of shares to buy based on actualInvestmentPerStock
      const investmentAmount = Math.min(
        investmentPerStock,
        actualInvestmentPerStock
      );
      const qty = Math.floor(investmentAmount / currentPrice);
      if (qty <= 0) {
        logMessage(
          `Calculated quantity for ${stock.symbol} is less than or equal to zero. Skipping...`
        );
        continue;
      }

      logMessage(
        `Placing order for ${qty} shares of ${
          stock.symbol
        } at $${currentPrice.toFixed(2)} each.`
      );

      // Place buy order
      await placeBuyOrder(stock.symbol, qty, currentPrice);
    } catch (stockError) {
      logMessage(`Error processing ${stock.symbol}: ${stockError.message}`);
    }
  }

  logMessage("Magic Formula Strategy execution completed.");
}

// Execute the strategy
executeMagicFormulaStrategy();

// Close the database connection gracefully on exit
process.on("SIGINT", () => {
  logMessage("Closing SQLite database connection.");
  db.close((err) => {
    if (err) {
      console.error("Error closing SQLite database:", err.message);
    }
    process.exit(0);
  });
});
