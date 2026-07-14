"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-var-requires
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database = require('better-sqlite3');
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
// In this build, asar is disabled (asar: false in package.json), so python files are directly in app folder
const asarDisabled = true;
const PORT = 3001;
const TRUSTED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const MAX_EXTERNAL_URL_LENGTH = 2048;
const MAX_OPTIONS_PER_SIDE = 500;
const MAX_HISTORY_LIMIT = 100;
const MIN_OPTIONS_SAVE_INTERVAL_MS = 500;
let mainWindow = null;
let nextServer = null;
let pythonProcesses = [];
let lastOptionsSaveAt = 0;
function isTrustedRendererUrl(rawUrl) {
    try {
        return TRUSTED_ORIGINS.has(new URL(rawUrl).origin);
    }
    catch {
        return false;
    }
}
function isTrustedIpcSender(event) {
    return mainWindow !== null && !mainWindow.isDestroyed()
        && event.sender === mainWindow.webContents
        && event.senderFrame === mainWindow.webContents.mainFrame
        && isTrustedRendererUrl(event.senderFrame.url);
}
function handleTrusted(channel, handler) {
    electron_1.ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedIpcSender(event))
            throw new Error('IPC request rejected');
        try {
            return await handler(event, ...args);
        }
        catch {
            throw new Error('IPC request failed');
        }
    });
}
/**
 * Secret compartilhado do token WS do MT5 Bridge (Fase 0, Item 10).
 * Se não vier do ambiente (>= 32 chars), gera um valor criptográfico efêmero
 * por processo e passa o MESMO valor, via env, ao servidor Next e ao
 * mt5_bridge.py. Nunca persistido nem logado.
 */
function resolveWsTokenSecret() {
    const fromEnv = process.env.WR_WS_TOKEN_SECRET?.trim() ?? '';
    if (fromEnv.length >= 32)
        return fromEnv;
    return crypto_1.default.randomBytes(32).toString('hex');
}
const WS_TOKEN_SECRET = resolveWsTokenSecret();
function childEnv() {
    return { ...process.env, WR_WS_TOKEN_SECRET: WS_TOKEN_SECRET };
}
function isProjectRoot(candidate) {
    try {
        const packageJsonPath = path_1.default.join(candidate, 'package.json');
        if (!fs_1.default.existsSync(packageJsonPath))
            return false;
        const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf8'));
        return packageJson.name === 'wr-trade-pro';
    }
    catch {
        return false;
    }
}
function findNearestProjectRoot(startPath) {
    let current = path_1.default.resolve(startPath);
    while (true) {
        if (isProjectRoot(current))
            return current;
        const parent = path_1.default.dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
}
function getProjectRoot() {
    const envRoot = process.env.WR_TRADE_PRO_ROOT;
    if (envRoot && isProjectRoot(envRoot))
        return path_1.default.resolve(envRoot);
    if (electron_1.app.isPackaged) {
        const fromExecutable = findNearestProjectRoot(path_1.default.dirname(process.execPath));
        if (fromExecutable)
            return fromExecutable;
    }
    const candidates = [
        process.cwd(),
        path_1.default.resolve(__dirname, '../..'),
        path_1.default.dirname(process.execPath),
        process.resourcesPath ? path_1.default.join(process.resourcesPath, 'app') : '',
    ].filter(Boolean);
    for (const candidate of candidates) {
        const direct = path_1.default.resolve(candidate);
        if (isProjectRoot(direct))
            return direct;
        const nearest = findNearestProjectRoot(direct);
        if (nearest)
            return nearest;
    }
    return path_1.default.resolve(__dirname, '../..');
}
const PROJECT_ROOT = getProjectRoot();
const APP_DATA_DIR = path_1.default.join(PROJECT_ROOT, 'data');
const OPTIONS_DATA_DIR = path_1.default.join(APP_DATA_DIR, 'options');
const CRITICAL_SERVICES = [
    { name: 'mt5_bridge', scriptName: 'mt5_bridge.py', port: 8766, waitFor: 'Servidor WebSocket iniciado com sucesso' },
    { name: 'spread_api', scriptName: 'spread_api.py', port: 5000, waitFor: 'Debug mode' },
    { name: 'volatility_api', scriptName: 'volatility_api.py', port: 5555, waitFor: 'localhost:5555' },
];
function getPythonPath() {
    // Use the IA_Day_Trading conda environment Python
    const condaEnvPath = 'C:\\Users\\rwres\\anaconda3\\envs\\IA_Day_Trading\\python.exe';
    return condaEnvPath;
}
function getPythonServiceScriptPath(scriptName) {
    if (asarDisabled && electron_1.app.isPackaged) {
        return {
            scriptPath: path_1.default.join(process.resourcesPath, 'app', 'python', scriptName),
            cwd: path_1.default.join(process.resourcesPath, 'app', 'python'),
        };
    }
    else {
        return {
            scriptPath: path_1.default.join(__dirname, '../../python', scriptName),
            cwd: path_1.default.join(__dirname, '../../python'),
        };
    }
}
async function waitForPort(port, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const http = await Promise.resolve().then(() => __importStar(require('http')));
            const result = await new Promise((resolve, reject) => {
                const req = http.get(`http://localhost:${port}`, (res) => {
                    res.destroy();
                    if (res.statusCode && res.statusCode < 500)
                        resolve();
                    else
                        reject(new Error(`Port ${port} returned ${res.statusCode}`));
                });
                req.on('error', () => reject(new Error(`Port ${port} not ready`)));
                req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
            });
            return; // Port is ready
        }
        catch {
            // Port not ready yet
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Port ${port} never became available`);
}
function startPythonService(cfg) {
    return new Promise((resolve, reject) => {
        const { scriptPath, cwd } = getPythonServiceScriptPath(cfg.scriptName);
        const pythonPath = getPythonPath();
        console.log(`[Electron] Starting ${cfg.name}...`);
        console.log(`[${cfg.name}] Script path:`, scriptPath);
        console.log(`[${cfg.name}] CWD:`, cwd);
        const child = (0, child_process_1.spawn)(pythonPath, [scriptPath], {
            cwd: cwd,
            env: childEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });
        pythonProcesses.push(child);
        let output = '';
        let resolved = false;
        const cleanup = () => {
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
            child.removeAllListeners();
            output = ''; // allow GC
        };
        const timeout = setTimeout(() => {
            if (resolved)
                return;
            resolved = true;
            cleanup();
            console.log(`[${cfg.name}] Timeout reached, assuming ready`);
            resolve();
        }, 15000);
        child.stdout?.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log(`[${cfg.name} stdout]`, text.trim());
            if (cfg.waitFor && text.includes(cfg.waitFor)) {
                if (resolved)
                    return;
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                console.log(`[${cfg.name}] Ready!`);
                resolve();
            }
        });
        child.stderr?.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log(`[${cfg.name} stderr]`, text.trim());
        });
        child.on('error', (err) => {
            if (resolved)
                return;
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            console.error(`[${cfg.name} error]`, err);
            // Fatal error - reject
            reject(new Error(`[${cfg.name}] failed to start: ${err.message}`));
        });
        child.on('exit', (code) => {
            if (resolved)
                return;
            clearTimeout(timeout);
            console.log(`[${cfg.name}] exited with code`, code);
            if (code !== 0 && code !== null) {
                console.error(`[${cfg.name}] exited with error — output:`, output);
                // Non-zero exit is a failure for critical services
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    reject(new Error(`[${cfg.name}] exited with code ${code}`));
                }
            }
            else {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve();
                }
            }
        });
    });
}
async function restartPythonService(cfg, maxRetries = 3) {
    let attempts = 0;
    while (attempts < maxRetries) {
        attempts++;
        console.log(`[Electron] Restarting ${cfg.name} (attempt ${attempts}/${maxRetries})...`);
        try {
            await startPythonService(cfg);
            console.log(`[Electron] ${cfg.name} restarted successfully`);
            return;
        }
        catch (err) {
            console.error(`[Electron] ${cfg.name} restart failed:`, err);
            if (attempts >= maxRetries) {
                console.error(`[Electron] ${cfg.name} giving up after ${maxRetries} attempts`);
                throw err;
            }
            // Exponential backoff
            await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 1000));
        }
    }
}
async function startPythonServices() {
    console.log('[Electron] Starting Python backend services...');
    // Wait briefly to ensure ports from previous session are freed (TIME_WAIT on Windows)
    await new Promise((r) => setTimeout(r, 1500));
    const results = await Promise.allSettled(CRITICAL_SERVICES.map((cfg) => startPythonService(cfg)));
    const failed = results
        .map((r, i) => ({ cfg: CRITICAL_SERVICES[i], result: r }))
        .filter(({ result }) => result.status === 'rejected');
    if (failed.length > 0) {
        const names = failed.map(({ cfg }) => cfg.name).join(', ');
        console.error(`[Electron] Critical services failed: ${names}`);
        // Try to restart each failed service once
        await Promise.allSettled(failed.map(({ cfg }) => restartPythonService(cfg, 1)));
    }
    console.log('[Electron] All Python services started');
}
function stopPythonServices() {
    console.log('[Electron] Stopping Python services...');
    for (const proc of pythonProcesses) {
        try {
            // On Windows, SIGTERM may not work reliably — use taskkill for forceful cleanup
            if (process.platform === 'win32' && proc.pid) {
                try {
                    (0, child_process_1.spawn)('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
                        stdio: 'ignore',
                        shell: true,
                        windowsHide: true,
                    });
                }
                catch {
                    // Fallback to SIGTERM if taskkill fails
                }
            }
            proc.kill('SIGTERM');
        }
        catch (e) {
            // Process might already be dead
        }
    }
    pythonProcesses = [];
}
function startNextServer() {
    return new Promise((resolve, reject) => {
        const appFolder = isDev || !process.resourcesPath
            ? path_1.default.join(__dirname, '..', '..')
            : path_1.default.join(process.resourcesPath, 'app');
        const nextDir = path_1.default.join(appFolder, '.next');
        const nextBin = path_1.default.join(appFolder, 'node_modules', 'next', 'dist', 'bin', 'next');
        const serverCwd = appFolder;
        console.log('[Electron] nextDir =', nextDir);
        console.log('[Electron] nextBin =', nextBin);
        console.log('[Electron] serverCwd =', serverCwd);
        const child = (0, child_process_1.spawn)('node', [nextBin, 'start', '-H', '127.0.0.1', '-p', String(PORT)], {
            cwd: serverCwd,
            env: childEnv(),
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
        nextServer = child;
        let output = '';
        child.stdout?.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('[next stdout]', text.trim());
            if (text.includes('Ready') || text.includes('started server')) {
                resolve();
            }
        });
        child.stderr?.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('[next stderr]', text.trim());
            if (text.includes('Ready') || text.includes('started server')) {
                resolve();
            }
        });
        child.on('error', (err) => {
            console.error('[next spawn error]', err);
            reject(err);
        });
        child.on('exit', (code) => {
            console.log('[next exit] code =', code);
            if (code !== 0 && code !== null) {
                console.error('[next] Server exited with code', code, '— output:', output);
            }
        });
        setTimeout(() => {
            console.log('[next] Timeout reached, assuming server is running');
            resolve();
        }, 20000);
    });
}
async function createWindow() {
    if (!isDev) {
        await startPythonServices();
    }
    console.log('[Electron] Starting Next.js server...');
    await startNextServer();
    console.log('[Electron] Next.js server ready, launching window...');
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
            navigateOnDragDrop: false,
        },
        show: false,
        backgroundColor: '#0f172a',
    });
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (!isTrustedRendererUrl(navigationUrl))
            event.preventDefault();
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    const url = isDev
        ? `http://localhost:${PORT}`
        : `http://localhost:${PORT}`;
    mainWindow.loadURL(url);
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(() => {
    electron_1.session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    electron_1.session.defaultSession.setPermissionCheckHandler(() => false);
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    stopPythonServices();
    if (nextServer) {
        try {
            nextServer.kill('SIGTERM');
        }
        catch (e) {
            // Already dead
        }
    }
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    stopPythonServices();
});
handleTrusted('open-external', async (_event, value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH)
        throw new Error('Invalid URL');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Invalid URL');
    await electron_1.shell.openExternal(url.toString());
});
handleTrusted('get-app-version', () => {
    return electron_1.app.getVersion();
});
// ─── SQLite for Options (v4) ─────────────────────────────────────────────────
const DB_PATH = path_1.default.join(OPTIONS_DATA_DIR, 'options_data.db');
function ensureOptionsDB() {
    fs_1.default.mkdirSync(OPTIONS_DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        spot REAL NOT NULL,
        vol_data TEXT
      );
      CREATE TABLE IF NOT EXISTS options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        strike REAL NOT NULL,
        bid REAL NOT NULL,
        ask REAL,
        spread_pct REAL,
        otm_pct REAL,
        dte INTEGER,
        venc TEXT,
        tipo TEXT,
        estilo TEXT,
        anual_pct REAL,
        p_exerc REAL,
        custo_r REAL,
        cabe_10k INTEGER,
        cabe_capital INTEGER,
        opt_type TEXT
      );
    `);
        const existingColumns = new Set(db.prepare('PRAGMA table_info(options)').all().map((row) => row.name));
        if (!existingColumns.has('cabe_10k')) {
            db.exec('ALTER TABLE options ADD COLUMN cabe_10k INTEGER');
        }
        if (!existingColumns.has('cabe_capital')) {
            db.exec('ALTER TABLE options ADD COLUMN cabe_capital INTEGER');
        }
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNumberInRange = (value, min, max) => isFiniteNumber(value) && value >= min && value <= max;
const hasOnlyKeys = (value, allowed) => {
    const allowedSet = new Set(allowed);
    return Object.keys(value).every((key) => allowedSet.has(key));
};
const isSafeText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const isMarketCode = (value, max) => isSafeText(value, max) && /^[A-Z0-9._-]+$/i.test(value);
const isIsoDate = (value) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function isOptionPayload(value) {
    if (!isPlainObject(value) || !isMarketCode(value.symbol, 32) || !isIsoDate(value.expiration))
        return false;
    if (!hasOnlyKeys(value, ['symbol', 'strike', 'bid', 'ask', 'spreadPct', 'otmPct', 'dte', 'expiration', 'anualizado', 'pExerc', 'estilo', 'isWeekly']))
        return false;
    if (!isNumberInRange(value.strike, 0, 1_000_000_000)
        || !isNumberInRange(value.bid, 0, 1_000_000_000)
        || !isNumberInRange(value.ask, 0, 1_000_000_000)
        || !isNumberInRange(value.otmPct, -10_000, 10_000)
        || !isNumberInRange(value.anualizado, -1_000_000, 1_000_000))
        return false;
    if (!Number.isInteger(value.dte) || value.dte < 0 || value.dte > 3650)
        return false;
    if (value.spreadPct !== undefined && !isNumberInRange(value.spreadPct, -10_000, 10_000))
        return false;
    if (value.pExerc !== undefined && !isNumberInRange(value.pExerc, 0, 100))
        return false;
    return (value.estilo === undefined || isSafeText(value.estilo, 20))
        && (value.isWeekly === undefined || typeof value.isWeekly === 'boolean');
}
function parseOptionsScan(value) {
    if (!isPlainObject(value)
        || !hasOnlyKeys(value, ['asset', 'spot', 'volData', 'calls', 'puts'])
        || !isMarketCode(value.asset, 24)
        || !isNumberInRange(value.spot, 0, 1_000_000_000))
        throw new Error('Invalid payload');
    if (!Array.isArray(value.calls) || !Array.isArray(value.puts)
        || value.calls.length > MAX_OPTIONS_PER_SIDE || value.puts.length > MAX_OPTIONS_PER_SIDE
        || !value.calls.every(isOptionPayload) || !value.puts.every(isOptionPayload))
        throw new Error('Invalid payload');
    if (value.volData !== null) {
        const volData = value.volData;
        if (!isPlainObject(volData)
            || !hasOnlyKeys(volData, ['dailyStd', 'annualStd', 'weeklyPct', 'mean30d', 'std30d', 'lastClose', 'nCandles'])
            || !['dailyStd', 'annualStd', 'weeklyPct', 'mean30d', 'std30d', 'lastClose', 'nCandles']
                .every((key) => isNumberInRange(volData[key], -1_000_000_000, 1_000_000_000))
            || !Number.isInteger(volData.nCandles)
            || volData.nCandles < 0)
            throw new Error('Invalid payload');
    }
    return value;
}
handleTrusted('save-options-scan', async (_event, value) => {
    const data = parseOptionsScan(value);
    const requestTime = Date.now();
    if (requestTime - lastOptionsSaveAt < MIN_OPTIONS_SAVE_INTERVAL_MS)
        throw new Error('Request rate exceeded');
    lastOptionsSaveAt = requestTime;
    let db = null;
    try {
        db = ensureOptionsDB();
        const now = new Date().toISOString();
        const insertOpt = db.prepare(`
      INSERT INTO options (scan_id, symbol, strike, bid, ask, spread_pct, otm_pct, dte, venc, tipo, estilo, anual_pct, p_exerc, custo_r, cabe_10k, cabe_capital, opt_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
        const persistScan = db.transaction(() => {
            const prev = db.prepare('SELECT id FROM scans WHERE asset = ? ORDER BY id DESC LIMIT 1').get(data.asset);
            if (prev) {
                db.prepare('DELETE FROM options WHERE scan_id = ?').run(prev.id);
                db.prepare('DELETE FROM scans WHERE id = ?').run(prev.id);
            }
            const volJson = data.volData ? JSON.stringify(data.volData) : null;
            const scanResult = db.prepare('INSERT INTO scans (asset, scanned_at, spot, vol_data) VALUES (?,?,?,?)').run(data.asset, now, data.spot, volJson);
            const scanId = Number(scanResult.lastInsertRowid);
            for (const o of data.calls) {
                insertOpt.run(scanId, o.symbol, o.strike, o.bid, o.ask, o.spreadPct ?? 0, o.otmPct, o.dte, o.expiration.split('T')[0], 'CALL', o.estilo ?? 'EUROPEIA', o.anualizado * 100, o.pExerc ?? 0, o.strike * 100, 1, 1, 'CALL');
            }
            for (const p of data.puts) {
                insertOpt.run(scanId, p.symbol, p.strike, p.bid, p.ask, p.spreadPct ?? 0, p.otmPct, p.dte, p.expiration.split('T')[0], 'PUT', p.estilo ?? 'EUROPEIA', p.anualizado * 100, p.pExerc ?? 0, p.strike * 100, 1, 1, 'PUT');
            }
            return scanId;
        });
        const scanId = persistScan();
        console.log(`[Options] Scan saved: ${data.asset} (id=${scanId})`);
        return { success: true, scanId };
    }
    catch (e) {
        console.error('[Options] DB save error:', e);
        return { success: false, error: 'Unable to save options scan' };
    }
    finally {
        db?.close();
    }
});
handleTrusted('get-last-options-scan', async (_event, value) => {
    if (!isMarketCode(value, 24))
        throw new Error('Invalid payload');
    const asset = value;
    let db = null;
    try {
        db = ensureOptionsDB();
        const scan = db.prepare('SELECT * FROM scans WHERE asset = ? ORDER BY id DESC LIMIT 1').get(asset);
        if (!scan)
            return null;
        const options = db.prepare('SELECT * FROM options WHERE scan_id = ?').all(scan.id);
        return { scan, options };
    }
    catch (e) {
        console.error('[Options] DB read error:', e);
        return null;
    }
    finally {
        db?.close();
    }
});
handleTrusted('get-options-history', async (_event, value) => {
    const limit = value === undefined ? 10 : value;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT)
        throw new Error('Invalid payload');
    let db = null;
    try {
        db = ensureOptionsDB();
        return db.prepare('SELECT * FROM scans ORDER BY id DESC LIMIT ?').all(limit);
    }
    catch (e) {
        return [];
    }
    finally {
        db?.close();
    }
});
// ─── Uncaught exceptions ──────────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
    console.error('[Electron] Uncaught exception:', error);
});
//# sourceMappingURL=main.js.map