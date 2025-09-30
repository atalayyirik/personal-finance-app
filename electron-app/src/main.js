if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const yaml = require('js-yaml');
const storage = require('./storage');
const { initReporter, rescheduleReporter } = require('./reporter');

const jobs = new Map();
let jobSeq = 0;

const repoRoot = path.resolve(__dirname, '..', '..');
loadEnvFile(path.resolve(repoRoot, '.env'));
const scannerDir = path.resolve(repoRoot, 'scanner-agent');
const filtersPath = path.resolve(scannerDir, 'filters.yaml');

const scriptsDir = path.resolve(repoRoot, 'electron-app', 'scripts');

const QUOTE_PROVIDERS = ['polygon', 'yahoo'];

const defaultPythonBin = detectDefaultPython();
process.env.WORKBENCH_PYTHON = defaultPythonBin;

const toolPaths = {
  amountCalculator: path.resolve(repoRoot, 'amount_calculator', 'amount_calculator.py'),
  scanner: path.resolve(scannerDir, 'scanner.py'),
  quoteFetcher: path.resolve(scriptsDir, 'get_quote.py'),
  chartGenerator: path.resolve(scriptsDir, 'generate_chart.py'),
  filters: filtersPath,
};

function detectDefaultPython() {
  if (process.env.WORKBENCH_PYTHON && process.env.WORKBENCH_PYTHON.trim()) {
    return process.env.WORKBENCH_PYTHON.trim();
  }
  const workbenchCandidate = path.resolve(repoRoot, 'Workbench', 'bin', 'python');
  if (fs.existsSync(workbenchCandidate)) {
    return workbenchCandidate;
  }
  return 'python3';
}

function loadEnvFile(filePath) {
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        return;
      }
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) {
        return;
      }
      const key = line.slice(0, eqIdx).trim();
      if (!key) {
        return;
      }
      let value = line.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
      }
      if (!Object.prototype.hasOwnProperty.call(process.env, key) || process.env[key] === '') {
        process.env[key] = value;
      }
    });
  } catch (err) {
    console.warn(`.env yüklenemedi (${filePath}):`, err);
  }
}

function loadFiltersConfig() {
  try {
    const raw = fs.readFileSync(filtersPath, 'utf-8');
    const data = yaml.load(raw) || {};
    return data;
  } catch (err) {
    return null;
  }
}

function writeFiltersConfig(config) {
  const tmpDir = path.join(scannerDir, '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const filePath = path.join(tmpDir, `filters_${Date.now()}_${Math.random().toString(16).slice(2)}.yaml`);
  const yamlStr = yaml.dump(config, { noRefs: true });
  fs.writeFileSync(filePath, yamlStr, 'utf-8');
  return filePath;
}

function persistFiltersConfig(config) {
  const dir = path.dirname(filtersPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const yamlStr = yaml.dump(config, { noRefs: true });
  fs.writeFileSync(filtersPath, yamlStr, 'utf-8');
  return config;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.on('ready-to-show', () => {
    win.show();
  });

  win.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(async () => {
  await storage.initStorage(app);
  createWindow();
  initReporter({ fetchQuote: runQuoteFetcher });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function runPythonScript(scriptPath, args = [], options = {}) {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    throw new Error(`Python script bulunamadı: ${scriptPath}`);
  }

  const pythonBin = options.pythonPath && options.pythonPath.trim()
    ? options.pythonPath.trim()
    : defaultPythonBin;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [scriptPath, ...args], {
      cwd: options.cwd || path.dirname(scriptPath),
      env: { ...process.env, ...(options.env || {}) },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const messageRaw = (stderr || stdout || '').trim();
        if (messageRaw) {
          try {
            const parsed = JSON.parse(messageRaw);
            if (parsed && parsed.error) {
              reject(new Error(parsed.error));
              return;
            }
          } catch (err) {
            // ignore parse fail
          }
        }
        reject(new Error(messageRaw || `Python script ${code} kodu ile bitti`));
      }
    });
  });
}

async function runPythonJson(scriptPath, args = [], options = {}) {
  const output = await runPythonScript(scriptPath, args, options);
  try {
    return JSON.parse(output || '{}');
  } catch (err) {
    throw new Error('Geçersiz JSON çıktı');
  }
}

async function runQuoteFetcher(symbol, options = {}) {
  if (!symbol || !symbol.trim()) {
    throw new Error('Ticker gerekli');
  }
  const script = toolPaths.quoteFetcher;
  const { provider: overrideProvider, ...runnerOptions } = options;
  const storedProvider = storage.getQuoteProvider();
  const candidate = (overrideProvider || storedProvider || 'polygon').toLowerCase();
  const provider = QUOTE_PROVIDERS.includes(candidate) ? candidate : storedProvider;
  const args = [symbol.trim(), '--provider', provider];
  const mergedEnv = { ...(runnerOptions.env || {}), QUOTE_PROVIDER: provider };
  const data = await runPythonJson(script, args, { ...runnerOptions, env: mergedEnv });
  if (data && data.error) {
    throw new Error(data.error);
  }
  if (data) {
    data.provider = provider;
  }
  return data;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normaliseDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

ipcMain.handle('python:get-defaults', () => {
  const safeTools = {
    amountCalculator: fs.existsSync(toolPaths.amountCalculator) ? toolPaths.amountCalculator : null,
    scanner: fs.existsSync(toolPaths.scanner) ? toolPaths.scanner : null,
    quoteFetcher: fs.existsSync(toolPaths.quoteFetcher) ? toolPaths.quoteFetcher : null,
  };
  return {
    repoRoot,
    pythonPath: defaultPythonBin,
    tools: {
      ...safeTools,
    },
    filters: {
      path: filtersPath,
      data: loadFiltersConfig(),
    },
    portfolio: storage.getPortfolioSnapshot(),
    reporter: storage.getReporterSettings(),
    quotes: {
      provider: storage.getQuoteProvider(),
      providers: QUOTE_PROVIDERS,
    },
  };
});

ipcMain.handle('python:run', (event, payload) => {
  const { script, args = [], cwd, pythonPath, env = {} } = payload || {};

  if (!script) {
    throw new Error('script path is required');
  }

  if (!fs.existsSync(script)) {
    throw new Error(`script not found: ${script}`);
  }

  const jobId = `job-${Date.now()}-${++jobSeq}`;
  const pythonBin = pythonPath && pythonPath.trim() ? pythonPath.trim() : 'python3';

  const child = spawn(pythonBin, [script, ...args], {
    cwd: cwd || path.dirname(script),
    env: { ...process.env, ...env },
  });

  jobs.set(jobId, child);

  child.stdout.on('data', (data) => {
    event.senderFrame.send('python:output', { jobId, stream: 'stdout', data: data.toString() });
  });

  child.stderr.on('data', (data) => {
    event.senderFrame.send('python:output', { jobId, stream: 'stderr', data: data.toString() });
  });

  child.on('error', (err) => {
    event.senderFrame.send('python:exit', { jobId, code: null, signal: null, error: err.message });
    jobs.delete(jobId);
  });

  child.on('close', (code, signal) => {
    event.senderFrame.send('python:exit', { jobId, code, signal, error: null });
    jobs.delete(jobId);
  });

  return { jobId };
});

ipcMain.handle('python:stop', (event, jobId) => {
  const child = jobs.get(jobId);
  if (!child) {
    return { stopped: false, reason: 'not-found' };
  }
  try {
    child.kill();
    jobs.delete(jobId);
    return { stopped: true };
  } catch (err) {
    return { stopped: false, reason: err.message };
  }
});

ipcMain.handle('python:list-jobs', () => {
  return Array.from(jobs.keys());
});

ipcMain.handle('quotes:get', async (_event, payload) => {
  const { symbol, provider, pythonPath, env = {} } = payload || {};
  return runQuoteFetcher(symbol, { provider, pythonPath, env });
});

ipcMain.handle('quotes:set-provider', (_event, payload) => {
  const provider = payload && payload.provider;
  return {
    provider: storage.setQuoteProvider(provider),
    providers: QUOTE_PROVIDERS,
  };
});

ipcMain.handle('filters:load', () => {
  return {
    path: filtersPath,
    data: loadFiltersConfig(),
  };
});

ipcMain.handle('filters:prepare', (_event, config) => {
  if (!config || typeof config !== 'object') {
    throw new Error('Geçerli filter config gerekli');
  }
  const filePath = writeFiltersConfig(config);
  return { path: filePath };
});

ipcMain.handle('filters:save', (_event, config) => {
  if (!config || typeof config !== 'object') {
    throw new Error('Geçerli filter config gerekli');
  }
  const data = persistFiltersConfig(config);
  return { path: filtersPath, data };
});

ipcMain.handle('portfolio:load', () => {
  return storage.getPortfolioSnapshot();
});

ipcMain.handle('portfolio:bought', async (_event, payload) => {
  const { symbol, mode, shares, totalAmount, avgPrice, currency, buyDate, stopLoss } = payload || {};
  const symbolSafe = (symbol || '').trim().toUpperCase();
  if (!symbolSafe) {
    throw new Error('Ticker gerekli');
  }
  const avg = parseNumber(avgPrice);
  if (avg === null || avg <= 0) {
    throw new Error('Geçerli ort. alış fiyatı gerekli');
  }

  let shareCount = parseNumber(shares);
  let totalCost = parseNumber(totalAmount);

  if ((mode === 'amount' || shareCount === null) && totalCost !== null) {
    if (totalCost <= 0) {
      throw new Error('Toplam tutar 0’dan büyük olmalı');
    }
    shareCount = totalCost / avg;
  } else if (shareCount !== null) {
    if (shareCount <= 0) {
      throw new Error('Lot 0’dan büyük olmalı');
    }
    totalCost = shareCount * avg;
  } else {
    throw new Error('Lot veya toplam tutar girin');
  }

  shareCount = Number(shareCount.toFixed(4));
  totalCost = Number(totalCost.toFixed(2));

  const stop = stopLoss !== undefined ? parseNumber(stopLoss) : null;
  const stored = storage.upsertHolding({
    symbol: symbolSafe,
    shares: shareCount,
    totalCost,
    avgPrice: avg,
    currency: (currency || 'USD').toUpperCase(),
    buyDate: normaliseDate(buyDate) || new Date().toISOString(),
    stopLoss: stop,
  });

  rescheduleReporter();

  return {
    holding: stored,
    snapshot: storage.getPortfolioSnapshot(),
  };
});

ipcMain.handle('portfolio:update', (_event, payload) => {
  const { symbol } = payload || {};
  const symbolSafe = (symbol || '').trim().toUpperCase();
  if (!symbolSafe) {
    throw new Error('Ticker gerekli');
  }

  const updates = {};
  if (payload.stopLoss !== undefined) {
    updates.stopLoss = parseNumber(payload.stopLoss);
  }
  if (payload.buyDate !== undefined) {
    updates.buyDate = normaliseDate(payload.buyDate);
  }
  if (payload.avgPrice !== undefined) {
    const avg = parseNumber(payload.avgPrice);
    if (avg === null || avg <= 0) {
      throw new Error('Geçerli ort. fiyat gerekli');
    }
    updates.avgPrice = avg;
  }
  if (payload.shares !== undefined) {
    const shareCount = parseNumber(payload.shares);
    if (shareCount === null || shareCount <= 0) {
      throw new Error('Lot 0’dan büyük olmalı');
    }
    updates.shares = shareCount;
  }
  if (payload.totalCost !== undefined) {
    const totalCost = parseNumber(payload.totalCost);
    if (totalCost === null || totalCost <= 0) {
      throw new Error('Toplam tutar 0’dan büyük olmalı');
    }
    updates.totalCost = totalCost;
  }
  if (payload.currency) {
    updates.currency = payload.currency.toUpperCase();
  }

  const updated = storage.updateHolding(symbolSafe, updates);
  rescheduleReporter();
  return {
    holding: updated,
    snapshot: storage.getPortfolioSnapshot(),
  };
});

ipcMain.handle('portfolio:sell', async (_event, payload) => {
  const { symbol, price, sellDate } = payload || {};
  const symbolSafe = (symbol || '').trim().toUpperCase();
  if (!symbolSafe) {
    throw new Error('Ticker gerekli');
  }

  let sellPrice = parseNumber(price);
  if (sellPrice === null || sellPrice <= 0) {
    const quote = await runQuoteFetcher(symbolSafe, {});
    sellPrice = Number(quote.price);
  }
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    throw new Error('Satış fiyatı belirlenemedi');
  }

  const result = storage.sellHolding({
    symbol: symbolSafe,
    sellPrice,
    sellDate: normaliseDate(sellDate),
  });

  rescheduleReporter();

  return {
    proceeds: result.proceeds,
    currency: result.currency,
    cash: result.cash,
    snapshot: storage.getPortfolioSnapshot(),
  };
});

ipcMain.handle('reporter:get-settings', () => {
  return {
    settings: storage.getReporterSettings(),
    holdings: storage.listHoldingsForReporter(),
  };
});

ipcMain.handle('reporter:save-settings', (_event, payload) => {
  const saved = storage.saveReporterSettings(payload || {});
  rescheduleReporter();
  return saved;
});

ipcMain.handle('chart:generate', async (_event, payload) => {
  const { symbol } = payload || {};
  const symbolSafe = (symbol || '').trim().toUpperCase();
  if (!symbolSafe) {
    throw new Error('Ticker gerekli');
  }
  const data = await runPythonJson(toolPaths.chartGenerator, [symbolSafe]);
  if (!data || !data.image) {
    throw new Error('Grafik üretilemedi');
  }
  return data;
});
