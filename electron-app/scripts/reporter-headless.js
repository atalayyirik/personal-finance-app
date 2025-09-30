'use strict';

const fs = require('fs');
const path = require('path');
const storage = require('../src/storage');
const { initReporter, rescheduleReporter } = require('../src/reporter');

// Resolve important paths
const repoRoot = path.resolve(__dirname, '..', '..');
const scriptsDir = path.resolve(repoRoot, 'electron-app', 'scripts');

// Load .env from repo root (simple parser similar to main.js)
function loadEnvFile(filePath) {
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) return;
      const key = line.slice(0, eqIdx).trim();
      if (!key) return;
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

loadEnvFile(path.resolve(repoRoot, '.env'));

// Determine Python binary
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

const defaultPythonBin = detectDefaultPython();

// Run Python helpers (copied from main.js with light tweaks)
const { spawn } = require('child_process');

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

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const messageRaw = (stderr || stdout || '').trim();
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
  const script = path.resolve(scriptsDir, 'get_quote.py');
  const { provider: overrideProvider, ...runnerOptions } = options;
  const storedProvider = storage.getQuoteProvider();
  const candidate = (overrideProvider || storedProvider || 'polygon').toLowerCase();
  const providers = ['polygon', 'yahoo'];
  const provider = providers.includes(candidate) ? candidate : storedProvider;
  const args = [symbol.trim(), '--provider', provider];
  const mergedEnv = { ...(runnerOptions.env || {}), QUOTE_PROVIDER: provider };
  const data = await runPythonJson(script, args, { ...runnerOptions, env: mergedEnv });
  if (data && data.error) {
    throw new Error(data.error);
  }
  if (data) data.provider = provider;
  return data;
}

function toBool(val, def = false) {
  if (val === undefined || val === null || val === '') return def;
  const v = String(val).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

async function configureFromEnv() {
  // Allow configuring reporter from environment/.env for headless usage
  const maybe = {
    email_enabled: process.env.REPORTER_EMAIL_ENABLED,
    email_address: process.env.REPORTER_EMAIL_ADDRESS,
    smtp_host: process.env.SMTP_HOST,
    smtp_port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    smtp_username: process.env.SMTP_USERNAME,
    smtp_password: process.env.SMTP_PASSWORD,
    from_address: process.env.FROM_ADDRESS,
    check_interval: process.env.CHECK_INTERVAL ? Math.max(30, Number(process.env.CHECK_INTERVAL)) : undefined,
  };

  const hasAny = Object.values(maybe).some((v) => v !== undefined && v !== '');
  if (!hasAny) return; // nothing to apply

  const payload = {
    email_enabled: toBool(maybe.email_enabled, undefined),
    email_address: maybe.email_address ?? undefined,
    smtp_host: maybe.smtp_host ?? undefined,
    smtp_port: Number.isFinite(maybe.smtp_port) ? maybe.smtp_port : undefined,
    smtp_username: maybe.smtp_username ?? undefined,
    smtp_password: maybe.smtp_password ?? undefined,
    from_address: maybe.from_address ?? undefined,
    check_interval: maybe.check_interval ?? undefined,
  };

  // Remove undefined fields so we don't overwrite with nulls unintentionally
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const saved = storage.saveReporterSettings(payload);
  return saved;
}

async function main() {
  // Determine user data path for SQLite file in headless mode
  const defaultUserData = path.resolve(repoRoot, 'electron-app', '.user-data');
  const userDataPath = process.env.WORKBENCH_USER_DATA && process.env.WORKBENCH_USER_DATA.trim()
    ? process.env.WORKBENCH_USER_DATA.trim()
    : defaultUserData;

  fs.mkdirSync(userDataPath, { recursive: true });

  // Minimal app shim for storage.initStorage
  const appShim = { getPath: (key) => {
    if (key === 'userData') return userDataPath;
    throw new Error(`Unsupported app.getPath key: ${key}`);
  }};

  await storage.initStorage(appShim);

  // Apply reporter settings from env (optional)
  await configureFromEnv();

  // Start reporter
  initReporter({ fetchQuote: runQuoteFetcher });
  rescheduleReporter();

  const settings = storage.getReporterSettings();
  console.log('[headless] Reporter başlatıldı');
  console.log('[headless] userData:', userDataPath);
  console.log('[headless] email_enabled:', settings.email_enabled);
  console.log('[headless] check_interval:', settings.check_interval);

  // Keep the process alive and re-evaluate schedule periodically in case settings change externally
  const keepAliveIntervalMs = 60 * 1000;
  const tick = setInterval(() => {
    try { rescheduleReporter(); } catch (err) { /* ignore */ }
  }, keepAliveIntervalMs);

  const shutdown = (signal) => {
    console.log(`[headless] Kapanıyor (${signal})`);
    clearInterval(tick);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[headless] Başlatma hatası:', err && err.message ? err.message : err);
  process.exit(1);
});

