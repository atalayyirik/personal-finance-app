let defaultPython = 'python3';

const state = {
  defaults: null,
  activeTab: 'amount',
  jobs: new Map(),
  views: {},
  quoteSettings: {
    provider: 'polygon',
    providers: ['polygon', 'yahoo'],
  },
};

const tabs = [
  { id: 'amount', label: 'Position Calculator', builder: buildAmountView },
  { id: 'scanner', label: 'Market Scanner', builder: buildScannerView },
  { id: 'portfolio', label: 'Portfolio Watch', builder: buildPortfolioView },
  { id: 'reporter', label: 'Automated Reporter', builder: buildReporterView },
];

const PORTFOLIO_DEFAULTS = {
  account: {
    id: '',
    currency: 'USD',
    equity: 0,
    dailyPnl: 0,
    settledCash: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    maintenanceMargin: 0,
    excessLiquidity: 0,
    buyingPower: 0,
    dividends: 0,
  },
  cash: [],
  holdings: [],
};

const SCANNER_FILTER_GROUPS = [
  {
    key: 'momentum',
    title: 'Momentum',
    description: 'StochRSI tabanlı ivme filtresi.',
    fields: [
      { path: 'momentum.enable_stochrsi', label: 'StochRSI filtresini aç', type: 'boolean' },
      { path: 'momentum.stochrsi_len', label: 'StochRSI periyot', type: 'number', numberType: 'int', step: '1' },
      { path: 'momentum.stochrsi_k', label: 'StochRSI %K', type: 'number', numberType: 'int', step: '1' },
      { path: 'momentum.stochrsi_d', label: 'StochRSI %D', type: 'number', numberType: 'int', step: '1' },
      { path: 'momentum.stochrsi_max', label: 'StochRSI üst sınır', type: 'number', step: '0.05' },
    ],
  },
  {
    key: 'universe',
    title: 'Fiyat Aralığı',
    description: 'Borsa fiyat evrenini sınırla.',
    fields: [
      { path: 'universe.min_price', label: 'Minimum fiyat', type: 'number', step: '0.01' },
      { path: 'universe.max_price', label: 'Maksimum fiyat', type: 'number', step: '0.01' },
    ],
  },
  {
    key: 'volume',
    title: 'Hacim',
    description: 'Ortalama hacim eşikleri.',
    fields: [
      { path: 'volume.avg_window_days', label: 'Ortalama gün sayısı', type: 'number', numberType: 'int', step: '1' },
      { path: 'volume.min_avg_volume', label: 'Minimum ort. hacim (adet)', type: 'number', step: '1000' },
      { path: 'volume.min_avg_dollar_vol', label: 'Minimum ort. hacim ($)', type: 'number', step: '1000' },
    ],
  },
  {
    key: 'fundamentals',
    title: 'Temeller',
    description: 'Piyasa değeri, beta ve YTD sınırları.',
    fields: [
      { path: 'fundamentals.market_cap_min', label: 'Asgari piyasa değeri', type: 'number', step: '1000000' },
      { path: 'fundamentals.market_cap_max', label: 'Azami piyasa değeri', type: 'number', step: '1000000' },
      { path: 'fundamentals.beta_min_5y', label: 'Minimum beta', type: 'number', step: '0.1' },
      { path: 'fundamentals.ytd_min_pct', label: 'YTD minimum (%)', type: 'number', step: '0.1' },
      { path: 'fundamentals.ytd_max_pct', label: 'YTD maksimum (%)', type: 'number', step: '0.1' },
      { path: 'fundamentals.require_ytd', label: 'YTD verisi zorunlu', type: 'boolean' },
      { path: 'fundamentals.analyst_ratings_allow', label: 'Kabul edilen analist notları (virgül ile)', type: 'list', placeholder: 'Strong Buy, Buy' },
      { path: 'fundamentals.require_analyst_rating', label: 'Analist notu zorunlu', type: 'boolean' },
    ],
  },
  {
    key: 'beta',
    title: 'Beta Ayarları',
    description: 'Getiri regresyonu parametreleri.',
    fields: [
      { path: 'beta.benchmark', label: 'Benchmark sembolü', type: 'text', placeholder: 'SPY' },
      { path: 'beta.years', label: 'Hesaplama süresi (yıl)', type: 'number', numberType: 'int', step: '1' },
      { path: 'beta.method', label: 'Yöntem', type: 'text', placeholder: 'daily_ols' },
      { path: 'beta.min_points', label: 'Minimum veri noktası', type: 'number', numberType: 'int', step: '10' },
      { path: 'beta.winsor_pct', label: 'Winsor yüzdesi', type: 'number', step: '0.01' },
    ],
  },
  {
    key: 'options',
    title: 'Opsiyonlar',
    description: 'Ek veri sağlayıcı ve uyarı ayarları.',
    fields: [
      { path: 'options.include_earnings', label: 'Earnings verisini ekle', type: 'boolean' },
      { path: 'options.earnings_provider', label: 'Earnings sağlayıcısı', type: 'select', options: [
        { value: 'yahoo', label: 'Yahoo' },
        { value: 'none', label: 'Kapalı' },
      ] },
      { path: 'options.quiet_warnings', label: 'Uyarıları sustur', type: 'boolean' },
      { path: 'options.analyst_ratings_provider', label: 'Analist notu sağlayıcısı', type: 'select', options: [
        { value: 'yahoo', label: 'Yahoo' },
        { value: 'none', label: 'Kapalı' },
      ] },
    ],
  },
  {
    key: 'trend',
    title: 'Trend',
    description: 'Hareketli ortalama kesişim süzgeci.',
    fields: [
      { path: 'trend.enable_ma_cross_filter', label: 'MA kesişim filtresi', type: 'boolean' },
      { path: 'trend.ma_mid', label: 'Orta periyot (MA)', type: 'number', numberType: 'int', step: '1' },
      { path: 'trend.ma_slow', label: 'Yavaş periyot (MA)', type: 'number', numberType: 'int', step: '1' },
      { path: 'trend.ma_cross_lookahead_days', label: 'Kesişim bakış (gün)', type: 'number', numberType: 'int', step: '1' },
      { path: 'trend.ma_cross_max_gap_pct', label: 'Maks. MA farkı (%)', type: 'number', step: '0.1' },
    ],
  },
];

(async function init() {
  const appEl = document.getElementById('app');
  appEl.textContent = 'Loading...';

  try {
    state.defaults = await window.pythonBridge.getDefaults();
    if (state.defaults.pythonPath) {
      defaultPython = state.defaults.pythonPath;
    }
    if (state.defaults.quotes) {
      state.quoteSettings = {
        provider: state.defaults.quotes.provider || state.quoteSettings.provider,
        providers: state.defaults.quotes.providers || state.quoteSettings.providers,
      };
    } else {
      state.defaults.quotes = { ...state.quoteSettings };
    }
  } catch (err) {
    appEl.textContent = `Defaults yüklenemedi: ${err.message}`;
    return;
  }

  window.pythonBridge.onOutput(handlePythonOutput);
  window.pythonBridge.onExit(handlePythonExit);

  appEl.innerHTML = '';
  appEl.appendChild(buildGlobalPanel());
  appEl.appendChild(buildTabs());
})();

function buildGlobalPanel() {
  const section = document.createElement('section');
  section.className = 'panel global-panel';

  const title = document.createElement('h2');
  title.textContent = 'Genel Ayarlar';

  const repoInfo = document.createElement('p');
  repoInfo.className = 'repo-path';
  repoInfo.textContent = `Repo kökü: ${state.defaults.repoRoot}`;

  section.appendChild(title);
  section.appendChild(repoInfo);

  const pythonInfo = document.createElement('p');
  pythonInfo.className = 'repo-path';
  pythonInfo.textContent = `Varsayılan Python: ${defaultPython}`;
  section.appendChild(pythonInfo);

  const providerField = document.createElement('label');
  providerField.className = 'field';
  providerField.textContent = 'Anlık veri sağlayıcısı';

  const providerSelect = document.createElement('select');
  const providers = Array.isArray(state.quoteSettings.providers)
    ? state.quoteSettings.providers
    : ['polygon', 'yahoo'];
  const labels = {
    polygon: 'Polygon.io',
    yahoo: 'Yahoo Finance',
  };

  providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider;
    option.textContent = labels[provider] || provider;
    providerSelect.appendChild(option);
  });

  providerSelect.value = state.quoteSettings.provider || 'polygon';
  if (providers.length <= 1) {
    providerSelect.disabled = true;
  }
  providerSelect.addEventListener('change', async () => {
    const selected = providerSelect.value;
    await updateProvider(selected);
  });

  providerField.appendChild(providerSelect);
  section.appendChild(providerField);

  const status = document.createElement('div');
  status.className = 'global-status hidden';
  section.appendChild(status);

  return section;

  function setStatus(kind, message) {
    status.textContent = message || '';
    status.className = 'global-status';
    if (!message) {
      status.classList.add('hidden');
      return;
    }
    status.classList.remove('hidden');
    if (kind) {
      status.classList.add(`is-${kind}`);
    }
  }

  async function updateProvider(provider) {
    const current = state.quoteSettings.provider;
    if (!provider || provider === current) {
      return;
    }
    providerSelect.disabled = true;
    setStatus('info', 'Sağlayıcı güncelleniyor...');
    try {
      const result = await window.pythonBridge.setQuoteProvider(provider);
      state.quoteSettings.provider = result.provider;
      if (result.providers) {
        state.quoteSettings.providers = result.providers;
      }
      state.defaults.quotes = { ...state.quoteSettings };
      providerSelect.value = result.provider;
      setStatus('success', `${labels[result.provider] || result.provider} seçildi.`);
    } catch (err) {
      providerSelect.value = current;
      const message = err && err.message ? err.message : 'Güncellenemedi.';
      setStatus('error', message);
    } finally {
      providerSelect.disabled = false;
      setTimeout(() => setStatus(null, null), 2500);
    }
  }
}

function buildTabs() {
  const container = document.createElement('section');
  container.className = 'panel';

  const nav = document.createElement('div');
  nav.className = 'tab-nav';

  const body = document.createElement('div');
  body.className = 'tab-body';

  tabs.forEach((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.className = tab.id === state.activeTab ? 'tab-button active' : 'tab-button';
    btn.addEventListener('click', () => {
      state.activeTab = tab.id;
      updateTabs(container);
    });
    nav.appendChild(btn);
  });

  container.appendChild(nav);
  container.appendChild(body);
  updateTabs(container);
  return container;
}

function updateTabs(container) {
  const nav = container.querySelector('.tab-nav');
  const body = container.querySelector('.tab-body');

  Array.from(nav.children).forEach((btn, idx) => {
    const tab = tabs[idx];
    btn.className = tab.id === state.activeTab ? 'tab-button active' : 'tab-button';
  });

  if (!state.views[state.activeTab]) {
    const tab = tabs.find((t) => t.id === state.activeTab);
    state.views[state.activeTab] = tab.builder();
  }

  body.innerHTML = '';
  body.appendChild(state.views[state.activeTab].root);
}


function buildPortfolioView() {
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;

  const root = document.createElement('section');
  root.className = 'tool-panel portfolio-panel';

  const heading = document.createElement('h2');
  heading.textContent = 'Portfolio Watch';

  const desc = document.createElement('p');
  desc.textContent = 'Portföyünüzü kalıcı olarak saklayın, alış-satışları kaydedin ve anlık grafikleri izleyin.';

  const statusEl = document.createElement('div');
  statusEl.className = 'portfolio-status hidden';

  const layout = document.createElement('div');
  layout.className = 'portfolio-layout';

  const sidebar = document.createElement('div');
  sidebar.className = 'portfolio-sidebar';

  const main = document.createElement('div');
  main.className = 'portfolio-main';

  const summaryCard = document.createElement('article');
  summaryCard.className = 'portfolio-card summary-card';

  const cashCard = document.createElement('article');
  cashCard.className = 'portfolio-card cash-card';

  const holdingsCard = document.createElement('article');
  holdingsCard.className = 'portfolio-card holdings-card';

  const holdingsHeader = document.createElement('div');
  holdingsHeader.className = 'portfolio-header';
  const holdingsTitle = document.createElement('h3');
  holdingsTitle.textContent = 'Mevcut Pozisyonlar';
  const refreshInfo = document.createElement('span');
  refreshInfo.className = 'portfolio-refresh';
  refreshInfo.textContent = 'Son yenileme: henüz alınmadı';
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'secondary';
  refreshBtn.textContent = 'Şimdi Yenile';
  holdingsHeader.appendChild(holdingsTitle);
  holdingsHeader.appendChild(refreshInfo);
  holdingsHeader.appendChild(refreshBtn);

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'portfolio-table-wrapper';
  const holdingsTable = document.createElement('table');
  holdingsTable.className = 'portfolio-table';
  const tableHead = document.createElement('thead');
  tableHead.innerHTML = `
    <tr>
      <th>Ticker</th>
      <th>Lot</th>
      <th>Toplam</th>
      <th>Ort. Alış</th>
      <th>Stop Loss</th>
      <th>Alım Tarihi</th>
      <th>Son</th>
      <th>Piyasa Değeri</th>
      <th>Gerçekleşmemiş</th>
      <th>Aksiyon</th>
    </tr>
  `;
  const tableBody = document.createElement('tbody');
  holdingsTable.appendChild(tableHead);
  holdingsTable.appendChild(tableBody);
  tableWrapper.appendChild(holdingsTable);

  const emptyState = document.createElement('div');
  emptyState.className = 'portfolio-empty hidden';
  emptyState.textContent = 'Portföyünüzde kayıtlı hisse bulunmuyor.';

  const actions = document.createElement('form');
  actions.className = 'portfolio-actions';
  actions.noValidate = true;
  actions.addEventListener('submit', (evt) => evt.preventDefault());

  const tickerField = document.createElement('label');
  tickerField.className = 'field';
  tickerField.textContent = 'Ticker';
  const tickerInput = document.createElement('input');
  tickerInput.type = 'text';
  tickerInput.placeholder = 'örn. AAPL';
  tickerInput.autocomplete = 'off';
  tickerField.appendChild(tickerInput);

  const sharesField = document.createElement('label');
  sharesField.className = 'field';
  sharesField.textContent = 'Lot (adet)';
  const sharesInput = document.createElement('input');
  sharesInput.type = 'number';
  sharesInput.step = '0.0001';
  sharesInput.placeholder = 'örn. 10';
  sharesField.appendChild(sharesInput);

  const amountField = document.createElement('label');
  amountField.className = 'field';
  amountField.textContent = 'Toplam Tutar ($)';
  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.step = '0.01';
  amountInput.placeholder = 'örn. 2500';
  amountField.appendChild(amountInput);

  const priceField = document.createElement('label');
  priceField.className = 'field';
  priceField.textContent = 'Ort. Alış Fiyatı';
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.step = '0.01';
  priceInput.placeholder = 'örn. 125.50';
  priceField.appendChild(priceInput);

  const currencyField = document.createElement('label');
  currencyField.className = 'field';
  currencyField.textContent = 'Para Birimi';
  const currencyInput = document.createElement('input');
  currencyInput.type = 'text';
  currencyInput.value = 'USD';
  currencyInput.maxLength = 6;
  currencyField.appendChild(currencyInput);

  const dateField = document.createElement('label');
  dateField.className = 'field';
  dateField.textContent = 'Alım Tarihi';
  const buyDateInput = document.createElement('input');
  buyDateInput.type = 'date';
  buyDateInput.value = new Date().toISOString().slice(0, 10);
  dateField.appendChild(buyDateInput);

  const stopField = document.createElement('label');
  stopField.className = 'field';
  stopField.textContent = 'Stop Loss (Fiyat)';
  const stopInput = document.createElement('input');
  stopInput.type = 'number';
  stopInput.step = '0.01';
  stopInput.placeholder = 'örn. 110.00';
  stopField.appendChild(stopInput);

  const actionButtons = document.createElement('div');
  actionButtons.className = 'portfolio-action-buttons';
  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'secondary';
  checkBtn.textContent = 'Check';
  const buyBtn = document.createElement('button');
  buyBtn.type = 'button';
  buyBtn.className = 'primary';
  buyBtn.textContent = 'Bought';
  actionButtons.appendChild(checkBtn);
  actionButtons.appendChild(buyBtn);

  const quotePreview = document.createElement('div');
  quotePreview.className = 'portfolio-quote hidden';

  const chartContainer = document.createElement('div');
  chartContainer.className = 'portfolio-chart hidden';
  const chartImg = document.createElement('img');
  chartImg.alt = 'Güncel fiyat grafiği';
  const chartMeta = document.createElement('span');
  chartMeta.className = 'portfolio-chart-meta';
  chartContainer.appendChild(chartImg);
  chartContainer.appendChild(chartMeta);

  actions.appendChild(tickerField);
  actions.appendChild(sharesField);
  actions.appendChild(amountField);
  actions.appendChild(priceField);
  actions.appendChild(currencyField);
  actions.appendChild(dateField);
  actions.appendChild(stopField);
  actions.appendChild(actionButtons);
  actions.appendChild(quotePreview);
  actions.appendChild(chartContainer);

  holdingsCard.appendChild(holdingsHeader);
  holdingsCard.appendChild(tableWrapper);
  holdingsCard.appendChild(emptyState);
  holdingsCard.appendChild(actions);

  sidebar.appendChild(summaryCard);
  sidebar.appendChild(cashCard);
  main.appendChild(holdingsCard);

  layout.appendChild(sidebar);
  layout.appendChild(main);

  root.appendChild(heading);
  root.appendChild(desc);
  root.appendChild(statusEl);
  root.appendChild(layout);

  const initialPortfolio = state.defaults.portfolio || {};

  const viewState = {
    holdings: (initialPortfolio.holdings || []).map(mapHoldingRow),
    cash: initialPortfolio.cash || [],
    refreshTimer: null,
    lastQuote: null,
    latestChart: null,
  };

  function mapHoldingRow(row) {
    return {
      id: row.id,
      symbol: (row.symbol || '').toUpperCase(),
      shares: Number(row.shares ?? row.position ?? 0),
      totalCost: Number(row.total_cost ?? row.costBasis ?? 0),
      avgPrice: Number(row.avg_price ?? row.avgPrice ?? 0),
      currency: row.currency || 'USD',
      buyDate: row.buy_date || row.buyDate || null,
      stopLoss: row.stop_loss ?? row.stopLoss ?? null,
      last: row.last ?? null,
      marketValue: Number(row.marketValue ?? row.total_cost ?? 0),
      changePct: row.changePct ?? null,
      dailyPnl: row.dailyPnl ?? null,
      unrealizedPnl: row.unrealizedPnl ?? null,
      lastUpdated: row.lastUpdated ?? null,
    };
  }

  function setStatus(kind, message) {
    statusEl.textContent = message || '';
    statusEl.className = 'portfolio-status';
    if (!message) {
      statusEl.classList.add('hidden');
      return;
    }
    statusEl.classList.remove('hidden');
    if (kind) {
      statusEl.classList.add(`is-${kind}`);
    }
  }

  function updateQuotePreview(quote, symbol) {
    if (!quote || !Number.isFinite(quote.price)) {
      quotePreview.textContent = '';
      quotePreview.classList.add('hidden');
      return;
    }
    const asOfText = quote.as_of ? ` · ${formatDateTime(quote.as_of)}` : '';
    const sourceText = quote.source ? ` · ${quote.source}` : '';
    quotePreview.textContent = `${symbol} · ${formatMoney(quote.price, quote.currency)}${asOfText}${sourceText}`;
    quotePreview.classList.remove('hidden');
  }

  function applySnapshot(snapshot) {
    viewState.holdings = (snapshot?.holdings || []).map(mapHoldingRow);
    viewState.cash = snapshot?.cash || [];
    renderSummary();
    renderCash();
    renderHoldings();
  }

  function renderSummary() {
    const invested = viewState.holdings.reduce((acc, holding) => acc + (Number.isFinite(holding.totalCost) ? holding.totalCost : 0), 0);
    const cashTotal = viewState.cash.reduce((acc, row) => acc + (Number.isFinite(row.amount) ? row.amount : 0), 0);
    summaryCard.innerHTML = `
      <header><h3>Portföy Özeti</h3></header>
      <div class="summary-stats">
        <div><span>Toplam Pozisyon</span><strong>${formatMoney(invested, 'USD')}</strong></div>
        <div><span>Nakit</span><strong>${formatMoney(cashTotal, 'USD')}</strong></div>
        <div><span>Hisse Sayısı</span><strong>${viewState.holdings.length}</strong></div>
      </div>
    `;
  }

  function renderCash() {
    const rows = viewState.cash
      .map((row) => `<tr><td>${row.currency}</td><td>${formatMoney(row.amount, row.currency)}</td></tr>`)
      .join('');
    cashCard.innerHTML = `
      <header>
        <h3>Nakit Bakiyesi</h3>
      </header>
      <table class="cash-table">
        <thead><tr><th>Para Birimi</th><th>Tutar</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2">—</td></tr>'}</tbody>
      </table>
    `;
  }

  function renderHoldings() {
    tableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    let hasRow = false;
    viewState.holdings.forEach((holding) => {
      if (!holding.symbol) return;
      hasRow = true;
      const tr = document.createElement('tr');

      const lastText = Number.isFinite(holding.last) ? formatMoney(holding.last, holding.currency) : '—';
      const unrealized = Number.isFinite(holding.unrealizedPnl) ? formatMoney(holding.unrealizedPnl, holding.currency) : '—';
      const stopLossText = holding.stopLoss != null ? formatMoney(holding.stopLoss, holding.currency) : '—';
      const buyDateText = holding.buyDate ? new Date(holding.buyDate).toLocaleDateString('tr-TR') : '—';

      const sellBtn = document.createElement('button');
      sellBtn.type = 'button';
      sellBtn.textContent = 'Sold';
      sellBtn.className = 'danger';
      sellBtn.addEventListener('click', () => {
        handleSell(holding);
      });

      tr.innerHTML = `
        <td>${holding.symbol}</td>
        <td>${formatNumber(holding.shares, { maximumFractionDigits: 4 })}</td>
        <td>${formatMoney(holding.totalCost, holding.currency)}</td>
        <td>${formatMoney(holding.avgPrice, holding.currency)}</td>
        <td>${stopLossText}</td>
        <td>${buyDateText}</td>
        <td>${lastText}</td>
        <td>${formatMoney(holding.marketValue, holding.currency)}</td>
        <td>${unrealized}</td>
      `;

      const actionCell = document.createElement('td');
      actionCell.appendChild(sellBtn);
      tr.appendChild(actionCell);
      fragment.appendChild(tr);
    });
    tableBody.appendChild(fragment);
    if (hasRow) {
      emptyState.classList.add('hidden');
    } else {
      emptyState.classList.remove('hidden');
    }
  }

  function normaliseQuote(rawQuote = {}) {
    const quote = { ...rawQuote };
    if (!Number.isFinite(quote.price)) {
      const fallbackPrice = parseNumber(quote.last) || parseNumber(quote.close) || parseNumber(quote.regularMarketPrice);
      if (Number.isFinite(fallbackPrice)) {
        quote.price = fallbackPrice;
      }
    }
    if (!quote.currency) {
      quote.currency = 'USD';
    }
    return quote;
  }

  function mergeQuoteIntoHolding(holding, rawQuote) {
    if (!holding) return;
    const quote = normaliseQuote(rawQuote);
    if (Number.isFinite(quote.price)) {
      holding.last = quote.price;
      holding.marketValue = holding.shares * quote.price;
      if (Number.isFinite(holding.avgPrice)) {
        holding.unrealizedPnl = (quote.price - holding.avgPrice) * holding.shares;
      }
    }
    const prevClose = parseNumber(quote.prev_close ?? quote.previousClose ?? quote.previous_close);
    if (Number.isFinite(prevClose) && prevClose !== 0 && Number.isFinite(quote.price)) {
      holding.changePct = ((quote.price - prevClose) / prevClose) * 100;
    }
    holding.currency = quote.currency || holding.currency;
    holding.lastUpdated = new Date().toISOString();
    return quote;
  }

  async function ensureQuote(symbol, { silent = false } = {}) {
    const symbolSafe = (symbol || '').trim().toUpperCase();
    if (!symbolSafe) {
      setStatus('error', 'Ticker girin.');
      throw new Error('Ticker gerekli');
    }
    if (!silent) {
      setStatus('info', `${symbolSafe} için fiyat alınıyor...`);
    }
    try {
      const raw = await window.pythonBridge.fetchQuote(symbolSafe);
      if (raw && raw.error) {
        throw new Error(raw.error);
      }
      const quote = normaliseQuote(raw || {});
      viewState.lastQuote = { symbol: symbolSafe, quote };
      const holding = viewState.holdings.find((row) => row.symbol === symbolSafe);
      if (holding) {
        mergeQuoteIntoHolding(holding, quote);
        renderHoldings();
        renderSummary();
      }
      updateQuotePreview(quote, symbolSafe);
      if (!silent) {
        setStatus('success', `${symbolSafe} anlık fiyatı ${formatMoney(quote.price, quote.currency)}`);
      } else {
        setStatus(null, null);
      }
      return quote;
    } catch (err) {
      updateQuotePreview(null, null);
      setStatus('error', err && err.message ? err.message : 'Fiyat çekilemedi.');
      throw err;
    }
  }

  async function handleSell(holding) {
    if (!holding) return;
    setStatus('info', `${holding.symbol} için satış işlemi hazırlanıyor...`);
    try {
      const response = await window.pythonBridge.sellHolding({ symbol: holding.symbol });
      applySnapshot(response.snapshot);
      await refreshAllHoldings({ silent: true });
      setStatus('success', `${holding.symbol} nakde çevrildi. Gelir: ${formatMoney(response.proceeds, response.currency)}`);
    } catch (err) {
      setStatus('error', err && err.message ? err.message : 'Satış tamamlanamadı.');
    }
  }

  async function refreshPortfolio() {
    try {
      const snapshot = await window.pythonBridge.loadPortfolio();
      applySnapshot(snapshot);
    } catch (err) {
      setStatus('error', 'Portföy verileri yüklenemedi.');
    }
  }

  async function refreshAllHoldings({ silent = false } = {}) {
    if (!viewState.holdings.length) {
      refreshInfo.textContent = 'Portföy boş';
      if (!silent) setStatus(null, null);
      return;
    }
    if (!silent) {
      setStatus('info', 'Portföy verileri güncelleniyor...');
    }
    const failed = [];
    for (const holding of viewState.holdings) {
      try {
        const quote = await ensureQuote(holding.symbol, { silent: true });
        mergeQuoteIntoHolding(holding, quote);
      } catch (err) {
        failed.push(holding.symbol);
      }
    }
    renderHoldings();
    renderSummary();
    const timestamp = formatDateTime(new Date().toISOString());
    if (failed.length) {
      setStatus('error', `Güncellenemeyen semboller: ${failed.join(', ')}`);
      refreshInfo.textContent = `Son yenileme: ${timestamp} (kısmi)`;
    } else if (silent) {
      setStatus(null, null);
      refreshInfo.textContent = `Son yenileme: ${timestamp}`;
    } else {
      setStatus('success', 'Portföy güncellendi.');
      refreshInfo.textContent = `Son yenileme: ${timestamp}`;
    }
  }

  function startAutoRefresh() {
    if (viewState.refreshTimer) {
      clearInterval(viewState.refreshTimer);
    }
    viewState.refreshTimer = setInterval(() => {
      refreshAllHoldings({ silent: true }).catch((err) => console.error('Auto refresh error', err));
    }, FIFTEEN_MIN_MS);
  }

  async function handleCheck() {
    const symbol = tickerInput.value.trim().toUpperCase();
    if (!symbol) {
      setStatus('error', 'Kontrol için ticker girin.');
      return;
    }
    try {
      await ensureQuote(symbol, { silent: false });
      await loadChart(symbol);
    } catch (err) {
      // hata zaten gösterildi
    }
  }

  async function loadChart(symbol) {
    try {
      setStatus('info', 'Grafik oluşturuluyor...');
      const data = await window.pythonBridge.generateChart(symbol);
      if (data && data.image) {
        chartImg.src = data.image;
        chartMeta.textContent = `Grafik zamanı: ${formatDateTime(data.generated_at)}`;
        chartContainer.classList.remove('hidden');
        setStatus('success', `${symbol} grafiği hazır.`);
      } else {
        throw new Error('Grafik verisi alınamadı');
      }
    } catch (err) {
      chartContainer.classList.add('hidden');
      setStatus('error', err && err.message ? err.message : 'Grafik oluşturulamadı.');
    }
  }

  async function handleBought() {
    const symbol = tickerInput.value.trim().toUpperCase();
    if (!symbol) {
      setStatus('error', 'Ticker gerekli.');
      return;
    }
    const avgPriceVal = priceInput.value.trim();
    if (!avgPriceVal) {
      setStatus('error', 'Ort. alış fiyatı girin.');
      return;
    }

    const payload = {
      symbol,
      shares: sharesInput.value,
      totalAmount: amountInput.value,
      avgPrice: avgPriceVal,
      currency: currencyInput.value.trim() || 'USD',
      buyDate: buyDateInput.value,
      stopLoss: stopInput.value,
    };

    payload.mode = payload.totalAmount ? 'amount' : 'shares';

    try {
      setStatus('info', `${symbol} kaydediliyor...`);
      const response = await window.pythonBridge.saveHolding(payload);
      applySnapshot(response.snapshot);
      await refreshAllHoldings({ silent: true });
      sharesInput.value = '';
      amountInput.value = '';
      priceInput.value = '';
      stopInput.value = '';
      tickerInput.value = symbol;
      setStatus('success', `${symbol} portföye kaydedildi.`);
    } catch (err) {
      setStatus('error', err && err.message ? err.message : 'Kayıt yapılamadı.');
    }
  }

  refreshBtn.addEventListener('click', () => {
    refreshAllHoldings().catch((err) => console.error('Manual refresh error', err));
  });
  checkBtn.addEventListener('click', handleCheck);
  buyBtn.addEventListener('click', handleBought);

  applySnapshot({ holdings: viewState.holdings, cash: viewState.cash });
  startAutoRefresh();
  refreshAllHoldings({ silent: true }).catch((err) => console.error('Initial holdings refresh failed', err));
  refreshPortfolio();

  return { root };
}

function buildReporterView() {
  const root = document.createElement('section');
  root.className = 'tool-panel reporter-panel';

  const heading = document.createElement('h2');
  heading.textContent = 'Automated Reporter';

  const desc = document.createElement('p');
  desc.textContent = 'Stop loss ve R hedeflerinizi takip ederek fiyat hareketlerinde email bildirimi gönderir.';

  const statusEl = document.createElement('div');
  statusEl.className = 'reporter-status hidden';

  const layout = document.createElement('div');
  layout.className = 'reporter-layout';

  const settingsCard = document.createElement('article');
  settingsCard.className = 'reporter-card settings-card';

  const holdingsCard = document.createElement('article');
  holdingsCard.className = 'reporter-card holdings-card';

  const settingsTitle = document.createElement('h3');
  settingsTitle.textContent = 'Genel Ayarlar';

  const settingsForm = document.createElement('form');
  settingsForm.className = 'reporter-form';
  settingsForm.noValidate = true;
  settingsForm.addEventListener('submit', (evt) => evt.preventDefault());

  const enableRow = document.createElement('label');
  enableRow.className = 'reporter-toggle';
  const enableInput = document.createElement('input');
  enableInput.type = 'checkbox';
  const enableSpan = document.createElement('span');
  enableSpan.textContent = 'Reporter aktif';
  enableRow.appendChild(enableInput);
  enableRow.appendChild(enableSpan);

  const intervalField = document.createElement('label');
  intervalField.className = 'field';
  intervalField.textContent = 'Kontrol aralığı (sn)';
  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.min = '30';
  intervalInput.step = '30';
  intervalField.appendChild(intervalInput);

  const emailField = document.createElement('label');
  emailField.className = 'field';
  emailField.textContent = 'Bildirim Emaili';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.placeholder = 'ornek@domain.com';
  emailField.appendChild(emailInput);

  const smtpHostField = document.createElement('label');
  smtpHostField.className = 'field';
  smtpHostField.textContent = 'SMTP Host';
  const smtpHostInput = document.createElement('input');
  smtpHostInput.type = 'text';
  smtpHostInput.placeholder = 'smtp.mail.com';
  smtpHostField.appendChild(smtpHostInput);

  const smtpPortField = document.createElement('label');
  smtpPortField.className = 'field';
  smtpPortField.textContent = 'SMTP Port';
  const smtpPortInput = document.createElement('input');
  smtpPortInput.type = 'number';
  smtpPortInput.placeholder = '587';
  smtpPortField.appendChild(smtpPortInput);

  const smtpUserField = document.createElement('label');
  smtpUserField.className = 'field';
  smtpUserField.textContent = 'SMTP Kullanıcı';
  const smtpUserInput = document.createElement('input');
  smtpUserInput.type = 'text';
  smtpUserField.appendChild(smtpUserInput);

  const smtpPassField = document.createElement('label');
  smtpPassField.className = 'field';
  smtpPassField.textContent = 'SMTP Şifre';
  const smtpPassInput = document.createElement('input');
  smtpPassInput.type = 'password';
  smtpPassField.appendChild(smtpPassInput);

  const fromField = document.createElement('label');
  fromField.className = 'field';
  fromField.textContent = 'Gönderen Adresi';
  const fromInput = document.createElement('input');
  fromInput.type = 'email';
  fromField.appendChild(fromInput);

  const channelGroup = document.createElement('div');
  channelGroup.className = 'reporter-channels';
  const channelLabel = document.createElement('p');
  channelLabel.textContent = 'Bildirim Kanalları';
  const emailChannel = document.createElement('label');
  emailChannel.className = 'reporter-channel';
  const emailChannelInput = document.createElement('input');
  emailChannelInput.type = 'checkbox';
  emailChannelInput.checked = true;
  emailChannelInput.disabled = true;
  const emailChannelSpan = document.createElement('span');
  emailChannelSpan.textContent = 'Email (aktif)';
  emailChannel.appendChild(emailChannelInput);
  emailChannel.appendChild(emailChannelSpan);
  channelGroup.appendChild(channelLabel);
  channelGroup.appendChild(emailChannel);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'Ayarları Kaydet';

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'secondary';
  testBtn.textContent = 'Test e-postası gönder';

  const lastRunInfo = document.createElement('p');
  lastRunInfo.className = 'reporter-last-run';
  lastRunInfo.textContent = 'Son çalıştırma: -';

  settingsForm.appendChild(enableRow);
  settingsForm.appendChild(intervalField);
  settingsForm.appendChild(emailField);
  settingsForm.appendChild(smtpHostField);
  settingsForm.appendChild(smtpPortField);
  settingsForm.appendChild(smtpUserField);
  settingsForm.appendChild(smtpPassField);
  settingsForm.appendChild(fromField);
  settingsForm.appendChild(channelGroup);
  settingsForm.appendChild(saveBtn);
  settingsForm.appendChild(testBtn);
  settingsForm.appendChild(lastRunInfo);

  settingsCard.appendChild(settingsTitle);
  settingsCard.appendChild(settingsForm);

  const holdingsTitle = document.createElement('h3');
  holdingsTitle.textContent = 'Takip Edilen Pozisyonlar';
  const holdingsHint = document.createElement('p');
  holdingsHint.className = 'reporter-hint';
  holdingsHint.textContent = 'Uyarılar için stop loss seviyesi şarttır. Fiyat stop mesafesinin %80\'ine yaklaşırsa veya 1R kar alınırsa email gönderilir.';

  const holdingsTable = document.createElement('table');
  holdingsTable.className = 'reporter-table';
  const holdingsHead = document.createElement('thead');
  holdingsHead.innerHTML = `
    <tr>
      <th>Ticker</th>
      <th>Lot</th>
      <th>Ort. Alış</th>
      <th>Stop Loss</th>
      <th>1R</th>
      <th>Durum</th>
      <th>Aksiyon</th>
    </tr>
  `;
  const holdingsBody = document.createElement('tbody');
  holdingsTable.appendChild(holdingsHead);
  holdingsTable.appendChild(holdingsBody);

  holdingsCard.appendChild(holdingsTitle);
  holdingsCard.appendChild(holdingsHint);
  holdingsCard.appendChild(holdingsTable);

  layout.appendChild(settingsCard);
  layout.appendChild(holdingsCard);

  root.appendChild(heading);
  root.appendChild(desc);
  root.appendChild(statusEl);
  root.appendChild(layout);

  const viewState = {
    settings: state.defaults.reporter || {},
    holdings: [],
  };

  function setStatus(kind, message) {
    statusEl.textContent = message || '';
    statusEl.className = 'reporter-status';
    if (!message) {
      statusEl.classList.add('hidden');
      return;
    }
    statusEl.classList.remove('hidden');
    if (kind) {
      statusEl.classList.add(`is-${kind}`);
    }
  }

  function applySettings(settings) {
    enableInput.checked = Boolean(settings.email_enabled);
    intervalInput.value = settings.check_interval || 60;
    emailInput.value = settings.email_address || '';
    smtpHostInput.value = settings.smtp_host || '';
    smtpPortInput.value = settings.smtp_port || '';
    smtpUserInput.value = settings.smtp_username || '';
    smtpPassInput.value = settings.smtp_password || '';
    fromInput.value = settings.from_address || '';
    lastRunInfo.textContent = settings.last_run
      ? `Son çalıştırma: ${formatDateTime(settings.last_run)}`
      : 'Son çalıştırma: -';
  }

  function renderHoldings() {
    holdingsBody.innerHTML = '';
    if (!viewState.holdings.length) {
      const emptyRow = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'Portföyde takip edilecek hisse yok.';
      emptyRow.appendChild(td);
      holdingsBody.appendChild(emptyRow);
      return;
    }

    viewState.holdings.forEach((holding) => {
      const tr = document.createElement('tr');
      const stopInputField = document.createElement('input');
      stopInputField.type = 'number';
      stopInputField.step = '0.01';
      stopInputField.value = holding.stop_loss != null ? holding.stop_loss : '';
      stopInputField.placeholder = 'Stop';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'secondary';
      saveBtn.textContent = 'Kaydet';
      saveBtn.addEventListener('click', async () => {
        try {
          setStatus('info', `${holding.symbol} stop loss güncelleniyor...`);
          await window.pythonBridge.updateHolding({
            symbol: holding.symbol,
            stopLoss: stopInputField.value,
          });
          await loadData();
          setStatus('success', `${holding.symbol} stop loss güncellendi.`);
        } catch (err) {
          setStatus('error', err && err.message ? err.message : 'Stop loss kaydedilemedi.');
        }
      });

      const risk = (holding.avg_price != null && holding.stop_loss != null)
        ? holding.avg_price - holding.stop_loss
        : null;

      const statusText = holding.stop_loss != null && holding.stop_loss < holding.avg_price
        ? 'Aktif'
        : 'Eksik';

      tr.innerHTML = `
        <td>${holding.symbol}</td>
        <td>${formatNumber(holding.shares, { maximumFractionDigits: 4 })}</td>
        <td>${formatMoney(holding.avg_price, holding.currency)}</td>
      `;

      const stopCell = document.createElement('td');
      stopCell.appendChild(stopInputField);
      const riskCell = document.createElement('td');
      riskCell.textContent = risk && risk > 0 ? formatMoney(risk, holding.currency) : '—';
      const statusCell = document.createElement('td');
      statusCell.textContent = statusText;
      const actionCell = document.createElement('td');
      actionCell.appendChild(saveBtn);

      tr.appendChild(stopCell);
      tr.appendChild(riskCell);
      tr.appendChild(statusCell);
      tr.appendChild(actionCell);
      holdingsBody.appendChild(tr);
    });
  }

  async function loadData() {
    try {
      const payload = await window.pythonBridge.getReporterSettings();
      viewState.settings = payload.settings || {};
      viewState.holdings = payload.holdings || [];
      applySettings(viewState.settings);
      renderHoldings();
    } catch (err) {
      setStatus('error', 'Reporter ayarları okunamadı.');
    }
  }

  saveBtn.addEventListener('click', async () => {
    const payload = {
      email_enabled: enableInput.checked,
      check_interval: Number(intervalInput.value) || 60,
      email_address: emailInput.value.trim(),
      smtp_host: smtpHostInput.value.trim(),
      smtp_port: Number(smtpPortInput.value) || null,
      smtp_username: smtpUserInput.value.trim(),
      smtp_password: smtpPassInput.value,
      from_address: fromInput.value.trim(),
    };

    try {
      setStatus('info', 'Ayarlar kaydediliyor...');
      const saved = await window.pythonBridge.saveReporterSettings(payload);
      applySettings(saved);
      setStatus('success', 'Reporter ayarları güncellendi.');
    } catch (err) {
      setStatus('error', err && err.message ? err.message : 'Ayarlar kaydedilemedi.');
    }
  });

  testBtn.addEventListener('click', async () => {
    try {
      setStatus('info', 'Test e-postası gönderiliyor...');
      await window.pythonBridge.sendReporterTestEmail();
      setStatus('success', 'Test e-postası gönderildi. (Spam klasörünü de kontrol edin)');
    } catch (err) {
      setStatus('error', err && err.message ? err.message : 'Test e-postası gönderilemedi.');
    }
  });

  loadData();

  return { root };
}

function buildAmountView() {
  const root = document.createElement('section');
  root.className = 'tool-panel';

  const heading = document.createElement('h2');
  heading.textContent = 'Position & R-Multiple Hesaplayıcı';

  const desc = document.createElement('p');
  desc.textContent = 'Canlı fiyatı çekip pozisyon büyüklüğü ve 5R hedeflerini hesaplar.';

  const form = document.createElement('form');
  form.className = 'form-grid amount-grid';

  const viewState = {
    quote: null,
  };

  const tickerField = document.createElement('div');
  tickerField.className = 'field full inline-field';

  const tickerLabel = document.createElement('span');
  tickerLabel.textContent = 'Ticker';

  const tickerRow = document.createElement('div');
  tickerRow.className = 'input-row';
  const tickerInput = document.createElement('input');
  tickerInput.type = 'text';
  tickerInput.name = 'ticker';
  tickerInput.placeholder = 'örn. AAPL';
  tickerInput.autocomplete = 'off';

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'secondary';
  testBtn.textContent = 'Test';

  tickerRow.appendChild(tickerInput);
  tickerRow.appendChild(testBtn);
  tickerField.appendChild(tickerLabel);
  tickerField.appendChild(tickerRow);
  form.appendChild(tickerField);

  const fields = [
    { label: 'Hesap Büyüklüğü', name: 'account', type: 'number', step: '0.01', required: true, placeholder: 'örn. 6000' },
    { label: 'Stop Fiyatı', name: 'stop', type: 'number', step: '0.01', required: true, placeholder: 'örn. 35.00' },
    { label: 'Risk (%)', name: 'riskPct', type: 'number', step: '0.1', value: '1.0' },
    { label: 'Risk ($)', name: 'riskDollar', type: 'number', step: '0.01' },
    { label: 'Sabit Alım Tutarı ($)', name: 'buyAmount', type: 'number', step: '0.01' },
  ];

  fields.forEach((f) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    wrapper.textContent = f.label;
    const input = document.createElement('input');
    input.name = f.name;
    input.type = f.type;
    input.step = f.step;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (f.value) input.value = f.value;
    if (f.required) input.required = true;
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });

  const roundWrapper = document.createElement('label');
  roundWrapper.className = 'field';
  roundWrapper.textContent = 'Lot Yuvarlama';
  const select = document.createElement('select');
  select.name = 'shareRound';
  ['none', 'floor', 'ceil', 'nearest'].forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    select.appendChild(option);
  });
  roundWrapper.appendChild(select);
  form.appendChild(roundWrapper);

  const runBtn = document.createElement('button');
  runBtn.type = 'submit';
  runBtn.className = 'primary';
  runBtn.textContent = 'Hesapla';
  form.appendChild(runBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'calc-status hidden';

  const priceBadge = document.createElement('div');
  priceBadge.className = 'price-pill hidden';

  const resultCard = document.createElement('div');
  resultCard.className = 'calc-result hidden';

  async function ensureQuote({ silent = false, force = false } = {}) {
    const symbol = tickerInput.value.trim().toUpperCase();
    if (!symbol) {
      setStatus('error', 'Lütfen ticker girin.');
      throw new Error('Ticker gerekli');
    }

    if (!force && viewState.quote && viewState.quote.symbol === symbol) {
      return viewState.quote;
    }

    if (!silent) {
      setStatus('info', 'Anlık fiyat alınmaya çalışılıyor...');
    }

    setLoading(true);
    try {
      const quote = await window.pythonBridge.fetchQuote(symbol);
      if (quote.error) {
        throw new Error(quote.error);
      }
      quote.symbol = (quote.symbol || symbol).toUpperCase();
      viewState.quote = quote;
      updatePriceInfo(quote);
      if (!silent) {
        setStatus('success', `${quote.symbol} anlık fiyatı: ${formatMoney(quote.price, quote.currency)}`);
      } else {
        clearStatus();
      }
      return quote;
    } catch (err) {
      viewState.quote = null;
      updatePriceInfo(null);
      const message = err && err.message ? err.message : 'Fiyat alınamadı';
      setStatus('error', message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    testBtn.disabled = isLoading;
    runBtn.disabled = isLoading;
    if (isLoading) {
      root.classList.add('is-loading');
    } else {
      root.classList.remove('is-loading');
    }
  }

  function setStatus(kind, message) {
    statusEl.textContent = message || '';
    statusEl.className = 'calc-status';
    if (!message) {
      statusEl.classList.add('hidden');
      return;
    }
    statusEl.classList.remove('hidden');
    if (kind) {
      statusEl.classList.add(`is-${kind}`);
    }
  }

  function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = 'calc-status hidden';
  }

  function updatePriceInfo(quote) {
    if (!quote) {
      priceBadge.textContent = '';
      priceBadge.classList.add('hidden');
      return;
    }
    const priceText = `${quote.symbol} · ${formatMoney(quote.price, quote.currency)} (${quote.currency || 'USD'})`;
    const sourceText = quote.source ? `Kaynak: ${quote.source}` : '';
    priceBadge.textContent = sourceText ? `${priceText} · ${sourceText}` : priceText;
    priceBadge.classList.remove('hidden');
  }

  function resetResult() {
    resultCard.innerHTML = '';
    resultCard.classList.add('hidden');
  }

  function renderResult(result) {
    const { ladder, currency } = result;
    const modeLabel = result.mode === 'fixed'
      ? 'Sabit Alım Tutarı'
      : result.mode === 'riskDollar'
        ? 'Risk ($) Tabanlı'
        : 'Risk (%) Tabanlı';

    const targetRiskText = formatMoney(result.targetRisk, currency);
    const actualRiskText = formatMoney(result.actualRisk, currency);
    const ladderRows = ladder.map((row) => `
      <tr>
        <td>${row.multiple}R</td>
        <td>${formatMoney(row.pnl, currency)}</td>
        <td>${formatMoney(row.price, currency)}</td>
      </tr>
    `).join('');

    const timingLabel = result.quoteAsOf
      ? `Veri zamanı: ${formatDateTime(result.quoteAsOf)}`
      : `Çekildi: ${formatDateTime(result.fetchedAt)}`;

    resultCard.innerHTML = `
      <div class="result-header">
        <div>
          <h3>${result.symbol} · ${formatMoney(result.buyPrice, currency)}</h3>
          <p>Stop: ${formatMoney(result.stop, currency)} · Lot başı risk: ${formatMoney(result.riskPerShare, currency)} (${formatPercent(result.percentRiskPosition)})</p>
        </div>
        <div class="result-meta">
          <span class="result-chip">${result.currency}</span>
          <span class="result-chip">${modeLabel}</span>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-item">
          <span>Alınacak Lot</span>
          <strong>${formatNumber(result.shares, { maximumFractionDigits: 2 })}</strong>
          <small>Ham: ${formatNumber(result.sharesRaw, { maximumFractionDigits: 4 })} (${result.shareRound})</small>
        </div>
        <div class="summary-item">
          <span>Yatırım Tutarı</span>
          <strong>${formatMoney(result.invested, currency)}</strong>
          <small>Hesap: ${formatMoney(result.account, currency)}</small>
        </div>
        <div class="summary-item">
          <span>Hedef Risk</span>
          <strong>${targetRiskText}</strong>
          <small>Gerçekleşen: ${actualRiskText}</small>
        </div>
        <div class="summary-item">
          <span>Risk % (pozisyon)</span>
          <strong>${formatPercent(result.percentRiskPosition)}</strong>
          <small>Kaynak: ${result.quoteSource}</small>
        </div>
      </div>
      <h4>R Çarpanları</h4>
      <table class="r-table">
        <thead>
          <tr><th>R</th><th>Potansiyel P&L</th><th>Fiyat</th></tr>
        </thead>
        <tbody>
          ${ladderRows}
        </tbody>
      </table>
      <div class="result-footer">
        <span>${timingLabel}</span>
        <span>Kaynak: ${result.quoteSource}</span>
      </div>
    `;
    resultCard.classList.remove('hidden');
  }

  testBtn.addEventListener('click', async () => {
    try {
      await ensureQuote({ silent: false, force: true });
    } catch (err) {
      resetResult();
    }
  });

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const formData = new FormData(form);

    const account = parseNumber(formData.get('account'));
    const stop = parseNumber(formData.get('stop'));
    const riskPct = parseNumber(formData.get('riskPct'));
    const riskDollar = parseNumber(formData.get('riskDollar'));
    const buyAmount = parseNumber(formData.get('buyAmount'));
    const shareRound = formData.get('shareRound') || 'none';

    if (!Number.isFinite(account) || account <= 0) {
      setStatus('error', 'Hesap büyüklüğü 0’dan büyük olmalı.');
      return;
    }

    if (!Number.isFinite(stop) || stop <= 0) {
      setStatus('error', 'Stop fiyatı 0’dan büyük olmalı.');
      return;
    }

    let quote;
    try {
      quote = await ensureQuote({ silent: true, force: false });
    } catch (err) {
      resetResult();
      return;
    }

    try {
      const result = computePosition({
        account,
        stop,
        riskPct,
        riskDollar,
        buyAmount,
        shareRound,
        quote,
      });
      renderResult(result);
      setStatus('success', `${result.symbol} için hesaplama tamamlandı.`);
    } catch (err) {
      resetResult();
      setStatus('error', err && err.message ? err.message : 'Hesaplama yapılamadı');
    }
  });

  root.appendChild(heading);
  root.appendChild(desc);
  root.appendChild(form);
  root.appendChild(statusEl);
  root.appendChild(priceBadge);
  root.appendChild(resultCard);

  return { root };
}

function buildScannerView() {
  const root = document.createElement('section');
  root.className = 'tool-panel scanner-panel';

  const filtersState = {
    data: cloneDeep(state.defaults.filters?.data || {}),
    loaded: false,
  };

  const heading = document.createElement('h2');
  heading.textContent = 'Scanner Agent';

  const desc = document.createElement('p');
  desc.textContent = 'Tarayıcıyı çalıştırmadan önce CLI parametrelerini ve filtre eşiklerini buradan ayarlayabilirsiniz.';

  const statusEl = document.createElement('div');
  statusEl.className = 'scanner-status hidden';

  const form = document.createElement('form');
  form.className = 'scanner-form';

  const generalSection = document.createElement('section');
  generalSection.className = 'subpanel';
  const generalTitle = document.createElement('h3');
  generalTitle.textContent = 'Genel Parametreler';
  const generalGrid = document.createElement('div');
  generalGrid.className = 'form-grid';

  const numericFields = [
    { label: 'En Fazla Ticker', name: 'max', placeholder: 'örn. 50' },
    { label: 'Lookback (gün)', name: 'lookback', value: '270' },
    { label: 'Başlangıç Tarihi (YYYY-MM-DD)', name: 'dateFrom' },
    { label: 'Bitiş Tarihi (YYYY-MM-DD)', name: 'dateTo' },
    { label: 'HTTP Timeout (sn)', name: 'httpTimeout', value: '8' },
    { label: 'Max Retry', name: 'maxRetries', value: '2' },
    { label: 'İşçi Sayısı', name: 'workers', value: '16' },
    { label: 'Çıktı Klasörü', name: 'outDir', value: 'results' },
  ];

  numericFields.forEach((f) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    wrapper.textContent = f.label;
    const input = document.createElement('input');
    input.name = f.name;
    input.type = 'text';
    if (f.value) input.value = f.value;
    if (f.placeholder) input.placeholder = f.placeholder;
    wrapper.appendChild(input);
    generalGrid.appendChild(wrapper);
  });

  const checkboxFields = [
    { label: 'Sessiz mod (quiet)', name: 'quiet' },
    { label: 'Grafik üretme (no charts)', name: 'noCharts' },
    { label: 'Delist edilenleri sakla (keep delisted)', name: 'keepDelisted' },
    { label: 'Earnings alma (no earnings)', name: 'noEarnings' },
    { label: 'Analyst rating alma (no analyst)', name: 'noAnalyst' },
  ];

  checkboxFields.forEach((f) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'check-field';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = f.name;
    wrapper.appendChild(input);
    const span = document.createElement('span');
    span.textContent = f.label;
    wrapper.appendChild(span);
    generalGrid.appendChild(wrapper);
  });

  generalSection.appendChild(generalTitle);
  generalSection.appendChild(generalGrid);

  const filtersSection = document.createElement('section');
  filtersSection.className = 'subpanel';
  const filtersTitle = document.createElement('h3');
  filtersTitle.textContent = 'Filtreler (filters.yaml)';
  const filtersHint = document.createElement('p');
  filtersHint.className = 'filters-hint';
  filtersHint.textContent = 'Aşağıdaki ayarlar mevcut filters.yaml içeriğini geçici olarak override eder. "Filtreleri Kaydet" ile dosyayı kalıcı güncelleyebilirsiniz.';

  const filterInputs = [];

  function buildFiltersConfigFromInputs() {
    const config = cloneDeep(filtersState.data || {});
    ensureFilterDefaults(config);
    filterInputs.forEach(({ input, field }) => {
      const value = parseFilterInputValue(field, input);
      if (value !== undefined) {
        setValueByPath(config, field.path, value);
      }
    });
    return config;
  }

  const groupsWrapper = document.createElement('div');
  groupsWrapper.className = 'filter-groups';

  SCANNER_FILTER_GROUPS.forEach((group) => {
    const card = document.createElement('article');
    card.className = 'filter-group';

    const header = document.createElement('header');
    header.className = 'filter-group-header';
    const title = document.createElement('h4');
    title.textContent = group.title;
    header.appendChild(title);
    if (group.description) {
      const small = document.createElement('p');
      small.textContent = group.description;
      header.appendChild(small);
    }
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'filter-grid';

    group.fields.forEach((field) => {
      const { element, input } = createFilterField(field);
      if (input) {
        input.dataset.filterPath = field.path;
        input.dataset.filterType = field.type;
        if (field.step) input.step = field.step;
        if (field.placeholder && field.type !== 'boolean') input.placeholder = field.placeholder;
        if (field.type === 'number' && field.numberType === 'int') {
          input.step = field.step || '1';
        }
        filterInputs.push({ input, field });
      }
      grid.appendChild(element);
    });

    card.appendChild(grid);
    groupsWrapper.appendChild(card);
  });

  filtersSection.appendChild(filtersTitle);
  filtersSection.appendChild(filtersHint);
  filtersSection.appendChild(groupsWrapper);

  const formActions = document.createElement('div');
  formActions.className = 'form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'secondary';
  saveBtn.textContent = 'Filtreleri Kaydet';
  const runBtn = document.createElement('button');
  runBtn.type = 'submit';
  runBtn.className = 'primary';
  runBtn.textContent = 'Taramayı Başlat';
  formActions.appendChild(saveBtn);
  formActions.appendChild(runBtn);

  const jobList = document.createElement('div');
  jobList.className = 'job-list';

  const progressCard = createProgressCard();
  let progressState = null;

  form.appendChild(generalSection);
  form.appendChild(filtersSection);
  form.appendChild(formActions);

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const formData = new FormData(form);
    const args = [];

    const max = formData.get('max');
    if (max) args.push('--max', max);

    const lookback = formData.get('lookback');
    if (lookback) args.push('--lookback', lookback);

    const dateFrom = formData.get('dateFrom');
    if (dateFrom) args.push('--from', dateFrom);

    const dateTo = formData.get('dateTo');
    if (dateTo) args.push('--to', dateTo);

    const httpTimeout = formData.get('httpTimeout');
    if (httpTimeout) args.push('--http-timeout', httpTimeout);

    const maxRetries = formData.get('maxRetries');
    if (maxRetries) args.push('--max-retries', maxRetries);

    const workers = formData.get('workers');
    if (workers) args.push('--workers', workers);

    const outDir = formData.get('outDir');
    if (outDir) args.push('--out-dir', outDir);

    if (formData.get('quiet')) args.push('--quiet');
    if (formData.get('noCharts')) args.push('--no-charts');
    if (formData.get('keepDelisted')) args.push('--keep-delisted');
    if (formData.get('noEarnings')) args.push('--no-earnings');
    if (formData.get('noAnalyst')) args.push('--no-analyst');

    let filtersConfig;
    try {
      filtersConfig = buildFiltersConfigFromInputs();
    } catch (err) {
      setScannerStatus(statusEl, 'error', err.message || 'Filtre değeri geçersiz.');
      return;
    }

    setScannerStatus(statusEl, 'info', 'Filtre dosyası hazırlanıyor...');

    let preparedPath;
    try {
      const prepared = await window.pythonBridge.prepareFilters(filtersConfig);
      preparedPath = prepared?.path;
      if (!preparedPath) {
        throw new Error('Geçici filtre dosyası oluşturulamadı');
      }
    } catch (err) {
      setScannerStatus(statusEl, 'error', err.message || 'Filtre dosyası oluşturulamadı.');
      return;
    }

    const provider = 'polygon';
    const env = {
      SCANNER_FILTERS_PATH: preparedPath,
    };
    if (provider) {
      env.SCANNER_DATA_PROVIDER = provider;
      env.QUOTE_PROVIDER = provider;
    }
    if ((state.quoteSettings.provider || '').toLowerCase() !== provider) {
      setScannerStatus(statusEl, 'info', 'Market Scanner yalnızca Polygon verisiyle çalışır.');
    }

    filtersState.data = cloneDeep(filtersConfig);
    setScannerStatus(statusEl, 'success', 'Tarama başlatıldı, çıktı günlüklerinden takip edebilirsiniz.');

    progressState = {
      completed: 0,
      total: 0,
    };
    progressCard.card.classList.remove('job-complete');
    updateProgressCard(progressCard, progressState, 'Hazırlanıyor');
    jobList.prepend(progressCard.card);

    runPythonJob({
      label: 'Scanner Agent',
      scriptKey: 'scanner',
      args,
      cwd: getToolCwd('scanner'),
      jobList,
      env,
      onOutput: ({ data }) => {
        const parsed = parseScannerProgress(data);
        if (!parsed || !progressState) return;
        const totalSafe = Number.isFinite(parsed.total) ? parsed.total : 0;
        const completedSafe = Number.isFinite(parsed.completed) ? parsed.completed : 0;
        progressState.total = totalSafe;
        progressState.completed = Math.min(completedSafe, totalSafe || completedSafe);
        updateProgressCard(progressCard, progressState, parsed.message);
      },
      onExit: ({ error, signal }) => {
        if (!progressState) return;
        let text;
        let finished = true;
        if (error) {
          text = `Hata: ${error}`;
          finished = false;
        } else if (signal) {
          text = `İptal edildi (${signal})`;
          finished = false;
        } else {
          text = `${progressState.completed}/${progressState.total} tamamlandı`;
        }
        updateProgressCard(progressCard, progressState, text, finished);
        progressState = null;
      },
    });
    jobList.prepend(progressCard.card);
  });

  root.appendChild(heading);
  root.appendChild(desc);
  root.appendChild(statusEl);
  root.appendChild(form);
  root.appendChild(jobList);

  (async () => {
    try {
      const latest = await window.pythonBridge.loadFilters();
      if (latest && latest.data) {
        filtersState.data = cloneDeep(latest.data);
      }
    } catch (err) {
      setScannerStatus(statusEl, 'error', 'filters.yaml okunamadı, varsayılan değerler kullanılacak.');
    }
    ensureFilterDefaults(filtersState.data);
    applyFiltersToInputs(filterInputs, filtersState.data);
    if (!filtersState.loaded) {
      setScannerStatus(statusEl, 'info', 'filters.yaml yüklenip forma aktarıldı.');
      filtersState.loaded = true;
    }
  })();

  saveBtn.addEventListener('click', async () => {
    let filtersConfig;
    try {
      filtersConfig = buildFiltersConfigFromInputs();
    } catch (err) {
      setScannerStatus(statusEl, 'error', err.message || 'Filtre değeri geçersiz.');
      return;
    }

    try {
      const saved = await window.pythonBridge.saveFilters(filtersConfig);
      filtersState.data = cloneDeep((saved && saved.data) || filtersConfig);
      setScannerStatus(statusEl, 'success', 'filters.yaml kaydedildi.');
    } catch (err) {
      const message = err && err.message ? err.message : 'filters.yaml kaydedilemedi.';
      setScannerStatus(statusEl, 'error', message);
    }
  });

  return { root };
}

function getToolCwd(key) {
  switch (key) {
    case 'amountCalculator':
      return dirnameFromPath(state.defaults.tools.amountCalculator);
    case 'scanner':
      return dirnameFromPath(state.defaults.tools.scanner);
    default:
      return state.defaults.repoRoot;
  }
}

function dirnameFromPath(fullPath) {
  if (!fullPath) return state.defaults.repoRoot;
  const normalized = fullPath.replace(/\\\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return fullPath;
  return fullPath.slice(0, idx);
}

async function runPythonJob({ label, scriptKey, args, cwd, jobList, env, onOutput, onExit }) {
  const scriptPath = state.defaults.tools[scriptKey];
  if (!scriptPath) {
    alert(`Script yolu bulunamadı: ${scriptKey}`);
    return;
  }

  const { card, statusEl, logEl, stopBtn, commandEl } = createJobCard(label, scriptPath, args);
  jobList.prepend(card);

  try {
    const { jobId } = await window.pythonBridge.run({
      script: scriptPath,
      args,
      cwd,
      pythonPath: defaultPython,
      env,
    });
    card.dataset.jobId = jobId;
    statusEl.textContent = 'Çalışıyor';
    stopBtn.disabled = false;
    stopBtn.addEventListener('click', () => stopJob(jobId));
    commandEl.textContent = formatCommand(defaultPython, scriptPath, args);
    state.jobs.set(jobId, { card, statusEl, logEl, stopBtn, onOutput, onExit });
  } catch (err) {
    statusEl.textContent = `Başlatılamadı: ${err.message}`;
    card.classList.add('job-error');
    commandEl.textContent = formatCommand(defaultPython, scriptPath, args);
    if (typeof onExit === 'function') {
      try {
        onExit({ code: null, signal: null, error: err.message });
      } catch (cbErr) {
        console.error('progress exit callback error', cbErr);
      }
    }
  }
}

function createJobCard(label, scriptPath, args) {
  const card = document.createElement('article');
  card.className = 'job-card';

  const header = document.createElement('div');
  header.className = 'job-header';

  const title = document.createElement('h3');
  title.textContent = `${label} – ${new Date().toLocaleTimeString()}`;

  const statusEl = document.createElement('span');
  statusEl.className = 'job-status';
  statusEl.textContent = 'Başlatılıyor';

  const controls = document.createElement('div');
  controls.className = 'job-controls';
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'danger';
  stopBtn.textContent = 'Durdur';
  stopBtn.disabled = true;
  controls.appendChild(stopBtn);

  header.appendChild(title);
  header.appendChild(statusEl);
  header.appendChild(controls);

  const commandEl = document.createElement('code');
  commandEl.className = 'job-command';
    commandEl.textContent = formatCommand(defaultPython, scriptPath, args);

  const logEl = document.createElement('pre');
  logEl.className = 'job-log';
  logEl.textContent = '';

  card.appendChild(header);
  card.appendChild(commandEl);
  card.appendChild(logEl);

  return { card, statusEl, logEl, stopBtn, commandEl };
}

function stopJob(jobId) {
  const job = state.jobs.get(jobId);
  if (job) {
    job.stopBtn.disabled = true;
    job.statusEl.textContent = 'Durduruluyor...';
  }
  window.pythonBridge.stop(jobId);
}

function handlePythonOutput({ jobId, stream, data }) {
  const job = state.jobs.get(jobId);
  if (!job) return;
  const prefix = stream === 'stderr' ? '[stderr] ' : '';
  job.logEl.textContent += prefix + data;
  job.logEl.scrollTop = job.logEl.scrollHeight;
  if (typeof job.onOutput === 'function') {
    try {
      job.onOutput({ stream, data });
    } catch (err) {
      console.error('progress callback error', err);
    }
  }
}

function handlePythonExit({ jobId, code, signal, error }) {
  const job = state.jobs.get(jobId);
  if (!job) return;
  if (error) {
    job.statusEl.textContent = `Hata: ${error}`;
    job.card.classList.add('job-error');
  } else if (signal) {
    job.statusEl.textContent = `Sinyal ile sonlandı (${signal})`;
  } else {
    job.statusEl.textContent = `Bitti (kod ${code})`;
  }
  job.stopBtn.disabled = true;
  if (typeof job.onExit === 'function') {
    try {
      job.onExit({ code, signal, error });
    } catch (err) {
      console.error('progress exit callback error', err);
    }
  }
  state.jobs.delete(jobId);
}

function formatCommand(pythonPath, scriptPath, args) {
  const quote = (s) => (s.includes(' ') ? `"${s}"` : s);
  return `${quote(pythonPath)} ${quote(scriptPath)} ${args.map(quote).join(' ')}`.trim();
}

function createFilterField(field) {
  if (field.type === 'boolean') {
    const wrapper = document.createElement('label');
    wrapper.className = 'check-field';
    const input = document.createElement('input');
    input.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = field.label;
    wrapper.appendChild(input);
    wrapper.appendChild(span);
    return { element: wrapper, input };
  }

  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const title = document.createElement('span');
  title.textContent = field.label;
  wrapper.appendChild(title);

  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    (field.options || []).forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    if (field.type === 'number') {
      input.type = 'number';
      if (field.step) input.step = field.step;
    } else {
      input.type = 'text';
    }
  }

  wrapper.appendChild(input);
  return { element: wrapper, input };
}

function setScannerStatus(el, kind, message) {
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.className = 'scanner-status hidden';
    return;
  }
  el.textContent = message;
  el.className = 'scanner-status';
  if (kind) {
    el.classList.add(`is-${kind}`);
  }
}

function applyFiltersToInputs(entries, config) {
  entries.forEach(({ input, field }) => {
    const value = getValueByPath(config, field.path);
    switch (field.type) {
      case 'boolean':
        input.checked = Boolean(value);
        break;
      case 'number':
        input.value = value === undefined || value === null ? '' : value;
        break;
      case 'list':
        if (Array.isArray(value)) {
          input.value = value.join(', ');
        } else if (typeof value === 'string') {
          input.value = value;
        } else {
          input.value = '';
        }
        break;
      case 'select': {
        const optionValues = Array.from(input.options).map((opt) => opt.value);
        const strVal = value === undefined || value === null ? '' : String(value);
        if (strVal && !optionValues.includes(strVal)) {
          const opt = document.createElement('option');
          opt.value = strVal;
          opt.textContent = strVal;
          input.appendChild(opt);
        }
        input.value = strVal || optionValues[0] || '';
        break;
      }
      default:
        input.value = value === undefined || value === null ? '' : value;
    }
  });
}

function ensureFilterDefaults(config) {
  const cfg = config || {};
  cfg.options = cfg.options && typeof cfg.options === 'object' ? cfg.options : {};
  if (!cfg.options.earnings_provider) cfg.options.earnings_provider = 'yahoo';
  if (!cfg.options.analyst_ratings_provider) cfg.options.analyst_ratings_provider = 'yahoo';

  cfg.fundamentals = cfg.fundamentals && typeof cfg.fundamentals === 'object' ? cfg.fundamentals : {};
  const ratings = cfg.fundamentals.analyst_ratings_allow;
  if (Array.isArray(ratings)) {
    cfg.fundamentals.analyst_ratings_allow = ratings;
  } else if (typeof ratings === 'string') {
    cfg.fundamentals.analyst_ratings_allow = ratings.split(',').map((x) => x.trim()).filter(Boolean);
  } else if (!ratings) {
    cfg.fundamentals.analyst_ratings_allow = [];
  }

  return cfg;
}

function parseFilterInputValue(field, input) {
  switch (field.type) {
    case 'boolean':
      return input.checked;
    case 'number': {
      const raw = input.value.trim();
      if (raw === '') return undefined;
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        throw new Error(`${field.label} sayısal olmalı`);
      }
      return field.numberType === 'int' ? Math.round(num) : num;
    }
    case 'list': {
      const raw = input.value.trim();
      if (!raw) return [];
      return raw.split(',').map((x) => x.trim()).filter(Boolean);
    }
    case 'select':
      return input.value;
    case 'text':
    default:
      return input.value.trim();
  }
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') {
    return NaN;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function roundShares(value, mode) {
  if (!Number.isFinite(value)) return value;
  switch ((mode || 'none').toLowerCase()) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'nearest':
      return Math.round(value);
    case 'none':
    default:
      return value;
  }
}

function computePosition({ account, stop, riskPct, riskDollar, buyAmount, shareRound, quote }) {
  if (!quote || !Number.isFinite(quote.price)) {
    throw new Error('Geçerli fiyat alınamadı.');
  }

  const buyPrice = Number(quote.price);
  const currency = (quote.currency || 'USD').toUpperCase();

  if (buyPrice <= 0) {
    throw new Error('Anlık fiyat 0’dan büyük olmalı.');
  }

  if (stop >= buyPrice) {
    throw new Error('Stop fiyatı alış fiyatının altında olmalı.');
  }

  const riskPerShare = buyPrice - stop;

  let mode = 'riskPct';
  let targetRisk;
  let sharesRaw;

  if (Number.isFinite(buyAmount) && buyAmount > 0) {
    sharesRaw = buyAmount / buyPrice;
    mode = 'fixed';
    targetRisk = buyAmount; // güncel risk sonradan hesaplanacak
  } else {
    if (Number.isFinite(riskDollar) && riskDollar > 0) {
      targetRisk = riskDollar;
      mode = 'riskDollar';
    } else {
      const pct = Number.isFinite(riskPct) && riskPct > 0 ? riskPct : 1.0;
      targetRisk = account * (pct / 100);
      mode = 'riskPct';
    }
    sharesRaw = targetRisk / riskPerShare;
  }

  const shares = roundShares(sharesRaw, shareRound);
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error('Yuvarlama sonrası lot sayısı 0 oldu. Parametreleri güncelleyin.');
  }

  const invested = shares * buyPrice;
  const actualRisk = shares * riskPerShare;

  if (mode === 'fixed') {
    targetRisk = actualRisk;
  }

  const percentRiskPosition = (riskPerShare / buyPrice) * 100;

  const ladder = [];
  for (let k = 1; k <= 5; k += 1) {
    ladder.push({
      multiple: k,
      pnl: actualRisk * k,
      price: buyPrice + k * riskPerShare,
    });
  }

  return {
    symbol: quote.symbol || '',
    account,
    buyPrice,
    stop,
    riskPerShare,
    sharesRaw,
    shares,
    shareRound,
    invested,
    targetRisk,
    actualRisk,
    percentRiskPosition,
    ladder,
    currency,
    quoteSource: quote.source || 'bilinmiyor',
    quoteAsOf: quote.as_of || null,
    fetchedAt: quote.fetched_at || null,
    mode,
  };
}

function formatMoney(value, currency) {
  if (!Number.isFinite(value)) return '—';
  const cc = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: cc,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (err) {
    return `${formatNumber(value, { maximumFractionDigits: 2 })} ${cc}`;
  }
}

function formatNumber(value, options = {}) {
  if (!Number.isFinite(value)) return '—';
  const formatter = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  });
  return formatter.format(value);
}

function formatPercent(value, options = {}) {
  if (!Number.isFinite(value)) return '—';
  const text = formatNumber(value, { maximumFractionDigits: 2, ...options });
  return `${text}%`;
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function createProgressCard() {
  const card = document.createElement('article');
  card.className = 'job-card';
  const title = document.createElement('h3');
  title.textContent = 'Tarama İlerlemesi';
  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const barInner = document.createElement('span');
  bar.appendChild(barInner);
  const meta = document.createElement('div');
  meta.className = 'progress-meta';
  const left = document.createElement('span');
  const right = document.createElement('span');
  meta.appendChild(left);
  meta.appendChild(right);
  card.appendChild(title);
  card.appendChild(bar);
  card.appendChild(meta);
  return { card, barInner, left, right };
}

function updateProgressCard(progressCard, state, message, finished = false) {
  if (!progressCard || !state) return;
  const total = state.total || 0;
  const completed = state.completed || 0;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  progressCard.barInner.style.width = `${pct}%`;
  progressCard.left.textContent = message || '';
  progressCard.right.textContent = total > 0 ? `${completed}/${total}` : `${completed}`;
  if (finished) {
    progressCard.card.classList.add('job-complete');
  } else {
    progressCard.card.classList.remove('job-complete');
  }
}

function parseScannerProgress(line) {
  if (!line) return null;
  const lines = String(line).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const segment = lines[i].trim();
    if (!segment) continue;
    const match = segment.match(/^\[(\d+)\/(\d+)\]\s*(.*)$/);
    if (match) {
      const [, done, total, rest] = match;
      return {
        completed: Number(done),
        total: Number(total),
        message: rest || '',
      };
    }
  }
  return null;
}

function cloneDeep(obj) {
  if (obj === undefined || obj === null) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    return {};
  }
}

function getValueByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function setValueByPath(obj, path, value) {
  if (!obj || !path) return;
  const keys = path.split('.');
  let cursor = obj;
  keys.slice(0, -1).forEach((key) => {
    if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
  cursor[keys[keys.length - 1]] = value;
}
