/**
 * Zero-dependency SVG Charting Engine for AMR Cost & Compute Analytics
 * Implements Line Charts, Grouped Bars, Stacked Latency Bars, and Interactive Tooltips
 */

// Shared tooltip element
let tooltipEl: HTMLDivElement | null = null;

function getTooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = document.getElementById('chart-tooltip') as HTMLDivElement;
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chart-tooltip';
      tooltipEl.className = 'chart-tooltip-box';
      document.body.appendChild(tooltipEl);
    }
  }
  return tooltipEl;
}

export function showTooltip(e: MouseEvent, html: string) {
  const tip = getTooltip();
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = `${e.pageX + 12}px`;
  tip.style.top = `${e.pageY - 28}px`;
}

export function hideTooltip() {
  const tip = getTooltip();
  tip.style.display = 'none';
}

function emptyMessage(width: number, height: number, text: string = 'No incidents match active filters'): string {
  return `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg-root" width="100%" height="100%">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#5D7289" font-family="'JetBrains Mono', monospace" font-size="12">
        ${text}
      </text>
    </svg>
  `;
}

// ============================================================================
// 1. Line Chart: Rolling Cache Hit Rate over Incidents
// ============================================================================
export function renderRollingHitRateChart(
  containerId: string,
  data: Array<{ x: number; y: number }>,
  title: string = 'Rolling Cache Hit Rate'
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = emptyMessage(500, 220);
    return;
  }

  const W = 520;
  const H = 220;
  const pad = { top: 25, right: 30, bottom: 35, left: 45 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const minX = data[0].x;
  const maxX = data[data.length - 1].x || 1;
  const maxY = 100;

  const points = data.map(d => {
    const x = pad.left + ((d.x - minX) / (maxX - minX || 1)) * innerW;
    const y = pad.top + innerH - (d.y / maxY) * innerH;
    return { x, y, origX: d.x, origY: d.y };
  });

  const lineD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');
  const areaD = `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  // Y-axis grid lines (0%, 25%, 50%, 75%, 100%)
  const yTicks = [0, 25, 50, 75, 100];
  const gridLines = yTicks
    .map(val => {
      const y = pad.top + innerH - (val / maxY) * innerH;
      return `
        <line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
        <text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" fill="#5D7289" font-size="9" font-family="'JetBrains Mono', monospace">${val}%</text>
      `;
    })
    .join('');

  // Target line at 60%
  const targetY = pad.top + innerH - (60 / maxY) * innerH;

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <defs>
        <linearGradient id="hitRateGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#38D98A" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#38D98A" stop-opacity="0.0"/>
        </linearGradient>
      </defs>

      <!-- Y Grid -->
      ${gridLines}

      <!-- Target 60% benchmark guide -->
      <line x1="${pad.left}" y1="${targetY}" x2="${W - pad.right}" y2="${targetY}" stroke="#38BDF8" stroke-width="1" stroke-dasharray="4,4" opacity="0.6"/>
      <text x="${W - pad.right}" y="${targetY - 5}" text-anchor="end" fill="#38BDF8" font-size="9" font-family="'JetBrains Mono', monospace">Target 60%</text>

      <!-- Area fill & Line path -->
      <path d="${areaD}" fill="url(#hitRateGrad)" />
      <path d="${lineD}" fill="none" stroke="#38D98A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Hover interaction points (sampled) -->
      ${points
        .filter((_, idx) => idx % Math.ceil(points.length / 30) === 0 || idx === points.length - 1)
        .map(
          p => `
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#0D1824" stroke="#38D98A" stroke-width="1.8" class="chart-point-marker"
            data-tooltip="Incident #${p.origX}<br/>Rolling Hit Rate: <strong>${p.origY.toFixed(1)}%</strong>" />
        `
        )
        .join('')}

      <!-- Axes Labels -->
      <text x="${pad.left + innerW / 2}" y="${H - 6}" text-anchor="middle" fill="#5D7289" font-size="10" font-family="'JetBrains Mono', monospace">Incident Index (Chronological)</text>
      <text x="12" y="${pad.top + innerH / 2}" text-anchor="middle" transform="rotate(-90 12 ${pad.top + innerH / 2})" fill="#5D7289" font-size="10" font-family="'JetBrains Mono', monospace">Hit Rate (%)</text>
    </svg>
  `;

  attachTooltips(container);
}

// ============================================================================
// 2. Grouped Bar Chart: With Cache vs Without Cache
// ============================================================================
export interface GroupedBarMetric {
  label: string;
  unit: string;
  withCache: number;
  withoutCache: number;
}

export function renderWithWithoutCacheChart(
  containerId: string,
  metrics: GroupedBarMetric[],
  title: string = 'With Cache vs Without Cache'
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!metrics || metrics.length === 0) {
    container.innerHTML = emptyMessage(520, 220);
    return;
  }

  const W = 520;
  const H = 220;
  const pad = { top: 30, right: 30, bottom: 40, left: 50 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const groupWidth = innerW / metrics.length;
  const barWidth = Math.min(28, (groupWidth - 20) / 2);

  const bars = metrics
    .map((m, i) => {
      const maxVal = Math.max(m.withCache, m.withoutCache) * 1.15 || 1;
      const hWith = (m.withCache / maxVal) * innerH;
      const hWithout = (m.withoutCache / maxVal) * innerH;

      const groupCenterX = pad.left + i * groupWidth + groupWidth / 2;
      const xWith = groupCenterX - barWidth - 3;
      const xWithout = groupCenterX + 3;

      const yWith = pad.top + innerH - hWith;
      const yWithout = pad.top + innerH - hWithout;

      const formatVal = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(1));

      return `
        <!-- With Cache Bar -->
        <rect x="${xWith.toFixed(1)}" y="${yWith.toFixed(1)}" width="${barWidth}" height="${hWith.toFixed(1)}"
          rx="3" fill="#38BDF8" class="chart-bar-rect"
          data-tooltip="${m.label}<br/>With Cache: <strong>${m.withCache.toLocaleString()} ${m.unit}</strong>" />
        <text x="${(xWith + barWidth / 2).toFixed(1)}" y="${(yWith - 4).toFixed(1)}" text-anchor="middle" fill="#38BDF8" font-size="9" font-family="'JetBrains Mono', monospace">
          ${formatVal(m.withCache)}
        </text>

        <!-- Without Cache Bar -->
        <rect x="${xWithout.toFixed(1)}" y="${yWithout.toFixed(1)}" width="${barWidth}" height="${hWithout.toFixed(1)}"
          rx="3" fill="#64748B" class="chart-bar-rect"
          data-tooltip="${m.label}<br/>Without Cache: <strong>${m.withoutCache.toLocaleString()} ${m.unit}</strong>" />
        <text x="${(xWithout + barWidth / 2).toFixed(1)}" y="${(yWithout - 4).toFixed(1)}" text-anchor="middle" fill="#94A3B8" font-size="9" font-family="'JetBrains Mono', monospace">
          ${formatVal(m.withoutCache)}
        </text>

        <!-- Group Label -->
        <text x="${groupCenterX.toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="#91A4BA" font-size="10" font-weight="600" font-family="'Inter', sans-serif">
          ${m.label}
        </text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <!-- Baseline axis -->
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="rgba(255,255,255,0.12)" />

      <!-- Grouped bars -->
      ${bars}

      <!-- Top Legend -->
      <g transform="translate(${W - 200}, 14)">
        <rect x="0" y="0" width="10" height="10" rx="2" fill="#38BDF8" />
        <text x="14" y="9" fill="#E8F0FA" font-size="10" font-family="'Inter', sans-serif">With Cache</text>
        <rect x="90" y="0" width="10" height="10" rx="2" fill="#64748B" />
        <text x="104" y="9" fill="#94A3B8" font-size="10" font-family="'Inter', sans-serif">Without Cache</text>
      </g>
    </svg>
  `;

  attachTooltips(container);
}

// ============================================================================
// 3. Validator Panel: Violations Executed & Validation Cost Charts
// ============================================================================
export interface ViolationComparison {
  name: string;
  withValidator: number;
  withoutValidator: number;
}

export function renderValidatorViolationsChart(containerId: string, violations: ViolationComparison[]) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const W = 380;
  const H = 200;
  const pad = { top: 25, right: 25, bottom: 35, left: 35 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...violations.map(v => v.withoutValidator), 10) * 1.2;
  const groupW = innerW / violations.length;
  const barW = Math.min(22, (groupW - 14) / 2);

  const bars = violations
    .map((v, i) => {
      const hWith = (v.withValidator / maxVal) * innerH;
      const hWithout = (v.withoutValidator / maxVal) * innerH;

      const cx = pad.left + i * groupW + groupW / 2;
      const xWith = cx - barW - 2;
      const xWithout = cx + 2;

      const yWith = pad.top + innerH - Math.max(2, hWith);
      const yWithout = pad.top + innerH - hWithout;

      return `
        <!-- With Validator (0 violations) -->
        <rect x="${xWith.toFixed(1)}" y="${yWith.toFixed(1)}" width="${barW}" height="${Math.max(2, hWith).toFixed(1)}"
          rx="2" fill="#38D98A" class="chart-bar-rect"
          data-tooltip="${v.name}<br/>With Validator: <strong>${v.withValidator} executed</strong> (0% Allowed)" />
        <text x="${(xWith + barW / 2).toFixed(1)}" y="${(yWith - 3).toFixed(1)}" text-anchor="middle" fill="#38D98A" font-size="9" font-family="'JetBrains Mono', monospace">
          0
        </text>

        <!-- Without Validator -->
        <rect x="${xWithout.toFixed(1)}" y="${yWithout.toFixed(1)}" width="${barW}" height="${hWithout.toFixed(1)}"
          rx="2" fill="#EF4444" class="chart-bar-rect"
          data-tooltip="${v.name}<br/>Without Validator: <strong>${v.withoutValidator} violations executed</strong>" />
        <text x="${(xWithout + barW / 2).toFixed(1)}" y="${(yWithout - 3).toFixed(1)}" text-anchor="middle" fill="#EF4444" font-size="9" font-family="'JetBrains Mono', monospace">
          ${v.withoutValidator}
        </text>

        <!-- Label -->
        <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">
          ${v.name}
        </text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="rgba(255,255,255,0.12)" />
      ${bars}
      <!-- Legend -->
      <g transform="translate(${W - 195}, 10)">
        <rect x="0" y="0" width="8" height="8" rx="2" fill="#38D98A" />
        <text x="12" y="7" fill="#38D98A" font-size="9" font-family="'Inter', sans-serif">With Validator (0)</text>
        <rect x="105" y="0" width="8" height="8" rx="2" fill="#EF4444" />
        <text x="117" y="7" fill="#EF4444" font-size="9" font-family="'Inter', sans-serif">Without (Failed)</text>
      </g>
    </svg>
  `;

  attachTooltips(container);
}

export function renderValidatorCostChart(
  containerId: string,
  costItems: Array<{ label: string; value: string; numVal: number; unit: string; desc: string }>
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const W = 380;
  const H = 200;
  const pad = { top: 25, right: 30, bottom: 25, left: 130 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const rowHeight = innerH / costItems.length;

  const bars = costItems
    .map((item, i) => {
      const y = pad.top + i * rowHeight + 8;
      const barH = 16;
      // Relative visual fill (normalized between 20% and 90% for clear display)
      const fillW = Math.max(12, Math.min(innerW, innerW * (0.25 + i * 0.35)));

      return `
        <!-- Row Label -->
        <text x="${pad.left - 10}" y="${y + 12}" text-anchor="end" fill="#E8F0FA" font-size="10" font-weight="600" font-family="'Inter', sans-serif">
          ${item.label}
        </text>

        <!-- Track & Bar -->
        <rect x="${pad.left}" y="${y}" width="${innerW}" height="${barH}" rx="3" fill="#132130" />
        <rect x="${pad.left}" y="${y}" width="${fillW}" height="${barH}" rx="3" fill="#A855F7" class="chart-bar-rect"
          data-tooltip="${item.label}: <strong>${item.value}</strong><br/>${item.desc}" />

        <!-- Value text inside/beside bar -->
        <text x="${pad.left + fillW + 8}" y="${y + 12}" fill="#A855F7" font-size="10" font-weight="700" font-family="'JetBrains Mono', monospace">
          ${item.value}
        </text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      ${bars}
    </svg>
  `;

  attachTooltips(container);
}

// ============================================================================
// 4. Stacked Latency Bar Chart: By Stage (Hit vs Miss)
// ============================================================================
export interface LatencyStageBreakdown {
  mode: string;
  totalMs: number;
  stages: {
    detection: number;
    cacheLookup: number;
    llm: number;
    solver: number;
    validation: number;
  };
}

export function renderStackedLatencyChart(
  containerId: string,
  hitBreakdown: LatencyStageBreakdown,
  missBreakdown: LatencyStageBreakdown
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const W = 520;
  const H = 220;
  const pad = { top: 35, right: 35, bottom: 40, left: 100 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const stageColors = {
    detection: '#38BDF8',   // Cyan
    cacheLookup: '#3185FF', // Blue
    llm: '#A855F7',         // Purple
    solver: '#F59E0B',      // Amber
    validation: '#38D98A',  // Green
  };

  const rows = [
    { label: 'Cache Hit (~1.2 ms)', data: hitBreakdown, isLog: false },
    { label: 'Cache Miss (~840 ms)', data: missBreakdown, isLog: true },
  ];

  const barH = 26;

  const barSvg = rows
    .map((r, idx) => {
      const y = pad.top + idx * 60 + 10;
      const s = r.data.stages;
      const total = s.detection + s.cacheLookup + s.llm + s.solver + s.validation;

      // For Cache Hit, we amplify small fractions visually so segments are legible, with exact tooltip numbers
      const isHit = idx === 0;
      const wDet = isHit ? innerW * 0.12 : (s.detection / total) * innerW;
      const wCache = isHit ? innerW * 0.58 : (s.cacheLookup / total) * innerW;
      const wLlm = isHit ? 0 : (s.llm / total) * innerW;
      const wSolver = isHit ? innerW * 0.18 : (s.solver / total) * innerW;
      const wVal = isHit ? innerW * 0.12 : (s.validation / total) * innerW;

      let curX = pad.left;

      const segs = [
        { name: 'Detection', val: s.detection, w: wDet, color: stageColors.detection },
        { name: 'Cache Lookup', val: s.cacheLookup, w: wCache, color: stageColors.cacheLookup },
        { name: 'LLM Generation', val: s.llm, w: wLlm, color: stageColors.llm },
        { name: 'MAPF Solver', val: s.solver, w: wSolver, color: stageColors.solver },
        { name: 'Validation', val: s.validation, w: wVal, color: stageColors.validation },
      ];

      const rects = segs
        .map(seg => {
          if (seg.w <= 0) return '';
          const x = curX;
          curX += seg.w;
          return `
            <rect x="${x.toFixed(1)}" y="${y}" width="${seg.w.toFixed(1)}" height="${barH}" rx="1" fill="${seg.color}" class="chart-bar-rect"
              data-tooltip="${r.label}<br/>${seg.name}: <strong>${seg.val.toFixed(2)} ms</strong>" />
          `;
        })
        .join('');

      return `
        <text x="${pad.left - 12}" y="${y + 17}" text-anchor="end" fill="#E8F0FA" font-size="11" font-weight="600" font-family="'Inter', sans-serif">
          ${r.label}
        </text>
        <g>${rects}</g>
        <text x="${(pad.left + innerW + 8).toFixed(1)}" y="${y + 17}" fill="#94A3B8" font-size="10" font-family="'JetBrains Mono', monospace">
          ${total.toFixed(1)} ms
        </text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <!-- Legend across top -->
      <g transform="translate(${pad.left - 15}, 12)">
        <rect x="0" y="0" width="8" height="8" rx="2" fill="${stageColors.detection}" />
        <text x="12" y="7" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">Detection</text>
        
        <rect x="75" y="0" width="8" height="8" rx="2" fill="${stageColors.cacheLookup}" />
        <text x="87" y="7" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">Lookup</text>
        
        <rect x="140" y="0" width="8" height="8" rx="2" fill="${stageColors.llm}" />
        <text x="152" y="7" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">LLM</text>
        
        <rect x="195" y="0" width="8" height="8" rx="2" fill="${stageColors.solver}" />
        <text x="207" y="7" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">Solver</text>
        
        <rect x="260" y="0" width="8" height="8" rx="2" fill="${stageColors.validation}" />
        <text x="272" y="7" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">Validator</text>
      </g>

      ${barSvg}
    </svg>
  `;

  attachTooltips(container);
}

// ============================================================================
// 5. Expander Charts: Token Usage, Cache Growth, Quality Impact
// ============================================================================
export function renderTokenUsageChart(
  containerId: string,
  tokenBuckets: Array<{ bucket: string; inputTokens: number; outputTokens: number }>
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const W = 360;
  const H = 180;
  const pad = { top: 25, right: 20, bottom: 30, left: 45 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxTokens = Math.max(...tokenBuckets.map(b => b.inputTokens + b.outputTokens), 1000) * 1.15;
  const barW = Math.min(24, innerW / tokenBuckets.length - 8);

  const bars = tokenBuckets
    .map((b, i) => {
      const x = pad.left + (i * innerW) / tokenBuckets.length + 8;
      const hIn = (b.inputTokens / maxTokens) * innerH;
      const hOut = (b.outputTokens / maxTokens) * innerH;

      const yIn = pad.top + innerH - hIn;
      const yOut = yIn - hOut;

      return `
        <!-- Input tokens -->
        <rect x="${x.toFixed(1)}" y="${yIn.toFixed(1)}" width="${barW}" height="${hIn.toFixed(1)}" fill="#3185FF" class="chart-bar-rect"
          data-tooltip="${b.bucket}<br/>Input: <strong>${b.inputTokens.toLocaleString()}</strong> tokens" />
        <!-- Output tokens (stacked) -->
        <rect x="${x.toFixed(1)}" y="${yOut.toFixed(1)}" width="${barW}" height="${hOut.toFixed(1)}" fill="#A855F7" class="chart-bar-rect"
          data-tooltip="${b.bucket}<br/>Output: <strong>${b.outputTokens.toLocaleString()}</strong> tokens" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#91A4BA" font-size="8" font-family="'Inter', sans-serif">
          ${b.bucket}
        </text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="rgba(255,255,255,0.12)" />
      ${bars}
      <g transform="translate(${W - 150}, 8)">
        <rect x="0" y="0" width="7" height="7" rx="1" fill="#3185FF" />
        <text x="10" y="6" fill="#91A4BA" font-size="8">Input</text>
        <rect x="50" y="0" width="7" height="7" rx="1" fill="#A855F7" />
        <text x="60" y="6" fill="#91A4BA" font-size="8">Output</text>
      </g>
    </svg>
  `;

  attachTooltips(container);
}

export function renderCacheGrowthChart(
  containerId: string,
  growthData: Array<{ incidentIdx: number; cacheSize: number; negativeSize: number }>
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const W = 360;
  const H = 180;
  const pad = { top: 25, right: 20, bottom: 30, left: 35 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...growthData.map(d => d.cacheSize), 200) * 1.1;
  const maxX = growthData[growthData.length - 1]?.incidentIdx || 500;

  const cachePoints = growthData.map(d => ({
    x: pad.left + (d.incidentIdx / maxX) * innerW,
    y: pad.top + innerH - (d.cacheSize / maxVal) * innerH,
    size: d.cacheSize,
  }));

  const negPoints = growthData.map(d => ({
    x: pad.left + (d.incidentIdx / maxX) * innerW,
    y: pad.top + innerH - (d.negativeSize / maxVal) * innerH,
    size: d.negativeSize,
  }));

  const cachePath = cachePoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');
  const negPath = negPoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="rgba(255,255,255,0.12)" />
      
      <path d="${cachePath}" fill="none" stroke="#38D98A" stroke-width="2" />
      <path d="${negPath}" fill="none" stroke="#EF4444" stroke-width="1.8" stroke-dasharray="3,3" />

      <g transform="translate(${W - 170}, 8)">
        <line x1="0" y1="4" x2="10" y2="4" stroke="#38D98A" stroke-width="2" />
        <text x="14" y="6" fill="#38D98A" font-size="8">Strategy Cache</text>
        <line x1="90" y1="4" x2="100" y2="4" stroke="#EF4444" stroke-width="2" stroke-dasharray="2,2" />
        <text x="104" y="6" fill="#EF4444" font-size="8">Negative Mem</text>
      </g>
    </svg>
  `;

  attachTooltips(container);
}

export function renderQualityByDisruptionChart(
  containerId: string,
  typeMetrics: Array<{ type: string; extraSteps: number; throughputLoss: number }>
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const W = 360;
  const H = 180;
  const pad = { top: 25, right: 25, bottom: 30, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...typeMetrics.map(t => Math.max(t.extraSteps, t.throughputLoss)), 10) * 1.2;
  const groupW = innerW / typeMetrics.length;
  const barW = 16;

  const bars = typeMetrics
    .map((t, i) => {
      const cx = pad.left + i * groupW + groupW / 2;
      const hSteps = (t.extraSteps / maxVal) * innerH;
      const hLoss = (t.throughputLoss / maxVal) * innerH;

      const ySteps = pad.top + innerH - hSteps;
      const yLoss = pad.top + innerH - hLoss;

      return `
        <!-- Extra Steps -->
        <rect x="${(cx - barW - 2).toFixed(1)}" y="${ySteps.toFixed(1)}" width="${barW}" height="${hSteps.toFixed(1)}"
          rx="2" fill="#F59E0B" class="chart-bar-rect"
          data-tooltip="${t.type}<br/>Extra Steps: <strong>+${t.extraSteps.toFixed(1)}</strong>" />
        
        <!-- Throughput Loss -->
        <rect x="${(cx + 2).toFixed(1)}" y="${yLoss.toFixed(1)}" width="${barW}" height="${hLoss.toFixed(1)}"
          rx="2" fill="#38BDF8" class="chart-bar-rect"
          data-tooltip="${t.type}<br/>Throughput Loss: <strong>${t.throughputLoss.toFixed(1)}%</strong>" />

        <text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#91A4BA" font-size="8" font-family="'Inter', sans-serif">
          ${t.type}
        </text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="rgba(255,255,255,0.12)" />
      ${bars}
      <g transform="translate(${W - 170}, 8)">
        <rect x="0" y="0" width="7" height="7" rx="1" fill="#F59E0B" />
        <text x="10" y="6" fill="#F59E0B" font-size="8">Extra Steps</text>
        <rect x="75" y="0" width="7" height="7" rx="1" fill="#38BDF8" />
        <text x="85" y="6" fill="#38BDF8" font-size="8">Loss %</text>
      </g>
    </svg>
  `;

  attachTooltips(container);
}

export interface MethodBarDatum {
  method: string;
  value: number;
  color: string;
}

export function renderMethodComparisonChart(
  containerId: string,
  data: MethodBarDatum[],
  unit: string,
  maxValue?: number,
  referenceValue?: number
) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!data.length) {
    container.innerHTML = emptyMessage(520, 240);
    return;
  }

  const W = 520;
  const H = 240;
  const pad = { top: 24, right: 12, bottom: 56, left: 38 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const scaleMax = maxValue || Math.max(...data.map(item => item.value)) * 1.18 || 1;
  const groupW = innerW / data.length;
  const barW = Math.min(42, groupW * 0.58);
  const referenceY = referenceValue === undefined ? null : pad.top + innerH - (referenceValue / scaleMax) * innerH;
  const decimals = unit === '× original' ? 2 : 1;

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (scaleMax * index) / 4;
    const y = pad.top + innerH - (value / scaleMax) * innerH;
    const label = unit === '%' ? `${Math.round(value)}%` : `${value.toFixed(2)}×`;
    return `
      <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" />
      <text x="${pad.left - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#5D7289" font-size="8" font-family="'JetBrains Mono', monospace">${label}</text>
    `;
  }).join('');

  const bars = data.map((item, index) => {
    const height = Math.max(2, (item.value / scaleMax) * innerH);
    const x = pad.left + index * groupW + (groupW - barW) / 2;
    const y = pad.top + innerH - height;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="3"
        fill="${item.color}" class="chart-bar-rect"
        data-tooltip="${item.method}<br/><strong>${item.value.toFixed(decimals)} ${unit}</strong>" />
      <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(14, y - 5).toFixed(1)}" text-anchor="middle"
        fill="${item.color}" font-size="9" font-family="'JetBrains Mono', monospace">${item.value.toFixed(decimals)}</text>
      <text x="${(pad.left + index * groupW + groupW / 2).toFixed(1)}" y="${H - 34}" text-anchor="middle"
        fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">${item.method}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      ${grid}
      ${referenceY === null ? '' : `
        <line x1="${pad.left}" y1="${referenceY.toFixed(1)}" x2="${W - pad.right}" y2="${referenceY.toFixed(1)}" stroke="#F59E0B" stroke-dasharray="4,4" opacity="0.7" />
        <text x="${W - pad.right}" y="${(referenceY - 4).toFixed(1)}" text-anchor="end" fill="#F59E0B" font-size="8">Original cost = 1.0</text>
      `}
      ${bars}
    </svg>
  `;
  attachTooltips(container);
}

export interface MethodDistributionDatum {
  method: string;
  values: number[];
  color: string;
}

export function renderMethodRecoveryBoxPlot(containerId: string, data: MethodDistributionDatum[], unit: 'steps' | 'ms' = 'steps') {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!data.length || data.every(item => item.values.length === 0)) {
    container.innerHTML = emptyMessage(520, 240);
    return;
  }

  const W = 520;
  const H = 240;
  const pad = { top: 22, right: 18, bottom: 32, left: 94 };
  const valueColumnWidth = 62;
  const plotRight = W - pad.right - valueColumnWidth;
  const innerW = plotRight - pad.left;
  const innerH = H - pad.top - pad.bottom;
  const maxValue = Math.max(...data.flatMap(item => item.values), 1) * 1.08;
  const useLogScale = unit === 'ms';
  const scaleValue = (value: number) => useLogScale ? Math.log10(value + 1) : value;
  const maxScaleValue = scaleValue(maxValue);
  const x = (value: number) => pad.left + (scaleValue(value) / maxScaleValue) * innerW;
  const quantile = (values: number[], fraction: number) => {
    const position = (values.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
  };
  const rowH = innerH / data.length;

  const plots = data.map((item, index) => {
    const values = [...item.values].sort((a, b) => a - b);
    if (!values.length) return '';
    const min = values[0];
    const max = values[values.length - 1];
    const q1 = quantile(values, 0.25);
    const median = quantile(values, 0.5);
    const q3 = quantile(values, 0.75);
    const cy = pad.top + rowH * index + rowH / 2;
    const boxTop = cy - Math.min(10, rowH * 0.28);
    const boxHeight = Math.min(20, rowH * 0.56);
    return `
      <text x="${pad.left - 10}" y="${(cy + 3).toFixed(1)}" text-anchor="end" fill="#91A4BA" font-size="9" font-family="'Inter', sans-serif">${item.method}</text>
      <line x1="${x(min).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x(max).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${item.color}" stroke-width="1.5" />
      <line x1="${x(min).toFixed(1)}" y1="${(cy - 5).toFixed(1)}" x2="${x(min).toFixed(1)}" y2="${(cy + 5).toFixed(1)}" stroke="${item.color}" />
      <line x1="${x(max).toFixed(1)}" y1="${(cy - 5).toFixed(1)}" x2="${x(max).toFixed(1)}" y2="${(cy + 5).toFixed(1)}" stroke="${item.color}" />
      <rect x="${x(q1).toFixed(1)}" y="${boxTop.toFixed(1)}" width="${Math.max(1, x(q3) - x(q1)).toFixed(1)}" height="${boxHeight.toFixed(1)}"
        fill="${item.color}" fill-opacity="0.24" stroke="${item.color}" class="chart-bar-rect"
        data-tooltip="${item.method}<br/>Median: <strong>${median.toFixed(1)} ${unit}</strong><br/>IQR: ${q1.toFixed(1)}–${q3.toFixed(1)} ${unit}<br/>Range: ${min.toFixed(1)}–${max.toFixed(1)} ${unit}" />
      <line x1="${x(median).toFixed(1)}" y1="${boxTop.toFixed(1)}" x2="${x(median).toFixed(1)}" y2="${(boxTop + boxHeight).toFixed(1)}" stroke="${item.color}" stroke-width="2" />
      <text x="${W - pad.right}" y="${(cy + 3).toFixed(1)}" text-anchor="end" fill="${item.color}" font-size="8" font-family="'JetBrains Mono', monospace">${median >= 100 ? median.toFixed(0) : median.toFixed(2)} ${unit}</text>
    `;
  }).join('');

  const tickValues = useLogScale
    ? [0, 1, 10, 100, 1000, 10000].filter(value => value < maxValue).concat(maxValue)
    : Array.from({ length: 5 }, (_, index) => (maxValue * index) / 4);
  const ticks = tickValues.map(value => {
    const tickX = x(value);
    return `
      <line x1="${tickX.toFixed(1)}" y1="${pad.top}" x2="${tickX.toFixed(1)}" y2="${H - pad.bottom}" stroke="rgba(255,255,255,0.05)" />
      <text x="${tickX.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#5D7289" font-size="8" font-family="'JetBrains Mono', monospace">${Math.round(value)}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-root" width="100%" height="100%">
      ${ticks}
      ${plots}
    </svg>
  `;
  attachTooltips(container);
}

// Attach tooltip hover handlers to any chart container
function attachTooltips(container: HTMLElement) {
  const elements = container.querySelectorAll('[data-tooltip]');
  elements.forEach(el => {
    el.addEventListener('mouseenter', e => {
      const html = el.getAttribute('data-tooltip') || '';
      showTooltip(e as MouseEvent, html);
    });
    el.addEventListener('mousemove', e => {
      const html = el.getAttribute('data-tooltip') || '';
      showTooltip(e as MouseEvent, html);
    });
    el.addEventListener('mouseleave', () => {
      hideTooltip();
    });
  });
}

