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
}

export interface LoginResponse {
  accessToken: string;
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

export interface SourceView {
  sourceId: string;
  kind: string;
  name: string;
  status: string;
  webhookUrl: string;
  secret?: string;
  secretNote?: string;
}

export interface SourceListResponse {
  items: Array<Pick<SourceView, "sourceId" | "name" | "status">>;
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

export interface TicketDetail extends TicketRow {
  scope: string[];
  budget: { maxTotalTokens: number } | null;
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
