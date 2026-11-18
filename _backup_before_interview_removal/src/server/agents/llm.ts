import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';
import { env } from '../env';

/**
 * One place for every Claude call. All agents degrade to offline engines when no API key is set,
 * so the platform keeps working (with lower quality) without Claude.
 */
let client: Anthropic | null = null;
export const llmAvailable = () => env.anthropicEnabled;
export function getClaude(): Anthropic {
  client ??= new Anthropic({ maxRetries: 2, timeout: 180_000 });
  return client;
}

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5-2']);
export function fallbackParams(): { betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: 'default' } {
  return FALLBACK_MODELS.has(env.anthropicModel) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
}

export type Effort = 'low' | 'medium' | 'high';

/** Structured extraction: returns the parsed object, or null if Claude declined or the output did not validate. */
export async function structured<T extends z.ZodType>(options: {
  schema: T;
  system: string;
  content: string | Anthropic.Beta.BetaContentBlockParam[];
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<T> | null> {
  const response = await getClaude().beta.messages.parse({
    model: env.anthropicModel,
    max_tokens: options.maxTokens ?? 16000,
    ...fallbackParams(),
    system: options.system,
    output_config: { format: betaZodOutputFormat(options.schema), effort: options.effort ?? 'medium' },
    messages: [{ role: 'user', content: options.content }],
  });
  if (response.stop_reason === 'refusal') {
    console.warn('[sanad-llm] request declined', response.stop_details?.category ?? '');
    return null;
  }
  if (response.stop_reason === 'max_tokens') console.warn('[sanad-llm] output hit max_tokens; result may be incomplete');
  return (response.parsed_output ?? null) as z.infer<T> | null;
}

export function describeLlmError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'invalid_api_key';
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (error instanceof Anthropic.BadRequestError) return `bad_request: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `api_error_${error.status ?? 'unknown'}`;
  return error instanceof Error ? error.message : String(error);
}
