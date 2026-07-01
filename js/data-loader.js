const SAMPLE_BASE = './sample-data/';
const PERSONAL_DATA_BASE = window.MJOLNIR_PERSONAL_DATA_BASE || './private-user-data/';
// Generated Node Insights JSON (both the latest snapshot and history) lives
// in the dashboard-data repo (bentpetersendk/dashboard-data, mjolnir/
// directory), not in this repo - see docs/DASHBOARD_DATA_MIGRATION.md.
// Override with window.MJOLNIR_DASHBOARD_DATA_BASE for private/internal
// deployments, the same pattern PERSONAL_DATA_BASE already uses above.
const NODE_INSIGHTS_HISTORY_BASE = window.MJOLNIR_DASHBOARD_DATA_BASE
  || 'https://raw.githubusercontent.com/bentpetersendk/dashboard-data/main/mjolnir/';
// Slurm Analytics pipeline status (private repo's
// scripts/export_dashboard_data.py + publish_slurm_analytics.sh) - a single
// small aggregate-only JSON proving the nightly warehouse import/validate/
// materialize cycle is alive, not an analytics export. Same dashboard-data
// base as Node Insights history, one subdirectory over - see
// NIGHTLY_PIPELINE.md in the private repo.
const SLURM_ANALYTICS_BASE = `${NODE_INSIGHTS_HISTORY_BASE}slurm_analytics/`;
// Queue Insights (docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md): one
// shared directory fed by two pipelines with disjoint filenames - the
// public repo's hourly Node Insights cycle publishes current_pressure.json,
// partition_pressure.json, pending_reasons.json, queue_health_history.json;
// the private repo's nightly Slurm Analytics cycle publishes status.json,
// wait_time_history.json, submission_patterns.json. Same base as Node
// Insights/Slurm Analytics above, just one more subdirectory over.
const QUEUE_INSIGHTS_BASE = `${NODE_INSIGHTS_HISTORY_BASE}queue_insights/`;
// Software Inventory (Software Analytics Milestone 1, private repo's
// docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md) - one small
// aggregate JSON refreshed nightly by the same Slurm Analytics cycle that
// publishes Queue Insights' historical half above, just one more
// subdirectory over.
const SOFTWARE_INVENTORY_BASE = `${NODE_INSIGHTS_HISTORY_BASE}software_inventory/`;
// Software Intelligence (private repo's
// docs/architecture/SOFTWARE_INTELLIGENCE_ARCHITECTURE.md) - "what software
// is actually being used," a separate module from Software Inventory above
// ("what software exists"). The export is documented as the complete
// public API for this module (no server-side Top-N truncation) - one
// subdirectory over from Software Inventory, same dashboard-data base.
const SOFTWARE_INTELLIGENCE_BASE = `${NODE_INSIGHTS_HISTORY_BASE}software_intelligence/`;
// Analytics module (Version 1.2 migration, see private repo's
// docs/architecture/ANALYTICS_WAREHOUSE.md Section 10): replaces the old
// locally-committed 90-day frozen snapshot below this comment used to read
// from with a live nightly export from the warehouse, published to
// dashboard-data the same way as every other module above.
const REAL_BASE = `${NODE_INSIGHTS_HISTORY_BASE}analytics/`;

function liveRowCounts(allTime, reportDayCount) {
  const a = asObject(allTime);
  return {
    jobs: a.jobs ?? 0,
    job_metrics: a.jobs_with_measured_cpu ?? 0,
    daily_user_summary: a.unique_users ?? 0,
    daily_account_summary: a.unique_accounts ?? 0,
    daily_cluster_summary: reportDayCount ?? 0,
  };
}

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

// Revised Cost-Bearer waste model (docs/COST_BEARER_RESOURCE_AUDIT.md).
// Reads the exported cost_bearer_* fields when present, and falls back to deriving
// the bearer from cpu/mem sub-costs so older JSON (without the new fields) still
// renders. cost_bearer_waste aliases the legacy underutilized_cost_dkk.
function costBearerView(row) {
  const source = asObject(row);
  const cpuCost = numberOrZero(source.cpu_cost_dkk);
  const memCost = numberOrZero(source.mem_cost_dkk);
  const gpuCost = numberOrZero(source.gpu_cost_dkk);
  let bearer = source.cost_bearer;
  if (bearer !== 'cpu' && bearer !== 'memory') {
    bearer = memCost > cpuCost ? 'memory' : 'cpu';
  }
  const bearerCost = source.cost_bearer_cost_dkk !== undefined && source.cost_bearer_cost_dkk !== null
    ? numberOrZero(source.cost_bearer_cost_dkk)
    : Math.max(cpuCost, memCost);
  const waste = source.cost_bearer_waste_dkk ?? source.underutilized_cost_dkk;
  return {
    costBearer: bearer,
    cpuCost,
    memCost,
    gpuCost,
    costBearerCost: bearerCost,
    costBearerEfficiency: source.cost_bearer_efficiency ?? null,
    costBearerWaste: waste === null || waste === undefined ? null : numberOrZero(waste),
    gpuWaste: null,
  };
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
    users_summary: global.users_summary || null,
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

  const [clusterSummary, percentiles, usersSummaryDoc, accountSummary, projectHierarchy, piHierarchy, groupHierarchy, sectionHierarchy] = await Promise.all([
    loadJson(`${base}${globalIndex.cluster_summary}`),
    loadJson(`${base}${globalIndex.percentiles}`),
    globalIndex.users_summary ? tryOptionalJson(`${base}${globalIndex.users_summary}`) : null,
    globalIndex.account_summary ? tryOptionalJson(`${base}${globalIndex.account_summary}`) : null,
    globalIndex.projects ? tryOptionalJson(`${base}${globalIndex.projects}`) : null,
    globalIndex.pi_summaries ? tryOptionalJson(`${base}${globalIndex.pi_summaries}`) : null,
    globalIndex.research_groups ? tryOptionalJson(`${base}${globalIndex.research_groups}`) : null,
    globalIndex.sections ? tryOptionalJson(`${base}${globalIndex.sections}`) : null,
  ]);

  const userTokens = usersIndex.map((item) => asObject(item).public_user_id).filter(Boolean);
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
    usersSummaryDoc,
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
    const bearer = costBearerView(row);
    return {
      userLabel: label,
      wastedCost,
      estimatedCost: numberOrZero(row.estimated_cost_dkk),
      cpuEfficiency: cpu,
      memoryEfficiency: memory,
      gpuCount: numberOrZero(row.gpu_count),
      elapsedHours: numberOrZero(row.elapsed_hours),
      inefficiencyScore: wastedCost * (1 + ((cpuGap + memoryGap) / 2)),
      costBearer: bearer.costBearer,
      costBearerCost: bearer.costBearerCost,
      costBearerEfficiency: bearer.costBearerEfficiency,
      costBearerWaste: bearer.costBearerWaste,
    };
  });

  const summaryBearer = costBearerView(summary);
  return {
    label,
    cpu: summary.avg_cpu_efficiency,
    memory: summary.avg_memory_efficiency,
    gpu: numberOrZero(summary.gpu_hours),
    savings: numberOrZero(summary.underutilized_cost_dkk),
    cost: numberOrZero(summary.estimated_cost_dkk),
    costBearer: summaryBearer.costBearer,
    costBearerCost: summaryBearer.costBearerCost,
    costBearerEfficiency: summaryBearer.costBearerEfficiency,
    costBearerWaste: summaryBearer.costBearerWaste,
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
  const bearer = costBearerView(row);
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
    costBearer: bearer.costBearer,
    costBearerCost: bearer.costBearerCost,
    costBearerEfficiency: bearer.costBearerEfficiency,
    costBearerWaste: bearer.costBearerWaste,
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
  const displayPseudonym = root.display_pseudonym || publicIdentity.display_pseudonym || root.public_pseudonym || '';
  const publicUserId = root.public_user_id || publicIdentity.public_user_id || '';

  return {
    visibilityTier: 'personal',
    schemaVersion: root.schema_version || null,
    generatedAt: root.generated_at || null,
    routeToken,
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
      ...(() => {
        const bearer = costBearerView(summary);
        return {
          costBearer: bearer.costBearer,
          costBearerCost: bearer.costBearerCost,
          costBearerEfficiency: bearer.costBearerEfficiency,
          costBearerWaste: bearer.costBearerWaste ?? numberOrZero(summary.underutilized_cost_dkk),
        };
      })(),
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
    leaf: normalizeLeafBlock(root.leaf),
    topInefficientJobs: asArray(root.top_inefficient_jobs).map(normalizePersonalJob),
    recommendations: asArray(root.recommendations).map(normalizeRecommendation),
    peerComparisons: asArray(root.peer_comparisons).map(normalizePeer),
  };
}

// Phase 8: the "leaf" methodology block (version/window_days/leaf_index/
// leaf_index_components/confidence/measurement_coverage/percentile) is the
// only LEAF Index meant for display - see js/app.js's LEAF_INDEX_TOOLTIP.
// Legacy leaf_index/leaf_index_components fields are left un-normalized
// here on purpose: nothing should read them for display after Phase 8.
function normalizeLeafBlock(leaf) {
  const l = asObject(leaf);
  const coverage = asObject(l.measurement_coverage);
  return {
    version: l.version || null,
    windowDays: l.window_days != null ? Number(l.window_days) : null,
    leafIndex: l.leaf_index != null ? Number(l.leaf_index) : null,
    leafIndexComponents: Array.isArray(l.leaf_index_components) ? l.leaf_index_components : [],
    confidence: l.confidence || null,
    percentile: l.percentile != null ? Number(l.percentile) : null,
    measurementCoverage: {
      jobsMeasured: coverage.jobs_measured != null ? Number(coverage.jobs_measured) : null,
      jobsExcluded: coverage.jobs_excluded != null ? Number(coverage.jobs_excluded) : null,
      jobsMeasuredPct: coverage.jobs_measured_pct != null ? Number(coverage.jobs_measured_pct) : null,
      cpuHoursMeasuredPct: coverage.cpu_hours_measured_pct != null ? Number(coverage.cpu_hours_measured_pct) : null,
      memoryMeasuredPct: coverage.memory_measured_pct != null ? Number(coverage.memory_measured_pct) : null,
    },
  };
}

function normalizeUserRow(r) {
  const eff = (v) => (v !== null && v !== undefined) ? Number(v) : null;
  return {
    publicUserId:              r.public_user_id || '',
    displayPseudonym:         r.display_pseudonym || '',
    isBenchmark:              r.is_benchmark === true,
    benchmarkSize:            r.benchmark_size != null ? Number(r.benchmark_size) : null,
    totalJobs:                numberOrZero(r.total_jobs),
    completedJobs:            numberOrZero(r.completed_jobs),
    failedJobs:               numberOrZero(r.failed_jobs),
    cpuHours:                 numberOrZero(r.cpu_hours),
    memoryGbHours:            numberOrZero(r.memory_gb_hours),
    gpuHours:                 numberOrZero(r.gpu_hours),
    walltimeHours:            numberOrZero(r.walltime_hours),
    estimatedCostDkk:         numberOrZero(r.estimated_cost_dkk),
    underutilizedCostDkk:     numberOrZero(r.underutilized_cost_dkk),
    cpuEfficiency:            eff(r.cpu_efficiency),
    memoryEfficiency:         eff(r.memory_efficiency),
    overallEfficiency:        eff(r.overall_efficiency),
    averageQueueWaitSeconds:  r.average_queue_wait_seconds !== null ? numberOrZero(r.average_queue_wait_seconds) : null,
    medianQueueWaitSeconds:   r.median_queue_wait_seconds !== null ? numberOrZero(r.median_queue_wait_seconds) : null,
    lastActive:               r.last_active || null,
    activeDays:               numberOrZero(r.active_days),
    softwareCount:            numberOrZero(r.software_count),
    recommendationCount:      r.recommendation_count != null ? numberOrZero(r.recommendation_count) : null,
    favoritePartition:        r.favorite_partition || null,
    favoriteSoftware:         r.favorite_software || null,
    percentileCpu:            eff(r.percentile_cpu),
    percentileEfficiency:     eff(r.percentile_efficiency),
    leafIndex:                r.leaf_index != null ? Number(r.leaf_index) : null,
    leafIndexComponents:      Array.isArray(r.leaf_index_components) ? r.leaf_index_components : [],
    leaf:                     normalizeLeafBlock(r.leaf),
    trends30d:                Array.isArray(r.trends_30d) ? r.trends_30d : [],
  };
}

function normalizeUsersSummary(doc) {
  if (!doc) return { available: false, generatedAt: null, users: [], benchmarkProfiles: [], byId: {} };
  const users = asArray(doc.users).map((row) => normalizeUserRow(asObject(row)));
  const benchmarkProfiles = asArray(doc.benchmark_profiles).map((row) => normalizeUserRow(asObject(row)));
  const byId = {};
  users.forEach((u) => { byId[u.publicUserId] = u; });
  benchmarkProfiles.forEach((b) => { byId[b.publicUserId] = b; });
  return {
    available: true,
    generatedAt: doc.generated_at || null,
    users,
    benchmarkProfiles,
    byId,
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
    ...(() => {
      const bearer = costBearerView(summary);
      return {
        costBearer: bearer.costBearer,
        costBearerCost: bearer.costBearerCost,
        costBearerEfficiency: bearer.costBearerEfficiency,
        costBearerWaste: bearer.costBearerWaste ?? numberOrZero(summary.underutilized_cost_dkk),
      };
    })(),
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
  const usersSummary = normalizeUsersSummary(tree.usersSummaryDoc);
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
    usersSummary,
    clusterSummary: {
      allTime,
      rolling30d: asObject(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['30d']),
      rolling7d: asObject(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['7d']),
      rolling90d: asObject(cluster.cluster_rolling_summaries && cluster.cluster_rolling_summaries['90d']),
      dailyTrends,
      measurementCoverage: asObject(cluster.measurement_coverage),
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
      sourceDatabase: 'mjolnir-analytics/data/mjolnir_analytics.sqlite',
      coverageWindow: reportDates.length ? `${reportDates[0]} to ${reportDates[reportDates.length - 1]}` : 'Unavailable',
      dateRange: reportDates.length ? { start: reportDates[0], end: reportDates[reportDates.length - 1] } : { start: null, end: null },
      exportDate: cluster.generated_at || tree.index.generated_at || null,
      importedRows: dailyTrends.length,
      rowCounts: liveRowCounts(allTime, dailyTrends.length),
      userCount: users.length,
      projectCount: projects.length,
      piCount: hierarchy.pis.length,
      groupCount: hierarchy.groups.length,
      sectionCount: hierarchy.sections.length,
      recommendationCount: users.reduce((sum, user) => sum + user.recommendations.length, 0),
      inefficientJobCount: allInefficientJobs.length,
      accountExportAvailable: projects.length > 0,
      // Platform Status framework (docs/PLATFORM_STATUS.md): read straight
      // through if the export already carries them, otherwise status.js
      // derives sensible defaults from the fields above.
      collectorName: cluster.collector || tree.index.collector || null,
      collectorStatus: cluster.collector_status || tree.index.collector_status || null,
      platformModule: cluster.platform_module || tree.index.platform_module || null,
      dataWindowDays: cluster.data_window_days ?? tree.index.data_window_days ?? null,
    },
  };
}

export async function loadUserBundle(base, publicUserId) {
  if (!base || !publicUserId) return null;
  const b = base.endsWith('/') ? base : `${base}/`;
  return tryOptionalJson(`${b}users/${encodeURIComponent(publicUserId)}.json`);
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

// Node Insights: live Slurm fleet state (sinfo/scontrol/squeue), collected by
// the private repo's scripts/collect_node_insights.py. Public-safe aggregate/
// node-hardware data only - no Airtable, no usernames, no per-job identity
// fields. See docs/NODE_INSIGHTS_SLURM_AUDIT.md and
// docs/NODE_INSIGHTS_SLURM_DESIGN.md in the private repo.
function emptyNodeInsights(error) {
  return {
    available: false,
    error: error ? String(error) : null,
    source: null,
    generatedAt: null,
    schemaVersion: null,
    collectorName: null,
    collectorStatus: 'failed',
    platformModule: null,
    expectedRefreshSeconds: null,
    warningAfterIntervals: null,
    criticalAfterIntervals: null,
    dataWindowDays: null,
    clusterOverview: {},
    nodeInventory: { nodeCount: 0, nodes: [] },
    hardwareInventory: {},
    capacityPlanning: {},
  };
}

export async function loadNodeInsightsData() {
  try {
    // One combined document, generated hourly by export_node_insights.py
    // from the live SQLite collector and published to dashboard-data (see
    // docs/DASHBOARD_DATA_MIGRATION.md) - cluster_overview/node_inventory/
    // hardware_inventory/capacity_planning are nested sections within it,
    // not separate files.
    const doc = await loadJson(`${NODE_INSIGHTS_HISTORY_BASE}node_insights.json`);
    const nodeInventory = asObject(doc.node_inventory);
    return {
      available: true,
      error: null,
      source: doc.source || 'live-slurm',
      generatedAt: doc.generated_at || null,
      schemaVersion: doc.schema_version || null,
      // Platform Status framework (docs/PLATFORM_STATUS.md).
      collectorName: doc.collector || 'node_insights',
      collectorStatus: doc.collector_status || null,
      platformModule: doc.platform_module || 'Node Insights',
      expectedRefreshSeconds: doc.expected_refresh_seconds ?? null,
      warningAfterIntervals: doc.warning_after_intervals ?? null,
      criticalAfterIntervals: doc.critical_after_intervals ?? null,
      dataWindowDays: doc.data_window_days ?? null,
      clusterOverview: asObject(doc.cluster_overview),
      nodeInventory: {
        nodeCount: numberOrZero(nodeInventory.node_count),
        nodes: asArray(nodeInventory.nodes),
      },
      hardwareInventory: asObject(doc.hardware_inventory),
      capacityPlanning: asObject(doc.capacity_planning),
    };
  } catch (error) {
    return emptyNodeInsights(error);
  }
}

// Node Insights history: hourly snapshots collected on the headnode by
// scripts/collect_node_insights.py, stored in data/node_insights.sqlite, and
// exported as public-safe aggregate JSON by scripts/export_node_insights.py.
// Aggregate-only (cluster/node counts and pressure percentages) - no
// usernames, job IDs, job names, or account names anywhere in this tree.
function emptyNodeInsightsHistory(error) {
  return {
    available: false,
    error: error ? String(error) : null,
    generatedAt: null,
    retentionDays: null,
    collectorName: null,
    collectorStatus: 'failed',
    platformModule: null,
    expectedRefreshSeconds: null,
    warningAfterIntervals: null,
    criticalAfterIntervals: null,
    dataWindowDays: null,
    capacity: [],
    nodes: {},
  };
}

export async function loadNodeInsightsHistory() {
  try {
    const [capacityDoc, nodeDoc] = await Promise.all([
      loadJson(`${NODE_INSIGHTS_HISTORY_BASE}capacity_history.json`),
      loadJson(`${NODE_INSIGHTS_HISTORY_BASE}node_history.json`),
    ]);
    const nodes = {};
    asArray(nodeDoc.nodes).forEach((entry) => {
      const row = asObject(entry);
      if (row.node_name) nodes[row.node_name] = asArray(row.points);
    });
    return {
      available: true,
      error: null,
      generatedAt: capacityDoc.generated_at || null,
      retentionDays: numberOrZero(capacityDoc.retention_days) || null,
      // Platform Status framework (docs/PLATFORM_STATUS.md).
      collectorName: capacityDoc.collector || 'node_insights',
      collectorStatus: capacityDoc.collector_status || null,
      platformModule: capacityDoc.platform_module || 'Node Insights',
      expectedRefreshSeconds: capacityDoc.expected_refresh_seconds ?? null,
      warningAfterIntervals: capacityDoc.warning_after_intervals ?? null,
      criticalAfterIntervals: capacityDoc.critical_after_intervals ?? null,
      dataWindowDays: capacityDoc.data_window_days ?? numberOrZero(capacityDoc.retention_days) ?? null,
      capacity: asArray(capacityDoc.points),
      nodes,
    };
  } catch (error) {
    return emptyNodeInsightsHistory(error);
  }
}

// Slurm Analytics pipeline status: is the private repo's nightly warehouse
// automation (collect -> import -> validate -> materialize -> export ->
// publish) keeping data/mjolnir_analytics.sqlite up to date. Aggregate
// counts only - no usernames, job IDs, or work directories ever leave the
// private repo (see ANALYTICS_WAREHOUSE.md Section 7 and
// export_dashboard_data.py's docstring).
function emptySlurmAnalyticsStatus(error) {
  return {
    available: false,
    error: error ? String(error) : null,
    generatedAt: null,
    collectorName: null,
    collectorStatus: 'failed',
    platformModule: null,
    expectedRefreshSeconds: null,
    warningAfterIntervals: null,
    criticalAfterIntervals: null,
    dataWindowDays: null,
    warehouse: {},
  };
}

export async function loadSlurmAnalyticsPipelineStatus() {
  try {
    const doc = await loadJson(`${SLURM_ANALYTICS_BASE}status.json`);
    return {
      available: true,
      error: null,
      generatedAt: doc.generated_at || null,
      collectorName: doc.collector || 'slurm_analytics_pipeline',
      collectorStatus: doc.collector_status || null,
      platformModule: doc.platform_module || 'Slurm Analytics Pipeline',
      expectedRefreshSeconds: doc.expected_refresh_seconds ?? null,
      warningAfterIntervals: doc.warning_after_intervals ?? null,
      criticalAfterIntervals: doc.critical_after_intervals ?? null,
      dataWindowDays: doc.data_window_days ?? null,
      warehouse: asObject(doc.warehouse),
    };
  } catch (error) {
    return emptySlurmAnalyticsStatus(error);
  }
}

// Queue Insights (docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md). Each of
// the 7 files is loaded independently via tryOptionalJson() rather than one
// Promise.all(), so a module that's only half-published yet (e.g. the
// historical half hasn't run its first nightly cycle) still renders whatever
// already exists instead of failing the whole page - same graceful-
// degradation shape as loadMjolnirData()'s optional global-index files.
function emptyQueueInsights(error) {
  return {
    available: false,
    error: error ? String(error) : null,
    currentPressure: {},
    partitionPressureHistory: [],
    pendingReasonsHistory: [],
    queueHealthHistory: [],
    waitTimeHistory: {},
    submissionPatterns: {},
    status: {},
  };
}

export async function loadQueueInsightsData() {
  try {
    const [currentPressure, partitionPressure, pendingReasons, queueHealthHistory, waitTimeHistory, submissionPatterns, status] = await Promise.all([
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}current_pressure.json`),
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}partition_pressure.json`),
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}pending_reasons.json`),
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}queue_health_history.json`),
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}wait_time_history.json`),
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}submission_patterns.json`),
      tryOptionalJson(`${QUEUE_INSIGHTS_BASE}status.json`),
    ]);
    const anyLoaded = [currentPressure, partitionPressure, pendingReasons, queueHealthHistory, waitTimeHistory, submissionPatterns, status]
      .some((doc) => doc !== null);
    return {
      available: anyLoaded,
      error: null,
      currentPressure: asObject(currentPressure),
      partitionPressureHistory: asArray(partitionPressure && partitionPressure.points),
      pendingReasonsHistory: asArray(pendingReasons && pendingReasons.points),
      queueHealthHistory: asArray(queueHealthHistory && queueHealthHistory.points),
      waitTimeHistory: asObject(waitTimeHistory),
      submissionPatterns: asObject(submissionPatterns),
      status: asObject(status),
    };
  } catch (error) {
    return emptyQueueInsights(error);
  }
}

// Software Inventory (Software Analytics Milestone 1): one file,
// software_inventory.json, schema software-inventory-v1 - see the private
// repo's scripts/export_software_inventory.py and
// docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md. tryOptionalJson()
// already turns a missing file (private repo's nightly stage has not run
// yet) and a malformed/unparseable file (any JSON.parse failure) into the
// same `null` - both degrade to the same "unavailable" shape below rather
// than throwing, so this is the one loader in this file with no privacy
// gate concerns: module_catalog has no username/jobid/account/workdir
// field, so there is nothing here that ever needs tier separation.
function emptySoftwareInventory(error) {
  return {
    available: false,
    error: error ? String(error) : null,
    generatedAt: null,
    schemaVersion: null,
    collectorName: null,
    collectorStatus: 'failed',
    platformModule: null,
    failureMessage: null,
    expectedRefreshSeconds: null,
    warningAfterIntervals: null,
    criticalAfterIntervals: null,
    summary: {},
    modules: [],
    moduleFamilies: {},
    moduleKnowledge: {},
    knowledgeSummary: {},
    relatedSoftware: {},
  };
}

// Field names are normalized from the exporter's snake_case to this file's
// camelCase convention (moduleName/moduleVersion/etc.) - the export's exact
// keys (module_name, module_version, ...) are documented in
// SOFTWARE_INVENTORY_ARCHITECTURE.md and intentionally not duplicated here;
// changing that contract is the exporter's call, not this loader's.
function normalizeSoftwareModule(raw) {
  const m = asObject(raw);
  return {
    moduleName: m.module_name || '',
    moduleVersion: m.module_version || '',
    modulefilePath: m.modulefile_path || '',
    whatisText: m.whatis_text || null,
    firstSeen: m.first_seen || null,
    lastSeen: m.last_seen || null,
    removedAt: m.removed_at || null,
    // Software Intelligence Milestone 2 - optional, only present once the
    // exporter has shipped it; absent on an older export this loader simply
    // yields null, never a guessed value.
    modulepathRoot: m.modulepath_root || null,
    // Software Explorer Milestone 4 ("Better Descriptions") - the
    // exporter's own precedence (registry description -> whatis -> help ->
    // none, see export_software_inventory.py's apply_display_description())
    // computed once, server-side. This page never re-derives it from
    // whatisText/module_knowledge itself - whatisText above remains the
    // original `module whatis` text for provenance, displayDescription is
    // what every page actually renders as "the description."
    displayDescription: m.display_description || null,
  };
}

// Software Intelligence Milestone 2 (docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md,
// "module_families"): one entry per module_name, used by the module detail
// page for Related Versions/Default Version/version navigation. Optional -
// an export that predates this milestone simply has no module_families
// key, and asObject(undefined) below yields {}, not an error.
function normalizeModuleFamily(raw) {
  const f = asObject(raw);
  return {
    versions: asArray(f.versions).map((v) => ({
      version: v?.version || '',
      modulefilePath: v?.modulefile_path || '',
    })),
    defaultVersion: f.default_version || null,
    defaultModulefilePath: f.default_modulefile_path || null,
    // Software Knowledge Milestone 3 ("Version Intelligence") - optional,
    // same degrade-to-null rule as every other field added after the
    // export contract's first release.
    latestInstalledVersion: f.latest_installed_version || null,
  };
}

function normalizeModuleFamilies(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [name, family] of Object.entries(obj)) {
    out[name] = normalizeModuleFamily(family);
  }
  return out;
}

// Software Knowledge Milestone 3 (docs/architecture/SOFTWARE_KNOWLEDGE_ARCHITECTURE.md):
// deterministic facts collected via exact-match-only registry lookups - no
// AI, no web summarization. A module_name absent from the export's
// module_knowledge object has simply never been checked yet; this loader
// represents that as an absent key (checked with `in` / optional chaining
// at the call site), never as an object full of nulls, so the "only
// display sections when data exists" rule starts from the same absence
// the exporter itself uses.
function normalizeModuleKnowledgeEntry(raw) {
  const k = asObject(raw);
  return {
    homepage: k.homepage || null,
    documentationUrl: k.documentation_url || null,
    sourceRepositoryUrl: k.source_repository_url || null,
    githubRepositoryUrl: k.github_repository_url || null,
    gitlabRepositoryUrl: k.gitlab_repository_url || null,
    license: k.license || null,
    citationInfo: k.citation_info || null,
    programmingLanguage: k.programming_language || null,
    maintainer: k.maintainer || null,
    upstreamVersion: k.upstream_version || null,
    latestRelease: k.latest_release || null,
    releaseDate: k.release_date || null,
    changelogUrl: k.changelog_url || null,
    knowledgeSource: k.knowledge_source || null,
    confidence: k.confidence || null,
    lastCheckedAt: k.last_checked_at || null,
    // True/False only when the exporter could actually compare upstream
    // against what's installed; null means "unknown," never guessed.
    updateAvailable: k.update_available ?? null,
    // Software Explorer Milestone 4 - the registry's own short summary
    // field, verbatim (never the long free-text description some
    // registries also expose - see collect_module_knowledge.py). Folded
    // into normalizeSoftwareModule()'s displayDescription server-side
    // already; exposed here too for any page that wants the raw field
    // directly (e.g. to show "via bioconda" provenance alongside it).
    registryDescription: k.registry_description || null,
  };
}

function normalizeModuleKnowledge(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [name, entry] of Object.entries(obj)) {
    out[name] = normalizeModuleKnowledgeEntry(entry);
  }
  return out;
}

// Software Health summary (Milestone 3) - every key here is a real count
// the exporter computed (build_knowledge_summary()), not a placeholder for
// a future one. asObject(undefined) below yields {} against an older
// export, and every field access at the call site already tolerates a
// missing key.
function normalizeKnowledgeSummary(raw) {
  const s = asObject(raw);
  return {
    totalActiveModules: s.total_active_modules ?? null,
    modulesWithHomepage: s.modules_with_homepage ?? null,
    modulesWithDocumentation: s.modules_with_documentation ?? null,
    modulesWithRepository: s.modules_with_repository ?? null,
    modulesWithLicense: s.modules_with_license ?? null,
    modulesWithUpdateAvailable: s.modules_with_update_available ?? null,
    modulesMissingMetadata: s.modules_missing_metadata ?? null,
    knowledgeCoveragePct: s.knowledge_coverage_pct ?? null,
    // Software Explorer Milestone 4 ("Software Health" expansion) - one
    // percentage per coverage dimension, computed server-side
    // (build_knowledge_summary()'s pct() closure) alongside the raw counts
    // above, so this page never computes its own percentage from them.
    homepageCoveragePct: s.homepage_coverage_pct ?? null,
    documentationCoveragePct: s.documentation_coverage_pct ?? null,
    repositoryCoveragePct: s.repository_coverage_pct ?? null,
    licenseCoveragePct: s.license_coverage_pct ?? null,
    updateCoveragePct: s.update_coverage_pct ?? null,
  };
}

// related_software is already exactly {module_name: [module_name, ...]} in
// the export - no per-field normalization needed, just the same
// asObject()/asArray() defensiveness against a missing or malformed key
// every other optional block in this file already applies.
function normalizeRelatedSoftware(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [name, related] of Object.entries(obj)) {
    out[name] = asArray(related);
  }
  return out;
}

export async function loadSoftwareInventoryData() {
  try {
    const doc = await tryOptionalJson(`${SOFTWARE_INVENTORY_BASE}software_inventory.json`);
    if (!doc) return emptySoftwareInventory(null);
    return {
      available: true,
      error: null,
      generatedAt: doc.generated_at || null,
      schemaVersion: doc.schema_version || null,
      collectorName: doc.collector || 'software_inventory_export',
      collectorStatus: doc.collector_status || null,
      platformModule: doc.platform_module || 'Software Inventory',
      failureMessage: doc.failure_message || null,
      expectedRefreshSeconds: doc.expected_refresh_seconds ?? null,
      warningAfterIntervals: doc.warning_after_intervals ?? null,
      criticalAfterIntervals: doc.critical_after_intervals ?? null,
      summary: asObject(doc.summary),
      modules: asArray(doc.modules).map(normalizeSoftwareModule),
      moduleFamilies: normalizeModuleFamilies(doc.module_families),
      moduleKnowledge: normalizeModuleKnowledge(doc.module_knowledge),
      knowledgeSummary: normalizeKnowledgeSummary(doc.knowledge_summary),
      relatedSoftware: normalizeRelatedSoftware(doc.related_software),
    };
  } catch (error) {
    return emptySoftwareInventory(error);
  }
}

// --- Software Intelligence (private repo's export_software_intelligence.py) ---
// Unlike Software Inventory (one file), this module publishes many small
// files - all fetched in parallel via tryOptionalJson() so one missing/
// malformed file degrades only its own block to an empty shape, not the
// whole module. `available` (the "do we have anything to show at all" gate
// every page checks first) is true iff overview.json itself loaded; every
// other field independently falls back to {}/[] the same way
// emptySoftwareInventory() does for its single file.

function emptySoftwareIntelligence(error) {
  return {
    available: false,
    error: error ? String(error) : null,
    generatedAt: null,
    schemaVersion: null,
    collectorName: null,
    collectorStatus: 'failed',
    platformModule: null,
    failureMessage: null,
    expectedRefreshSeconds: null,
    warningAfterIntervals: null,
    criticalAfterIntervals: null,
    overview: {},
    topModules: { all_time: [], rolling_7d: [], rolling_30d: [] },
    trending: { asOf: null, modules: [] },
    growthDecline: { growing: [], declining: [] },
    versions: {},
    relationships: {},
    dailyUsage: [],
    monthlyUsage: [],
    topByAccount: {},
    topByPartition: {},
  };
}

function normalizeCollectorStats(raw) {
  const s = asObject(raw);
  return {
    filesDiscovered: s.files_discovered ?? null,
    filesProcessed: s.files_processed ?? null,
    filesInvalid: s.files_invalid ?? null,
    filesFailed: s.files_failed ?? null,
    jobsImported: s.jobs_imported ?? null,
    lastImportAt: s.last_import_at ?? null,
    lastMaterializedAt: s.last_materialized_at ?? null,
    dropZoneHasData: Boolean(s.drop_zone_has_data),
  };
}

function normalizeOverview(raw) {
  const o = asObject(raw);
  const range = asObject(o.date_range);
  return {
    totalJobsIngested: o.total_jobs_ingested ?? 0,
    distinctModules: o.distinct_modules ?? 0,
    distinctModuleVersions: o.distinct_module_versions ?? 0,
    uniqueUsers: o.unique_users ?? 0,
    uniqueAccounts: o.unique_accounts ?? 0,
    totalCpuHours: o.total_cpu_hours ?? 0,
    dateRange: { firstDate: range.first_date ?? null, lastDate: range.last_date ?? null },
    collectorStats: normalizeCollectorStats(o.collector_stats),
  };
}

// Each top_modules.json window entry already carries jobs/unique_users/
// cpu_hours/first_seen/last_seen together (uncapped, every module) - the
// frontend sorts/paginates this one list client-side rather than reading
// three separately-Top-N-ranked arrays the export used to publish.
function normalizeTopModuleEntry(raw) {
  const m = asObject(raw);
  return {
    moduleName: m.module_name || '',
    jobs: m.jobs ?? 0,
    uniqueUsers: m.unique_users ?? 0,
    cpuHours: m.cpu_hours ?? 0,
    firstSeen: m.first_seen || null,
    lastSeen: m.last_seen || null,
  };
}

function normalizeTopModules(raw) {
  const t = asObject(raw);
  return {
    all_time: asArray(t.all_time).map(normalizeTopModuleEntry),
    rolling_7d: asArray(t.rolling_7d).map(normalizeTopModuleEntry),
    rolling_30d: asArray(t.rolling_30d).map(normalizeTopModuleEntry),
  };
}

function normalizeTrendingModule(raw) {
  const m = asObject(raw);
  return {
    moduleName: m.module_name || '',
    jobsToday: m.jobs_today ?? 0,
    avgJobsPerDayLast7d: m.avg_jobs_per_day_last_7d ?? 0,
    avgJobsPerDayLast30d: m.avg_jobs_per_day_last_30d ?? 0,
    changeVsWeekAvgPct: m.change_vs_week_avg_pct ?? null,
    changeVsMonthAvgPct: m.change_vs_month_avg_pct ?? null,
    trendDirection: m.trend_direction || 'flat',
  };
}

function normalizeTrending(raw) {
  const t = asObject(raw);
  return { asOf: t.as_of || null, modules: asArray(t.modules).map(normalizeTrendingModule) };
}

function normalizeGrowthDeclineEntry(raw) {
  const e = asObject(raw);
  return {
    moduleName: e.module_name || '',
    jobsLast30d: e.jobs_last_30d ?? 0,
    jobsPrior30d: e.jobs_prior_30d ?? 0,
    changePct: e.change_pct ?? null,
  };
}

function normalizeGrowthDecline(raw) {
  const g = asObject(raw);
  return {
    growing: asArray(g.growing).map(normalizeGrowthDeclineEntry),
    declining: asArray(g.declining).map(normalizeGrowthDeclineEntry),
  };
}

function normalizeVersionEntry(raw) {
  const v = asObject(raw);
  return {
    moduleName: v.module_name || '',
    moduleVersion: v.module_version || '',
    jobs: v.jobs ?? 0,
    users: v.users ?? 0,
    firstSeen: v.first_seen || null,
    lastSeen: v.last_seen || null,
  };
}

function normalizeVersionsEntry(raw) {
  const v = asObject(raw);
  return {
    latestVersion: v.latest_version || null,
    mostUsedVersion: v.most_used_version || null,
    versions: asArray(v.versions).map(normalizeVersionEntry),
  };
}

function normalizeVersions(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [name, entry] of Object.entries(obj)) out[name] = normalizeVersionsEntry(entry);
  return out;
}

function normalizeRelationshipEntry(raw) {
  const r = asObject(raw);
  return { module: r.module || '', count: r.count ?? 0, confidence: r.confidence ?? null, lift: r.lift ?? null };
}

function normalizeRelationships(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [name, entries] of Object.entries(obj)) out[name] = asArray(entries).map(normalizeRelationshipEntry);
  return out;
}

function normalizeDailyUsage(raw) {
  return asArray(raw).map((r) => {
    const row = asObject(r);
    return { date: row.date || null, jobs: row.jobs ?? 0, cpuHours: row.cpu_hours ?? 0, distinctModules: row.distinct_modules ?? 0 };
  });
}

function normalizeMonthlyUsage(raw) {
  return asArray(raw).map((r) => {
    const row = asObject(r);
    return { month: row.month || null, jobs: row.jobs ?? 0, cpuHours: row.cpu_hours ?? 0, distinctModules: row.distinct_modules ?? 0 };
  });
}

function normalizeTopByAccount(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [publicAccountId, entry] of Object.entries(obj)) {
    const e = asObject(entry);
    out[publicAccountId] = {
      accountLabel: e.account_label || publicAccountId,
      topModules: asArray(e.top_modules).map((m) => {
        const row = asObject(m);
        return { moduleName: row.module_name || '', jobs: row.jobs ?? 0, cpuHours: row.cpu_hours ?? 0 };
      }),
    };
  }
  return out;
}

function normalizeTopByPartition(raw) {
  const obj = asObject(raw);
  const out = {};
  for (const [partitionName, entries] of Object.entries(obj)) {
    out[partitionName] = asArray(entries).map((m) => {
      const row = asObject(m);
      return { moduleName: row.module_name || '', jobs: row.jobs ?? 0, cpuHours: row.cpu_hours ?? 0 };
    });
  }
  return out;
}

export async function loadSoftwareIntelligenceData() {
  try {
    const [overview, topModules, trending, versions, relationships, dailyUsage, monthlyUsage, topByAccount, topByPartition] = await Promise.all([
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}overview.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}top_modules.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}trending.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}versions.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}relationships.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}daily_usage.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}monthly_usage.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}top_by_account.json`),
      tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}top_by_partition.json`),
    ]);
    if (!overview) return emptySoftwareIntelligence(null);
    return {
      available: true,
      error: null,
      generatedAt: overview.generated_at || null,
      schemaVersion: overview.schema_version || null,
      collectorName: overview.collector || 'software_intelligence_export',
      collectorStatus: overview.collector_status || null,
      platformModule: overview.platform_module || 'Software Intelligence',
      failureMessage: overview.failure_message || null,
      expectedRefreshSeconds: overview.expected_refresh_seconds ?? null,
      warningAfterIntervals: overview.warning_after_intervals ?? null,
      criticalAfterIntervals: overview.critical_after_intervals ?? null,
      overview: normalizeOverview(overview.overview),
      topModules: normalizeTopModules(topModules?.top_modules),
      trending: normalizeTrending(trending?.trending),
      growthDecline: normalizeGrowthDecline(trending?.growth_decline),
      versions: normalizeVersions(versions?.versions),
      relationships: normalizeRelationships(relationships?.relationships),
      dailyUsage: normalizeDailyUsage(dailyUsage?.daily_usage),
      monthlyUsage: normalizeMonthlyUsage(monthlyUsage?.monthly_usage),
      topByAccount: normalizeTopByAccount(topByAccount?.top_by_account),
      topByPartition: normalizeTopByPartition(topByPartition?.top_by_partition),
    };
  } catch (error) {
    return emptySoftwareIntelligence(error);
  }
}

// Same slug rule as export_software_intelligence.py's safe_module_filename()
// (non [A-Za-z0-9_.+-] -> "_") so a module name with an unusual character
// resolves to the exact file the exporter actually wrote.
function safeModuleFilename(moduleName) {
  return String(moduleName || '').replace(/[^A-Za-z0-9_.+-]/g, '_');
}

function normalizeVersionDailyHistoryEntry(raw) {
  const r = asObject(raw);
  return { date: r.date || null, version: r.version || '', jobs: r.jobs ?? 0 };
}

// Lazy, per-module fetch - deliberately NOT part of loadSoftwareIntelligenceData()/
// the init() Promise.all bundle. Called only when a module detail route, or
// a module-filtered Timeline/Relationships view, actually needs this one
// file - this is what makes "support thousands of modules" and "lazy-load
// large module pages" true rather than aspirational (see
// docs/architecture/SOFTWARE_INTELLIGENCE_ARCHITECTURE.md in the private repo).
export async function loadSoftwareIntelligenceModuleDetail(moduleName) {
  try {
    const doc = await tryOptionalJson(`${SOFTWARE_INTELLIGENCE_BASE}module/${safeModuleFilename(moduleName)}.json`);
    if (!doc || !doc.module) return null;
    const m = asObject(doc.module);
    return {
      moduleName: m.module_name || moduleName,
      totalJobs: m.total_jobs ?? 0,
      totalUsers: m.total_users ?? 0,
      totalCpuHours: m.total_cpu_hours ?? 0,
      trendDirection: m.trend_direction || null,
      jobsToday: m.jobs_today ?? null,
      versionInfo: normalizeVersionsEntry(m.version_info),
      relatedModules: asArray(m.related_modules).map(normalizeRelationshipEntry),
      dailyHistory: normalizeDailyUsage(m.daily_history),
      versionDailyHistory: asArray(m.version_daily_history).map(normalizeVersionDailyHistoryEntry),
    };
  } catch (error) {
    return null;
  }
}

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
          coverageWindow: 'Unavailable',
          dateRange: { start: null, end: null },
          exportDate: null,
          importedRows: 0,
          rowCounts: {},
          userCount: 0,
          projectCount: 0,
          piCount: 0,
          groupCount: 0,
          sectionCount: 0,
          recommendationCount: 0,
          inefficientJobCount: 0,
          accountExportAvailable: false,
          collectorName: null,
          collectorStatus: 'failed',
          platformModule: null,
          dataWindowDays: null,
        },
        errors: [String(primaryError), String(fallbackError)],
      };
    }
  }
}
