const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL = null;
let db = null;
let dbPath = null;

async function initStorage(app) {
  if (db) return db;

  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
    });
  }

  const userPath = app.getPath('userData');
  dbPath = path.join(userPath, 'portfolio.sqlite');

  let data = null;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    data = new Uint8Array(buffer);
  }

  db = data ? new SQL.Database(data) : new SQL.Database();
  bootstrapSchema();
  return db;
}

function ensureDb() {
  if (!db) {
    throw new Error('Database initialised değil');
  }
}

function persist() {
  ensureDb();
  if (!dbPath) {
    throw new Error('Database path bulunamadı');
  }
  const binaryArray = db.export();
  fs.writeFileSync(dbPath, Buffer.from(binaryArray));
}

function bootstrapSchema() {
  ensureDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      shares REAL NOT NULL,
      total_cost REAL NOT NULL,
      avg_price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      buy_date TEXT,
      stop_loss REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_balances (
      currency TEXT PRIMARY KEY,
      amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares REAL,
      amount REAL,
      price REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS reporter_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email_enabled INTEGER NOT NULL DEFAULT 0,
      email_address TEXT,
      smtp_host TEXT,
      smtp_port INTEGER,
      smtp_username TEXT,
      smtp_password TEXT,
      from_address TEXT,
      check_interval INTEGER NOT NULL DEFAULT 60,
      last_run TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holding_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      last_triggered TEXT NOT NULL,
      UNIQUE(holding_id, alert_type)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const stmt = db.prepare('SELECT COUNT(*) AS c FROM reporter_settings WHERE id = 1');
  stmt.step();
  const { c } = stmt.getAsObject();
  stmt.free();

  if (!c) {
    const insert = db.prepare('INSERT INTO reporter_settings (id, email_enabled, check_interval) VALUES (1, 0, 60)');
    insert.run();
    insert.free();
    persist();
  }

  ensureQuoteProviderDefault();
}

function ensureQuoteProviderDefault() {
  const existing = getRow('SELECT value FROM app_settings WHERE key = :key', { ':key': 'quote_provider' });
  if (!existing || !existing.value) {
    setAppSetting('quote_provider', 'polygon');
  }
}

function getAppSetting(key) {
  ensureDb();
  const row = getRow('SELECT value FROM app_settings WHERE key = :key', { ':key': key });
  return row ? row.value : null;
}

function setAppSetting(key, value) {
  ensureDb();
  if (value === null || value === undefined) {
    run('DELETE FROM app_settings WHERE key = :key', { ':key': key });
    return null;
  }
  run(`
    INSERT INTO app_settings (key, value)
    VALUES (:key, :value)
    ON CONFLICT(key) DO UPDATE SET value = :value
  `, { ':key': key, ':value': String(value) });
  return String(value);
}

function getQuoteProvider() {
  const raw = (getAppSetting('quote_provider') || '').toLowerCase();
  if (raw === 'polygon' || raw === 'yahoo') {
    return raw;
  }
  return setQuoteProvider('polygon');
}

function setQuoteProvider(provider) {
  const normalized = (provider || '').toLowerCase();
  const allowed = ['polygon', 'yahoo'];
  if (!allowed.includes(normalized)) {
    throw new Error(`Geçersiz sağlayıcı: ${provider}`);
  }
  setAppSetting('quote_provider', normalized);
  return normalized;
}

function allRows(sql, params = {}) {
  ensureDb();
  const stmt = db.prepare(sql);
  if (params && Object.keys(params).length) {
    stmt.bind(params);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function getRow(sql, params = {}) {
  ensureDb();
  const stmt = db.prepare(sql);
  if (params && Object.keys(params).length) {
    stmt.bind(params);
  }
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

function run(sql, params = {}) {
  ensureDb();
  const stmt = db.prepare(sql);
  if (params && Object.keys(params).length) {
    stmt.bind(params);
  }
  stmt.run();
  stmt.free();
  persist();
}

function getPortfolioSnapshot() {
  const holdings = allRows(`
    SELECT id, symbol, shares, total_cost, avg_price, currency, buy_date, stop_loss, created_at, updated_at
    FROM holdings
    ORDER BY symbol ASC
  `).map((row) => ({
    ...row,
    shares: Number(row.shares),
    total_cost: Number(row.total_cost),
    avg_price: Number(row.avg_price),
    stop_loss: row.stop_loss != null ? Number(row.stop_loss) : null,
  }));

  const cash = allRows('SELECT currency, amount FROM cash_balances').map((row) => ({
    currency: row.currency,
    amount: Number(row.amount),
  }));

  return { holdings, cash };
}

function upsertHolding({ symbol, shares, totalCost, avgPrice, currency = 'USD', buyDate = null, stopLoss = null }) {
  ensureDb();
  const data = {
    ':symbol': symbol.toUpperCase(),
    ':shares': Number(shares),
    ':total_cost': Number(totalCost),
    ':avg_price': Number(avgPrice),
    ':currency': currency,
    ':buy_date': buyDate,
    ':stop_loss': stopLoss != null ? Number(stopLoss) : null,
  };

  const stmt = db.prepare(`
    INSERT INTO holdings (symbol, shares, total_cost, avg_price, currency, buy_date, stop_loss, updated_at)
    VALUES (:symbol, :shares, :total_cost, :avg_price, :currency, :buy_date, :stop_loss, CURRENT_TIMESTAMP)
    ON CONFLICT(symbol) DO UPDATE SET
      shares = :shares,
      total_cost = :total_cost,
      avg_price = :avg_price,
      currency = :currency,
      buy_date = :buy_date,
      stop_loss = :stop_loss,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(data);
  stmt.free();

  const trx = db.prepare(`
    INSERT INTO transactions (type, symbol, shares, amount, price, currency)
    VALUES ('buy', :symbol, :shares, :total_cost, :avg_price, :currency)
  `);
  trx.run(data);
  trx.free();

  persist();

  return getHoldingBySymbol(data[':symbol']);
}

function getHoldingBySymbol(symbol) {
  const row = getRow(`
    SELECT id, symbol, shares, total_cost, avg_price, currency, buy_date, stop_loss, created_at, updated_at
    FROM holdings
    WHERE symbol = :symbol
  `, { ':symbol': symbol });
  if (!row) return null;
  return {
    ...row,
    shares: Number(row.shares),
    total_cost: Number(row.total_cost),
    avg_price: Number(row.avg_price),
    stop_loss: row.stop_loss != null ? Number(row.stop_loss) : null,
  };
}

function updateHolding(symbol, updates = {}) {
  const existing = getHoldingBySymbol(symbol.toUpperCase());
  if (!existing) {
    throw new Error('Holding bulunamadı');
  }

  const payload = {
    ':symbol': existing.symbol,
    ':shares': updates.shares != null ? Number(updates.shares) : existing.shares,
    ':total_cost': updates.totalCost != null ? Number(updates.totalCost) : existing.total_cost,
    ':avg_price': updates.avgPrice != null ? Number(updates.avgPrice) : existing.avg_price,
    ':currency': updates.currency || existing.currency,
    ':buy_date': updates.buyDate !== undefined ? updates.buyDate : existing.buy_date,
    ':stop_loss': updates.stopLoss !== undefined ? (updates.stopLoss != null ? Number(updates.stopLoss) : null) : existing.stop_loss,
  };

  run(`
    UPDATE holdings SET
      shares = :shares,
      total_cost = :total_cost,
      avg_price = :avg_price,
      currency = :currency,
      buy_date = :buy_date,
      stop_loss = :stop_loss,
      updated_at = CURRENT_TIMESTAMP
    WHERE symbol = :symbol
  `, payload);

  return getHoldingBySymbol(existing.symbol);
}

function sellHolding({ symbol, sellPrice, sellDate = null }) {
  const holding = getHoldingBySymbol(symbol.toUpperCase());
  if (!holding) {
    throw new Error('Holding bulunamadı');
  }

  const price = Number(sellPrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Geçerli satış fiyatı gerekli');
  }

  const proceeds = price * holding.shares;

  run('DELETE FROM holdings WHERE id = :id', { ':id': holding.id });

  run(`
    INSERT INTO transactions (type, symbol, shares, amount, price, currency, occurred_at)
    VALUES ('sell', :symbol, :shares, :amount, :price, :currency, COALESCE(:occurred_at, CURRENT_TIMESTAMP))
  `, {
    ':symbol': holding.symbol,
    ':shares': holding.shares,
    ':amount': proceeds,
    ':price': price,
    ':currency': holding.currency,
    ':occurred_at': sellDate,
  });

  upsertCash({ currency: holding.currency, delta: proceeds });

  return {
    proceeds,
    currency: holding.currency,
    removedHolding: holding,
    cash: getCashBalances(),
  };
}

function upsertCash({ currency = 'USD', delta = 0 }) {
  const row = getRow('SELECT amount FROM cash_balances WHERE currency = :currency', { ':currency': currency });
  if (row) {
    run('UPDATE cash_balances SET amount = amount + :delta WHERE currency = :currency', {
      ':delta': delta,
      ':currency': currency,
    });
  } else {
    run('INSERT INTO cash_balances (currency, amount) VALUES (:currency, :amount)', {
      ':currency': currency,
      ':amount': delta,
    });
  }
}

function getCashBalances() {
  return allRows('SELECT currency, amount FROM cash_balances').map((row) => ({
    currency: row.currency,
    amount: Number(row.amount),
  }));
}

function saveReporterSettings(settings) {
  const payload = {
    ':email_enabled': settings.email_enabled ? 1 : 0,
    ':email_address': settings.email_address || null,
    ':smtp_host': settings.smtp_host || null,
    ':smtp_port': settings.smtp_port ? Number(settings.smtp_port) : null,
    ':smtp_username': settings.smtp_username || null,
    ':smtp_password': settings.smtp_password || null,
    ':from_address': settings.from_address || null,
    ':check_interval': settings.check_interval ? Math.max(30, Number(settings.check_interval)) : 60,
  };

  run(`
    UPDATE reporter_settings SET
      email_enabled = :email_enabled,
      email_address = :email_address,
      smtp_host = :smtp_host,
      smtp_port = :smtp_port,
      smtp_username = :smtp_username,
      smtp_password = :smtp_password,
      from_address = :from_address,
      check_interval = :check_interval
    WHERE id = 1
  `, payload);

  return getReporterSettings();
}

function updateReporterLastRun(timestampIso) {
  run('UPDATE reporter_settings SET last_run = :last_run WHERE id = 1', { ':last_run': timestampIso });
}

function getReporterSettings() {
  const row = getRow('SELECT * FROM reporter_settings WHERE id = 1');
  if (!row) return null;
  return {
    email_enabled: Boolean(row.email_enabled),
    email_address: row.email_address || '',
    smtp_host: row.smtp_host || '',
    smtp_port: row.smtp_port ? Number(row.smtp_port) : null,
    smtp_username: row.smtp_username || '',
    smtp_password: row.smtp_password || '',
    from_address: row.from_address || '',
    check_interval: row.check_interval ? Number(row.check_interval) : 60,
    last_run: row.last_run || null,
  };
}

function listHoldingsForReporter() {
  return allRows(`
    SELECT id, symbol, shares, avg_price, stop_loss, currency, buy_date
    FROM holdings
    ORDER BY symbol
  `).map((row) => ({
    id: row.id,
    symbol: row.symbol,
    shares: Number(row.shares),
    avg_price: Number(row.avg_price),
    stop_loss: row.stop_loss != null ? Number(row.stop_loss) : null,
    currency: row.currency,
    buy_date: row.buy_date,
  }));
}

function recordAlertTrigger({ holdingId, alertType, timestampIso }) {
  run(`
    INSERT INTO alerts_log (holding_id, alert_type, last_triggered)
    VALUES (:holding_id, :alert_type, :last_triggered)
    ON CONFLICT(holding_id, alert_type) DO UPDATE SET last_triggered = :last_triggered
  `, {
    ':holding_id': holdingId,
    ':alert_type': alertType,
    ':last_triggered': timestampIso,
  });
}

function getLastAlertFor({ holdingId, alertType }) {
  const row = getRow('SELECT last_triggered FROM alerts_log WHERE holding_id = :holding_id AND alert_type = :alert_type', {
    ':holding_id': holdingId,
    ':alert_type': alertType,
  });
  return row ? row.last_triggered : null;
}

module.exports = {
  initStorage,
  getPortfolioSnapshot,
  upsertHolding,
  sellHolding,
  getHoldingBySymbol,
  getCashBalances,
  updateHolding,
  saveReporterSettings,
  getReporterSettings,
  updateReporterLastRun,
  listHoldingsForReporter,
  recordAlertTrigger,
  getLastAlertFor,
  getQuoteProvider,
  setQuoteProvider,
};
