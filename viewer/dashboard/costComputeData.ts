/**
 * Cost & Compute Data Module
 * Schema & seeded mock generator (500 incidents) for AMR Lifelong MAPF
 * Disruption-Aware Path Repair with Verified Strategy Caching & Deterministic Validation
 */

export const PRICE_PER_1K_TOKENS = 0.0015; // $0.0015 per 1K blended tokens (industry standard for fast reasoning models)

export type DisruptionType = 'blocked_cell' | 'robot_failure' | 'robot_delay';
export type DisruptionMode = 'single' | 'overlapping';
export type SolverType = 'PIBT' | 'LNS' | 'PBS';
export type RunMode = 'with_cache' | 'without_cache';
export type ValidatorMode = 'with_validator' | 'without_validator';
export type ViolationType = 'none' | 'vertex_collision' | 'edge_collision' | 'blocked_cell' | 'deadlock';

export interface CostComputeIncident {
  incident_id: string;
  timestamp: number;
  disruption_type: DisruptionType;
  disruption_mode: DisruptionMode;
  num_disruptions: number;
  cache_hit: boolean;
  dry_run_failed: boolean;
  llm_called: boolean;
  llm_calls_count: number;
  input_tokens: number;
  output_tokens: number;
  llm_latency_ms: number;
  retry_used: boolean;
  fallback_used: boolean;
  solver_used: SolverType;
  solver_runtime_ms: number;
  robots_replanned: number;
  cache_lookup_ms: number;
  detection_ms: number;
  validation_ms: number;
  total_decision_latency_ms: number;
  recovery_time_steps: number;
  extra_steps_due_to_repair: number;
  throughput_loss_pct: number;
  cache_size_at_time: number;
  negative_memory_size_at_time: number;
  run_mode: RunMode;
  validator_mode: ValidatorMode;
  plan_valid_first_try: boolean;
  violations_count: number;
  violation_type: ViolationType;
}

// Seeded PRNG (mulberry32) for reproducible, deterministic benchmark data
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeededMockData(count: number = 500, seed: number = 42): CostComputeIncident[] {
  const rng = mulberry32(seed);
  const incidents: CostComputeIncident[] = [];

  let currentCacheSize = 0;
  let currentNegativeSize = 0;

  const disruptionTypes: DisruptionType[] = ['blocked_cell', 'robot_failure', 'robot_delay'];
  const solvers: SolverType[] = ['PIBT', 'LNS', 'PBS'];

  for (let i = 0; i < count; i++) {
    const id = `inc_${String(i + 1).padStart(4, '0')}`;
    const timestamp = 100 + i * 20 + Math.floor(rng() * 15);

    // Distribution: 40% blocked, 35% delay, 25% failure
    const typeRoll = rng();
    const disruption_type: DisruptionType =
      typeRoll < 0.4 ? 'blocked_cell' : typeRoll < 0.75 ? 'robot_delay' : 'robot_failure';

    // 70% single, 30% overlapping (compounding corridor faults)
    const isOverlapping = rng() < 0.3;
    const disruption_mode: DisruptionMode = isOverlapping ? 'overlapping' : 'single';
    const num_disruptions = isOverlapping ? (rng() < 0.7 ? 2 : 3) : 1;

    // Run mode & Validator mode distribution for comparative analysis
    // 75% standard with_cache / with_validator, 25% control counter-factual runs
    const runModeRoll = rng();
    const run_mode: RunMode = runModeRoll < 0.7 ? 'with_cache' : 'without_cache';

    const valModeRoll = rng();
    const validator_mode: ValidatorMode = valModeRoll < 0.75 ? 'with_validator' : 'without_validator';

    // Cache hit probability curve: rises from 0% cold start to ~60% steady state
    // Sigmoid curve around incident 120
    const targetHitProb = 0.62 / (1 + Math.exp(-0.016 * (i - 120)));
    const candidateHit = run_mode === 'with_cache' && rng() < targetHitProb;

    let cache_hit = false;
    let dry_run_failed = false;

    if (candidateHit) {
      // 5% dry-run failure rate (improper cache match rejected before execution)
      if (rng() < 0.05) {
        dry_run_failed = true;
        cache_hit = false;
      } else {
        cache_hit = true;
        dry_run_failed = false;
      }
    }

    // Solvers: PIBT (60%), LNS (25%), PBS (15%)
    const solverRoll = rng();
    const solver_used: SolverType =
      solverRoll < 0.6 ? 'PIBT' : solverRoll < 0.85 ? 'LNS' : 'PBS';

    const robots_replanned = isOverlapping ? Math.floor(rng() * 5) + 3 : Math.floor(rng() * 3) + 1;

    // Solver runtimes (ms)
    let solver_runtime_ms = 0.1;
    if (solver_used === 'PIBT') {
      solver_runtime_ms = 0.08 + rng() * 0.15;
    } else if (solver_used === 'LNS') {
      solver_runtime_ms = 3.2 + rng() * 3.0;
    } else {
      solver_runtime_ms = 1.6 + rng() * 1.8;
    }

    const detection_ms = 0.06 + rng() * 0.08;
    const cache_lookup_ms = run_mode === 'with_cache' ? 0.7 + rng() * 0.4 : 0;
    const validation_ms = 0.02 + rng() * 0.03; // ~0.03 ms pure deterministic check

    // LLM execution details
    let llm_called = false;
    let llm_calls_count = 0;
    let input_tokens = 0;
    let output_tokens = 0;
    let llm_latency_ms = 0;
    let retry_used = false;
    let fallback_used = false;

    // Plan validity (before validator gate)
    // 19% of initial candidate plans contain collisions or deadlocks
    const initiallyValid = rng() >= 0.19;
    let plan_valid_first_try = initiallyValid;
    let violations_count = 0;
    let violation_type: ViolationType = 'none';

    if (validator_mode === 'with_validator') {
      if (!initiallyValid) {
        // Validator intercepts!
        if (run_mode === 'with_cache' && cache_hit) {
          // If dry-run caught it, cache hit would be false
          // In real execution, dry-run catches world mismatches
        }
        
        // LLM retry
        retry_used = true;
        const retrySuccess = rng() < 0.82; // 82% retry recovery success
        if (retrySuccess) {
          fallback_used = false;
        } else {
          fallback_used = true; // Predefined deterministic fallback ensures safety
        }
      }
      // Zero violations ever reach execution with validator
      violations_count = 0;
      violation_type = 'none';
    } else {
      // Without validator: 15-25% of unvalidated plans execute with collisions/deadlocks!
      if (!initiallyValid) {
        violations_count = rng() < 0.8 ? 1 : 2;
        const vTypes: ViolationType[] = ['vertex_collision', 'edge_collision', 'blocked_cell', 'deadlock'];
        violation_type = vTypes[Math.floor(rng() * vTypes.length)];
      } else {
        violations_count = 0;
        violation_type = 'none';
      }
    }

    if (!cache_hit) {
      llm_called = true;
      llm_calls_count = retry_used ? 2 : 1;
      const baseInput = 480 + Math.floor(rng() * 140);
      const baseOutput = 95 + Math.floor(rng() * 45);
      input_tokens = baseInput * llm_calls_count;
      output_tokens = baseOutput * llm_calls_count;
      llm_latency_ms = (720 + rng() * 220) * (retry_used ? 1.7 : 1.0);

      // Cache growth on successful new solution
      if (run_mode === 'with_cache' && (initiallyValid || retry_used)) {
        if (rng() < 0.45 && currentCacheSize < 190) {
          currentCacheSize += 1;
        }
      }
      if (dry_run_failed && currentNegativeSize < 30) {
        currentNegativeSize += 1;
      }
    }

    // Total decision latency
    const total_decision_latency_ms =
      detection_ms +
      cache_lookup_ms +
      (cache_hit ? 0.35 : llm_latency_ms) + // dry-run ~0.35ms if cache hit
      solver_runtime_ms +
      validation_ms * (retry_used ? 2 : 1);

    // Recovery time steps: maintained whether cached or LLM
    const baseRecovery = disruption_type === 'robot_failure' ? 18 : disruption_type === 'blocked_cell' ? 14 : 12;
    const recovery_time_steps = Math.max(
      6,
      Math.round(baseRecovery + (isOverlapping ? 4 : 0) + (rng() * 4 - 2))
    );

    const extra_steps_due_to_repair = Math.max(1, Math.round(recovery_time_steps * (0.15 + rng() * 0.1)));
    const throughput_loss_pct = Number(
      ((extra_steps_due_to_repair / (recovery_time_steps * 4)) * 100).toFixed(1)
    );

    incidents.push({
      incident_id: id,
      timestamp,
      disruption_type,
      disruption_mode,
      num_disruptions,
      cache_hit,
      dry_run_failed,
      llm_called,
      llm_calls_count,
      input_tokens,
      output_tokens,
      llm_latency_ms: Number(llm_latency_ms.toFixed(1)),
      retry_used,
      fallback_used,
      solver_used,
      solver_runtime_ms: Number(solver_runtime_ms.toFixed(2)),
      robots_replanned,
      cache_lookup_ms: Number(cache_lookup_ms.toFixed(2)),
      detection_ms: Number(detection_ms.toFixed(2)),
      validation_ms: Number(validation_ms.toFixed(2)),
      total_decision_latency_ms: Number(total_decision_latency_ms.toFixed(2)),
      recovery_time_steps,
      extra_steps_due_to_repair,
      throughput_loss_pct,
      cache_size_at_time: currentCacheSize,
      negative_memory_size_at_time: currentNegativeSize,
      run_mode,
      validator_mode,
      plan_valid_first_try,
      violations_count,
      violation_type,
    });
  }

  return incidents;
}

// Single load function that can easily be swapped with real pipeline API/JSON telemetry
let cachedMockData: CostComputeIncident[] | null = null;

export async function loadCostComputeData(): Promise<CostComputeIncident[]> {
  if (!cachedMockData) {
    cachedMockData = generateSeededMockData(500, 42);
  }
  return cachedMockData;
}

