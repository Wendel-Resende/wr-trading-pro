import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database = require('better-sqlite3') as any;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
// In this build, asar is disabled (asar: false in package.json), so python files are directly in app folder
const asarDisabled = true;
const PORT = 3001;

let mainWindow: BrowserWindow | null = null;
let nextServer: ChildProcess | null = null;
let pythonProcesses: ChildProcess[] = [];

function isProjectRoot(candidate: string): boolean {
  try {
    const packageJsonPath = path.join(candidate, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return false;
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    return packageJson.name === 'wr-trade-pro';
  } catch {
    return false;
  }
}

function findNearestProjectRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (isProjectRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getProjectRoot(): string {
  const envRoot = process.env.WR_TRADE_PRO_ROOT;
  if (envRoot && isProjectRoot(envRoot)) return path.resolve(envRoot);

  if (app.isPackaged) {
    const fromExecutable = findNearestProjectRoot(path.dirname(process.execPath));
    if (fromExecutable) return fromExecutable;
  }

  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '../..'),
    path.dirname(process.execPath),
    process.resourcesPath ? path.join(process.resourcesPath, 'app') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const direct = path.resolve(candidate);
    if (isProjectRoot(direct)) return direct;
    const nearest = findNearestProjectRoot(direct);
    if (nearest) return nearest;
  }

  return path.resolve(__dirname, '../..');
}

const PROJECT_ROOT = getProjectRoot();
const APP_DATA_DIR = path.join(PROJECT_ROOT, 'data');
const OPTIONS_DATA_DIR = path.join(APP_DATA_DIR, 'options');

interface ServiceConfig {
  name: string;
  scriptName: string;
  port: number;
  waitFor?: string;
}

const CRITICAL_SERVICES: ServiceConfig[] = [
  { name: 'mt5_bridge', scriptName: 'mt5_bridge.py', port: 8766, waitFor: 'Servidor WebSocket iniciado com sucesso' },
  { name: 'spread_api', scriptName: 'spread_api.py', port: 5000, waitFor: 'Debug mode' },
  { name: 'volatility_api', scriptName: 'volatility_api.py', port: 5555, waitFor: 'localhost:5555' },
];

function getPythonPath(): string {
  // Use the IA_Day_Trading conda environment Python
  const condaEnvPath = 'C:\\Users\\rwres\\anaconda3\\envs\\IA_Day_Trading\\python.exe';
  return condaEnvPath;
}

function getPythonServiceScriptPath(scriptName: string): { scriptPath: string; cwd: string } {
  if (asarDisabled && app.isPackaged) {
    return {
      scriptPath: path.join(process.resourcesPath!, 'app', 'python', scriptName),
      cwd: path.join(process.resourcesPath!, 'app', 'python'),
    };
  } else {
    return {
      scriptPath: path.join(__dirname, '../../python', scriptName),
      cwd: path.join(__dirname, '../../python'),
    };
  }
}

async function waitForPort(port: number, timeout = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const http = await import('http');
      const result = await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://localhost:${port}`, (res) => {
          res.destroy();
          if (res.statusCode && res.statusCode < 500) resolve();
          else reject(new Error(`Port ${port} returned ${res.statusCode}`));
        });
        req.on('error', () => reject(new Error(`Port ${port} not ready`)));
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return; // Port is ready
    } catch {
      // Port not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Port ${port} never became available`);
}

function startPythonService(cfg: ServiceConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const { scriptPath, cwd } = getPythonServiceScriptPath(cfg.scriptName);
    const pythonPath = getPythonPath();

    console.log(`[Electron] Starting ${cfg.name}...`);
    console.log(`[${cfg.name}] Script path:`, scriptPath);
    console.log(`[${cfg.name}] CWD:`, cwd);

    const child = spawn(pythonPath, [scriptPath], {
      cwd: cwd,
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
      if (resolved) return;
      resolved = true;
      cleanup();
      console.log(`[${cfg.name}] Timeout reached, assuming ready`);
      resolve();
    }, 15000);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      console.log(`[${cfg.name} stdout]`, text.trim());
      if (cfg.waitFor && text.includes(cfg.waitFor)) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        console.log(`[${cfg.name}] Ready!`);
        resolve();
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      console.log(`[${cfg.name} stderr]`, text.trim());
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      console.error(`[${cfg.name} error]`, err);
      // Fatal error - reject
      reject(new Error(`[${cfg.name}] failed to start: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (resolved) return;
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
      } else {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve();
        }
      }
    });
  });
}

async function restartPythonService(cfg: ServiceConfig, maxRetries = 3): Promise<void> {
  let attempts = 0;
  while (attempts < maxRetries) {
    attempts++;
    console.log(`[Electron] Restarting ${cfg.name} (attempt ${attempts}/${maxRetries})...`);
    try {
      await startPythonService(cfg);
      console.log(`[Electron] ${cfg.name} restarted successfully`);
      return;
    } catch (err) {
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

async function startPythonServices(): Promise<void> {
  console.log('[Electron] Starting Python backend services...');

  // Wait briefly to ensure ports from previous session are freed (TIME_WAIT on Windows)
  await new Promise((r) => setTimeout(r, 1500));

  const results = await Promise.allSettled(
    CRITICAL_SERVICES.map((cfg) => startPythonService(cfg))
  );

  const failed = results
    .map((r, i) => ({ cfg: CRITICAL_SERVICES[i], result: r }))
    .filter(({ result }) => result.status === 'rejected');

  if (failed.length > 0) {
    const names = failed.map(({ cfg }) => cfg.name).join(', ');
    console.error(`[Electron] Critical services failed: ${names}`);
    // Try to restart each failed service once
    await Promise.allSettled(
      failed.map(({ cfg }) => restartPythonService(cfg, 1))
    );
  }

  console.log('[Electron] All Python services started');
}

function stopPythonServices(): void {
  console.log('[Electron] Stopping Python services...');
  for (const proc of pythonProcesses) {
    try {
      // On Windows, SIGTERM may not work reliably — use taskkill for forceful cleanup
      if (process.platform === 'win32' && proc.pid) {
        try {
          spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
            stdio: 'ignore',
            shell: true,
            windowsHide: true,
          });
        } catch {
          // Fallback to SIGTERM if taskkill fails
        }
      }
      proc.kill('SIGTERM');
    } catch (e) {
      // Process might already be dead
    }
  }
  pythonProcesses = [];
}

function startNextServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const appFolder = path.join(process.resourcesPath!, 'app');
    const nextDir = path.join(appFolder, '.next');
    const nextBin = path.join(appFolder, 'node_modules', 'next', 'dist', 'bin', 'next');
    const serverCwd = appFolder;

    console.log('[Electron] nextDir =', nextDir);
    console.log('[Electron] nextBin =', nextBin);
    console.log('[Electron] serverCwd =', serverCwd);

    const child = spawn(
      'node',
      [nextBin, 'start', '-p', String(PORT)],
      {
        cwd: serverCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      }
    );

    nextServer = child;

    let output = '';
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      console.log('[next stdout]', text.trim());
      if (text.includes('Ready') || text.includes('started server')) {
        resolve();
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
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
    console.log('[Electron] Starting Next.js production server...');
    await startNextServer();
    console.log('[Electron] Next.js server ready, launching window...');
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#0f172a',
  });

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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonServices();
  if (nextServer) {
    try {
      nextServer.kill('SIGTERM');
    } catch (e) {
      // Already dead
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonServices();
});

ipcMain.handle('open-external', async (_, url: string) => {
  // Validate URL scheme before opening
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.warn('[Electron] Blocked open-external with invalid scheme:', url);
    return;
  }
  await shell.openExternal(url);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-user-data-path', () => {
  return APP_DATA_DIR;
});

// ─── SQLite for Options (v4) ─────────────────────────────────────────────────
const DB_PATH = path.join(OPTIONS_DATA_DIR, 'options_data.db');

function ensureOptionsDB(): ReturnType<typeof Database> {
  fs.mkdirSync(OPTIONS_DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
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

  const existingColumns = new Set(
    db.prepare('PRAGMA table_info(options)').all().map((row: { name: string }) => row.name)
  );
  if (!existingColumns.has('cabe_10k')) {
    db.exec('ALTER TABLE options ADD COLUMN cabe_10k INTEGER');
  }
  if (!existingColumns.has('cabe_capital')) {
    db.exec('ALTER TABLE options ADD COLUMN cabe_capital INTEGER');
  }

  return db;
}

ipcMain.handle('save-options-scan', async (_, data: {
  asset: string;
  spot: number;
  volData: { dailyStd: number; annualStd: number; weeklyPct: number; mean30d: number; std30d: number; lastClose: number; nCandles: number } | null;
  calls: { symbol: string; strike: number; bid: number; ask: number; spreadPct?: number; otmPct: number; dte: number; expiration: string; anualizado: number; pExerc?: number; estilo?: string; isWeekly?: boolean }[];
  puts: { symbol: string; strike: number; bid: number; ask: number; spreadPct?: number; otmPct: number; dte: number; expiration: string; anualizado: number; pExerc?: number; estilo?: string; isWeekly?: boolean }[];
}) => {
  try {
    const db = ensureOptionsDB();
    const now = new Date().toISOString();

    const prev = db.prepare('SELECT id FROM scans WHERE asset = ? ORDER BY id DESC LIMIT 1').get(data.asset) as { id: number } | undefined;
    if (prev) {
      db.prepare('DELETE FROM options WHERE scan_id = ?').run(prev.id);
      db.prepare('DELETE FROM scans WHERE id = ?').run(prev.id);
    }

    const volJson = data.volData ? JSON.stringify(data.volData) : null;
    const scanResult = db.prepare('INSERT INTO scans (asset, scanned_at, spot, vol_data) VALUES (?,?,?,?)').run(data.asset, now, data.spot, volJson);
    const scanId = scanResult.lastInsertRowid as number;

    const insertOpt = db.prepare(`
      INSERT INTO options (scan_id, symbol, strike, bid, ask, spread_pct, otm_pct, dte, venc, tipo, estilo, anual_pct, p_exerc, custo_r, cabe_10k, cabe_capital, opt_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const o of data.calls) {
      insertOpt.run(scanId, o.symbol, o.strike, o.bid, o.ask ?? 0, o.spreadPct ?? 0, o.otmPct, o.dte, o.expiration.split('T')[0], 'CALL', o.estilo ?? 'EUROPEIA', o.anualizado * 100, o.pExerc ?? 0, o.strike * 100, 1, 1, 'CALL');
    }
    for (const p of data.puts) {
      insertOpt.run(scanId, p.symbol, p.strike, p.bid, p.ask ?? 0, p.spreadPct ?? 0, p.otmPct, p.dte, p.expiration.split('T')[0], 'PUT', p.estilo ?? 'EUROPEIA', p.anualizado * 100, p.pExerc ?? 0, p.strike * 100, 1, 1, 'PUT');
    }

    db.close();
    console.log(`[Options] Scan saved: ${data.asset} (id=${scanId})`);
    return { success: true, scanId };
  } catch (e) {
    console.error('[Options] DB save error:', e);
    return { success: false, error: String(e) };
  }
});

ipcMain.handle('get-last-options-scan', async (_, asset: string) => {
  try {
    const db = ensureOptionsDB();
    const scan = db.prepare('SELECT * FROM scans WHERE asset = ? ORDER BY id DESC LIMIT 1').get(asset) as any;
    if (!scan) { db.close(); return null; }
    const options = db.prepare('SELECT * FROM options WHERE scan_id = ?').all(scan.id);
    db.close();
    return { scan, options };
  } catch (e) {
    console.error('[Options] DB read error:', e);
    return null;
  }
});

ipcMain.handle('get-options-history', async (_, limit = 10) => {
  try {
    const db = ensureOptionsDB();
    const scans = db.prepare('SELECT * FROM scans ORDER BY id DESC LIMIT ?').all(limit);
    db.close();
    return scans;
  } catch (e) {
    return [];
  }
});

// ─── Uncaught exceptions ──────────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('[Electron] Uncaught exception:', error);
});
