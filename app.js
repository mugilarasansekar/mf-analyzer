/* ==========================================================================
   CONFIG & STATE
   ========================================================================== */
const MFAPI = 'https://api.mfapi.in/mf';
const RISK_FREE_RATE = 0.065;

const state = {
  currentScheme: null,
  navData: [],
  compareScheme: null,
  compareNavData: [],
  allSchemes: [],
  charts: {},
  rollingPeriodYears: 3
};

/* ==========================================================================
   UTILITIES
   ========================================================================== */
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : n.toFixed(d);
const fmtINR = n => n == null || isNaN(n) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN');

function updateStatus(msg, isWorking = false) {
  const container = $('statusIndicator');
  const txt = $('statusText');
  if (!container || !txt) return;
  txt.textContent = msg;
  isWorking ? container.classList.add('working') : container.classList.remove('working');
}

function showToast(msg, dur = 2500) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function colorClass(val, inverse = false) {
  if (val == null || isNaN(val)) return 'neutral';
  if (inverse) return val < 0 ? 'good' : val > 0 ? 'bad' : 'neutral';
  return val > 0 ? 'good' : val < 0 ? 'bad' : 'neutral';
}

function parseDateString(str) {
  const parts = str.split('-');
  return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
}

/* ==========================================================================
   XIRR CALCULATOR
   Newton-Raphson method to solve for the internal rate of return
   given irregular cashflows (SIP instalments + final redemption).
   ========================================================================== */
function calculateXIRR(cashflows) {
  // cashflows: array of { amount, date } where investments are negative, final value positive
  if (!cashflows || cashflows.length < 2) return null;

  const DAYS_IN_YEAR = 365;
  const MAX_ITER = 100;
  const TOLERANCE = 1e-7;

  const t0 = cashflows[0].date.getTime();
  const years = cashflows.map(cf => (cf.date.getTime() - t0) / (1000 * 60 * 60 * 24 * DAYS_IN_YEAR));

  function npv(rate) {
    return cashflows.reduce((sum, cf, i) => sum + cf.amount / Math.pow(1 + rate, years[i]), 0);
  }

  function dnpv(rate) {
    return cashflows.reduce((sum, cf, i) => {
      if (years[i] === 0) return sum;
      return sum - years[i] * cf.amount / Math.pow(1 + rate, years[i] + 1);
    }, 0);
  }

  let rate = 0.1; // initial guess 10%
  for (let i = 0; i < MAX_ITER; i++) {
    const n = npv(rate);
    const d = dnpv(rate);
    if (Math.abs(d) < 1e-12) break;
    const newRate = rate - n / d;
    if (Math.abs(newRate - rate) < TOLERANCE) return newRate * 100;
    rate = newRate;
    if (rate < -0.999) rate = -0.999; // guard against blow-up
  }
  return rate * 100;
}

/* ==========================================================================
   RESET
   ========================================================================== */
function returnToHomepage() {
  $('searchInput').value = '';
  $('compareSearchInput').value = '';
  $('dropdownResults').style.display = 'none';
  $('compareDropdownResults').style.display = 'none';

  Object.keys(state.charts).forEach(key => {
    if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; }
  });

  state.currentScheme = null;
  state.navData = [];
  state.compareScheme = null;
  state.compareNavData = [];

  $('mainDashboard').style.display = 'none';
  $('compareMatrixContainer').style.display = 'none';
  $('emptyState').style.display = 'flex';

  showToast('Returned to home.');
}

/* ==========================================================================
   THEME ENGINE
   ========================================================================== */
function initThemeEngine() {
  const btn = $('themeToggleBtn');
  if (!btn) return;

  const savedTheme = localStorage.getItem('theme-preference') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateFaviconForTheme(savedTheme);

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme-preference', next);
    updateFaviconForTheme(next);

    if (state.navData.length) {
      renderNavChart(state.navData);
      renderRollingChart(calculateRollingReturnsData(state.navData, state.rollingPeriodYears));
      if (state.compareNavData.length) renderComparisonNormalizedChart();
    }
    showToast(`Switched to ${next} mode.`);
  });
}

function updateFaviconForTheme(theme) {
  const favicon = $('dynamicFavicon');
  if (!favicon) return;
  const bgFill = theme === 'dark' ? '%2310141c' : '%23ffffff';
  const markFill = theme === 'dark' ? '%2300d4aa' : '%2300b48f';
  favicon.setAttribute('href', `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='${bgFill}'/%3E%3Ctext y='70' x='18' font-family='monospace' font-size='65' font-weight='bold' fill='${markFill}'%3E▮%3C/text%3E%3C/svg%3E`);
}

function getChartThemingTokens() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    gridColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    textColor: isDark ? '#8b95a8' : '#475569',
    tooltipBg: isDark ? '#10141c' : '#ffffff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    bodyColor: isDark ? '#e8edf5' : '#0f172a'
  };
}

/* ==========================================================================
   MATH / METRICS
   ========================================================================== */
function calculateCAGR(startNav, endNav, years) {
  if (startNav <= 0 || endNav <= 0 || years <= 0) return 0;
  return Math.pow(endNav / startNav, 1 / years) - 1;
}

function computeCorePerformanceMetrics(data) {
  if (!data || data.length < 3) return { cagr: 0, volatility: 0, sharpe: 0, maxDrawdown: 0 };

  const last = data[data.length - 1];
  const totalYears = (last.date - data[0].date) / (1000 * 60 * 60 * 24 * 365.25);
  const cagr = calculateCAGR(data[0].nav, last.nav, totalYears);

  const returns = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].nav > 0) returns.push((data[i].nav - data[i - 1].nav) / data[i - 1].nav);
  }

  let annualizedVol = 0;
  if (returns.length > 0) {
    const avg = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / returns.length;
    annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
  }

  const sharpe = annualizedVol > 0 ? (cagr - RISK_FREE_RATE) / annualizedVol : 0;

  let maxDrawdown = 0, peakNav = -Infinity;
  for (const d of data) {
    if (d.nav > peakNav) peakNav = d.nav;
    else {
      const dd = (d.nav - peakNav) / peakNav;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }

  return { cagr: cagr * 100, volatility: annualizedVol * 100, sharpe, maxDrawdown: maxDrawdown * 100 };
}

function calculateRollingReturnsData(data, years) {
  if (data.length < 2) return [];
  const results = [];
  const daysWindow = years * 365.25;
  let leftIdx = 0;

  for (let rightIdx = 0; rightIdx < data.length; rightIdx++) {
    const right = data[rightIdx];
    while (leftIdx < rightIdx && (right.date - data[leftIdx].date) / 86400000 > daysWindow) leftIdx++;
    const exactDays = (right.date - data[leftIdx].date) / 86400000;
    if (exactDays >= daysWindow - 8 && exactDays <= daysWindow + 15 && data[leftIdx].nav > 0) {
      const cagr = Math.pow(right.nav / data[leftIdx].nav, 1 / years) - 1;
      results.push({ x: right.date.getTime(), y: cagr * 100 });
    }
  }
  return results;
}

/* ==========================================================================
   COMPARISON
   ========================================================================== */
async function loadSecondaryComparisonScheme(code) {
  $('compareDropdownResults').style.display = 'none';
  $('compareSearchInput').value = '';
  updateStatus('Loading...', true);

  try {
    const res = await fetch(`${MFAPI}/${code}`);
    const json = await res.json();

    if (!json?.data?.length) {
      showToast('No data found for that fund.');
      updateStatus('Ready', false);
      return;
    }

    state.compareScheme = json.meta;
    state.compareNavData = json.data.map(item => ({
      date: parseDateString(item.date),
      nav: parseFloat(item.nav)
    })).sort((a, b) => a.date - b.date);

    executeHeadToHeadComparison();
    updateStatus('Ready', false);
  } catch (err) {
    console.error(err);
    showToast('Failed to load comparison fund.');
    updateStatus('Error', false);
  }
}

function executeHeadToHeadComparison() {
  if (!state.navData.length || !state.compareNavData.length) return;

  $('compareNamePrimary').textContent = state.currentScheme.scheme_name;
  $('compareNameSecondary').textContent = state.compareScheme.scheme_name;

  const pStats = computeCorePerformanceMetrics(state.navData);
  const sStats = computeCorePerformanceMetrics(state.compareNavData);

  $('compPrimNav').textContent = `₹${state.navData[state.navData.length - 1].nav.toFixed(4)}`;
  $('compSecNav').textContent = `₹${state.compareNavData[state.compareNavData.length - 1].nav.toFixed(4)}`;

  $('compPrimCagr').textContent = `${fmt(pStats.cagr)}%`;
  $('compSecCagr').textContent = `${fmt(sStats.cagr)}%`;
  $('compPrimCagr').className = colorClass(pStats.cagr);
  $('compSecCagr').className = colorClass(sStats.cagr);

  $('compPrimVol').textContent = `${fmt(pStats.volatility)}%`;
  $('compSecVol').textContent = `${fmt(sStats.volatility)}%`;

  $('compPrimSharpe').textContent = fmt(pStats.sharpe);
  $('compSecSharpe').textContent = fmt(sStats.sharpe);

  // BUG FIX: maxDrawdown stored as negative %, display as positive magnitude
  $('compPrimDrawdown').textContent = `${fmt(Math.abs(pStats.maxDrawdown))}%`;
  $('compSecDrawdown').textContent = `${fmt(Math.abs(sStats.maxDrawdown))}%`;

  renderComparisonNormalizedChart();
  $('compareMatrixContainer').style.display = 'block';
}

function renderComparisonNormalizedChart() {
  const ctx = $('compareChart').getContext('2d');
  if (state.charts.compare) state.charts.compare.destroy();

  const theme = getChartThemingTokens();
  const overlapStart = Math.max(state.navData[0].date.getTime(), state.compareNavData[0].date.getTime());

  const primBase = (state.navData.find(d => d.date.getTime() >= overlapStart) || state.navData[0]).nav;
  const secBase = (state.compareNavData.find(d => d.date.getTime() >= overlapStart) || state.compareNavData[0]).nav;

  const primaryDs = state.navData
    .filter(d => d.date.getTime() >= overlapStart)
    .map(d => ({ x: d.date.getTime(), y: primBase > 0 ? (d.nav / primBase) * 100 : 100 }));

  const secondaryDs = state.compareNavData
    .filter(d => d.date.getTime() >= overlapStart)
    .map(d => ({ x: d.date.getTime(), y: secBase > 0 ? (d.nav / secBase) * 100 : 100 }));

  state.charts.compare = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: state.currentScheme.scheme_name, data: primaryDs, borderColor: '#00d4aa', borderWidth: 1.8, pointRadius: 0, hoverRadius: 4, fill: false },
        { label: state.compareScheme.scheme_name, data: secondaryDs, borderColor: '#4fa3e0', borderWidth: 1.8, pointRadius: 0, hoverRadius: 4, fill: false }
      ]
    },
    options: buildChartOptions(theme, value => `${value}%`, (ctx) => ` ${ctx.dataset.label}: ${parseFloat(ctx.parsed.y).toFixed(2)}`)
  });
}

/* ==========================================================================
   CHARTS
   ========================================================================== */
function buildChartOptions(theme, yTickCallback, tooltipLabelCallback, extraYConfig = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index', intersect: false,
        backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1,
        titleColor: theme.textColor, bodyColor: theme.bodyColor,
        titleFont: { family: 'IBM Plex Mono', size: 10 },
        bodyFont: { family: 'IBM Plex Mono', size: 12 },
        callbacks: {
          title: items => new Date(items[0].parsed.x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          label: tooltipLabelCallback
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: { displayFormats: { month: 'MMM yy', year: 'yyyy' } },
        grid: { color: theme.gridColor },
        ticks: { color: theme.textColor, font: { family: 'IBM Plex Mono', size: 9 }, maxTicksLimit: 8 }
      },
      y: {
        grid: { color: theme.gridColor },
        ticks: { color: theme.textColor, font: { family: 'IBM Plex Mono', size: 9 }, callback: yTickCallback },
        ...extraYConfig
      }
    }
  };
}

function renderNavChart(data) {
  const ctx = $('navChart').getContext('2d');
  if (state.charts.nav) state.charts.nav.destroy();
  const theme = getChartThemingTokens();

  const opts = buildChartOptions(theme, value => `₹${value}`, ctx => ` NAV: ₹${parseFloat(ctx.parsed.y).toFixed(4)}`);
  opts.plugins.legend = { display: false };

  state.charts.nav = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'NAV',
        data: data.map(d => ({ x: d.date.getTime(), y: d.nav })),
        borderColor: '#00d4aa',
        borderWidth: 1.5,
        pointRadius: 0,
        hoverRadius: 4,
        fill: false,
        tension: 0.05
      }]
    },
    options: opts
  });
}

function renderRollingChart(rollingPoints) {
  const ctx = $('rollingChart').getContext('2d');
  if (state.charts.rolling) state.charts.rolling.destroy();
  const theme = getChartThemingTokens();

  if (rollingPoints.length === 0) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = theme.textColor;
    ctx.font = "13px 'IBM Plex Mono'";
    ctx.textAlign = 'center';
    ctx.fillText('Not enough history for this period.', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const zeroLineColor = isDark ? '#ff5f5f' : '#e11d48';

  const opts = buildChartOptions(
    theme,
    value => `${value}%`,
    ctx => ` Annualized: ${parseFloat(ctx.parsed.y).toFixed(2)}%`,
    {
      grid: {
        color: context => context.tick.value === 0 ? zeroLineColor : theme.gridColor,
        lineWidth: context => context.tick.value === 0 ? 1.5 : 1,
        borderDash: context => context.tick.value === 0 ? [5, 5] : []
      }
    }
  );
  opts.plugins.legend = { display: false };

  state.charts.rolling = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: `${state.rollingPeriodYears}Y Rolling CAGR`,
        data: rollingPoints,
        borderColor: '#4fa3e0',
        borderWidth: 1.5,
        pointRadius: 0,
        hoverRadius: 4,
        fill: false,
        tension: 0.05
      }]
    },
    options: opts
  });
}

function setupRollingPeriodButtons() {
  const container = $('rollingPeriodContainer');
  if (!container || !state.navData.length) return;

  const totalYears = (state.navData[state.navData.length - 1].date - state.navData[0].date) / (1000 * 60 * 60 * 24 * 365.25);
  const periods = [{ label: '1Y', value: 1 }, { label: '3Y', value: 3 }, { label: '5Y', value: 5 }, { label: '7Y', value: 7 }, { label: '10Y', value: 10 }];

  container.innerHTML = '';
  const valid = periods.filter(p => totalYears >= p.value);

  if (!valid.length) {
    container.innerHTML = `<span class="section-subtitle">Fund is less than 1 year old</span>`;
    return;
  }
  if (!valid.some(p => p.value === state.rollingPeriodYears)) state.rollingPeriodYears = valid[0].value;

  valid.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `period-toggle-btn ${state.rollingPeriodYears === p.value ? 'active' : ''}`;
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rollingPeriodYears = p.value;
      updateStatus('Calculating...', true);
      setTimeout(() => {
        renderRollingChart(calculateRollingReturnsData(state.navData, state.rollingPeriodYears));
        updateStatus('Ready', false);
      }, 50);
    });
    container.appendChild(btn);
  });
}

/* ==========================================================================
   PRIMARY DATA LOAD
   ========================================================================== */
async function selectScheme(code) {
  $('searchInput').value = '';
  $('dropdownResults').style.display = 'none';
  updateStatus('Loading...', true);

  try {
    const res = await fetch(`${MFAPI}/${code}`);
    const json = await res.json();

    if (!json?.data?.length) {
      showToast('No data found for this fund.');
      updateStatus('Ready', false);
      return;
    }

    state.compareScheme = null;
    state.compareNavData = [];
    $('compareMatrixContainer').style.display = 'none';

    state.currentScheme = json.meta;
    state.navData = json.data.map(item => ({
      date: parseDateString(item.date),
      nav: parseFloat(item.nav)
    })).sort((a, b) => a.date - b.date);

    $('fundTitle').textContent = state.currentScheme.scheme_name;
    $('metaCode').textContent = `Code: ${state.currentScheme.scheme_code}`;
    $('metaCategory').textContent = state.currentScheme.scheme_category || 'Equity';
    $('metaType').textContent = state.currentScheme.scheme_type || 'Open Ended';

    const last = state.navData[state.navData.length - 1];
    $('valNav').textContent = `₹${last.nav.toFixed(4)}`;
    $('valNavDate').textContent = `As of ${last.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;

    const totalYears = (last.date - state.navData[0].date) / (1000 * 60 * 60 * 24 * 365.25);
    $('valCagr').textContent = `${(calculateCAGR(state.navData[0].nav, last.nav, totalYears) * 100).toFixed(2)}%`;

    const analytics = computeCorePerformanceMetrics(state.navData);
    $('valStdDev').textContent = `${analytics.volatility.toFixed(2)}%`;
    $('valSharpe').textContent = fmt(analytics.sharpe, 2);

    populatePerformanceTables();
    setupRollingPeriodButtons();
    runSipBacktestSimulation();
    calculateAdvancedRiskProfiles();

    renderNavChart(state.navData);
    renderRollingChart(calculateRollingReturnsData(state.navData, state.rollingPeriodYears));

    $('emptyState').style.display = 'none';
    $('mainDashboard').style.display = 'block';

    document.querySelector('.tab-btn')?.click();
    updateStatus('Ready', false);
  } catch (err) {
    console.error(err);
    showToast('Failed to load fund data.');
    updateStatus('Error', false);
  }
}

/* ==========================================================================
   SIP BACKTEST + XIRR
   ========================================================================== */
function runSipBacktestSimulation() {
  const amount = parseFloat($('sipAmountInput').value) || 10000;
  const targetDay = parseInt($('sipDayInput').value) || 5;
  if (!state.navData.length) return;

  let totalInvested = 0, totalUnits = 0, monthsCount = 0, lastYM = '';
  const cashflows = [];

  state.navData.forEach(point => {
    const yr = point.date.getFullYear();
    const mo = point.date.getMonth();
    const ym = `${yr}-${mo}`;

    if (ym !== lastYM && point.date.getDate() >= targetDay && point.nav > 0) {
      totalInvested += amount;
      totalUnits += amount / point.nav;
      monthsCount++;
      lastYM = ym;
      cashflows.push({ amount: -amount, date: point.date }); // negative = outflow
    }
  });

  const lastNav = state.navData[state.navData.length - 1].nav;
  const totalValue = totalUnits * lastNav;
  const netPL = totalValue - totalInvested;
  const absGainPct = totalInvested > 0 ? (netPL / totalInvested) * 100 : 0;

  // Add final redemption cashflow for XIRR
  cashflows.push({ amount: totalValue, date: state.navData[state.navData.length - 1].date });

  $('sipTotalValue').textContent = fmtINR(totalValue);
  $('sipInvestedAmount').textContent = fmtINR(totalInvested);
  $('sipTotalMonths').textContent = `${monthsCount} instalments`;
  $('sipAbsoluteGain').textContent = `${absGainPct.toFixed(2)}%`;
  $('sipAbsoluteGain').className = `metric-value ${colorClass(netPL)}`;
  $('sipProfitLossAmt').textContent = `${netPL >= 0 ? 'Profit' : 'Loss'}: ${fmtINR(Math.abs(netPL))}`;
  $('sipTotalUnits').textContent = totalUnits.toFixed(3);

  // XIRR
  const xirr = calculateXIRR(cashflows);
  const xirrEl = $('sipXIRR');
  if (xirrEl) {
    if (xirr !== null && isFinite(xirr)) {
      xirrEl.textContent = `${xirr.toFixed(2)}%`;
      xirrEl.className = `metric-value ${colorClass(xirr)}`;
      $('sipXIRRSub').textContent = 'Actual annualized return';
    } else {
      xirrEl.textContent = '—';
      xirrEl.className = 'metric-value neutral';
      $('sipXIRRSub').textContent = 'Could not converge';
    }
  }
}

/* ==========================================================================
   RISK METRICS
   BUG FIX: recovery days now tracks actual peak-to-recovery, not peak-to-current
   ========================================================================== */
function calculateAdvancedRiskProfiles() {
  if (!state.navData.length) return;

  let maxDrawdown = 0, peakNav = -Infinity, peakIdx = 0;
  let maxRecoveryDays = 0, positiveDays = 0;

  for (let i = 0; i < state.navData.length; i++) {
    const nav = state.navData[i].nav;
    if (i > 0 && nav > state.navData[i - 1].nav) positiveDays++;

    if (nav > peakNav) {
      // New peak: check if previous drawdown recovered and how long it took
      if (peakNav !== -Infinity) {
        const recoveryDays = (state.navData[i].date - state.navData[peakIdx].date) / 86400000;
        if (recoveryDays > maxRecoveryDays) maxRecoveryDays = recoveryDays;
      }
      peakNav = nav;
      peakIdx = i;
    } else {
      const dd = (nav - peakNav) / peakNav;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }

  const positivePct = (positiveDays / (state.navData.length - 1)) * 100;

  $('riskPeakNav').textContent = `₹${peakNav.toFixed(4)}`;
  // BUG FIX: show positive magnitude
  $('riskMaxDrawdown').textContent = `${(Math.abs(maxDrawdown) * 100).toFixed(2)}%`;
  $('riskRecoveryDays').textContent = maxRecoveryDays > 0 ? `${Math.round(maxRecoveryDays)} days` : '—';
  $('riskPositiveDaysPct').textContent = `${positivePct.toFixed(1)}%`;
}

/* ==========================================================================
   PERFORMANCE TABLES
   ========================================================================== */
function populatePerformanceTables() {
  const tbodyTrailing = $('trailingReturnsBody');
  const tbodyCalendar = $('calendarReturnsBody');
  tbodyTrailing.innerHTML = '';
  tbodyCalendar.innerHTML = '';
  if (!state.navData.length) return;

  const last = state.navData[state.navData.length - 1];
  const horizons = [
    { label: '1 Year', days: 365 },
    { label: '3 Years', days: 365 * 3 },
    { label: '5 Years', days: 365 * 5 },
    { label: '10 Years', days: 365 * 10 }
  ];

  horizons.forEach(h => {
    const targetMs = last.date.getTime() - h.days * 86400000;
    let match = null;
    for (let i = state.navData.length - 1; i >= 0; i--) {
      if (state.navData[i].date.getTime() <= targetMs) { match = state.navData[i]; break; }
    }
    const tr = document.createElement('tr');
    if (match) {
      const abs = ((last.nav - match.nav) / match.nav) * 100;
      const cagr = (Math.pow(last.nav / match.nav, 365 / h.days) - 1) * 100;
      tr.innerHTML = `<td><strong>${h.label}</strong></td><td class="${colorClass(abs)}">${fmt(abs)}%</td><td class="${colorClass(cagr)}">${fmt(cagr)}%</td>`;
    } else {
      tr.innerHTML = `<td><strong>${h.label}</strong></td><td colspan="2" class="neutral">Not enough history</td>`;
    }
    tbodyTrailing.appendChild(tr);
  });

  const yearsMap = {};
  state.navData.forEach(d => {
    const yr = d.date.getFullYear();
    if (!yearsMap[yr]) yearsMap[yr] = [];
    yearsMap[yr].push(d);
  });

  Object.keys(yearsMap).sort((a, b) => b - a).forEach(yr => {
    const list = yearsMap[yr];
    if (list.length > 2) {
      const start = list[0].nav, end = list[list.length - 1].nav;
      const pct = ((end - start) / start) * 100;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${yr}</td><td>₹${start.toFixed(2)} → ₹${end.toFixed(2)}</td><td class="${colorClass(pct)}"><strong>${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</strong></td>`;
      tbodyCalendar.appendChild(tr);
    }
  });
}

/* ==========================================================================
   INIT
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initThemeEngine();
  $('logoHomeBtn').addEventListener('click', returnToHomepage);

  updateStatus('Loading fund list...', true);
  try {
    const res = await fetch(MFAPI);
    state.allSchemes = await res.json();
    updateStatus('Ready', false);
  } catch (err) {
    console.error(err);
    updateStatus('Offline', false);
  }

  setupSearchAutocomplete($('searchInput'), $('dropdownResults'), selectScheme);
  setupSearchAutocomplete($('compareSearchInput'), $('compareDropdownResults'), loadSecondaryComparisonScheme);
  setupTabs();

  $('runSipBtn').addEventListener('click', () => {
    runSipBacktestSimulation();
    showToast('SIP recalculated.');
  });
});

function setupSearchAutocomplete(inputEl, dropEl, onSelectCallback) {
  if (!inputEl || !dropEl) return;

  inputEl.addEventListener('input', () => {
    const query = inputEl.value.toLowerCase().trim();
    if (query.length < 3) { dropEl.style.display = 'none'; return; }

    const matches = state.allSchemes
      .filter(s => s.schemeName.toLowerCase().includes(query) || s.schemeCode.toString().includes(query))
      .slice(0, 60);

    dropEl.innerHTML = '';
    if (!matches.length) {
      dropEl.innerHTML = '<div class="dropdown-item neutral">No funds found.</div>';
    } else {
      matches.forEach(m => {
        const row = document.createElement('div');
        row.className = 'dropdown-item';
        row.innerHTML = `<span class="code-badge">${m.schemeCode}</span> <span class="name-text">${m.schemeName}</span>`;
        row.addEventListener('click', () => onSelectCallback(m.schemeCode, m.schemeName));
        dropEl.appendChild(row);
      });
    }
    dropEl.style.display = 'block';
  });

  document.addEventListener('click', e => {
    if (!inputEl.contains(e.target) && !dropEl.contains(e.target)) dropEl.style.display = 'none';
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
    });
  });
}