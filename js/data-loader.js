const REAL_BASE = './data/efficiency_v3/site_data_90d_validation/';
const SAMPLE_BASE = './sample-data/';
const PERSONAL_DATA_BASE = window.MJOLNIR_PERSONAL_DATA_BASE || './private-user-data/';

const VALIDATION_ROW_COUNTS = {
  jobs: 2364601,
  job_metrics: 1218881,
  daily_user_summary: 3411,
  daily_account_summary: 128,
  daily_cluster_summary: 90,
};

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function avg(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function publicLabel(index) {
  return `User-${String(index + 1).padStart(4, '0')}`;
}

function normalizeGlobal(index) {
  const global = asObject(index.global);
  return {
    cluster_summary: global.cluster_summary || 'global/cluster_summary.json',
    percentiles: global.percentiles || 'global/percentiles.json',
    account_summary: global.account_summary || global.accounts || null,
    projects: global.projects || null,
    pi_summaries: global.pi_summaries || null,
    research_groups: global.research_groups || null,
    sections: global.sections || null,
  };
}

async function tryOptionalJson(path) {
  try {
    return await loadJson(path);
  } catch (error) {
    return null;
  }
}

async function tryLoadTree(base) {
  const index = await loadJson(`${base}index.json`);
  const globalIndex = normalizeGlobal(index);
  const usersIndex = asArray(index.users);

  const [clusterSummary, percentiles, accountSummary, projectHierarchy, piHierarchy, groupHierarchy, sectionHierarchy] = await Promise.all([
    loadJson(`${base}${globalIndex.cluster_summary}`),
    loadJson(`${base}${globalIndex.percentiles}`),
    globalIndex.account_summary ? tryOptionalJson(`${base}${globalIndex.account_summary}`) : null,
    globalIndex.projects ? tryOptionalJson(`${base}${globalIndex.projects}`) : null,
    globalIndex.pi_summaries ? tryOptionalJson(`${base}${globalIndex.pi_summaries}`) : null,
    globalIndex.research_groups ? tryOptionalJson(`${base}${globalIndex.research_groups}`) : null,
    globalIndex.sections ? tryOptionalJson(`${base}${globalIndex.sections}`) : null,
  ]);

  const userTokens = usersIndex.map((item) => asObject(item).user_token).filter(Boolean);
  const userBundles = await Promise.allSettled(
    userTokens.map((token) => loadJson(`${base}users/${token}.json`))
  );

  const users = userBundles
    .map((result) => (result.status === 'fulfilled' ? result.value : null))
    .filter(Boolean);

  return {
    source: base === REAL_BASE ? 'real-export' : 'sample-data',
    sourcePath: base,
    index,
    clusterSummary,
    percentiles,
    accountSummary,
    projectHierarchy,
    piHierarchy,
    groupHierarchy,
    sectionHierarchy,
    users,
  };
}

function improvementFromTrends(trends, key) {
  const rows = asArray(trends).filter((row) => Number.isFinite(Number(row && row[key])));
  if (rows.length < 4) return null;
  const windowSize = Math.min(14, Math.max(2, Math.floor(rows.length / 4)));
  const first = avg(rows.slice(0, windowSize).map((row) => row[key]));
  const last = avg(rows.slice(-windowSize).map((row) => row[key]));
  return first === null || last === null ? null : last - first;
}

function normalizeUser(user, index) {
  const summary = asObject(user.all_time_summary);
  const trends = asArray(user.daily_trends);
  const label = publicLabel(index);
  const recommendations = asArray(user.recommendations).map((item) => {
    const rec = asObject(item);
    return {
      label,
      title: rec.title || rec.recommendation || 'Recommendation',
      category: rec.category || rec.type || 'Optimization',
      priority: rec.priority || rec.severity || 'medium',
      savings: numberOrZero(rec.estimated_savings_dkk ?? rec.estimated_savings ?? rec.estimated_dkk),
      evidence: asObject(rec.evidence),
    };
  });

  const topJobs = asArray(user.top_inefficient_jobs).map((job) => {
    const row = asObject(job);
    const wastedCost = numberOrZero(row.underutilized_cost_dkk);
    const cpu = row.measured_cpu_efficiency;
    const memory = row.memory_efficiency;
    const cpuGap = cpu === null || cpu === undefined ? 0 : Math.max(0, 1 - numberOrZero(cpu));
    const memoryGap = memory === null || memory === undefined ? 0 : Math.max(0, 1 - numberOrZero(memory));
    return {
      userLabel: label,
      wastedCost,
      estimatedCost: numberOrZero(row.estimated_cost_dkk),
      cpuEfficiency: cpu,
      memoryEfficiency: memory,
      gpuCount: numberOrZero(row.gpu_count),
      elapsedHours: numberOrZero(row.elapsed_hours),
      inefficiencyScore: wastedCost * (1 + ((cpuGap + memoryGap) / 2)),
    };
  });

  return {
    label,
    cpu: summary.avg_cpu_efficiency,
    memory: summary.avg_memory_efficiency,
    gpu: numberOrZero(summary.gpu_hours),
    savings: numberOrZero(summary.underutilized_cost_dkk),
    cost: numberOrZero(summary.estimated_cost_dkk),
    jobs: numberOrZero(summary.jobs),
    completedJobs: numberOrZero(summary.completed_jobs),
    failedJobs: numberOrZero(summary.failed_jobs),
    measuredCpuJobs: numberOrZero(summary.jobs_with_measured_cpu),
    measuredMemoryJobs: numberOrZero(summary.jobs_with_measured_memory),
    cpuImprovement: improvementFromTrends(trends, 'avg_cpu_efficiency'),
    memoryImprovement: improvementFromTrends(trends, 'avg_memory_efficiency'),
    trends,
    recommendations,
    topJobs,
  };
}

function normalizeRecommendation(item) {
  const rec = asObject(item);
  return {
    title: rec.title || rec.recommendation || 'Recommendation',
    category: rec.category || rec.type || 'Optimization',
    priority: rec.priority || rec.severity || 'medium',
    savings: numberOrZero(rec.estimated_savings_dkk ?? rec.estimated_savings ?? rec.estimated_dkk),
    detail: rec.detail || rec.description || '',
    evidence: asObject(rec.evidence),
  };
}

function normalizePersonalJob(job) {
  const row = asObject(job);
  const cpu = row.measured_cpu_efficiency ?? row.cpu_efficiency;
  const memory = row.memory_efficiency;
  const wastedCost = numberOrZero(row.underutilized_cost_dkk);
  const cpuGap = cpu === null || cpu === undefined ? 0 : Math.max(0, 1 - numberOrZero(cpu));
  const memoryGap = memory === null || memory === undefined ? 0 : Math.max(0, 1 - numberOrZero(memory));
  return {
    label: row.job_label || row.label || 'Personal job',
    wastedCost,
    estimatedCost: numberOrZero(row.estimated_cost_dkk),
    cpuEfficiency: cpu,
    memoryEfficiency: memory,
    elapsedHours: numberOrZero(row.elapsed_hours),
    gpuCount: numberOrZero(row.gpu_count),
    recommendation: row.recommendation || '',
    inefficiencyScore: numberOrZero(row.inefficiency_score) || wastedCost * (1 + ((cpuGap + memoryGap) / 2)),
  };
}

function normalizePeer(peer) {
  const row = asObject(peer);
  return {
    pseudonym: row.display_pseudonym || row.public_pseudonym || row.label || 'Anonymous peer',
    cpu: row.avg_cpu_efficiency ?? row.cpu_efficiency,
    memory: row.avg_memory_efficiency ?? row.memory_efficiency,
    savings: numberOrZero(row.underutilized_cost_dkk ?? row.potential_savings_dkk),
    percentile: row.percentile_position ?? row.percentile,
  };
}

function normalizePersonalUserViewModel(bundle, routeToken) {
  const root = asObject(bundle);
  const summary = asObject(root.all_time_summary || root.metrics);
  const ranking = asObject(root.ranking);
  const percentile = asObject(root.percentile_position || root.percentiles);
  const trends = asArray(root.daily_trends || root.historical_trends);
  const publicIdentity = asObject(root.public_identity);
  const username = root.username || root.real_username || '';
  const displayPseudonym = root.display_pseudonym || publicIdentity.display_pseudonym || root.public_pseudonym || '';
  const publicUserId = root.public_user_id || publicIdentity.public_user_id || '';

  return {
    visibilityTier: 'personal',
    schemaVersion: root.schema_version || null,
    generatedAt: root.generated_at || null,
    routeToken,
    username,
    publicUserId,
    displayPseudonym,
    metrics: {
      cpuEfficiency: summary.avg_cpu_efficiency,
      memoryEfficiency: summary.avg_memory_efficiency,
      estimatedCost: numberOrZero(summary.estimated_cost_dkk),
      potentialSavings: numberOrZero(summary.underutilized_cost_dkk ?? summary.potential_savings_dkk),
      jobs: numberOrZero(summary.jobs),
      completedJobs: numberOrZero(summary.completed_jobs),
      failedJobs: numberOrZero(summary.failed_jobs),
      gpuHours: numberOrZero(summary.gpu_hours),
    },
    ranking: {
      rank: numberOrZero(ranking.rank),
      totalUsers: numberOrZero(ranking.total_users),
      label: ranking.label || '',
    },
    percentile: {
      overall: percentile.overall ?? percentile.overall_percentile,
      cpu: percentile.cpu ?? percentile.avg_cpu_efficiency,
      memory: percentile.memory ?? percentile.avg_memory_efficiency,
      savings: percentile.savings ?? percentile.underutilized_cost_dkk,
    },
    trends,
    topInefficientJobs: asArray(root.top_inefficient_jobs).map(normalizePersonalJob),
    recommendations: asArray(root.recommendations).map(normalizeRecommendation),
    peerComparisons: asArray(root.peer_comparisons).map(normalizePeer),
  };
}

function topBy(users, key, direction = 'desc', limit = 25) {
  return users
    .filter((user) => Number.isFinite(Number(user[key])))
    .slice()
    .sort((a, b) => direction === 'asc' ? Number(a[key]) - Number(b[key]) : Number(b[key]) - Number(a[key]))
    .slice(0, limit);
}

function buildRecommendationSummary(users) {
  const groups = new Map();
  users.forEach((user) => {
    user.recommendations.forEach((rec) => {
      const key = rec.category || 'Optimization';
      if (!groups.has(key)) {
        groups.set(key, {
          type: key,
          title: rec.title,
          count: 0,
          affectedUsers: new Set(),
          estimatedSavings: 0,
          wasteContext: 0,
          priority: rec.priority,
        });
      }
      const group = groups.get(key);
      group.count += 1;
      group.affectedUsers.add(user.label);
      group.estimatedSavings += numberOrZero(rec.savings);
      group.wasteContext += numberOrZero(user.savings);
      if (rec.priority === 'high') group.priority = 'high';
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      affectedUsers: group.affectedUsers.size,
    }))
    .sort((a, b) => b.affectedUsers - a.affectedUsers || b.wasteContext - a.wasteContext);
}


function normalizeSummaryItem(item, idKey, labelKey, fallbackPrefix, index) {
  const row = asObject(item);
  const summary = asObject(row.all_time_summary);
  return {
    id: row[idKey] || `${fallbackPrefix}-${index + 1}`,
    label: row[labelKey] || row.project_pseudonym || `${fallbackPrefix}-${String(index + 1).padStart(3, '0')}`,
    hierarchy: asObject(row.hierarchy),
    allTime: summary,
    rollingSummaries: asObject(row.rolling_summaries),
    dailyTrends: asArray(row.daily_trends),
    recommendations: asArray(row.recommendations).map(normalizeRecommendation),
    jobs: numberOrZero(summary.jobs),
    completedJobs: numberOrZero(summary.completed_jobs),
    failedJobs: numberOrZero(summary.failed_jobs),
    cpu: summary.avg_cpu_efficiency,
    memory: summary.avg_memory_efficiency,
    cost: numberOrZero(summary.estimated_cost_dkk),
    savings: numberOrZero(summary.underutilized_cost_dkk),
    gpu: numberOrZero(summary.gpu_hours),
    topProjects: asArray(row.top_projects),
    topPis: asArray(row.top_pis),
    topGroups: asArray(row.top_groups),
    projectCount: numberOrZero(row.project_count),
    piCount: numberOrZero(row.pi_count),
    groupCount: numberOrZero(row.group_count),
  };
}

function normalizeHierarchy(tree) {
  const projectsRoot = asObject(tree.projectHierarchy);
  const piRoot = asObject(tree.piHierarchy);
  const groupRoot = asObject(tree.groupHierarchy);
  const sectionRoot = asObject(tree.sectionHierarchy);
  return {
    coverage: asObject(projectsRoot.coverage),
    projects: asArray(projectsRoot.projects).map((item, index) => normalizeSummaryItem(item, 'project_id', 'project_label', 'Project', index)),
    pis: asArray(piRoot.pis).map((item, index) => normalizeSummaryItem(item, 'pi_id', 'pi_label', 'PI', index)),
    groups: asArray(groupRoot.groups).map((item, index) => normalizeSummaryItem(item, 'group_id', 'group_label', 'Group', index)),
    sections: asArray(sectionRoot.sections).map((item, index) => normalizeSummaryItem(item, 'section_id', 'section_label', 'Section', index)),
  };
}

function normalizeProjects(accountSummary) {
  const sourceRows = asArray(accountSummary && (accountSummary.accounts || accountSummary.projects || accountSummary.daily_account_summary));
  return sourceRows.map((row, index) => {
    const record = asObject(row);
    return {
      label: `Project-${String(index + 1).padStart(3, '0')}`,
      jobs: numberOrZero(record.jobs),
      cpu: record.avg_cpu_efficiency,
      memory: record.avg_memory_efficiency,
      cost: numberOrZero(record.estimated_cost_dkk),
      savings: numberOrZero(record.underutilized_cost_dkk),
      gpu: numberOrZero(record.gpu_hours),
    };
  });
}

function buildDerivedData(tree) {
  const cluster = asObject(tree.clusterSummary);
  const percentilesRoot = asObject(tree.percentiles);
  const p = asObject(percentilesRoot.percentiles);
  const allTime = asObject(cluster.cluster_all_time_summary || cluster.all_time_summary);
  const dailyTrends = asArray(cluster.daily_trends);
  const users = asArray(tree.users).map(normalizeUser);
  const reportDates = dailyTrends.map((row) => row && row.report_date).filter(Boolean);
  const recommendations = users.flatMap((user) => user.recommendations).slice(0, 100);
  const allInefficientJobs = users
    .flatMap((user) => user.topJobs)
    .sort((a, b) => b.inefficiencyScore - a.inefficiencyScore);
  const hierarchy = normalizeHierarchy(tree);
  const projects = hierarchy.projects.length ? hierarchy.projects : normalizeProjects(tree.accountSummary);

  return {
    source: tree.source,
    sourcePath: tree.sourcePath,
    generatedAt: tree.index && tree.index.generated_at,
    schemaVersion: tree.index && tree.index.schema_version,
    clusterSummary: {
      allTime,
      rolling30d: asObject(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['30d']),
      rolling7d: asObject(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['7d']),
      rolling90d: asObject(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['90d']),
      dailyTrends,
    },
    percentiles: {
      cpu: asObject(p.avg_cpu_efficiency),
      memory: asObject(p.avg_memory_efficiency),
      cost: asObject(p.estimated_cost_dkk),
      gpu: asObject(p.gpu_hours),
      underutilized: asObject(p.underutilized_cost_dkk),
      cpuHours: asObject(p.cpu_hours_allocated),
    },
    users,
    userBundles: users.slice(0, 12),
    rankings: {
      bestCpu: topBy(users, 'cpu'),
      bestMemory: topBy(users, 'memory'),
      mostImproved: topBy(users, 'cpuImprovement'),
      largestSavings: topBy(users, 'savings'),
    },
    recommendations,
    recommendationSummary: buildRecommendationSummary(users),
    inefficientJobs: allInefficientJobs,
    projects,
    pis: hierarchy.pis,
    groups: hierarchy.groups,
    sections: hierarchy.sections,
    hierarchyCoverage: hierarchy.coverage,
    datasetMeta: {
      sourceDatabase: 'efficiency_v3/data/mjolnir_efficiency_90d_validation.sqlite',
      validationWindow: reportDates.length ? `${reportDates[0]} to ${reportDates[reportDates.length - 1]}` : 'Unavailable',
      dateRange: reportDates.length ? { start: reportDates[0], end: reportDates[reportDates.length - 1] } : { start: null, end: null },
      exportDate: cluster.generated_at || tree.index.generated_at || null,
      importedRows: dailyTrends.length,
      rowCounts: VALIDATION_ROW_COUNTS,
      userCount: users.length,
      projectCount: projects.length,
      piCount: hierarchy.pis.length,
      groupCount: hierarchy.groups.length,
      sectionCount: hierarchy.sections.length,
      recommendationCount: users.reduce((sum, user) => sum + user.recommendations.length, 0),
      inefficientJobCount: allInefficientJobs.length,
      accountExportAvailable: projects.length > 0,
    },
  };
}

export async function loadPersonalData(routeToken) {
  const token = String(routeToken || '').trim();
  if (!PERSONAL_DATA_BASE || !token) {
    return {
      configured: Boolean(PERSONAL_DATA_BASE),
      loaded: false,
      personalUser: null,
    };
  }

  const base = PERSONAL_DATA_BASE.endsWith('/') ? PERSONAL_DATA_BASE : `${PERSONAL_DATA_BASE}/`;
  const personalBundle = await loadJson(`${base}users/${encodeURIComponent(token)}.json`);
  return {
    configured: true,
    loaded: true,
    personalUser: normalizePersonalUserViewModel(personalBundle, token),
  };
}

export const loadPersonalDashboardData = loadPersonalData;

export async function loadMjolnirData() {
  try {
    return buildDerivedData(await tryLoadTree(REAL_BASE));
  } catch (primaryError) {
    try {
      const fallback = buildDerivedData(await tryLoadTree(SAMPLE_BASE));
      return {
        ...fallback,
        errors: [String(primaryError)],
      };
    } catch (fallbackError) {
      return {
        source: 'fallback',
        sourcePath: null,
        generatedAt: new Date().toISOString(),
        schemaVersion: 'fallback',
        clusterSummary: {
          allTime: {},
          rolling30d: {},
          rolling7d: {},
          rolling90d: {},
          dailyTrends: [],
        },
        percentiles: { cpu: {}, memory: {}, cost: {}, gpu: {}, underutilized: {}, cpuHours: {} },
        users: [],
        userBundles: [],
        rankings: { bestCpu: [], bestMemory: [], mostImproved: [], largestSavings: [] },
        recommendations: [],
        recommendationSummary: [],
        inefficientJobs: [],
        projects: [],
        pis: [],
        groups: [],
        sections: [],
        hierarchyCoverage: {},
        datasetMeta: {
          sourceDatabase: 'Unavailable',
          validationWindow: 'Unavailable',
          dateRange: { start: null, end: null },
          exportDate: null,
          importedRows: 0,
          rowCounts: VALIDATION_ROW_COUNTS,
          userCount: 0,
          projectCount: 0,
          piCount: 0,
          groupCount: 0,
          sectionCount: 0,
          recommendationCount: 0,
          inefficientJobCount: 0,
          accountExportAvailable: false,
        },
        errors: [String(primaryError), String(fallbackError)],
      };
    }
  }
}
