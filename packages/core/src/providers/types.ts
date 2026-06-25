import type { ConnectionMode } from "../domain/agent";

/** AI sağlayıcı soyutlaması (PRD §6.3). Faz 1 non-streaming `complete` kullanır. */

export interface CompletionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: CompletionMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
}

export interface CostEstimate {
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AIProviderAdapter {
  readonly id: string;
  readonly connectionMode: ConnectionMode;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  estimateCost(req: CompletionRequest, usage?: TokenUsage): CostEstimate;
  supportsTools(): boolean;
  supportsVision(): boolean;
}
