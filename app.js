/* ==========================================================================
   CONFIG & STATE MANAGEMENT
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
   UTILITY HELPER ENGINES
   ========================================================================== */
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => n == null || isNaN(n) ? '—' : n.toFixed(d);
const fmtINR = n => n == null || isNaN(n) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN');

function updateStatus(msg, isWorking = false) {
  const container = $('statusIndicator');
  const txt = $('statusText');
  if (!container || !txt) return;
  txt.textContent = msg;
  if (isWorking) container.classList.add('working'); else container.classList.remove('working');
}

function showToast(msg, dur = 2500) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// Fixed theme/metric matching utility
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
   WEBSITE RESET / RETURN HOME ROUTINE
   ========================================================================== */
function returnToHomepage() {
  $('searchInput').value = '';
  $('compareSearchInput').value = '';
  $('dropdownResults').style.display = 'none';
  $('compareDropdownResults').style.display = 'none';

  Object.keys(state.charts).forEach(key => {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  });

  state.currentScheme = null;
  state.navData = [];
  state.compareScheme = null;
  state.compareNavData = [];

  $('mainDashboard').style.display = 'none';
  $('compareMatrixContainer').style.display = 'none';
  $('emptyState').style.display = 'flex';

  showToast("Workspace reset to homepage context.");
}

/* ==========================================================================
   THEME ENGINE INTERFACES (WITH FAVICON INVERSION)
   ========================================================================== */
function initThemeEngine() {
  const btn = $('themeToggleBtn');
  if (!btn) return;

  const savedTheme = localStorage.getItem('theme-preference') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateFaviconForTheme(savedTheme);

  btn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', targetTheme);
    localStorage.setItem('theme-preference', targetTheme);
    
    updateFaviconForTheme(targetTheme);

    if (state.navData.length) {
      renderNavChart(state.navData);
      const rollingPoints = calculateRollingReturnsData(state.navData, state.rollingPeriodYears);
      renderRollingChart(rollingPoints);
      if (state.compareNavData.length) {
        renderComparisonNormalizedChart();
      }
    }
    showToast(`Switched workspace environment to ${targetTheme} mode.`);
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
    gridColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)',
    textColor: isDark ? '#8b95a8' : '#475569',
    tooltipBg: isDark ? '#10141c' : '#ffffff',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    bodyColor: isDark ? '#e8edf5' : '#0f172a'
  };
}

/* ==========================================================================
   MATHEMATICAL COMPUTATION MATRIX HOOKS
   ========================================================================== */
function calculateCAGR(startNav, endNav, years) {
  if (startNav <= 0 || endNav <= 0 || years <= 0) return 0;
  return Math.pow((endNav / startNav), (1 / years)) - 1;
}

function computeCorePerformanceMetrics(data) {
  if (!data || data.length < 3) return { cagr: 0, volatility: 0, sharpe: 0, maxDrawdown: 0 };
  
  const lastItem = data[data.length - 1];
  const totalDays = (lastItem.date - data[0].date) / (1000 * 60 * 60 * 24);
  const totalYears = totalDays / 365.25;
  const cagr = calculateCAGR(data[0].nav, lastItem.nav, totalYears);

  const returns = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1].nav > 0) returns.push((data[i].nav - data[i - 1].nav) / data[i - 1].nav);
  }
  
  let annualizedVol = 0;
  if (returns.length > 0) {
    const avg = returns.reduce((sum, v) => sum + v, 0) / returns.length;
    const variance = returns.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / returns.length;
    annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
  }

  const sharpe = annualizedVol > 0 ? (cagr - RISK_FREE_RATE) / annualizedVol : 0;

  let maxDrawdown = 0;
  let peakNav = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i].nav > peakNav) peakNav = data[i].nav;
    else {
      const dd = (data[i].nav - peakNav) / peakNav;
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
    const rightPoint = data[rightIdx];
    while (leftIdx < rightIdx && (rightPoint.date - data[leftIdx].date) / (1000 * 60 * 60 * 24) > daysWindow) {
      leftIdx++;
    }
    const exactDays = (rightPoint.date - data[leftIdx].date) / (1000 * 60 * 60 * 24);
    if (exactDays >= daysWindow - 8 && exactDays <= daysWindow + 15) {
      if (data[leftIdx].nav > 0) {
        const cagr = Math.pow((rightPoint.nav / data[leftIdx].nav), (1 / years)) - 1;
        results.push({ x: rightPoint.date.getTime(), y: cagr * 100 });
      }
    }
  }
  return results;
}

/* ==========================================================================
   SECONDARY COMPARISON ASYNC PIPELINES
   ========================================================================== */
async function loadSecondaryComparisonScheme(code) {
  $('compareDropdownResults').style.display = 'none';
  $('compareSearchInput').value = '';
  updateStatus(`Loading comparative stream [${code}]...`, true);

  try {
    const res = await fetch(`${MFAPI}/${code}`);
    const json = await res.json();

    if (!json || !json.data || json.data.length === 0) {
      showToast("Comparison target dataset payload is empty.");
      updateStatus("System Ready", false);
      return;
    }

    state.compareScheme = json.meta;
    state.compareNavData = json.data.map(item => ({
      date: parseDateString(item.date),
      nav: parseFloat(item.nav)
    })).sort((a, b) => a.date - b.date);

    executeHeadToHeadComparison();
    updateStatus("System Ready", false);
  } catch (err) {
    console.error("Comparison load failure:", err);
    showToast("Error retrieving secondary data model.");
    updateStatus("Engine Error", false);
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

  $('compPrimDrawdown').textContent = `${fmt(pStats.maxDrawdown)}%`;
  $('compSecDrawdown').textContent = `${fmt(sStats.maxDrawdown)}%`;

  renderComparisonNormalizedChart();
  $('compareMatrixContainer').style.display = 'block';
}

function renderComparisonNormalizedChart() {
  const ctx = $('compareChart').getContext('2d');
  if (state.charts.compare) state.charts.compare.destroy();

  const theme = getChartThemingTokens();

  const startPrimaryMs = state.navData[0].date.getTime();
  const startSecondaryMs = state.compareNavData[0].date.getTime();
  const overlappingStartMs = Math.max(startPrimaryMs, startSecondaryMs);

  const primBasePoint = state.navData.find(d => d.date.getTime() >= overlappingStartMs) || state.navData[0];
  const secBasePoint = state.compareNavData.find(d => d.date.getTime() >= overlappingStartMs) || state.compareNavData[0];

  const primBaseNav = primBasePoint.nav;
  const secBaseNav = secBasePoint.nav;

  const primaryDataset = state.navData
    .filter(d => d.date.getTime() >= overlappingStartMs)
    .map(d => ({ x: d.date.getTime(), y: primBaseNav > 0 ? (d.nav / primBaseNav) * 100 : 100 }));

  const secondaryDataset = state.compareNavData
    .filter(d => d.date.getTime() >= overlappingStartMs)
    .map(d => ({ x: d.date.getTime(), y: secBaseNav > 0 ? (d.nav / secBaseNav) * 100 : 100 }));

  state.charts.compare = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: state.currentScheme.scheme_name,
          data: primaryDataset,
          borderColor: '#00d4aa',
          borderWidth: 1.8,
          pointRadius: 0,
          hoverRadius: 4,
          fill: false
        },
        {
          label: state.compareScheme.scheme_name,
          data: secondaryDataset,
          borderColor: '#4fa3e0',
          borderWidth: 1.8,
          pointRadius: 0,
          hoverRadius: 4,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: theme.textColor, font: { family: 'IBM Plex Sans', size: 11 } } },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1,
          titleColor: theme.textColor, bodyColor: theme.bodyColor,
          titleFont: { family: 'IBM Plex Mono', size: 10 }, bodyFont: { family: 'IBM Plex Mono', size: 12 },
          callbacks: {
            title: items => new Date(items[0].parsed.x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            label: ctx => ` ${ctx.dataset.label}: ${parseFloat(ctx.parsed.y).toFixed(2)}% scale`
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
          ticks: { color: theme.textColor, font: { family: 'IBM Plex Mono', size: 9 }, callback: value => `${value}%` }
        }
      }
    }
  });
}

/* ==========================================================================
   STANDARD CHART PLOTTING CONTRACTS
   ========================================================================== */
function renderNavChart(data) {
  const ctx = $('navChart').getContext('2d');
  if (state.charts.nav) state.charts.nav.destroy();

  const theme = getChartThemingTokens();

  state.charts.nav = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Historical NAV Performance Value',
        data: data.map(d => ({ x: d.date.getTime(), y: d.nav })),
        borderColor: '#00d4aa',
        borderWidth: 1.5,
        pointRadius: 0,
        hoverRadius: 4,
        fill: false,
        tension: 0.05
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1,
          titleColor: theme.textColor, bodyColor: theme.bodyColor,
          titleFont: { family: 'IBM Plex Mono', size: 10 }, bodyFont: { family: 'IBM Plex Mono', size: 12 },
          callbacks: {
            title: items => new Date(items[0].parsed.x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            label: ctx => ` NAV Value: ₹${parseFloat(ctx.parsed.y).toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'dd MMM yyyy', displayFormats: { month: 'MMM yy', year: 'yyyy' } },
          grid: { color: theme.gridColor },
          ticks: { color: theme.textColor, font: { family: 'IBM Plex Mono', size: 9 }, maxTicksLimit: 8 }
        },
        y: {
          grid: { color: theme.gridColor },
          ticks: { color: theme.textColor, font: { family: 'IBM Plex Mono', size: 9 } }
        }
      }
    }
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
    ctx.textAlign = "center";
    ctx.fillText("Insufficient historical track sequence depth for this range choice.", ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  state.charts.rolling = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: `${state.rollingPeriodYears}Y Year Compounded Rolling Return Metric`,
        data: rollingPoints,
        borderColor: '#4fa3e0',
        borderWidth: 1.5,
        pointRadius: 0,
        hoverRadius: 4,
        fill: false,
        tension: 0.05
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, borderWidth: 1,
          titleColor: theme.textColor, bodyColor: theme.bodyColor,
          titleFont: { family: 'IBM Plex Mono', size: 10 }, bodyFont: { family: 'IBM Plex Mono', size: 12 },
          callbacks: {
            title: items => new Date(items[0].parsed.x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            label: ctx => ` Annualized Return: ${parseFloat(ctx.parsed.y).toFixed(2)}%`
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
          grid: {
            color: function(context) {
              if (context.tick.value === 0) {
                return document.documentElement.getAttribute('data-theme') === 'dark' ? '#ff5f5f' : '#e11d48';
              }
              return theme.gridColor;
            },
            lineWidth: function(context) { return context.tick.value === 0 ? 1.5 : 1; },
            borderDash: function(context) { return context.tick.value === 0 ? [5, 5] : []; }
          },
          ticks: { color: theme.textColor, font: { family: 'IBM Plex Mono', size: 9 }, callback: value => `${value}%` }
        }
      }
    }
  });
}

function setupRollingPeriodButtons() {
  const container = $('rollingPeriodContainer');
  if (!container || !state.navData.length) return;

  const totalDays = (state.navData[state.navData.length - 1].date - state.navData[0].date) / (1000 * 60 * 60 * 24);
  const totalYearsAvailable = totalDays / 365.25;

  const targetPeriods = [
    { label: '1Y', value: 1 }, { label: '3Y', value: 3 }, { label: '5Y', value: 5 }, { label: '7Y', value: 7 }, { label: '10Y', value: 10 }
  ];

  container.innerHTML = '';
  const validPeriods = targetPeriods.filter(p => totalYearsAvailable >= p.value);

  if (validPeriods.length === 0) {
    container.innerHTML = `<span class="section-subtitle">Lifespan &lt; 1 Year</span>`;
    return;
  }
  if (!validPeriods.some(p => p.value === state.rollingPeriodYears)) state.rollingPeriodYears = validPeriods[0].value;

  validPeriods.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `period-toggle-btn ${state.rollingPeriodYears === p.value ? 'active' : ''}`;
    btn.textContent = p.label;
    
    btn.addEventListener('click', () => {
      const currentActive = container.querySelector('.period-toggle-btn.active');
      if (currentActive) currentActive.classList.remove('active');
      btn.classList.add('active');
      state.rollingPeriodYears = p.value;
      
      updateStatus(`Re-calculating ${p.label} Rolling Curve...`, true);
      setTimeout(() => {
        const points = calculateRollingReturnsData(state.navData, state.rollingPeriodYears);
        renderRollingChart(points);
        updateStatus("System Ready", false);
      }, 50);
    });
    container.appendChild(btn);
  });
}

/* ==========================================================================
   PRIMARY DATA ROUTER SEQUENCES
   ========================================================================== */
async function selectScheme(code, name) {
  $('searchInput').value = '';
  $('dropdownResults').style.display = 'none';
  updateStatus(`Loading Scheme Data [${code}]...`, true);

  try {
    const res = await fetch(`${MFAPI}/${code}`);
    const json = await res.json();

    if (!json || !json.data || json.data.length === 0) {
      showToast("Data payload empty for targeted code.");
      updateStatus("System Ready", false);
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
    $('metaCategory').textContent = state.currentScheme.scheme_category || 'Growth Meta Index';
    $('metaType').textContent = state.currentScheme.scheme_type || 'Open Ended';

    const lastItem = state.navData[state.navData.length - 1];
    $('valNav').textContent = `₹${lastItem.nav.toFixed(4)}`;
    $('valNavDate').textContent = `As of ${lastItem.date.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'})}`;

    const totalDays = (lastItem.date - state.navData[0].date) / (1000 * 60 * 60 * 24);
    const totalYears = totalDays / 365.25;
    const totalCagr = calculateCAGR(state.navData[0].nav, lastItem.nav, totalYears);
    $('valCagr').textContent = `${(totalCagr * 100).toFixed(2)}%`;

    const analytics = computeCorePerformanceMetrics(state.navData);
    $('valStdDev').textContent = `${analytics.volatility.toFixed(2)}%`;
    $('valSharpe').textContent = fmt(analytics.sharpe, 2);

    populatePerformanceTables();
    setupRollingPeriodButtons();
    runSipBacktestSimulation();
    calculateAdvancedRiskProfiles();

    renderNavChart(state.navData);
    const rollingPoints = calculateRollingReturnsData(state.navData, state.rollingPeriodYears);
    renderRollingChart(rollingPoints);

    $('emptyState').style.display = 'none';
    $('mainDashboard').style.display = 'block';
    
    const firstTabBtn = document.querySelector('.tab-btn');
    if (firstTabBtn) firstTabBtn.click();

    updateStatus("System Ready", false);
  } catch (err) {
    console.error("Data sequence load failure:", err);
    showToast("Error processing data from MF servers.");
    updateStatus("Engine Error", false);
  }
}

function runSipBacktestSimulation() {
  const amount = parseFloat($('sipAmountInput').value) || 5000;
  const targetDay = parseInt($('sipDayInput').value) || 5;
  if (!state.navData.length) return;

  let totalInvested = 0; let totalUnits = 0; let monthsCount = 0; let lastProcessedYearMonth = "";

  state.navData.forEach(point => {
    const yr = point.date.getFullYear();
    const mo = point.date.getMonth();
    const currentYearMonth = `${yr}-${mo}`;

    if (currentYearMonth !== lastProcessedYearMonth && point.date.getDate() >= targetDay) {
      if (point.nav > 0) {
        totalInvested += amount;
        totalUnits += (amount / point.nav);
        monthsCount++;
        lastProcessedYearMonth = currentYearMonth;
      }
    }
  });

  const latestNav = state.navData[state.navData.length - 1].nav;
  const totalValue = totalUnits * latestNav;
  const netProfitLoss = totalValue - totalInvested;
  const absoluteGainPct = totalInvested > 0 ? (netProfitLoss / totalInvested) * 100 : 0;

  $('sipTotalValue').textContent = fmtINR(totalValue);
  $('sipInvestedAmount').textContent = fmtINR(totalInvested);
  $('sipTotalMonths').textContent = `${monthsCount} Instalments Made`;
  $('sipAbsoluteGain').textContent = `${absoluteGainPct.toFixed(2)}%`;
  $('sipAbsoluteGain').className = `metric-value ${colorClass(netProfitLoss)}`;
  $('sipProfitLossAmt').textContent = `${netProfitLoss >= 0 ? 'Profit' : 'Loss'} Value: ${fmtINR(Math.abs(netProfitLoss))}`;
  $('sipTotalUnits').textContent = totalUnits.toFixed(2);
}

function calculateAdvancedRiskProfiles() {
  if (!state.navData.length) return;
  let maxDrawdown = 0; let peakNav = -Infinity; let peakDate = null; let maxRecoveryDays = 0; let positiveDaysCount = 0;

  for (let i = 0; i < state.navData.length; i++) {
    const currentNav = state.navData[i].nav;
    if (i > 0 && currentNav > state.navData[i - 1].nav) positiveDaysCount++;

    if (currentNav > peakNav) {
      peakNav = currentNav; peakDate = state.navData[i].date;
    } else {
      const currentDrawdown = (currentNav - peakNav) / peakNav;
      if (currentDrawdown < maxDrawdown) maxDrawdown = currentDrawdown;
      
      if (peakDate) {
        const currentRecoveryGap = (state.navData[i].date - peakDate) / (1000 * 60 * 60 * 24);
        if (currentRecoveryGap > maxRecoveryDays) maxRecoveryDays = currentRecoveryGap;
      }
    }
  }

  const positiveDaysRatio = (positiveDaysCount / (state.navData.length - 1)) * 100;
  $('riskPeakNav').textContent = `₹${peakNav.toFixed(4)}`;
  $('riskMaxDrawdown').textContent = `${(maxDrawdown * 100).toFixed(2)}%`;
  $('riskRecoveryDays').textContent = maxRecoveryDays > 0 ? `${Math.round(maxRecoveryDays)} Days` : '0 Days';
  $('riskPositiveDaysPct').textContent = `${positiveDaysRatio.toFixed(1)}% Up Days`;
}

function populatePerformanceTables() {
  const tbodyTrailing = $('trailingReturnsBody');
  const tbodyCalendar = $('calendarReturnsBody');
  tbodyTrailing.innerHTML = ''; tbodyCalendar.innerHTML = '';
  if (!state.navData.length) return;
  
  const lastItem = state.navData[state.navData.length - 1];
  const horizons = [{ label: 'Past 1 Year', days: 365 }, { label: 'Past 3 Years', days: 365 * 3 }, { label: 'Past 5 Years', days: 365 * 5 }];

  horizons.forEach(h => {
    let matchPoint = null;
    const targetTargetMs = lastItem.date.getTime() - (h.days * 24 * 60 * 60 * 1000);
    for (let i = state.navData.length - 1; i >= 0; i--) {
      if (state.navData[i].date.getTime() <= targetTargetMs) { matchPoint = state.navData[i]; break; }
    }
    if (matchPoint) {
      const absReturn = ((lastItem.nav - matchPoint.nav) / matchPoint.nav) * 100;
      const cagr = (Math.pow((lastItem.nav / matchPoint.nav), (1 / (h.days / 365))) - 1) * 100;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${h.label}</strong></td><td class="${colorClass(absReturn)}">${fmt(absReturn)}%</td><td class="${colorClass(cagr)}">${fmt(cagr)}%</td>`;
      tbodyTrailing.appendChild(tr);
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${h.label}</strong></td><td colspan="2" class="neutral">— Insufficient track length —</td>`;
      tbodyTrailing.appendChild(tr);
    }
  });

  const yearsMap = {};
  state.navData.forEach(d => {
    const yr = d.date.getFullYear();
    if (!yearsMap[yr]) yearsMap[yr] = []; yearsMap[yr].push(d);
  });
  Object.keys(yearsMap).sort((a, b) => b - a).forEach(yr => {
    const list = yearsMap[yr];
    if (list.length > 2) {
      const start = list[0].nav; const end = list[list.length - 1].nav;
      const pct = ((end - start) / start) * 100;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>Year ${yr} Sequence Track</td><td>₹${start.toFixed(2)} → ₹${end.toFixed(2)}</td><td class="${colorClass(pct)}"><strong>${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</strong></td>`;
      tbodyCalendar.appendChild(tr);
    }
  });
}

/* ==========================================================================
   INITIALIZATION & AUTO-COMPLETE EVENT HOOKS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initThemeEngine(); 
  
  $('logoHomeBtn').addEventListener('click', returnToHomepage);

  updateStatus("Initialising Index Search Engine...", true);
  try {
    const res = await fetch(MFAPI);
    state.allSchemes = await res.json();
    updateStatus("System Ready", false);
  } catch (err) {
    console.error("Master catalog fetch error:", err);
    updateStatus("Offline Mode", false);
  }

  setupSearchAutocomplete($('searchInput'), $('dropdownResults'), selectScheme);
  setupSearchAutocomplete($('compareSearchInput'), $('compareDropdownResults'), loadSecondaryComparisonScheme);
  setupTabs();

  $('runSipBtn').addEventListener('click', () => {
    runSipBacktestSimulation();
    showToast("SIP metrics re-calculated successfully.");
  });
});

function setupSearchAutocomplete(inputEl, dropEl, onSelectCallback) {
  if (!inputEl || !dropEl) return;

  inputEl.addEventListener('input', () => {
    const query = inputEl.value.toLowerCase().trim();
    if (query.length < 3) { dropEl.style.display = 'none'; return; }

    const matches = state.allSchemes.filter(s => 
      s.schemeName.toLowerCase().includes(query) || s.schemeCode.toString().includes(query)
    ).slice(0, 60);

    dropEl.innerHTML = '';
    if (matches.length === 0) {
      dropEl.innerHTML = '<div class="dropdown-item neutral">No matching schema codes found.</div>';
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

  document.addEventListener('click', (e) => {
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