const nodemailer = require('nodemailer');
const {
  listHoldingsForReporter,
  getReporterSettings,
  recordAlertTrigger,
  getLastAlertFor,
  updateReporterLastRun,
} = require('./storage');

let fetchQuoteFn = null;
let timer = null;

function initReporter({ fetchQuote }) {
  fetchQuoteFn = fetchQuote;
  rescheduleReporter();
}

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function rescheduleReporter() {
  clearTimer();
  const settings = getReporterSettings();
  if (!settings || !settings.email_enabled) {
    return;
  }
  if (!settings.email_address || !settings.smtp_host) {
    return;
  }

  const intervalSec = Math.max(30, Number(settings.check_interval || 60));
  const run = () => {
    runReporterCycle().catch((err) => {
      console.error('[reporter]', err);
    });
  };

  timer = setInterval(run, intervalSec * 1000);
  run();
}

async function runReporterCycle() {
  if (typeof fetchQuoteFn !== 'function') return;
  const settings = getReporterSettings();
  if (!settings || !settings.email_enabled) return;
  if (!settings.email_address || !settings.smtp_host) return;

  const holdings = listHoldingsForReporter().filter((holding) => {
    if (!holding.stop_loss && holding.stop_loss !== 0) return false;
    if (!Number.isFinite(Number(holding.stop_loss))) return false;
    const risk = Number(holding.avg_price) - Number(holding.stop_loss);
    return risk > 0;
  });

  if (!holdings.length) {
    updateReporterLastRun(new Date().toISOString());
    return;
  }

  const transporter = buildTransport(settings);
  if (!transporter) {
    console.error('[reporter] SMTP transport oluşturulamadı');
    return;
  }

  for (const holding of holdings) {
    try {
      const quote = await fetchQuoteFn(holding.symbol);
      if (!quote || !Number.isFinite(Number(quote.price))) continue;
      await evaluateHolding({ holding, quote, settings, transporter });
    } catch (err) {
      console.error('[reporter] quote error', holding.symbol, err.message);
    }
  }

  updateReporterLastRun(new Date().toISOString());
}

async function evaluateHolding({ holding, quote, settings, transporter }) {
  const avgPrice = Number(holding.avg_price);
  const stopLoss = Number(holding.stop_loss);
  const risk = avgPrice - stopLoss;
  if (risk <= 0) return;

  const price = Number(quote.price);
  const symbol = holding.symbol;
  const timestamp = new Date().toISOString();

  const alerts = [];

  const lossThreshold = avgPrice - 0.8 * risk;
  if (price <= lossThreshold) {
    alerts.push({ type: 'stop_loss_80', title: 'Stop Loss Uyarısı', direction: 'down' });
  }

  const profitThreshold = avgPrice + 1.0 * risk;
  if (price >= profitThreshold) {
    alerts.push({ type: 'take_profit_100', title: 'R Hedefi Uyarısı', direction: 'up' });
  }

  for (const alert of alerts) {
    const lastTriggered = getLastAlertFor({ holdingId: holding.id, alertType: alert.type });
    if (lastTriggered && Date.now() - Date.parse(lastTriggered) < 60 * 60 * 1000) {
      // within last hour, skip duplicate notifications
      continue;
    }

    const subject = `${alert.title}: ${symbol} ${alert.direction === 'down' ? '↓' : '↑'}`;
    const bodyLines = [
      `Sembol: ${symbol}`,
      `Güncel Fiyat: ${formatMoney(price, quote.currency)}`,
      `Ort. Alış: ${formatMoney(avgPrice, quote.currency)}`,
      `Stop Loss: ${formatMoney(stopLoss, quote.currency)}`,
      `Risk (1R): ${formatMoney(risk, quote.currency)}`,
      '',
      alert.direction === 'down'
        ? `Fiyat stop loss mesafesinin %80'ine ulaştı. Pozisyonu gözden geçirin.`
        : `Fiyat 1R hedefini yakaladı. Kar realizasyonu değerlendirin.`,
      '',
      `Veri zamanı: ${quote.as_of || quote.fetched_at || new Date().toISOString()}`,
    ];

    try {
      await transporter.sendMail({
        from: settings.from_address || settings.smtp_username || settings.email_address,
        to: settings.email_address,
        subject,
        text: bodyLines.join('\n'),
      });
      recordAlertTrigger({ holdingId: holding.id, alertType: alert.type, timestampIso: timestamp });
    } catch (err) {
      console.error('[reporter] email send failed', err.message);
    }
  }
}

function buildTransport(settings) {
  try {
    const transportConfig = {
      host: settings.smtp_host,
      port: settings.smtp_port || 587,
      secure: Number(settings.smtp_port) === 465,
    };
    if (settings.smtp_username && settings.smtp_password) {
      transportConfig.auth = {
        user: settings.smtp_username,
        pass: settings.smtp_password,
      };
    }
    return nodemailer.createTransport(transportConfig);
  } catch (err) {
    console.error('[reporter] transport error', err);
    return null;
  }
}

function formatMoney(value, currency = 'USD') {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch (err) {
    return `${value.toFixed(2)} ${currency || 'USD'}`;
  }
}

module.exports = {
  initReporter,
  rescheduleReporter,
};
