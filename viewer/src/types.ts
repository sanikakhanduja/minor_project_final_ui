// Replay schema as written by amr_repair/replay/models.py. Optional fields arrive as null, not missing.

export type Cell = [number, number];
export type RobotState = 'moving' | 'idle' | 'delayed' | 'failed' | 'replanning';

export interface Meta {
  seed: number;
  mode: 'llm' | 'baseline_pibt' | 'baseline_lns' | 'baseline_pbs';
  map_name: string;
  steps: number;
}

export interface MapData {
  width: number;
  height: number;
  obstacles: Cell[];
}

export interface Frame {
  t: number;
  pos: Cell[];
  state: RobotState[];
  goals?: Cell[] | null; // only present in real pipeline runs
}

export interface Disruption {
  type: 'blocked_cell' | 'robot_failure' | 'robot_delay';
  cells?: Cell[];
  robot?: number | null;
  k_steps?: number | null;
}

export interface Congestion {
  level: 'low' | 'medium' | 'high';
  region: [Cell, Cell];
  density?: number | null;
}

export interface CacheResult {
  hit: boolean;
  matched?: string | null;
  similarity?: number | null;
}

export interface DryRunResult {
  ran: boolean;
  valid: boolean;
  violation?: string | null;
}

export interface Directive {
  robots: number[];
  solver: 'pibt' | 'lns' | 'windowed_pbs';
  priority: number[];
  horizon: number;
  rationale?: string | null;
}

export interface LLMResult {
  called: boolean;
  latency_ms?: number | null;
  tokens?: number | null;
  directive?: Directive | null;
}

export interface ValidatorAttempt {
  attempt: number;
  valid: boolean;
  violation?: string | null;
}

export interface PathsData {
  invalidated: Record<string, Cell[]>;
  repaired: Record<string, Cell[]>;
}

export interface IncidentOutcome {
  recovery_steps: number;
  cost_delta: number;
}

export interface Incident {
  id: string;
  t_detected: number;
  disruptions: Disruption[];
  affected_robots: number[];
  congestion: Congestion;
  interacts_with: string[];
  cache?: CacheResult | null;
  dry_run?: DryRunResult | null;
  llm?: LLMResult | null;
  validator: ValidatorAttempt[];
  fallback_used: boolean;
  executed_at: number;
  paths: PathsData;
  outcome: IncidentOutcome;
}

export interface Metrics {
  repair_success_rate: number;
  mean_recovery_steps: number;
  cost_delta_pct: number;
  llm_calls: number;
  llm_tokens: number;
  cache_hits: number;
  // Present only in real pipeline runs.
  sum_of_costs_delta?: number;
  makespan_delta?: number;
  llm_calls_avoided?: number;
  mean_llm_latency_ms?: number;
  cache_lookups?: number;
  cache_misses?: number;
  cache_hit_rate_pct?: number;
  dry_run_successes?: number;
  dry_run_failures?: number;
  verified_cache_reuse_count?: number;
  verified_reuse_rate_pct?: number;
  cache_insertions?: number;
  cache_evictions?: number;
  mean_solver_latency_ms?: number;
  mean_validator_latency_ms?: number;
  mean_total_repair_latency_ms?: number;
  safety_violations_intercepted?: number;
  executed_safety_violations?: number;
  failed_repair_attempts?: number;
  fallback_invocations?: number;
  emergency_holds?: number;
  incidents_total?: number;
  incidents_by_type?: Record<string, number>;
  incidents_isolated?: number;
  incidents_interacting?: number;
}

export interface Replay {
  meta: Meta;
  map: MapData;
  frames: Frame[];
  incidents: Incident[];
  metrics: Metrics;
}
