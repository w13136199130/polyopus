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
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: SessionUser;
}

export interface Thread {
  threadId: string;
  title: string;
  status: string;
  lastMessageAt: number;
  unreadCount: number;
  createdAt: number;
}

export interface ThreadListResponse {
  items: Thread[];
}

export interface Message {
  messageId: string;
  threadId: string;
  turnId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
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

export interface TicketDetail extends TicketRow {
  scope: string[];
  budget: { maxTotalTokens?: number; maxCostMicros?: number } | null;
  costMicros?: number;
  report: { state: string; summary: string; facts: Record<string, unknown> } | null;
}

export interface UsageSummaryItem {
  bucket: string;
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costMicros: number;
  currency: string;
}

export interface UsageSummaryResponse {
  window: string;
  startTs: number;
  endTs: number;
  items: UsageSummaryItem[];
  totalCostMicros: number;
}

export interface AdminUserRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
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
