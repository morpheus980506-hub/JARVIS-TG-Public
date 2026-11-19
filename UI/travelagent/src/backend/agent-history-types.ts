/** Stable on-disk schema, independent of the model orchestration library. */
import type { Attachment } from '../shared'
type TextPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; signature?: string }
type ProviderPart = { type: 'provider-content'; block: { type: string; [key: string]: unknown } }
type ToolCall = {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}
type ToolResult = {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: { type: 'text'; value: string } | { type: 'json'; value: unknown }
}
export type ModelMessage =
  | { role: 'user'; content: string; attachments?: Attachment[] }
  | { role: 'system'; content: string }
  | { role: 'assistant'; content: string | (TextPart | ToolCall | ProviderPart)[] }
  | { role: 'tool'; content: ToolResult[] }
