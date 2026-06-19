const REAL_BASE = './data/efficiency_v3/site_data_90d_validation/';
const SAMPLE_BASE = './sample-data/';
const PRIVATE_BASE = window.__MJOLNIR_PRIVATE_DATA_BASE__ || '';

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeGlobal(index) {
  const globalIndex = index && typeof index === 'object' ? index.global : null;
  return {
    cluster_summary: globalIndex && globalIndex.cluster_summary ? globalIndex.cluster_summary : 'global/cluster_summary.json',
    percentiles: globalIndex && globalIndex.percentiles ? globalIndex.percentiles : 'global/percentiles.json',
  };
}

async function tryLoadTree(base) {
  const index = await loadJson(`${base}index.json`);
  const globalIndex = normalizeGlobal(index);
  const usersIndex = normalizeList(index.users);
  const [clusterSummary, percentiles] = await Promise.all([
    loadJson(`${base}${globalIndex.cluster_summary}`),
    loadJson(`${base}${globalIndex.percentiles}`),
  ]);

  const userTokens = usersIndex.map((item) => item && item.user_token).filter(Boolean);
  const userResults = await Promise.allSettled(userTokens.map((token) => loadJson(`${base}users/${token}.json`)));
  const userBundles = userResults
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);

  return {
    source: base === REAL_BASE || base === PRIVATE_BASE ? 'real-export' : 'sample-data',
    sourcePath: base,
    index,
    clusterSummary,
    percentiles,
    users: userBundles,
    userTokens,
    indexUserCount: usersIndex.length,
    failedUserBundleCount: userResults.filter((result) => result.status === 'rejected').length,
  };
}

function normalizeSummary(summary) {
  return summary && typeof summary === 'object' ? summary : {};
}

function pickDataBase() {
  if (PRIVATE_BASE) return PRIVATE_BASE.endsWith('/') ? PRIVATE_BASE : `${PRIVATE_BASE}/`;
  return REAL_BASE;
}

function buildDerivedData(tree) {
  const cluster = normalizeSummary(tree.clusterSummary);
  const percentilesRoot = normalizeSummary(tree.percentiles);
  const p = normalizeSummary(percentilesRoot.percentiles);
  const users = normalizeList(tree.users);
  const trends = (users[0] && users[0].daily_trends) || cluster.daily_trends || [];
  const allTime = cluster.cluster_all_time_summary || cluster.all_time_summary || {};
  const reportDates = normalizeList(cluster.daily_trends).map((row) => row && row.report_date).filter(Boolean);
  const dateRange = reportDates.length ? { start: reportDates[0], end: reportDates[reportDates.length - 1] } : { start: null, end: null };
  const jobMetricsRows = users.reduce((count, user) => count + normalizeList(user && user.top_inefficient_jobs).length, 0);

  const cpuPercentiles = normalizeSummary(p.avg_cpu_efficiency);
  const memoryPercentiles = normalizeSummary(p.avg_memory_efficiency);
  const costPercentiles = normalizeSummary(p.estimated_cost_dkk);
  const gpuPercentiles = normalizeSummary(p.gpu_hours);
  const underPercentiles = normalizeSummary(p.underutilized_cost_dkk);

  const userBundles = users.map((user, index) => normalizeUserBundle(user, index));
  const userLookup = userBundles.reduce((lookup, user) => {
    if (user.routeId) lookup[user.routeId] = user;
    if (user.token && user.token !== user.routeId) lookup[user.token] = user;
    return lookup;
  }, {});
  const rankings = {
    cpu: rankedUsers(userBundles, 'cpu', 'desc'),
    memory: rankedUsers(userBundles, 'memory', 'desc'),
    savings: rankedUsers(userBundles, 'savings', 'desc'),
  };
  const diagnostics = {
    selectedRuntimeSource: tree.source,
    indexUsersCount: tree.indexUserCount || normalizeList(tree.index && tree.index.users).length,
    loadedUserBundleCount: userBundles.length,
    failedUserBundleCount: tree.failedUserBundleCount || 0,
    firstFiveUserLabelsOrTokens: userBundles.slice(0, 5).map((user) => user.label || user.tokenPreview || 'User bundle'),
    clusterDailyTrendLength: normalizeList(cluster.daily_trends).length,
    percentilesKeys: Object.keys(p).sort(),
  };

  return {
    source: tree.source,
    generatedAt: tree.index && tree.index.generated_at,
    schemaVersion: tree.index && tree.index.schema_version,
    clusterSummary: {
      allTime,
      rolling30d: normalizeSummary(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['30d']),
      rolling7d: normalizeSummary(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['7d']),
      rolling90d: normalizeSummary(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['90d']),
      dailyTrends: normalizeList(cluster.daily_trends).length ? normalizeList(cluster.daily_trends) : normalizeList(trends),
    },
    percentiles: {
      cpu: cpuPercentiles,
      memory: memoryPercentiles,
      cost: costPercentiles,
      gpu: gpuPercentiles,
      underutilized: underPercentiles,
    },
    userBundles,
    userLookup,
    rankings,
    recommendations: flattenRecommendations(users),
    diagnostics,
    datasetMeta: {
      dateRange,
      importedRows: normalizeList(cluster.daily_trends).length || normalizeList(trends).length,
      jobMetricsRows,
      userBundleCount: users.length,
    },
  };
}

function rankedUsers(users, field, direction = 'desc') {
  return normalizeList(users)
    .filter((user) => Number.isFinite(Number(user && user[field])))
    .slice()
    .sort((a, b) => direction === 'desc' ? Number(b[field]) - Number(a[field]) : Number(a[field]) - Number(b[field]))
    .slice(0, 25);
}

function normalizeUserBundle(user, index) {
  const summary = normalizeSummary(user && user.all_time_summary);
  const token = String((user && user.user_token) || '');
  const label = (user && (user.display_pseudonym || user.public_user_id || user.pseudonym)) || `User-${String(index + 1).padStart(4, '0')}`;
  return {
    token,
    routeId: token || `user-${index + 1}`,
    tokenPreview: token ? `${token.slice(0, 12)}...` : '',
    label,
    allTime: summary,
    rollingSummaries: normalizeSummary(user && user.rolling_summaries),
    dailyTrends: normalizeList(user && user.daily_trends),
    topInefficientJobs: normalizeList(user && user.top_inefficient_jobs),
    recommendations: normalizeList(user && user.recommendations),
    cpu: summary.avg_cpu_efficiency,
    memory: summary.avg_memory_efficiency,
    gpu: summary.gpu_hours || 0,
    savings: summary.underutilized_cost_dkk || 0,
    jobs: summary.jobs,
    completedJobs: summary.completed_jobs,
    failedJobs: summary.failed_jobs,
  };
}

function flattenRecommendations(users) {
  return normalizeList(users)
    .reduce((acc, user) => {
      normalizeList(user && user.recommendations).forEach((item) => {
        acc.push({
          token: user && user.user_token,
          title: item.title || item.recommendation || item.suggestion || 'Exported recommendation',
          suggestion: item.suggestion || '',
          savings: item.estimated_savings_dkk ?? item.estimated_savings ?? item.estimated_dkk ?? 0,
          category: item.category || item.type || 'Optimization',
          priority: item.priority || item.severity || 'medium',
        });
      });
      return acc;
    }, [])
    .slice(0, 12);
}

export async function loadMjolnirData() {
  const attempts = [];
  const tryPrivate = Boolean(PRIVATE_BASE);
  const realBase = pickDataBase();
  try {
    const tree = await tryLoadTree(realBase);
    const runtimeAttempts = attempts.concat({ base: realBase, ok: true, mode: tryPrivate ? 'private' : 'real' });
    const loaded = buildDerivedData(tree);
    console.info('Mjolnir data loader diagnostics', loaded.diagnostics);
    return {
      ...loaded,
      runtimeSource: realBase,
      runtimeAttempts,
    };
  } catch (primaryError) {
    attempts.push({ base: realBase, ok: false, mode: tryPrivate ? 'private' : 'real', error: String(primaryError) });
    try {
      const tree = await tryLoadTree(SAMPLE_BASE);
      const runtimeAttempts = attempts.concat({ base: SAMPLE_BASE, ok: true, mode: 'sample' });
      const loaded = buildDerivedData(tree);
      console.info('Mjolnir data loader diagnostics', loaded.diagnostics);
      return {
        ...loaded,
        runtimeSource: SAMPLE_BASE,
        runtimeAttempts,
        source: 'sample-data',
      };
    } catch (fallbackError) {
      const runtimeAttempts = attempts.concat({ base: SAMPLE_BASE, ok: false, mode: 'sample', error: String(fallbackError) });
      console.error('Mjolnir data loader failed', { runtimeSource: SAMPLE_BASE, runtimeAttempts, primaryError, fallbackError });
      return {
        source: 'fallback',
        runtimeSource: SAMPLE_BASE,
        runtimeAttempts,
        generatedAt: new Date().toISOString(),
        schemaVersion: 'fallback',
        clusterSummary: {
          allTime: {},
          rolling30d: {},
          rolling7d: {},
          rolling90d: {},
          dailyTrends: [],
        },
        percentiles: { cpu: {}, memory: {}, cost: {}, gpu: {}, underutilized: {} },
        userBundles: [],
        recommendations: [],
        errors: [String(primaryError), String(fallbackError)],
      };
    }
  }
}
