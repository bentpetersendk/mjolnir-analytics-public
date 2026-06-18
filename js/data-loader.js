const REAL_BASE = './data/efficiency_v3/site_data_90d_validation/';
const SAMPLE_BASE = './sample-data/';

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

async function tryLoadTree(base) {
  const index = await loadJson(`${base}index.json`);
  const [clusterSummary, percentiles] = await Promise.all([
    loadJson(`${base}${index.global.cluster_summary}`),
    loadJson(`${base}${index.global.percentiles}`),
  ]);

  const userTokens = index.users.map((item) => item.user_token);
  const userBundles = await Promise.allSettled(
    userTokens.map((token) => loadJson(`${base}users/${token}.json`))
  );

  const users = userBundles
    .map((result, i) => (result.status === 'fulfilled' ? result.value : null))
    .filter(Boolean);

  return {
    source: base === REAL_BASE ? 'real-export' : 'sample-data',
    sourcePath: base,
    index,
    clusterSummary,
    percentiles,
    users,
  };
}

function buildDerivedData(tree) {
  const cluster = tree.clusterSummary;
  const p = tree.percentiles.percentiles;
  const trends = tree.users[0]?.daily_trends || tree.clusterSummary.daily_trends || [];
  const allTime = cluster.cluster_all_time_summary || cluster.all_time_summary || {};

  const cpuPercentiles = p.avg_cpu_efficiency || {};
  const memoryPercentiles = p.avg_memory_efficiency || {};
  const costPercentiles = p.estimated_cost_dkk || {};
  const gpuPercentiles = p.gpu_hours || {};
  const underPercentiles = p.underutilized_cost_dkk || {};

  const sampleUsers = tree.users.slice(0, 6).map((user, index) => ({
    token: user.user_token,
    label: `User ${String(index + 1).padStart(2, '0')}`,
    cpu: user.all_time_summary.avg_cpu_efficiency,
    memory: user.all_time_summary.avg_memory_efficiency,
    gpu: user.all_time_summary.gpu_hours || 0,
    savings: user.all_time_summary.underutilized_cost_dkk || 0,
    jobs: user.all_time_summary.jobs,
    recommendations: user.recommendations || [],
  }));

  return {
    source: tree.source,
    generatedAt: tree.index.generated_at,
    schemaVersion: tree.index.schema_version,
    clusterSummary: {
      allTime,
      rolling30d: cluster.cluster_rolling_summaries?.['30d'] || {},
      rolling7d: cluster.cluster_rolling_summaries?.['7d'] || {},
      rolling90d: cluster.cluster_rolling_summaries?.['90d'] || {},
      dailyTrends: cluster.daily_trends || trends,
    },
    percentiles: {
      cpu: cpuPercentiles,
      memory: memoryPercentiles,
      cost: costPercentiles,
      gpu: gpuPercentiles,
      underutilized: underPercentiles,
    },
    userBundles: sampleUsers,
    recommendations: flattenRecommendations(tree.users),
  };
}

function flattenRecommendations(users) {
  return users
    .flatMap((user) =>
      (user.recommendations || []).map((item) => ({
        token: user.user_token,
        title: item.title || item.recommendation || 'Recommendation',
        savings: item.estimated_savings_dkk ?? item.estimated_savings ?? item.estimated_dkk ?? 0,
        category: item.category || item.type || 'Optimization',
        priority: item.priority || item.severity || 'medium',
      }))
    )
    .slice(0, 12);
}

export async function loadMjolnirData() {
  try {
    return buildDerivedData(await tryLoadTree(REAL_BASE));
  } catch (primaryError) {
    try {
      return buildDerivedData(await tryLoadTree(SAMPLE_BASE));
    } catch (fallbackError) {
      return {
        source: 'fallback',
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
