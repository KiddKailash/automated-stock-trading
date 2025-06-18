/**
 * @file sellPositions.js
 * @description Implements automated selling of stock positions based on holding duration and profitability.
 * This script manages the selling of stock positions according to the following rules:
 * 1. Sells unprofitable positions after a configurable number of days (default: ~1 year)
 * 2. Sells profitable positions after a configurable number of days (default: ~1 year)
 * 3. Records all sales in a SQLite database
 * 4. Sends email notifications for each sale
 * 
 * The script is designed to optimize tax benefits by holding positions for approximately one year
 * before selling, while also managing risk by selling unprofitable positions.
 * 
 * @requires dotenv - For environment variable management
 * @requires axios - For making HTTP requests to FMP API
 * @requires @alpacahq/alpaca-trade-api - For trading operations
 * @requires sqlite3 - For database operations
 * @requires nodemailer - For sending email notifications
 */

require('dotenv').config();
const axios = require('axios');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// ----------------------- Configuration ----------------------- //

// Load environment variables
const {
    FMP_API_KEY,
    ALPACA_API_KEY,
    ALPACA_API_SECRET,
    ALPACA_BASE_URL,
    SELL_UNPROFITABLE_AFTER_DAYS,
    SELL_PROFITABLE_AFTER_DAYS,
    EMAIL_FROM,
    EMAIL_PASS,
    EMAIL_TO,
    LOG_DIR
} = process.env;

// Ensure LOG_DIR exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// FMP API endpoints
const FMP_API_BASE_URL = 'https://financialmodelingprep.com/api/v3';

// Initialize Alpaca API client
const alpaca = new Alpaca({
    keyId: ALPACA_API_KEY,
    secretKey: ALPACA_API_SECRET,
    paper: ALPACA_BASE_URL.includes('paper'), // true for paper trading, false for live
    usePolygon: false // Optional: Set to true if you need Polygon data
});

// Initialize SQLite Database
const db = new sqlite3.Database(path.join(__dirname,'portfolio.db'), (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create table if not exists
db.run(`
    CREATE TABLE IF NOT EXISTS holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        acquisition_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'sold'))
    )
`, (err) => {
    if (err) {
        console.error('Error creating holdings table:', err.message);
    }
});

// Initialize Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
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
    fs.appendFileSync(path.join(LOG_DIR, 'sellPositions.log'), `[${timestamp}] ${message}\n`);
    console.log(message);
}

/**
 * Sends a styled HTML email notification about a stock sale
 * @param {string} subject - Email subject line
 * @param {string} symbol - Stock symbol
 * @param {number} quantity - Number of shares sold
 * @param {number} price - Price per share
 * @param {boolean} isProfitable - Whether the position was profitable
 */
async function sendEmail(subject, symbol, quantity, price, isProfitable) {
    const status = isProfitable ? 'Profitable' : 'Unprofitable';
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
                background-color: #d32f2f;
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
                <p>A position has been sold:</p>
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
                    <th>Status</th>
                    <td>${status}</td>
                  </tr>
                  <tr>
                    <th>Total Proceeds</th>
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
 * Fetches the acquisition date for a stock from the database
 * @param {string} symbol - Stock symbol to look up
 * @returns {Promise<Date|null>} Acquisition date or null if not found
 */
function getAcquisitionDateFromDB(symbol) {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT acquisition_date FROM holdings
            WHERE symbol = ? AND status = 'active'
            ORDER BY acquisition_date ASC
            LIMIT 1
        `, [symbol], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve(new Date(row.acquisition_date));
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Updates the status of a holding to 'sold' in the database
 * @param {string} symbol - Stock symbol to update
 * @returns {Promise<number>} Number of rows updated
 */
function updateHoldingStatus(symbol) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE holdings
            SET status = 'sold'
            WHERE symbol = ? AND status = 'active'
        `, [symbol], function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
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
 * Places a sell order for a stock and records the transaction
 * @param {string} symbol - Stock symbol to sell
 * @param {number} qty - Number of shares to sell
 * @param {number} price - Current price per share
 * @param {boolean} isProfitable - Whether the position is profitable
 */
async function placeSellOrder(symbol, qty, price, isProfitable) {
    try {
        const order = await alpaca.createOrder({
            symbol: symbol,
            qty: qty,
            side: 'sell',
            type: 'market',
            time_in_force: 'day'
        });
        logMessage(`Successfully placed sell order for ${symbol}: ${JSON.stringify(order)}`);

        // Update the holding status in the SQLite database
        const changes = await updateHoldingStatus(symbol);
        if (changes > 0) {
            logMessage(`Updated holding status for ${symbol} to 'sold' in database.`);
        } else {
            logMessage(`No active holdings found for ${symbol} to update in database.`);
        }

        // Send styled HTML email notification
        const subject = `Sold ${qty} shares of ${symbol}`;
        await sendEmail(subject, symbol, qty, price, isProfitable);

    } catch (error) {
        logMessage(`Failed to place sell order for ${symbol}: ${error.message}`);
    }
}

/**
 * Main function that manages the portfolio by selling positions based on criteria
 * The strategy follows these steps:
 * 1. Fetches all current positions from Alpaca
 * 2. For each position:
 *    - Calculates holding duration
 *    - Determines if position is profitable
 *    - Checks if position meets sell criteria based on:
 *      * Holding duration for unprofitable positions
 *      * Holding duration for profitable positions
 * 3. Places sell orders for positions that meet criteria
 * 4. Updates database records
 * 5. Sends email notifications
 */
async function managePortfolio() {
    logMessage('Starting Portfolio Management...');

    // Step 1: Fetch all current positions
    let positions;
    try {
        positions = await alpaca.getPositions();
    } catch (error) {
        logMessage(`Error fetching positions: ${error.message}`);
        return;
    }

    if (positions.length === 0) {
        logMessage('No open positions found.');
        return;
    }

    // Step 2: Iterate through each position
    for (const position of positions) {
        const symbol = position.symbol;
        const qty = parseFloat(position.qty);
        const entryPrice = parseFloat(position.avg_entry_price);
        const currentPrice = parseFloat(position.current_price);
        const isProfitable = currentPrice > entryPrice;

        // Fetch acquisition date from the database
        let acquisitionDate;
        try {
            acquisitionDate = await getAcquisitionDateFromDB(symbol);
            if (!acquisitionDate) {
                logMessage(`Acquisition date for ${symbol} not found in database. Skipping...`);
                continue;
            }
        } catch (err) {
            logMessage(`Error fetching acquisition date for ${symbol} from database: ${err.message}`);
            continue;
        }

        // Calculate holding duration in days
        const today = new Date();
        const holdingDuration = Math.floor((today - acquisitionDate) / (1000 * 60 * 60 * 24));

        // Determine if the position meets sell criteria
        let shouldSell = false;
        let reason = '';

        if (!isProfitable && holdingDuration >= parseInt(SELL_UNPROFITABLE_AFTER_DAYS)) {
            shouldSell = true;
            reason = `unprofitable after ${holdingDuration} days`;
        } else if (isProfitable && holdingDuration >= parseInt(SELL_PROFITABLE_AFTER_DAYS)) {
            shouldSell = true;
            reason = `profitable after ${holdingDuration} days`;
        }

        if (shouldSell) {
            logMessage(`Position ${symbol} (${reason}) meets sell criteria. Preparing to sell...`);
            await placeSellOrder(symbol, qty, currentPrice, isProfitable);
        } else {
            logMessage(`Position ${symbol} does not meet sell criteria (Holding Duration: ${holdingDuration} days, Profitable: ${isProfitable}).`);
        }
    }

    logMessage('Portfolio Management completed.');
}

// Execute the portfolio management
managePortfolio();

// Close the database connection gracefully on exit
process.on('SIGINT', () => {
    logMessage('Closing SQLite database connection.');
    db.close((err) => {
        if (err) {
            console.error('Error closing SQLite database:', err.message);
        }
        process.exit(0);
    });
});
