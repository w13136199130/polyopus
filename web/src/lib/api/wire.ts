/**
 * Wire-accurate types for what the backend serves TODAY.
 *
 * The generated contract (./generated.ts) is the v1.0 shape; where the live
 * API differs (camelCase payload subsets, missing refreshToken, SSE frames),
 * the honest type lives here. When backend and contract converge, delete the
 * corresponding entry (docs/49 §7.1).
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SessionUser {
  userId: string;
  tenantId: string;
  username: string;
  displayName: string;
  isOwner: boolean;
  roles?: string[];
  permissions?: string[];
  mfaEnabled?: boolean;
  notificationPrefs?: Record<string, boolean>;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: SessionUser;
}

export interface ThreadSettings {
  /** Model name hint honored by the engine on the next turn. */
  model?: string;
  /** Knowledge bases whose top hits are injected as grounded context. */
  kbIds?: string[];
  /** Connector instances attached to this conversation (metadata today). */
  connectorIds?: string[];
  /** Published experts offered as sub-agents for this conversation. */
  subagentIds?: string[];
  /** Composer run mode for the next turn. */
  mode?: "act" | "ask" | "plan";
  /** "ask" opens an approval card; "auto" upgrades ask -> allow (deny wins). */
  approvalPolicy?: "ask" | "auto";
  /** Tool keys the user allowed for this whole conversation. */
  approvedTools?: string[];
}

export interface Thread {
  threadId: string;
  title: string;
  status: string;
  lastMessageAt: number;
  unreadCount: number;
  createdAt: number;
  agentId?: string | null;
  agentVersionId?: string | null;
  pinned?: boolean;
  branchOf?: string | null;
  /** Latest visible message, one line; shown under the title in the rail. */
  preview?: string | null;
  settings?: ThreadSettings;
}

export interface ModelRow {
  modelId: string;
  name: string;
  provider: string;
  configured: boolean;
}

export interface ModelListResponse {
  source: "env" | "registry" | "fake";
  defaultModel: string;
  items: ModelRow[];
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  modified: number;
  children?: WorkspaceEntry[];
}

export interface WorkspaceTree {
  root: string;
  path: string;
  items: WorkspaceEntry[];
  truncated: boolean;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  size: number;
}

/** One row of GET /threads/{id}/trace (raw event tail for the Dock). */
export interface TraceEvent {
  seq: number;
  type: string;
  ts: number;
  turnId?: string | null;
  runId?: string | null;
  payload: Record<string, unknown>;
}

export interface ThreadListResponse {
  items: Thread[];
}

export interface MessageBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface Message {
  messageId: string;
  threadId: string;
  turnId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Structured blocks (text + reasoning); older rows only have content. */
  blocks?: MessageBlock[];
  status: string;
  seq: number;
  createdAt: number;
}

export interface MessageListResponse {
  items: Message[];
}

export interface PostTurnResponse {
  turnId: string;
  messageId: string;
  status: string;
}

/** Live SSE frame from GET /threads/{id}/events (subset of the v1.0 envelope). */
export interface WireEvent {
  seq: number;
  type: string;
  ts: number;
  turnId?: string;
  payload?: Record<string, unknown>;
}

export interface AttentionItem {
  attentionId: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  payload: Record<string, unknown>;
  status: string;
  turnId: string;
  ticketId: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface AttentionListResponse {
  items: AttentionItem[];
}

export interface AnswerResponse {
  attentionId: string;
  status: string;
  decision: string;
}

export interface CronJobView {
  cronJobId: string;
  sourceId: string;
  sourceName: string | null;
  sourceStatus: string | null;
  name: string;
  schedule: string;
  timezone: string;
  text: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  createdAt: number;
}

export interface CronRunRow {
  runId: string;
  status: string;
  scheduledAt: number;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  triggerId: string | null;
}

export interface ChannelRow {
  channelId: string;
  kind: string;
  displayName: string;
  status: string;
  appId: string | null;
  sourceId: string | null;
  approvers: string[];
  credentialsSet: {
    appSecret: boolean;
    verificationToken: boolean;
    encryptKey: boolean;
  };
  webhookPath: string;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelListResponse {
  items: ChannelRow[];
  supported: string[];
}

export interface SourceView {
  sourceId: string;
  kind: string;
  name: string;
  status: string;
  webhookUrl?: string;
  secret?: string;
  secretNote?: string;
  createdAt?: number;
  callbackUrl?: string | null;
  assessment?: string;
  replyStyle?: string;
  allowActors?: string[];
  explicitPatterns?: string[];
  schedule?: CronJobView | null;
}

export interface SourceListResponse {
  items: SourceView[];
}

export interface CronJobListResponse {
  items: CronJobView[];
}

export interface WebhookAccepted {
  disposition: string;
  ticketId?: string;
  triggerId?: string;
  duplicate?: boolean;
}

export interface TicketRow {
  ticketId: string;
  title: string;
  state: string;
  bucket: string;
  strength: string;
  sourceId: string | null;
  createdAt: number;
  sourceName?: string | null;
  sourceKind?: string | null;
  actor?: { id: string; name: string } | null;
  executor?: string | null;
  policyVersion?: number;
  /** 0..100, from the latest assignment. */
  progress?: number;
  summary?: string;
  reportState?: string | null;
  costMicros?: number;
}

export interface TicketListResponse {
  items: TicketRow[];
}

export interface TicketCounts {
  attention: number;
  running: number;
  queued: number;
  done: number;
}

export interface TicketTimelineItem {
  id: string;
  at: string;
  kind: string;
  title: string;
  description?: string;
  actor: { id: string; name: string };
  tone: string;
  link?: Record<string, unknown>;
}

export interface TicketTimelineResponse {
  items: TicketTimelineItem[];
}

export interface TicketArtifact {
  artifactId: string;
  kind: string;
  ref: string;
  mime: string | null;
  size: number;
  createdAt: number;
}

export interface TicketDetail extends TicketRow {
  instruction: string;
  scope: string[];
  /** The mandate budget is returned as stored, i.e. snake_case keys. */
  budget: {
    maxTotalTokens?: number;
    maxCostMicros?: number;
    max_total_tokens?: number;
    max_cost_micros?: number;
  } | null;
  costMicros?: number;
  report: { state: string; summary: string; facts: Record<string, unknown> } | null;
  artifacts?: TicketArtifact[];
}

export interface UsageSummaryItem {
  bucket: string;
  group: string;
  key: string;
  model?: string | null;
  agentId?: string | null;
  day?: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costMicros: number;
  currency: string;
}

export interface UsageSummaryResponse {
  window: string;
  groupBy: "model" | "agent" | "day";
  rangeDays: number | null;
  startTs: number;
  endTs: number;
  items: UsageSummaryItem[];
  byDay: UsageSummaryItem[];
  byAgent: UsageSummaryItem[];
  byModel: UsageSummaryItem[];
  totals: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costMicros: number;
  };
  totalCostMicros: number;
}

export interface AdminOverview {
  generatedAt: number;
  health: {
    activeSessions: number;
    queueDepth: number;
    runningTurns: number;
    openAttentions: number;
    runs24h: number;
    failedRuns24h: number;
    errorRate: number;
    p95LatencyMs: number | null;
  };
  tickets: { attention: number; running: number; queued: number; done: number };
  usage: { todayTokens: number; todayCostMicros: number };
  backup: {
    backupId: string;
    status: string;
    createdAt: number;
    sizeBytes: number;
  } | null;
  recentAudit: Array<{
    action: string;
    actorId: string | null;
    result: string;
    resourceType: string | null;
    resourceId: string | null;
    createdAt: number;
  }>;
  recentTickets: Array<{
    ticketId: string;
    title: string;
    bucket: string;
    createdAt: number;
  }>;
}

export interface ProviderModelRow {
  modelId: string;
  name: string;
  enabled: boolean;
  caps: Record<string, unknown>;
}

export interface ProviderRow {
  providerId: string;
  name: string;
  kind: string;
  baseUrl: string;
  status: string;
  configured: boolean;
  models: ProviderModelRow[];
  updatedAt: number;
}

export interface ProviderListResponse {
  env: {
    configured: boolean;
    modelName: string | null;
    baseUrl: string | null;
    note: string;
  };
  items: ProviderRow[];
}

export interface StorageSnapshot {
  db: { path: string; bytes: number };
  data: { path: string; bytes: number; files: number };
  workspace: { path: string; bytes: number; files: number };
  backups: { path: string; bytes: number; files: number };
  backend: string;
  remoteBackends: Array<{ kind: string; label: string; status: string }>;
  note: string;
}

export interface SecurityRule {
  rid: string;
  priority: number;
  when: Record<string, unknown>;
  effect: "allow" | "ask" | "deny";
}

export interface SecurityToolRow {
  toolKey: string;
  risk: string;
  sideEffects: boolean;
  scopes: string[];
  enabledGlobal: boolean;
  requiredScope: string | null;
}

export interface SecuritySnapshot {
  policy: {
    version: number | null;
    source: string;
    rules: SecurityRule[];
    history: Array<{
      version: number;
      status: string;
      createdBy: string | null;
      createdAt: number;
      activatedAt: number | null;
    }>;
  };
  tools: SecurityToolRow[];
  posture: {
    workspaceDir: string;
    workspaceJail: boolean;
    fileWriteApproval: string;
    auditRetentionDays: number;
    pluginSignature: string;
    mfa: string;
    commandGuard: string;
    sensitiveInfoScan: string;
    skillScan: string;
  };
}

export interface BackupAutoSettings {
  autoEnabled: boolean;
  intervalHours: number;
  retentionCount: number;
  includes: Record<string, boolean>;
}

export interface AdminUserRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  email: string | null;
  tenantId: string;
  status: string;
  isOwner: boolean;
  roles: string[];
  role: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AdminUserListResponse {
  items: AdminUserRow[];
}

export interface InviteRow {
  id: string;
  inviteId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: number;
  createdAt: number;
  token?: string;
}

export interface InviteListResponse {
  items: InviteRow[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  builtin: boolean;
  permissions: string[];
}

export interface NotificationRow {
  id: string;
  notificationId: string;
  kind: "task" | "cloud" | "export" | "system";
  title: string;
  body: string | null;
  link: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface NotificationListResponse {
  items: NotificationRow[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface AgentSubagentRow {
  agentId: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "disabled";
  model: string | null;
}

export interface AgentRow {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "disabled";
  version: number;
  model: string | null;
  tools: string[];
  systemPrompt: string;
  draftSystemPrompt?: string;
  draftModel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
}

export interface AgentListResponse {
  items: AgentRow[];
  templates: AgentTemplate[];
}

export interface TeamMemberRow {
  agentId: string;
  name: string;
  role: "lead" | "member";
  status: "draft" | "published" | "disabled";
  version: number;
}

/** v1.1 orchestration slice 1: persisted team roster (read-only in the UI). */
export interface TeamRow {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  memberCount: number;
  members: TeamMemberRow[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface TeamListResponse {
  items: TeamRow[];
}

export interface ToolRow {
  toolKey: string;
  source: string;
  version: string;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
  sideEffects: boolean;
  idempotent: boolean;
  scopes: string[];
  enabledGlobal: boolean;
  inputSchema: Record<string, unknown>;
}

export interface AgentToolBinding {
  toolKey: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface KnowledgeBaseRow {
  kbId: string;
  name: string;
  description: string | null;
  status: string;
  docCount: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeDocRow {
  docId: string;
  kbId: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  status: string;
  chunkCount: number;
  createdAt: number;
}

export interface KnowledgeHit {
  chunkId: string;
  doc: string;
  heading: string | null;
  span: [number, number];
  score: number;
  content: string;
}

export interface KnowledgeSearchResult {
  status: "ok" | "abstain";
  kb?: { kbId: string; name: string };
  hits: KnowledgeHit[];
  reason?: string;
}

export interface ConnectorCatalogRow {
  catalogId: string;
  kind: string;
  name: string;
  authKind: string;
  category: string | null;
}

export interface ConnectorInstanceRow {
  instanceId: string;
  kind: string;
  displayName: string;
  authKind: string;
  status: string;
  ownerId: string;
  shared: boolean;
  defaultOpen: boolean;
  toolsCount: number;
  lastProbeAt: number | null;
  configured: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorToolRow {
  toolKey: string;
  wireName: string;
  server: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled?: boolean;
}

export interface PluginRow {
  pluginId: string;
  name: string;
  version: string;
  apiVersion: string;
  status: "installed" | "enabled" | "disabled" | "failed";
  permissions: string[];
  tools: string[];
  signed: boolean;
  installedAt: number;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface AdminSettings {
  environment: string;
  version: string;
  modelName: string | null;
  modelConfigured: boolean;
  dataDir: string;
  workspaceDir: string;
  publicBaseUrl: string;
  auditRetentionDays: number;
  dailyCostBudgetMicros: number;
  readOnly: boolean;
}

export interface QuotaRow {
  quotaId: string;
  scope: "tenant" | "user" | "model";
  scopeId: string;
  metric: "tokens" | "cost" | "requests";
  limit: number;
  window: "day" | "month" | "absolute";
}

export interface AuditRow {
  auditId: string;
  createdAt: number;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: string;
  ticketId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  traceId: string | null;
}

export interface BackupRow {
  backupId: string;
  kind: string;
  checksum: string;
  sizeBytes: number;
  auto: boolean;
  status: string;
  createdAt: number;
  restoredAt: number | null;
}

export interface DataJobRow {
  jobId: string;
  kind: "export" | "delete";
  status: string;
  progress: number;
  storageRef: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}
