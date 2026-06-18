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
  const userBundles = await Promise.all(userTokens.map((token) => loadJson(`${base}users/${token}.json`)));

  return {
    source: base === REAL_BASE ? 'real-export' : 'sample-data',
    sourcePath: base,
    index,
    clusterSummary,
    percentiles,
    users: userBundles.filter(Boolean),
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

  const cpuPercentiles = normalizeSummary(p.avg_cpu_efficiency);
  const memoryPercentiles = normalizeSummary(p.avg_memory_efficiency);
  const costPercentiles = normalizeSummary(p.estimated_cost_dkk);
  const gpuPercentiles = normalizeSummary(p.gpu_hours);
  const underPercentiles = normalizeSummary(p.underutilized_cost_dkk);

  const sampleUsers = users.slice(0, 6).map((user, index) => {
    const summary = normalizeSummary(user.all_time_summary);
    return {
      token: user.user_token,
      label: `User ${String(index + 1).padStart(2, '0')}`,
      cpu: summary.avg_cpu_efficiency,
      memory: summary.avg_memory_efficiency,
      gpu: summary.gpu_hours || 0,
      savings: summary.underutilized_cost_dkk || 0,
      jobs: summary.jobs,
      recommendations: normalizeList(user.recommendations),
    };
  });

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
    userBundles: sampleUsers,
    recommendations: flattenRecommendations(users),
  };
}

function flattenRecommendations(users) {
  return normalizeList(users)
    .reduce((acc, user) => {
      normalizeList(user && user.recommendations).forEach((item) => {
        acc.push({
          token: user && user.user_token,
          title: item.title || item.recommendation || 'Recommendation',
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
    console.info('Mjolnir data loader selected source', { runtimeSource: realBase, runtimeAttempts });
    return {
      ...buildDerivedData(tree),
      runtimeSource: realBase,
      runtimeAttempts,
    };
  } catch (primaryError) {
    attempts.push({ base: realBase, ok: false, mode: tryPrivate ? 'private' : 'real', error: String(primaryError) });
    try {
      const tree = await tryLoadTree(SAMPLE_BASE);
      const runtimeAttempts = attempts.concat({ base: SAMPLE_BASE, ok: true, mode: 'sample' });
      console.info('Mjolnir data loader selected source', { runtimeSource: SAMPLE_BASE, runtimeAttempts });
      return {
        ...buildDerivedData(tree),
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
