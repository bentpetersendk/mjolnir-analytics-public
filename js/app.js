import { loadMjolnirData } from './data-loader.js';

const app = document.querySelector('#app');
const navItems = [
  { id: 'landing', label: 'Landing', icon: 'home' },
  { id: 'cluster', label: 'Cluster', icon: 'cluster' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'benchmarks', label: 'Benchmarks', icon: 'chart' },
  { id: 'cost', label: 'Cost', icon: 'wallet' },
  { id: 'methodology', label: 'Methodology', icon: 'book' },
];

const state = {
  theme: localStorage.getItem('med-theme') || 'dark',
  route: location.hash.replace('#/', '') || 'landing',
};

let data = null;

function icon(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5v8.5a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z"/><path d="M9 21v-5h6v5" fill="none"/>',
    cluster: '<path d="M7 7h4v4H7zM13 7h4v4h-4zM10 13h4v4h-4zM4 15h3v3H4zM17 15h3v3h-3z"/>',
    users: '<path d="M8.5 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8.5 11Zm7 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 2c-2.5 0-5 1.3-5 3.5V19h10v-2.5c0-2.2-2.5-3.5-5-3.5Zm7 .2c-.7 0-1.4.1-2 .3 1.3.8 2 1.9 2 3.2V19h5v-2.3c0-1.9-2-3.5-5-3.5Z"/>',
    chart: '<path d="M5 19h14"/><path d="M7 17V9"/><path d="M12 17V5"/><path d="M17 17v-6"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H20v14H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M16 12h4" fill="none"/>',
    book: '<path d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12H8.5A2.5 2.5 0 0 0 6 21.5z"/><path d="M6 4.5A2.5 2.5 0 0 0 3.5 7v12A2.5 2.5 0 0 1 6 16.5" fill="none"/>',
    moon: '<path d="M14.5 3.5a7.5 7.5 0 1 0 6 13 8 8 0 0 1-6-13Z"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.7 4.7l1.8 1.8M17.5 17.5l1.8 1.8M2.5 12H5M19 12h2.5M4.7 19.3l1.8-1.8M17.5 6.5l1.8-1.8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    bell: '<path d="M6 17h12l-1.3-2.1A8.5 8.5 0 0 1 15 10V9a3 3 0 0 0-6 0v1a8.5 8.5 0 0 1-1.7 4.9z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    settings: '<path d="M12 8.5A3.5 3.5 0 1 0 15.5 12 3.5 3.5 0 0 0 12 8.5Z"/><path d="M19 12a7.1 7.1 0 0 0-.1-1l2.1-1.6-2-3.5-2.5.8a7 7 0 0 0-1.7-1l-.4-2.7H9.6l-.4 2.7a7 7 0 0 0-1.7 1l-2.5-.8-2 3.5L5.1 11A7.1 7.1 0 0 0 5 12c0 .3 0 .7.1 1l-2.1 1.6 2 3.5 2.5-.8a7 7 0 0 0 1.7 1l.4 2.7h4.8l.4-2.7a7 7 0 0 0 1.7-1l2.5.8 2-3.5L18.9 13c.1-.3.1-.7.1-1Z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${icons[name] || icons.home}</svg>`;
}

function actionSentence(label, value, threshold) {
  if (value === null || value === undefined) return 'Data unavailable';
  const v = Number(value);
  const t = threshold === null || threshold === undefined ? null : Number(threshold);
  if (Number.isNaN(v)) return 'Data unavailable';
  if (label === 'CPU efficiency' && t !== null && !Number.isNaN(t)) {
    return `Your CPU efficiency is lower than ${Math.round(t * 100)}% of users.`;
  }
  if (label === 'Memory efficiency') {
    return `Your jobs typically use only ${pct(v)} of requested memory.`;
  }
  return pct(v);
}

function pct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function money(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })} DKK`;
}

function fmt(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function navLink(item) {
  const activeRoute = state.route === item.id || (item.id === 'users' && state.route.startsWith('user/'));
  const active = activeRoute ? 'aria-current="page"' : '';
  return `<a class="nav-link" href="#/${item.id}" ${active}>${icon(item.icon)}<span>${item.label}</span></a>`;
}

function pageTitle(route) {
  if (route.startsWith('user/')) return 'User Detail';
  return navItems.find((item) => item.id === route)?.label || 'Landing';
}

function lineChart() {
  const points = [[4, 78], [12, 72], [20, 76], [28, 68], [36, 73], [44, 63], [52, 66], [60, 50], [68, 46], [76, 58], [84, 57], [92, 48], [100, 42]];
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const avg = points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y + (i % 2 ? 8 : 6)}`).join(' ');
  return `
    <svg class="chart" viewBox="0 0 104 88" preserveAspectRatio="none">
      <defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0%" stop-color="#3e8cff"/><stop offset="100%" stop-color="#30d5d0"/></linearGradient></defs>
      ${[18, 36, 54, 72].map((y) => `<line x1="0" y1="${y}" x2="104" y2="${y}" stroke="rgba(147,166,194,.16)" />`).join('')}
      <path d="${avg}" fill="none" stroke="rgba(95,180,255,.58)" stroke-dasharray="3 3" stroke-width="1.5"/>
      <path d="${path}" fill="none" stroke="url(#g1)" stroke-width="2.5" stroke-linecap="round"/>
      ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#ecf3ff" stroke="#3e8cff" stroke-width="1.5"/>`).join('')}
    </svg>`;
}

function spark(seed, width = 92, height = 24, tone = 'blue') {
  const points = [4, 14, 9, 20, 16, 11, 24, 21, 32, 15, 41, 13, 50, 17, 60, 9, 70, 15, 80, 8, 90, 13];
  const path = points.reduce((acc, value, index) => index % 2 === 0 ? `${acc}${index ? ' L ' : 'M '}${value} ${points[index + 1]}` : acc, '');
  const colors = { blue: ['#3e8cff', '#30d5d0'], green: ['#53d88a', '#2dd4bf'], amber: ['#ffb84d', '#ff6b7a'] };
  const palette = colors[tone] || colors.blue;
  const [a, b] = palette;
  const id = `s${seed}`.replace(/[^a-zA-Z0-9_-]/g, '');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient></defs><path d="${path}" fill="none" stroke="url(#${id})" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}

function metricCard(kpi) {
  return `<article class="metric-card"><div class="metric-label">${kpi.label}</div><div class="metric-value">${kpi.value}</div><div class="metric-trend">${kpi.trend}</div>${spark(`${kpi.label}-${kpi.value}`, 92, 24, kpi.tone || 'blue')}</article>`;
}

function statBlock(label, value, trend) {
  return `<article class="stat-card"><div class="label">${label}</div><div class="value">${value}</div><div class="subtle">${trend}</div></article>`;
}

function percentileCard(label, value, status, tone) {
  return `<article class="percentile-card"><span class="pill ${tone}">${label}</span><strong>${value}</strong><div class="subtle">${status}</div></article>`;
}

function tableFromRows(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function localNav(active) {
  return `<aside class="local-nav">${navItems.map((item) => `<a class="${item.label === active ? 'active' : ''}" href="#/${item.id}">${item.label}</a>`).join('')}</aside>`;
}

function recommendations(limit = 3) {
  const cluster = asObject(data?.clusterSummary?.allTime);
  const percentiles = asObject(data?.percentiles);
  const recs = asArray(data?.recommendations);
  const generated = [
    insightCard('CPU efficiency', comparisonText(cluster.avg_cpu_efficiency, percentiles.cpu?.['75'], 'lower than', 'Your CPU efficiency is lower than')),
    insightCard('Memory efficiency', `Your jobs typically use only ${pct(cluster.avg_memory_efficiency)} of requested memory.`, 'Trim requests where the gap is widest.'),
    insightCard('Savings', 'You could reduce wasted spend by focusing on the highest-cost workloads first.', money(cluster.underutilized_cost_dkk)),
  ];
  const recommendationCards = recs.length
    ? recs.slice(0, limit).map((item) => recCard(item.priority === 'high' ? 'High impact' : 'Medium impact', item.title, money(item.savings)))
    : [
        recCard('High impact', 'Reduce requested memory', '0 DKK'),
        recCard('High impact', 'Reduce requested CPUs', '0 DKK'),
        recCard('Medium impact', 'Review GPU utilization', '0 DKK'),
      ];
  return [...generated, ...recommendationCards].slice(0, limit);
}

function recCard(level, title, savings) {
  const safeTitle = title || 'Recommendation unavailable';
  const safeSavings = savings || '—';
  return `<article class="rec-card"><div class="rec-top"><span class="pill ${level.startsWith('High') ? 'warn' : 'info'}">${level}</span><strong>${safeSavings}</strong></div><div>${safeTitle}</div><div class="subtle">Generated from the current data shape and percentile context.</div></article>`;
}

function insightCard(label, lead, detail) {
  return `<article class="rec-card"><div class="rec-top"><span class="pill info">Insight</span><strong>${label}</strong></div><div>${lead}</div><div class="subtle">${detail}</div></article>`;
}

function comparisonText(value, threshold, relation, intro) {
  if (value === null || value === undefined || threshold === null || threshold === undefined) return 'Data unavailable for this comparison.';
  const v = Number(value);
  const t = Number(threshold);
  if (Number.isNaN(v) || Number.isNaN(t)) return 'Data unavailable for this comparison.';
  return `${intro} ${relation} ${(t * 100).toFixed(0)}% of users.`;
}


function userLink(user) {
  const routeId = user && user.routeId ? encodeURIComponent(user.routeId) : '';
  const label = escapeHtml(user && user.label ? user.label : 'User bundle');
  return routeId ? `<a class="table-link" href="#/user/${routeId}">${label}</a>` : label;
}

function rankingTable(title, users, metricLabel, metricFormatter) {
  const rows = asArray(users).slice(0, 25).map((user, index) => [
    `#${index + 1}`,
    userLink(user),
    metricFormatter(user),
    pct(user.memory),
    money(user.savings),
    fmt(user.jobs),
  ]);
  const body = rows.length ? tableFromRows(['Rank', 'Pseudonymous user', metricLabel, 'Memory efficiency', 'Potential savings', 'Jobs'], rows) : '<p class="subtle">No user bundles are available for this ranking.</p>';
  return `<section class="section"><div class="section-head"><h2>${title}</h2><span class="subtle">Top ${Math.min(asArray(users).length, 25)}</span></div>${body}</section>`;
}

function userTable(users) {
  return rankingTable('Top 25 users by CPU efficiency', users, 'CPU efficiency', (user) => pct(user.cpu));
}

function rollingSummaryCards(user) {
  const summaries = asObject(user?.rollingSummaries);
  return ['7d', '30d', '90d'].map((window) => {
    const summary = asObject(summaries[window]);
    return statBlock(`Rolling ${window}`, `${pct(summary.avg_cpu_efficiency)} CPU`, `${pct(summary.avg_memory_efficiency)} memory, ${money(summary.underutilized_cost_dkk)} savings`);
  }).join('');
}

function dailyTrendTable(trends) {
  const rows = asArray(trends).slice(-14).reverse().map((row) => [
    escapeHtml(row.report_date || '—'),
    pct(row.avg_cpu_efficiency),
    pct(row.avg_memory_efficiency),
    fmt(row.jobs),
    money(row.underutilized_cost_dkk),
  ]);
  return rows.length ? tableFromRows(['Date', 'CPU efficiency', 'Memory efficiency', 'Jobs', 'Savings opportunity'], rows) : '<p class="subtle">No daily trend rows are available for this user bundle.</p>';
}

function inefficientJobsTable(jobs) {
  const rows = asArray(jobs).slice(0, 10).map((job) => [
    money(job.underutilized_cost_dkk),
    pct(job.measured_cpu_efficiency),
    pct(job.memory_efficiency),
    fmt(job.elapsed_hours, 1),
    fmt(job.gpu_count),
    money(job.estimated_cost_dkk),
  ]);
  return rows.length ? tableFromRows(['Wasted cost', 'CPU efficiency', 'Memory efficiency', 'Elapsed hours', 'GPUs', 'Estimated cost'], rows) : '<p class="subtle">No inefficient job rows are available for this user bundle.</p>';
}

function userRecommendations(user) {
  const recs = asArray(user?.recommendations);
  if (!recs.length) return '<p class="subtle">No generated recommendations are attached to this user bundle.</p>';
  return `<div class="rec-list">${recs.map((item) => recCard(item.severity === 'high' ? 'High impact' : 'Medium impact', item.title || item.suggestion || 'Recommendation', item.suggestion || 'Review this workload pattern')).join('')}</div>`;
}

function diagnosticsPanel() {
  const diagnostics = asObject(data?.diagnostics);
  const rows = [
    ['Selected runtime source', diagnostics.selectedRuntimeSource || data?.source || 'unknown'],
    ['Index users count', fmt(diagnostics.indexUsersCount)],
    ['Loaded user bundle count', fmt(diagnostics.loadedUserBundleCount)],
    ['Failed user bundle count', fmt(diagnostics.failedUserBundleCount)],
    ['First 5 pseudonymous labels/tokens', asArray(diagnostics.firstFiveUserLabelsOrTokens).map(escapeHtml).join(', ') || '—'],
    ['Cluster daily trend length', fmt(diagnostics.clusterDailyTrendLength)],
    ['Percentiles keys', asArray(diagnostics.percentilesKeys).map(escapeHtml).join(', ') || '—'],
  ];
  return `<section class="section diagnostics-panel"><div class="section-head"><h2>Runtime diagnostics</h2><span class="subtle">No private identifiers or raw paths</span></div>${tableFromRows(['Check', 'Value'], rows)}</section>`;
}


function landingPage() {
  const cluster = asObject(data?.clusterSummary);
  const allTime = asObject(cluster.allTime);
  const rolling90d = asObject(cluster.rolling90d);
  return `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">${dot('green')} Built for efficiency engineering and cluster operations</div>
        <h1>Improve cluster efficiency. Lower spend. Increase performance.</h1>
        <p>Mjolnir Efficiency Dashboard gives platform teams a focused workspace for cluster efficiency, user behavior, benchmark drift, and cost optimization. The interface is designed for fast scanning, real monitoring workflows, and production review.</p>
        <div class="hero-actions"><a class="btn btn-primary" href="#/cluster">Open dashboard</a><a class="btn" href="#/methodology">Read methodology</a></div>
      </div>
      <div class="hero-panel">
        <div class="hero-panel-head"><div class="panel-title">Overview</div><div class="subtle">${data?.source === 'real-export' ? 'Restricted export loaded locally' : 'Sample fallback active'}</div></div>
        <div class="mini-grid">
          ${[
            { label: 'Efficiency Score', value: pct(allTime.avg_cpu_efficiency), trend: `${fmt(allTime.jobs)} jobs`, tone: 'good' },
            { label: 'Potential Savings', value: money(allTime.underutilized_cost_dkk), trend: `${fmt(allTime.failed_jobs)} failed jobs`, tone: 'info' },
            { label: 'Memory Efficiency', value: pct(allTime.avg_memory_efficiency), trend: `${fmt(allTime.jobs_with_measured_memory)} measured`, tone: 'warn' },
            { label: 'GPU Hours', value: fmt(allTime.gpu_hours, 1), trend: 'Measured usage', tone: 'good' },
          ].map(metricCard).join('')}
        </div>
        <div class="panel-grid">
          <div class="section" style="margin:0"><div class="section-head"><h2>Efficiency trend</h2><span class="subtle">Daily</span></div>${lineChart()}</div>
          <div class="section" style="margin:0"><div class="section-head"><h2>Top recommendations</h2><span class="pill info">${fmt((data?.recommendations || []).length)}</span></div><div class="rec-list">${recommendations(3).join('')}</div></div>
        </div>
      </div>
    </section>
    <section class="dashboard-grid">
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Am I using Mjolnir efficiently?</h2></div><p class="subtle">Compare CPU and memory efficiency against the population, then act on the largest gap first.</p></section>
        <section class="section"><div class="section-head"><h2>How do I compare to others?</h2></div><p class="subtle">Use percentile context to see whether you sit above or below the majority of users.</p></section>
        <section class="section"><div class="section-head"><h2>What should I change?</h2></div><p class="subtle">Follow the recommendation cards for the most direct path to lower waste and cost.</p></section>
      </div>
      <div class="stack"><section class="section"><div class="section-head"><h2>Operational fit</h2></div><div class="cards-grid"><article class="stat-card"><div class="label">Export window</div><div class="value">90 days</div><div class="subtle">Mirrored source</div></article><article class="stat-card"><div class="label">Archive-ready</div><div class="value">Yes</div><div class="subtle">Path stable</div></article><article class="stat-card"><div class="label">Fallback</div><div class="value">Sample data</div><div class="subtle">Offline mode</div></article></div></section></div>
    </section>`;
}

function clusterPage() {
  const cluster = asObject(data?.clusterSummary);
  const allTime = asObject(cluster.allTime);
  const rolling = asObject(cluster.rolling90d || cluster.rolling30d);
  const percentiles = asObject(data?.percentiles);
  return `
    <div class="hero" style="grid-template-columns:1.1fr .9fr">
      <div class="section">
        <div class="section-head"><h2>Cluster Dashboard</h2><span class="subtle">Operational view focused on utilization, efficiency, and cost action</span></div>
        <div class="cards-grid">${[
          statBlock('Jobs', fmt(allTime.jobs), 'All time volume'),
          statBlock('CPU efficiency', actionSentence('CPU efficiency', allTime.avg_cpu_efficiency, data?.percentiles?.cpu?.['75'])),
          statBlock('Memory efficiency', actionSentence('Memory efficiency', allTime.avg_memory_efficiency, data?.percentiles?.memory?.['75'])),
        ].join('')}</div>
        <div style="margin-top:16px">${lineChart()}</div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Percentile distributions</h2><span class="subtle">How this dataset compares with the cluster population</span></div>
        <div class="percentiles">
          ${percentileCard('CPU p50', pct(percentiles.cpu?.['50']), 'Median efficiency', 'info')}
          ${percentileCard('Memory p50', pct(percentiles.memory?.['50']), 'Median memory', 'info')}
          ${percentileCard('Cost p75', money(percentiles.cost?.['75']), 'Upper quartile', 'warn')}
          ${percentileCard('GPU p95', fmt(percentiles.gpu?.['95'], 1), 'Heavy usage', 'good')}
          ${percentileCard('Underutilized p95', money(percentiles.underutilized?.['95']), 'Savings ceiling', 'good')}
          ${percentileCard('7d CPU', pct(rolling.avg_cpu_efficiency), 'Rolling summary', 'info')}
        </div>
      </div>
    </div>
    <div class="dashboard-grid">
      <div class="table-card"><div class="section-head"><h2>Cluster efficiency overview</h2><span class="subtle">${fmt((data?.index?.user_count) || (data?.userBundles?.length || 0))} users in export</span></div>${clusterTable()}</div>
      <div class="stack">${alertsSection()}</div>
    </div>`;
}

function clusterTable() {
  const rows = asArray(data?.userBundles).slice(0, 6).map((user) => [
    user.label,
    pct(user.cpu),
    pct(user.memory),
    money(user.savings),
    fmt(user.jobs),
  ]);
  return `
    <div class="table-toolbar"><input class="search" type="search" placeholder="Search clusters..." /><button class="btn">Filter</button><button class="btn">Export</button></div>
    ${tableFromRows(['User', 'CPU efficiency', 'Memory efficiency', 'Potential savings', 'Jobs'], rows)}
  `;
}

function alertsSection() {
  return `
    <section class="section"><div class="section-head"><h2>Alerts</h2><span class="subtle">12 total</span></div><div class="alerts-list"><div class="alert-item"><div class="alert-top"><strong>High waste detected in cluster</strong><span class="subtle">5m ago</span></div><div class="subtle">payments-prod</div></div><div class="alert-item"><div class="alert-top"><strong>Efficiency score below threshold</strong><span class="subtle">15m ago</span></div><div class="subtle">inventory-prod</div></div><div class="alert-item"><div class="alert-top"><strong>Benchmark data updated</strong><span class="subtle">2h ago</span></div><div class="subtle">4 benchmarks updated</div></div></div></section>`;
}

function userPage() {
  const users = asArray(data?.userBundles);
  const rankings = asObject(data?.rankings);
  const topCpu = asArray(rankings.cpu).length ? rankings.cpu : users.slice().sort((a, b) => Number(b.cpu || 0) - Number(a.cpu || 0)).slice(0, 25);
  const topMemory = asArray(rankings.memory).length ? rankings.memory : users.slice().sort((a, b) => Number(b.memory || 0) - Number(a.memory || 0)).slice(0, 25);
  const topSavings = asArray(rankings.savings).length ? rankings.savings : users.slice().sort((a, b) => Number(b.savings || 0) - Number(a.savings || 0)).slice(0, 25);
  return `
    <div class="page-layout">
      ${localNav('Users')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Users</h2><span class="subtle">Pseudonymous bundle rankings from the loaded export</span></div><div class="cards-grid">${[
          statBlock('Total user bundle count', fmt(users.length), `${fmt(data?.diagnostics?.indexUsersCount)} users listed in index`),
          statBlock('Failed bundle loads', fmt(data?.diagnostics?.failedUserBundleCount), 'Loader keeps rendering with successful bundles'),
          statBlock('Top CPU efficiency', topCpu[0] ? pct(topCpu[0].cpu) : '—', topCpu[0] ? topCpu[0].label : 'No bundle loaded'),
        ].join('')}</div></section>
        ${rankingTable('Top 25 users by CPU efficiency', topCpu, 'CPU efficiency', (user) => pct(user.cpu))}
        ${rankingTable('Top 25 users by memory efficiency', topMemory, 'Memory efficiency', (user) => pct(user.memory))}
        ${rankingTable('Top 25 users by potential savings', topSavings, 'Potential savings', (user) => money(user.savings))}
      </div>
    </div>`;
}

function userDetailPage() {
  const routeId = decodeURIComponent(state.route.replace(/^user\//, ''));
  const users = asArray(data?.userBundles);
  const user = asObject(data?.userLookup)[routeId] || users.find((item) => item.routeId === routeId || item.token === routeId);
  if (!user) {
    console.error('User detail renderer could not find user bundle', { renderer: 'userDetailPage', routeId });
    return `<section class="section"><div class="section-head"><h2>User bundle not found</h2><a class="btn" href="#/users">Back to users</a></div><p class="subtle">The requested pseudonymous user bundle was not loaded by the data layer.</p></section>`;
  }
  const allTime = asObject(user.allTime);
  return `
    <div class="page-layout">
      ${localNav('Users')}
      <div class="stack">
        <section class="section user-detail-head"><div><div class="subtle">Pseudonymous user bundle</div><h2>${escapeHtml(user.label)}</h2><p class="subtle">Public route token: ${escapeHtml(user.tokenPreview || user.routeId)}</p></div><a class="btn" href="#/users">Back to rankings</a></section>
        <section class="section"><div class="section-head"><h2>All-time summary</h2><span class="subtle">Loaded from the actual user bundle</span></div><div class="cards-grid">${[
          statBlock('Jobs', fmt(allTime.jobs), `${fmt(allTime.completed_jobs)} completed, ${fmt(allTime.failed_jobs)} failed`),
          statBlock('CPU efficiency', pct(allTime.avg_cpu_efficiency), `${fmt(allTime.jobs_with_measured_cpu)} measured CPU rows`),
          statBlock('Memory efficiency', pct(allTime.avg_memory_efficiency), `${fmt(allTime.jobs_with_measured_memory)} measured memory rows`),
          statBlock('Potential savings', money(allTime.underutilized_cost_dkk), `${money(allTime.estimated_cost_dkk)} estimated cost`),
          statBlock('GPU hours', fmt(allTime.gpu_hours, 1), 'Measured usage'),
          statBlock('Allocated CPU hours', fmt(allTime.cpu_hours_allocated, 1), `${fmt(allTime.measured_cpu_hours, 1)} measured`),
        ].join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Rolling summaries</h2><span class="subtle">7, 30, and 90 day windows</span></div><div class="cards-grid">${rollingSummaryCards(user)}</div></section>
        <section class="section"><div class="section-head"><h2>Daily trends</h2><span class="subtle">Most recent rows in this bundle</span></div>${dailyTrendTable(user.dailyTrends)}</section>
        <section class="section"><div class="section-head"><h2>Top inefficient jobs</h2><span class="subtle">No job names or raw identifiers displayed</span></div>${inefficientJobsTable(user.topInefficientJobs)}</section>
        <section class="section"><div class="section-head"><h2>Recommendations</h2><span class="subtle">Generated from bundle metrics</span></div>${userRecommendations(user)}</section>
      </div>
    </div>`;
}


function benchmarkPage() {
  const percentiles = asObject(data?.percentiles);
  return `
    <div class="page-layout">
      ${localNav('Benchmarks')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Benchmark Dashboard</h2><span class="subtle">Performance and regression tracking</span></div><div class="cards-grid">${[statBlock('CPU p95', pct(percentiles.cpu?.['95']), 'Sample benchmark'), statBlock('Memory p95', pct(percentiles.memory?.['95']), 'Sample benchmark'), statBlock('Regression score', '94', 'Placeholder')].join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Benchmark comparisons</h2><span class="subtle">By release</span></div>${comparisonBars()}</section>
        <section class="section"><div class="section-head"><h2>Percentile ranking</h2><span class="subtle">Grouped by workload</span></div><div class="percentiles">${percentileCard('CPU p50', pct(percentiles.cpu?.['50']), 'Baseline', 'info')}${percentileCard('CPU p95', pct(percentiles.cpu?.['95']), 'Top tier', 'good')}${percentileCard('Memory p95', pct(percentiles.memory?.['95']), 'Top tier', 'good')}${percentileCard('Cost p50', money(percentiles.cost?.['50']), 'Baseline', 'info')}</div></section>
      </div>
    </div>`;
}

function comparisonBars() {
  return `<div class="bars" style="height: 240px;">${[62, 78, 68, 96, 82, 90, 74].map((h) => `<div class="bar" style="height:${h}%"></div>`).join('')}</div><p class="subtle" style="margin-top:12px">These bars summarize the spread between lower-performing and higher-performing workloads so users can focus on the widest gaps first.</p>`;
}

function costPage() {
  const allTime = asObject(data?.clusterSummary?.allTime);
  return `
    <div class="page-layout">
      ${localNav('Cost')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Cost Dashboard</h2><span class="subtle">Spend, savings, and waste</span></div><div class="cards-grid">${[statBlock('Estimated cost', money(allTime.estimated_cost_dkk), 'All time'), statBlock('Potential savings', money(allTime.underutilized_cost_dkk), 'All time'), statBlock('GPU hours', fmt(allTime.gpu_hours, 1), 'All time')].join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Spend composition</h2><span class="subtle">Placeholder series</span></div><div class="bars" style="height: 200px;">${[42, 58, 76, 62, 88, 54, 74].map((h) => `<div class="bar" style="height:${h}%"></div>`).join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Recommendations</h2><span class="subtle">Impact-ranked</span></div><div class="rec-list">${recommendations(3).join('')}</div></section>
      </div>
    </div>`;
}

function methodologyPage() {
  const source = data?.source || 'fallback';
  const meta = asObject(data?.datasetMeta);
  return `
    <div class="page-layout">
      ${localNav('Methodology')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Methodology</h2><span class="subtle">How the dataset is structured</span></div><p class="subtle" style="line-height:1.8">The dashboard prefers the approved 90-day validation export and falls back to sample data only if the primary export is unavailable. The front end is intentionally modular so the archive source can change without page-level code changes. Current source: ${escapeHtml(source)}.</p></section>
        <section class="section"><div class="section-head"><h2>Design principles</h2><span class="subtle">Operational and readable</span></div><div class="cards-grid">${[
          statBlock('Dataset range', meta.dateRange && meta.dateRange.start ? `${meta.dateRange.start} to ${meta.dateRange.end}` : '—', 'Approved 90-day export'),
          statBlock('Imported rows', fmt(meta.importedRows), 'Daily trend rows'),
          statBlock('Job metrics', fmt(meta.jobMetricsRows), 'Derived inefficient-job rows currently exported'),
          statBlock('User bundles', fmt(meta.userBundleCount), 'Approved export users'),
        ].join('')}</div></section>
        ${diagnosticsPanel()}
        <section class="section"><div class="section-head"><h2>Data flow</h2><span class="subtle">Runtime path</span></div><p class="subtle" style="line-height:1.8">SQLite validation tables become privacy-reviewed JSON, the data loader normalizes the export into cluster, percentile, recommendation, and user bundle collections, then page renderers consume only those normalized properties.</p></section>
      </div>
    </div>`;
}


function renderShell(content) {
  const runtimeSource = data?.diagnostics?.selectedRuntimeSource || data?.source || 'unknown';
  const runtimeAttempts = Array.isArray(data?.runtimeAttempts) ? data.runtimeAttempts : [];
  const loadState = data?.errors?.length
    ? `<div class="load-banner error"><strong>Public demo mode</strong><span>Primary export unavailable. Showing sample-data fallback.</span></div>`
    : data?.source === 'real-export'
      ? `<div class="load-banner real"><strong>REAL MJOLNIR DATA</strong><span>90-day validation dataset</span></div>`
      : '';
  return `
    <div class="app-shell" data-theme="${state.theme}">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">${icon('cluster')}</div><div><div class="brand-name">Mjolnir</div><div class="brand-sub">Efficiency Dashboard</div></div></div>
        <nav class="nav-group">${navItems.map((item) => navLink(item)).join('')}</nav>
        <div class="context-card"><div class="context-label">Viewing context</div><div class="context-item"><span>Environment</span><strong>Production</strong></div><div class="context-item"><span>Mode</span><strong>${data?.source === 'real-export' ? 'Real 90-day export' : 'Sample fallback active'}</strong></div><div class="context-item"><span>Schema</span><strong>${data?.schemaVersion || 'unknown'}</strong></div><div class="context-item"><span>Runtime source</span><strong>${runtimeSource}</strong></div><div class="context-item"><span>Loaded bundles</span><strong>${fmt(data?.diagnostics?.loadedUserBundleCount)}</strong></div><div class="context-item"><span>Loader attempts</span><strong>${runtimeAttempts.length}</strong></div></div>
      </aside>
      <main class="main">
        <div class="mobile-topbar"><div class="brand"><div class="brand-mark">${icon('cluster')}</div><div><div class="brand-name">Mjolnir</div><div class="brand-sub">Efficiency Dashboard</div></div></div><button class="toolbar-button" data-action="menu" aria-label="Open navigation">${icon('menu')}</button></div>
        <div class="topbar"><div class="topbar-left"><div class="crumb">${icon('menu')} <span>${pageTitle(state.route)}</span></div></div><div class="topbar-right"><button class="toolbar-button" data-action="search" aria-label="Search">${icon('search')}</button><button class="toolbar-button" data-action="alerts" aria-label="Alerts">${icon('bell')}</button><button class="toolbar-button" data-action="theme" aria-label="Toggle theme">${state.theme === 'dark' ? icon('sun') : icon('moon')}</button><button class="toolbar-button" data-action="settings" aria-label="Settings">${icon('settings')}</button></div></div>
        ${loadState}
        <div class="page">${content}</div>
      </main>
    </div>`;
}

function dot(tone) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--${tone})"></span>`;
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  const renderers = {
    landing: landingPage,
    cluster: clusterPage,
    users: userPage,
    userDetail: userDetailPage,
    benchmarks: benchmarkPage,
    cost: costPage,
    methodology: methodologyPage,
  };
  const routeKey = state.route.startsWith('user/') ? 'userDetail' : state.route;
  const rendererName = renderers[routeKey] ? `${routeKey}Page` : 'landingPage';
  try {
    const pageRenderer = renderers[routeKey] || renderers.landing;
    const content = pageRenderer();
    app.innerHTML = renderShell(content);
    wireEvents();
  } catch (error) {
    console.error('Renderer failed:', rendererName, error);
    app.innerHTML = `<div class="app-error"><h1>Dashboard failed to render</h1><p>${escapeHtml(error.message)}</p><p class="subtle">Renderer: ${escapeHtml(rendererName)}</p><p class="subtle">The page is showing this message instead of a blank screen.</p></div>`;
  }
}

function wireEvents() {
  document.querySelector('[data-action="theme"]')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('med-theme', state.theme);
    render();
  });
  document.querySelector('[data-action="menu"]')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.toggle('hidden');
  });
}

function handleRoute() {
  state.route = location.hash.replace('#/', '') || 'landing';
  render();
}

window.addEventListener('hashchange', handleRoute);

async function init() {
  try {
    data = await loadMjolnirData();
    render();
  } catch (error) {
    console.error('Data loader failed:', error);
    app.innerHTML = `<div class="app-error"><h1>Dashboard data is unavailable</h1><p>${escapeHtml(error.message)}</p><p class="subtle">The site could not load JSON data, so it is showing a visible error instead of a blank page.</p></div>`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

init();
