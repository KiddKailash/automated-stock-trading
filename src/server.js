/**
 * @file server.js
 * @description Main server file for the Magic Formula Automated Trading System.
 * This Express server provides:
 * 1. RESTful API endpoints for manual trading operations
 * 2. Cron job scheduling for automated buying and selling
 * 3. Health check endpoints
 * 4. Portfolio monitoring dashboard
 * 5. Database management utilities
 *
 * @requires express - Web framework for Node.js
 * @requires dotenv - Environment variable management
 * @requires node-cron - Task scheduling
 * @requires sqlite3 - Database operations
 * @requires path - File path utilities
 * @requires fs - File system operations
 */

require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Environment variables
const {
  LOG_DIR = "./logs",
  DATABASE_DIR = "./database",
  NODE_ENV,
} = process.env;

// Ensure directories exist
[LOG_DIR, DATABASE_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize SQLite Database
const dbPath = path.join(DATABASE_DIR, "portfolio.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error connecting to SQLite database:", err.message);
    process.exit(1);
  } else {
    console.log("Connected to SQLite database at:", dbPath);
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            acquisition_date TEXT NOT NULL,
            acquisition_price REAL,
            status TEXT NOT NULL CHECK(status IN ('active', 'sold')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

  db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            action TEXT NOT NULL CHECK(action IN ('buy', 'sell')),
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            total_amount REAL NOT NULL,
            transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )
    `);

  db.run(`
        CREATE TABLE IF NOT EXISTS cron_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_name TEXT NOT NULL,
            schedule TEXT NOT NULL,
            script_path TEXT NOT NULL,
            last_run DATETIME,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

/**
 * Utility function to log messages with timestamps
 */
function logMessage(message, logFile = "server.log") {
  const timestamp = new Date().toISOString();
  const logPath = path.join(LOG_DIR, logFile);
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  console.log(`[${timestamp}] ${message}`);
}

/**
 * Execute a script and return a promise
 */
function executeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const command = `node ${scriptPath} ${args.join(" ")}`;
    logMessage(`Executing: ${command}`);

    // Use parent directory as cwd since server.js is now in src/
    const rootDir = path.join(__dirname, "..");
    exec(command, { cwd: rootDir }, (error, stdout, stderr) => {
      if (error) {
        logMessage(
          `Script execution error: ${error.message}`,
          "cron-errors.log"
        );
        reject(error);
      } else {
        logMessage(`Script completed successfully: ${scriptPath}`);
        if (stdout) logMessage(`STDOUT: ${stdout.trim()}`);
        if (stderr) logMessage(`STDERR: ${stderr.trim()}`);
        resolve({ stdout, stderr });
      }
    });
  });
}

// ===================== CRON JOB SCHEDULING =====================

// Buy positions: First day of Jan, Apr, Jul, Oct at 9:00 AM
const buyPositionsCron = cron.schedule(
  "0 9 1 1,4,7,10 *",
  async () => {
    logMessage("Starting scheduled buy positions job...");
    try {
      await executeScript("./src/scripts/buyPositions.js");
      logMessage("Buy positions job completed successfully");
    } catch (error) {
      logMessage(
        `Buy positions job failed: ${error.message}`,
        "cron-errors.log"
      );
    }
  },
  {
    scheduled: false,
    timezone: "America/New_York",
  }
);

// Sell positions: Daily at 10:00 AM (Monday-Friday)
const sellPositionsCron = cron.schedule(
  "0 10 * * 1-5",
  async () => {
    logMessage("Starting scheduled sell positions job...");
    try {
      await executeScript("./src/scripts/sellPositions.js");
      logMessage("Sell positions job completed successfully");
    } catch (error) {
      logMessage(
        `Sell positions job failed: ${error.message}`,
        "cron-errors.log"
      );
    }
  },
  {
    scheduled: false,
    timezone: "America/New_York",
  }
);

// Health check cron: Every hour
const healthCheckCron = cron.schedule(
  "0 * * * *",
  () => {
    logMessage("System health check - Server running normally");
  },
  {
    scheduled: false,
  }
);

// Start cron jobs
if (NODE_ENV === "prod") {
  buyPositionsCron.start();
  sellPositionsCron.start();
  healthCheckCron.start();
  logMessage("All cron jobs started for production environment");
} else {
  logMessage("Cron jobs disabled in development mode");
}

// ===================== API ENDPOINTS =====================

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    cronJobs: {
      buyPositions: buyPositionsCron.running ? "running" : "stopped",
      sellPositions: sellPositionsCron.running ? "running" : "stopped",
      healthCheck: healthCheckCron.running ? "running" : "stopped",
    },
  });
});

// Get portfolio holdings
app.get("/api/holdings", (req, res) => {
  const query = `
        SELECT h.*, 
               (CASE WHEN h.status = 'active' THEN 'Active' ELSE 'Sold' END) as status_display
        FROM holdings h 
        ORDER BY h.acquisition_date DESC
    `;

  db.all(query, [], (err, rows) => {
    if (err) {
      logMessage(`Database error: ${err.message}`, "api-errors.log");
      res.status(500).json({
        success: false,
        error: "Database error",
        message: err.message,
      });
    } else {
      res.json({
        success: true,
        data: rows,
        count: rows.length,
      });
    }
  });
});

// Get transaction history
app.get("/api/transactions", (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const query = `
        SELECT * FROM transactions 
        ORDER BY transaction_date DESC 
        LIMIT ? OFFSET ?
    `;

  db.all(query, [parseInt(limit), parseInt(offset)], (err, rows) => {
    if (err) {
      logMessage(`Database error: ${err.message}`, "api-errors.log");
      res.status(500).json({
        success: false,
        error: "Database error",
        message: err.message,
      });
    } else {
      res.json({
        success: true,
        data: rows,
        count: rows.length,
      });
    }
  });
});

// Manual trading endpoints removed - trades execute automatically via cron jobs only

// Get system logs
app.get("/api/logs/:logFile?", (req, res) => {
  const { logFile = "server.log" } = req.params;
  const { lines = 100 } = req.query;

  const logPath = path.join(LOG_DIR, logFile);

  if (!fs.existsSync(logPath)) {
    return res.status(404).json({
      success: false,
      error: "Log file not found",
      availableLogs: fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".log")),
    });
  }

  try {
    const logContent = fs.readFileSync(logPath, "utf8");
    const logLines = logContent.split("\n").slice(-parseInt(lines));

    res.json({
      success: true,
      logFile: logFile,
      lines: logLines.length,
      content: logLines.join("\n"),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to read log file",
      message: error.message,
    });
  }
});

// Cron job management
app.get("/api/cron/status", (req, res) => {
  res.json({
    success: true,
    jobs: {
      buyPositions: {
        schedule: "0 9 1 1,4,7,10 *",
        status: buyPositionsCron.running ? "running" : "stopped",
        description: "Buy positions quarterly",
      },
      sellPositions: {
        schedule: "0 10 * * 1-5",
        status: sellPositionsCron.running ? "running" : "stopped",
        description: "Sell positions daily (weekdays)",
      },
      healthCheck: {
        schedule: "0 * * * *",
        status: healthCheckCron.running ? "running" : "stopped",
        description: "System health check hourly",
      },
    },
  });
});

// Portfolio statistics endpoint
app.get("/api/stats", (req, res) => {
  const queries = {
    activeHoldings:
      'SELECT COUNT(*) as count FROM holdings WHERE status = "active"',
    totalTransactions: "SELECT COUNT(*) as count FROM transactions",
    portfolioValue: `
            SELECT 
                SUM(CASE WHEN action = 'buy' THEN total_amount ELSE -total_amount END) as net_invested
            FROM transactions
        `,
  };

  const stats = {};
  let completedQueries = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.get(query, [], (err, row) => {
      if (err) {
        stats[key] = { error: err.message };
      } else {
        stats[key] = row;
      }

      completedQueries++;
      if (completedQueries === totalQueries) {
        res.json({
          success: true,
          stats: stats,
          timestamp: new Date().toISOString(),
        });
      }
    });
  });
});

// Enhanced dynamic dashboard route
app.get("/", (req, res) => {
  res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Magic Formula Trader Dashboard</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                    background: #ffffff;
                    min-height: 100vh;
                    color: #4a4a4a;
                    line-height: 1.6;
                }
                .header {
                    background: #ffffff;
                    min-width: 100vw;
                    padding: 1.5rem 2rem;
                    border-bottom: 1px solid #f0f0f0;
                    position: sticky;
                    top: 0;
                    z-index: 100;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .header h1 {
                    color: #2a2a2a;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 300;
                    font-size: 1.8rem;
                    letter-spacing: -0.02em;
                }
                .status-indicator {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #666666;
                    opacity: 0.7;
                }
                .container {
                    max-width: 80%;
                    margin: 0 auto;
                    padding: 2rem;
                    display: grid;
                    gap: 0.5rem;
                }
                .dashboard-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1rem;
                }
                .dashboard-grid-bottom {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 1rem;
                    margin-top: 1rem;
                }
                .card {
                    background: #ffffff;
                    border-radius: 6px;
                    padding: 1rem;
                    border: 1px solid #e8e8e8;
                    transition: border-color 0.2s ease;
                }
                .card:hover {
                    border-color: #d0d0d0;
                }
                .card h3 {
                    color: #2a2a2a;
                    margin-bottom: 1rem;
                    font-weight: 600;
                    font-size: 1.3rem;
                }
                .metric-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                    gap: 1rem;
                }
                .metric {
                    text-align: center;
                    padding: 1.5rem 1rem;
                    background: #fafafa;
                    border-radius: 2px;
                    border: 1px solid #f0f0f0;
                }
                .metric-value {
                    font-size: 1.6rem;
                    font-weight: 300;
                    color: #2a2a2a;
                    margin-bottom: 0.5rem;
                    letter-spacing: -0.02em;
                }
                .metric-label {
                    font-size: 0.8rem;
                    color: #8a8a8a;
                    text-transform: uppercase;
                    letter-spacing: 0.8px;
                    font-weight: 500;
                }
                .chart-container {
                    position: relative;
                    height: 300px;
                    margin-top: 1.5rem;
                }
                .controls {
                    display: flex;
                    gap: 1rem;
                    flex-wrap: wrap;
                    margin-bottom: 1rem;
                }
                button {
                    background: #fafafa;
                    color: #4a4a4a;
                    border: 1px solid #e0e0e0;
                    padding: 0.75rem 1.25rem;
                    border-radius: 2px;
                    cursor: pointer;
                    font-weight: 400;
                    font-size: 0.9rem;
                    transition: all 0.2s ease;
                    letter-spacing: 0.3px;
                }
                button:hover {
                    background: #f0f0f0;
                    border-color: #d0d0d0;
                    color: #2a2a2a;
                }
                .refresh-btn {
                    background: #2a2a2a;
                    color: #ffffff;
                    border-color: #2a2a2a;
                }
                .refresh-btn:hover {
                    background: #1a1a1a;
                    border-color: #1a1a1a;
                }
                .holdings-table, .transactions-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 1.5rem;
                    font-size: 0.9rem;
                }
                .holdings-table th, .holdings-table td,
                .transactions-table th, .transactions-table td {
                    padding: 1rem 0.75rem;
                    text-align: left;
                    border-bottom: 1px solid #f0f0f0;
                }
                .holdings-table th, .transactions-table th {
                    background: #fafafa;
                    font-weight: 500;
                    color: #4a4a4a;
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .status-badge {
                    padding: 0.25rem 0.5rem;
                    border-radius: 2px;
                    font-size: 0.75rem;
                    font-weight: 500;
                    letter-spacing: 0.3px;
                }
                .status-active { background: #f0f0f0; color: #4a4a4a; }
                .status-sold { background: #f5f5f5; color: #6a6a6a; }
                .status-running { background: #f0f0f0; color: #4a4a4a; }
                .status-stopped { background: #f5f5f5; color: #6a6a6a; }
                .log-container {
                    background: #fafafa;
                    color: #4a4a4a;
                    padding: 1.5rem;
                    border-radius: 2px;
                    border: 1px solid #f0f0f0;
                    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
                    font-size: 0.85rem;
                    max-height: 300px;
                    overflow-y: auto;
                    margin-top: 1.5rem;
                    line-height: 1.4;
                }
                .loading {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid #f0f0f0;
                    border-top: 2px solid #8a8a8a;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .error { color: #6a6a6a; }
                .success { color: #4a4a4a; }
                .warning { color: #6a6a6a; }
                @media (max-width: 768px) {
                    .container { padding: 1rem; }
                    .dashboard-grid { grid-template-columns: 1fr; }
                    .dashboard-grid-bottom { grid-template-columns: 1fr; }
                    .controls { flex-direction: column; }
                    .card[style*="grid-column"] { grid-column: 1 !important; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>
                    Magic Formula Trader
                </h1>
                <div style="display: flex; flex-direction: row; gap: 0.5rem; align-items: center; justify-content: center;">
                    <div class="status-indicator" id="statusIndicator" style="margin: auto;"></div>
                    <span id="headerStatus"">Loading...</span>
                </div>
            </div>
            
            <div class="container">
                <div class="controls">
                    <button class="refresh-btn" onclick="refreshDashboard()">Refresh All</button>
                    <button onclick="toggleAutoRefresh()">Auto Refresh: <span id="autoRefreshStatus">ON</span></button>
                    <button onclick="showSystemInfo()">System Info</button>
                </div>
                
                <!-- Top row with 3 equal cards -->
                <div class="dashboard-grid">
                    <!-- System Status Card -->
                    <div class="card">
                        <h3>System Status</h3> 
                        <div class="metric-grid">
                            <div class="metric">
                                <div class="metric-value" id="systemStatus" style="text-transform: capitalize;">Loading...</div>
                                <div class="metric-label">Status</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value" id="environment" style="text-transform: capitalize;">${NODE_ENV}.</div>
                                <div class="metric-label">Environment</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value" id="uptime">Loading...</div>
                                <div class="metric-label">Last Checked</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Portfolio Overview Card -->
                    <div class="card">
                        <h3>Portfolio Overview</h3>
                        <div class="metric-grid">
                            <div class="metric">
                                <div class="metric-value" id="totalHoldings">Loading...</div>
                                <div class="metric-label">Active Holdings</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value" id="totalTransactions">Loading...</div>
                                <div class="metric-label">Total Trades</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value" id="portfolioValue">Loading...</div>
                                <div class="metric-label">Net Invested</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Automation Status Card -->
                    <div class="card">
                        <h3>Automation Status</h3>
                        <div id="cronStatus">
                            <div class="loading"></div> Loading automation status...
                        </div>
                    </div>
                </div>
                
                <!-- Bottom row with flexible cards -->
                <div class="dashboard-grid-bottom">
                    <!-- Performance Chart Card -->
                    <div class="card" style="grid-column: span 2;">
                        <h3>Portfolio Performance</h3>
                        <div class="chart-container">
                            <canvas id="performanceChart"></canvas>
                        </div>
                    </div>
                    
                    <!-- Recent Holdings Card -->
                    <div class="card" style="grid-column: span 2;">
                        <h3>Active Holdings</h3>
                        <div id="holdingsContainer">
                            <div class="loading"></div> Loading holdings...
                        </div>
                    </div>
                    
                    <!-- Recent Transactions Card -->
                    <div class="card" style="grid-column: span 2;">
                        <h3>Recent Transactions</h3>
                        <div id="transactionsContainer">
                            <div class="loading"></div> Loading transactions...
                        </div>
                    </div>
                    
                    <!-- System Logs Card -->
                    <div class="card" style="grid-column: span 2;">
                        <h3>System Logs</h3>
                        <div class="controls">
                            <select id="logFileSelector">
                                <option value="server.log">Server Logs</option>
                                <option value="buyOrders.log">Buy Orders</option>
                                <option value="sellPositions.log">Sell Positions</option>
                                <option value="cron-errors.log">Cron Errors</option>
                            </select>
                            <button onclick="refreshLogs()">Refresh Logs</button>
                            <button onclick="clearLogs()">Clear Display</button>
                        </div>
                        <div class="log-container" id="logsContainer">
                            <div class="loading"></div> Loading logs...
                        </div>
                    </div>
                </div>
            </div>
            
            <script>
                let autoRefresh = true;
                let refreshInterval;
                let performanceChart;
                
                // Initialize dashboard
                document.addEventListener('DOMContentLoaded', function() {
                    initializeCharts();
                    refreshDashboard();
                    startAutoRefresh();
                });
                
                function initializeCharts() {
                    const ctx = document.getElementById('performanceChart').getContext('2d');
                    performanceChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: [],
                            datasets: [{
                                label: 'Portfolio Value',
                                data: [],
                                borderColor: '#3498db',
                                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                                tension: 0.4,
                                fill: true
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: function(value) {
                                            return '$' + value.toLocaleString();
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
                
                async function refreshDashboard() {
                    try {
                        await Promise.all([
                            updateSystemStatus(),
                            updatePortfolioOverview(),
                            updateCronStatus(),
                            updateHoldings(),
                            updateTransactions(),
                            updateLogs(),
                            updatePerformanceChart()
                        ]);
                    } catch (error) {
                        console.error('Dashboard refresh error:', error);
                    }
                }
                
                async function updateSystemStatus() {
                    try {
                        const response = await fetch('/health');
                        const data = await response.json();
                        
                        document.getElementById('systemStatus').textContent = data.status;
                        document.getElementById('headerStatus').textContent = data.status.toUpperCase();
                        document.getElementById('uptime').textContent = new Date(data.timestamp).toLocaleTimeString();
                        
                        const indicator = document.getElementById('statusIndicator');
                        indicator.style.background = data.status === 'healthy' ? '#27ae60' : '#e74c3c';
                    } catch (error) {
                        document.getElementById('systemStatus').textContent = 'Error';
                        document.getElementById('headerStatus').textContent = 'ERROR';
                    }
                }
                
                async function updatePortfolioOverview() {
                    try {
                        const response = await fetch('/api/stats');
                        const data = await response.json();
                        
                        if (data.success) {
                            const stats = data.stats;
                            document.getElementById('totalHoldings').textContent = stats.activeHoldings?.count || 0;
                            document.getElementById('totalTransactions').textContent = stats.totalTransactions?.count || 0;
                            
                            const netInvested = stats.portfolioValue?.net_invested || 0;
                            document.getElementById('portfolioValue').textContent = netInvested ? 
                                '$' + Math.abs(netInvested).toLocaleString() : '$0';
                        }
                    } catch (error) {
                        console.error('Portfolio overview error:', error);
                    }
                }
                
                async function updateCronStatus() {
                    try {
                        const response = await fetch('/api/cron/status');
                        const data = await response.json();
                        
                        if (data.success) {
                            const cronHtml = Object.entries(data.jobs).map(([name, job]) => \`
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
                                    <div>
                                        <strong>\${name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</strong>
                                        <br><small>\${job.description}</small>
                                    </div>
                                    <span class="status-badge status-\${job.status}">\${job.status.toUpperCase()}</span>
                                </div>
                            \`).join('');
                            
                            document.getElementById('cronStatus').innerHTML = cronHtml;
                        }
                    } catch (error) {
                        document.getElementById('cronStatus').innerHTML = '<div class="error">Error loading automation status</div>';
                    }
                }
                
                async function updateHoldings() {
                    try {
                        const response = await fetch('/api/holdings');
                        const data = await response.json();
                        
                        if (data.success && data.data.length > 0) {
                            const holdingsHtml = \`
                                <table class="holdings-table">
                                    <thead>
                                        <tr>
                                            <th>Symbol</th>
                                            <th>Quantity</th>
                                            <th>Acquisition Date</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${data.data.slice(0, 10).map(holding => \`
                                            <tr>
                                                <td><strong>\${holding.symbol}</strong></td>
                                                <td>\${holding.quantity}</td>
                                                <td>\${new Date(holding.acquisition_date).toLocaleDateString()}</td>
                                                <td><span class="status-badge status-\${holding.status}">\${holding.status.toUpperCase()}</span></td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                            \`;
                            document.getElementById('holdingsContainer').innerHTML = holdingsHtml;
                        } else {
                            document.getElementById('holdingsContainer').innerHTML = '<div style="text-align: center; color: #6c757d; padding: 2rem;">No holdings data available</div>';
                        }
                    } catch (error) {
                        document.getElementById('holdingsContainer').innerHTML = '<div class="error">Error loading holdings</div>';
                    }
                }
                
                async function updateTransactions() {
                    try {
                        const response = await fetch('/api/transactions?limit=10');
                        const data = await response.json();
                        
                        if (data.success && data.data.length > 0) {
                            const transactionsHtml = \`
                                <table class="transactions-table">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Symbol</th>
                                            <th>Action</th>
                                            <th>Quantity</th>
                                            <th>Price</th>
                                            <th>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${data.data.map(tx => \`
                                            <tr>
                                                <td>\${new Date(tx.transaction_date).toLocaleDateString()}</td>
                                                <td><strong>\${tx.symbol}</strong></td>
                                                <td><span style="color: \${tx.action === 'buy' ? '#27ae60' : '#e74c3c'}">\${tx.action.toUpperCase()}</span></td>
                                                <td>\${tx.quantity}</td>
                                                <td>$\${parseFloat(tx.price).toFixed(2)}</td>
                                                <td>$\${parseFloat(tx.total_amount).toFixed(2)}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                            \`;
                            document.getElementById('transactionsContainer').innerHTML = transactionsHtml;
                        } else {
                            document.getElementById('transactionsContainer').innerHTML = '<div style="text-align: center; color: #6c757d; padding: 2rem;">No transaction data available</div>';
                        }
                    } catch (error) {
                        document.getElementById('transactionsContainer').innerHTML = '<div class="error">Error loading transactions</div>';
                    }
                }
                
                async function updateLogs() {
                    const logFile = document.getElementById('logFileSelector').value;
                    try {
                        const response = await fetch(\`/api/logs/\${logFile}?lines=50\`);
                        const data = await response.json();
                        
                        if (data.success) {
                            const logs = data.content.split('\\n').filter(line => line.trim()).slice(-20);
                            document.getElementById('logsContainer').innerHTML = logs.join('\\n') || 'No logs available';
                        } else {
                            document.getElementById('logsContainer').innerHTML = 'Error loading logs: ' + data.error;
                        }
                    } catch (error) {
                        document.getElementById('logsContainer').innerHTML = 'Error loading logs';
                    }
                }
                
                async function updatePerformanceChart() {
                    try {
                        const response = await fetch('/api/transactions');
                        const data = await response.json();
                        
                        if (data.success && data.data.length > 0) {
                            const chartData = calculatePortfolioValue(data.data);
                            performanceChart.data.labels = chartData.labels;
                            performanceChart.data.datasets[0].data = chartData.values;
                            performanceChart.update();
                        }
                    } catch (error) {
                        console.error('Chart update error:', error);
                    }
                }
                
                function calculatePortfolioValue(transactions) {
                    const dailyValues = {};
                    let runningTotal = 0;
                    
                    transactions.forEach(tx => {
                        const date = new Date(tx.transaction_date).toLocaleDateString();
                        const amount = tx.action === 'buy' ? -tx.total_amount : tx.total_amount;
                        runningTotal += amount;
                        dailyValues[date] = runningTotal;
                    });
                    
                    const labels = Object.keys(dailyValues).slice(-30);
                    const values = labels.map(date => Math.abs(dailyValues[date]));
                    
                    return { labels, values };
                }
                
                function toggleAutoRefresh() {
                    autoRefresh = !autoRefresh;
                    document.getElementById('autoRefreshStatus').textContent = autoRefresh ? 'ON' : 'OFF';
                    
                    if (autoRefresh) {
                        startAutoRefresh();
                    } else {
                        clearInterval(refreshInterval);
                    }
                }
                
                function startAutoRefresh() {
                    if (refreshInterval) clearInterval(refreshInterval);
                    refreshInterval = setInterval(refreshDashboard, 30000);
                }
                
                function refreshLogs() {
                    updateLogs();
                }
                
                function clearLogs() {
                    document.getElementById('logsContainer').innerHTML = 'Logs cleared - refresh to reload';
                }
                
                function exportData() {
                    // Export functionality would go here
                    alert('Export functionality - would download portfolio data as CSV/JSON');
                }
                
                function showSystemInfo() {
                    alert(\`Magic Formula Trader Dashboard
Environment: ${NODE_ENV}
Server: Node.js + Express
Database: SQLite
Last Updated: \${new Date().toLocaleString()}\`);
                }
                
                // Keyboard shortcuts
                document.addEventListener('keydown', function(e) {
                    if (e.ctrlKey || e.metaKey) {
                        switch(e.key) {
                            case 'r':
                                e.preventDefault();
                                refreshDashboard();
                                break;
                        }
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logMessage(`Unhandled error: ${err.message}`, "api-errors.log");
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: NODE_ENV === "dev" ? err.message : "Something went wrong",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /",
      "GET /health",
      "GET /api/holdings",
      "GET /api/transactions",
      "GET /api/stats",
      "GET /api/cron/status",
      "GET /api/logs/:logFile",
    ],
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logMessage("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    db.close((err) => {
      if (err) {
        logMessage(`Error closing database: ${err.message}`);
      } else {
        logMessage("Database connection closed.");
      }
      process.exit(0);
    });
  });
});

process.on("SIGINT", () => {
  logMessage("SIGINT received. Shutting down gracefully...");
  server.close(() => {
    db.close((err) => {
      if (err) {
        logMessage(`Error closing database: ${err.message}`);
      } else {
        logMessage("Database connection closed.");
      }
      process.exit(0);
    });
  });
});

// Start server
const server = app.listen(PORT, () => {
  logMessage(`🚀 Magic Formula Trader Server started on port ${PORT}`);
  logMessage(`📊 Dashboard available at: http://localhost:${PORT}`);
  logMessage(`🔧 API available at: http://localhost:${PORT}/api/*`);
  logMessage(`Environment: ${NODE_ENV}`);
});

module.exports = app;
