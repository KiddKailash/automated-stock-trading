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

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Environment variables
const {
    LOG_DIR = './logs',
    DATABASE_DIR = './database',
    NODE_ENV
} = process.env;

// Ensure directories exist
[LOG_DIR, DATABASE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Initialize SQLite Database
const dbPath = path.join(DATABASE_DIR, 'portfolio.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
        process.exit(1);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
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
function logMessage(message, logFile = 'server.log') {
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
        const command = `node ${scriptPath} ${args.join(' ')}`;
        logMessage(`Executing: ${command}`);
        
        // Use parent directory as cwd since server.js is now in src/
        const rootDir = path.join(__dirname, '..');
        exec(command, { cwd: rootDir }, (error, stdout, stderr) => {
            if (error) {
                logMessage(`Script execution error: ${error.message}`, 'cron-errors.log');
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
const buyPositionsCron = cron.schedule('0 9 1 1,4,7,10 *', async () => {
    logMessage('Starting scheduled buy positions job...');
    try {
        await executeScript('./src/scripts/buyPositions.js');
        logMessage('Buy positions job completed successfully');
    } catch (error) {
        logMessage(`Buy positions job failed: ${error.message}`, 'cron-errors.log');
    }
}, {
    scheduled: false,
    timezone: "America/New_York"
});

// Sell positions: Daily at 10:00 AM (Monday-Friday)
const sellPositionsCron = cron.schedule('0 10 * * 1-5', async () => {
    logMessage('Starting scheduled sell positions job...');
    try {
        await executeScript('./src/scripts/sellPositions.js');
        logMessage('Sell positions job completed successfully');
    } catch (error) {
        logMessage(`Sell positions job failed: ${error.message}`, 'cron-errors.log');
    }
}, {
    scheduled: false,
    timezone: "America/New_York"
});

// Health check cron: Every hour
const healthCheckCron = cron.schedule('0 * * * *', () => {
    logMessage('System health check - Server running normally');
}, {
    scheduled: false
});

// Start cron jobs
if (NODE_ENV === 'production') {
    buyPositionsCron.start();
    sellPositionsCron.start();
    healthCheckCron.start();
    logMessage('All cron jobs started for production environment');
} else {
    logMessage('Cron jobs disabled in development mode');
}

// ===================== API ENDPOINTS =====================

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        cronJobs: {
            buyPositions: buyPositionsCron.running ? 'running' : 'stopped',
            sellPositions: sellPositionsCron.running ? 'running' : 'stopped',
            healthCheck: healthCheckCron.running ? 'running' : 'stopped'
        }
    });
});

// Get portfolio holdings
app.get('/api/holdings', (req, res) => {
    const query = `
        SELECT h.*, 
               (CASE WHEN h.status = 'active' THEN 'Active' ELSE 'Sold' END) as status_display
        FROM holdings h 
        ORDER BY h.acquisition_date DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            logMessage(`Database error: ${err.message}`, 'api-errors.log');
            res.status(500).json({ 
                success: false, 
                error: 'Database error',
                message: err.message 
            });
        } else {
            res.json({ 
                success: true, 
                data: rows,
                count: rows.length
            });
        }
    });
});

// Get transaction history
app.get('/api/transactions', (req, res) => {
    const { limit = 50, offset = 0 } = req.query;
    
    const query = `
        SELECT * FROM transactions 
        ORDER BY transaction_date DESC 
        LIMIT ? OFFSET ?
    `;
    
    db.all(query, [parseInt(limit), parseInt(offset)], (err, rows) => {
        if (err) {
            logMessage(`Database error: ${err.message}`, 'api-errors.log');
            res.status(500).json({ 
                success: false, 
                error: 'Database error',
                message: err.message 
            });
        } else {
            res.json({ 
                success: true, 
                data: rows,
                count: rows.length
            });
        }
    });
});

// Manual trading endpoints removed - trades execute automatically via cron jobs only

// Get system logs
app.get('/api/logs/:logFile?', (req, res) => {
    const { logFile = 'server.log' } = req.params;
    const { lines = 100 } = req.query;
    
    const logPath = path.join(LOG_DIR, logFile);
    
    if (!fs.existsSync(logPath)) {
        return res.status(404).json({
            success: false,
            error: 'Log file not found',
            availableLogs: fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'))
        });
    }
    
    try {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const logLines = logContent.split('\n').slice(-parseInt(lines));
        
        res.json({
            success: true,
            logFile: logFile,
            lines: logLines.length,
            content: logLines.join('\n')
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to read log file',
            message: error.message
        });
    }
});

// Cron job management
app.get('/api/cron/status', (req, res) => {
    res.json({
        success: true,
        jobs: {
            buyPositions: {
                schedule: '0 9 1 1,4,7,10 *',
                status: buyPositionsCron.running ? 'running' : 'stopped',
                description: 'Buy positions quarterly'
            },
            sellPositions: {
                schedule: '0 10 * * 1-5',
                status: sellPositionsCron.running ? 'running' : 'stopped',
                description: 'Sell positions daily (weekdays)'
            },
            healthCheck: {
                schedule: '0 * * * *',
                status: healthCheckCron.running ? 'running' : 'stopped',
                description: 'System health check hourly'
            }
        }
    });
});

// Portfolio statistics endpoint
app.get('/api/stats', (req, res) => {
    const queries = {
        activeHoldings: 'SELECT COUNT(*) as count FROM holdings WHERE status = "active"',
        totalTransactions: 'SELECT COUNT(*) as count FROM transactions',
        portfolioValue: `
            SELECT 
                SUM(CASE WHEN action = 'buy' THEN total_amount ELSE -total_amount END) as net_invested
            FROM transactions
        `
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
                    timestamp: new Date().toISOString()
                });
            }
        });
    });
});

// Basic dashboard route
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Magic Formula Trader Dashboard</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
                h1 { color: #1976d2; }
                .stats { display: flex; gap: 20px; margin: 20px 0; }
                .stat-card { flex: 1; padding: 20px; background: #f8f9fa; border-radius: 4px; text-align: center; }
                .api-section { margin: 30px 0; }
                .api-endpoint { margin: 10px 0; padding: 10px; background: #e3f2fd; border-radius: 4px; }
                button { background: #1976d2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px; }
                button:hover { background: #1565c0; }
                pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎯 Magic Formula Trader Dashboard</h1>
                <p>Automated trading system running Joel Greenblatt's Magic Formula strategy</p>
                
                <div class="stats">
                    <div class="stat-card">
                        <h3>System Status</h3>
                        <p id="status">Loading...</p>
                    </div>
                    <div class="stat-card">
                        <h3>Environment</h3>
                        <p>${NODE_ENV}</p>
                    </div>
                    <div class="stat-card">
                        <h3>Server Uptime</h3>
                        <p id="uptime">Loading...</p>
                    </div>
                </div>
                
                <div class="api-section">
                    <h2>System Monitoring</h2>
                    <button onclick="checkHealth()">❤️ Health Check</button>
                    <button onclick="viewLogs()">📋 View Logs</button>
                    <button onclick="viewPortfolio()">📊 Portfolio Overview</button>
                    <button onclick="viewCronStatus()">⏰ Cron Jobs Status</button>
                </div>
                
                <div class="api-section">
                    <h2>Available API Endpoints</h2>
                    <div class="api-endpoint">
                        <strong>GET /health</strong> - System health check
                    </div>
                    <div class="api-endpoint">
                        <strong>GET /api/holdings</strong> - Portfolio holdings
                    </div>
                    <div class="api-endpoint">
                        <strong>GET /api/transactions</strong> - Transaction history
                    </div>
                    <div class="api-endpoint">
                        <strong>GET /api/stats</strong> - Portfolio statistics
                    </div>
                    <div class="api-endpoint">
                        <strong>GET /api/cron/status</strong> - Automated job status
                    </div>
                    <div class="api-endpoint">
                        <strong>GET /api/logs/:logFile</strong> - System logs
                    </div>
                    <div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0; border-left: 4px solid #ffc107;">
                        <strong>⚠️ Note:</strong> This system operates fully automatically via scheduled cron jobs. Manual trading is not available for security and consistency.
                    </div>
                </div>
                
                <div id="output"></div>
            </div>
            
            <script>
                function updateStatus() {
                    fetch('/health')
                        .then(r => r.json())
                        .then(data => {
                            document.getElementById('status').textContent = data.status;
                            document.getElementById('uptime').textContent = new Date(data.timestamp).toLocaleString();
                        })
                        .catch(e => document.getElementById('status').textContent = 'Error');
                }
                
                function viewPortfolio() {
                    Promise.all([
                        fetch('/api/holdings').then(r => r.json()),
                        fetch('/api/transactions?limit=10').then(r => r.json()),
                        fetch('/api/stats').then(r => r.json())
                    ])
                    .then(([holdings, transactions, stats]) => {
                        const portfolioData = {
                            holdings: holdings.data || [],
                            recentTransactions: transactions.data || [],
                            statistics: stats.stats || {}
                        };
                        displayOutput('Portfolio Overview', portfolioData);
                    })
                    .catch(e => displayOutput('Portfolio Error', e));
                }
                
                function viewCronStatus() {
                    fetch('/api/cron/status')
                        .then(r => r.json())
                        .then(data => displayOutput('Automated Jobs Status', data))
                        .catch(e => displayOutput('Cron Status Error', e));
                }
                
                function checkHealth() {
                    fetch('/health')
                        .then(r => r.json())
                        .then(data => displayOutput('Health Check', data))
                        .catch(e => displayOutput('Health Error', e));
                }
                
                function viewLogs() {
                    fetch('/api/logs/server.log?lines=20')
                        .then(r => r.json())
                        .then(data => displayOutput('Recent Logs', data.content))
                        .catch(e => displayOutput('Log Error', e));
                }
                
                function displayOutput(title, content) {
                    const output = document.getElementById('output');
                    output.innerHTML = '<h3>' + title + '</h3><pre>' + JSON.stringify(content, null, 2) + '</pre>';
                }
                
                // Update status every 30 seconds
                updateStatus();
                setInterval(updateStatus, 30000);
            </script>
        </body>
        </html>
    `);
});

// Error handling middleware
app.use((err, req, res, next) => {
    logMessage(`Unhandled error: ${err.message}`, 'api-errors.log');
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /',
            'GET /health',
            'GET /api/holdings',
            'GET /api/transactions',
            'GET /api/stats',
            'GET /api/cron/status',
            'GET /api/logs/:logFile'
        ]
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logMessage('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        db.close((err) => {
            if (err) {
                logMessage(`Error closing database: ${err.message}`);
            } else {
                logMessage('Database connection closed.');
            }
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    logMessage('SIGINT received. Shutting down gracefully...');
    server.close(() => {
        db.close((err) => {
            if (err) {
                logMessage(`Error closing database: ${err.message}`);
            } else {
                logMessage('Database connection closed.');
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