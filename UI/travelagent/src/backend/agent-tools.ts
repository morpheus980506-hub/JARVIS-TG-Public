import { tool } from '@langchain/core/tools'
import { toJsonSchema, type JSONSchema } from '@langchain/core/utils/json_schema'
import { z } from 'zod'

export interface AgentTool {
  description?: string
  inputSchema: z.ZodType | JSONSchema
  execute: (input: any, options?: any) => any
}

export function defineTool<T extends z.ZodType>(descriptor: {
  description: string
  inputSchema: T
  execute: (input: z.infer<T>, options?: any) => any
}) {
  return descriptor
}

export function toolSchemaSize(tools: Record<string, AgentTool>) {
  return Buffer.byteLength(
    JSON.stringify(
      Object.entries(tools).map(([name, descriptor]) => ({
        name,
        description: descriptor.description,
        parameters: toJsonSchema(descriptor.inputSchema, { unrepresentable: 'any' }),
      })),
    ),
    'utf8',
  )
}

/** Let LangChain validate JSON Schema without converting or dropping MCP constraints. */
export async function parseToolInput(descriptor: AgentTool, input: Record<string, unknown>) {
  const schema = descriptor.inputSchema
  if ('parseAsync' in schema && typeof schema.parseAsync === 'function') {
    return schema.parseAsync(input)
  }
  return tool((args) => args, {
    name: 'validate_tool_input',
    description: 'Validate tool arguments',
    schema,
  }).invoke(input)
}

/** Bind schemas only: graph execution must always pass through tracing and command review. */
export function bindAgentTools(tools: Record<string, AgentTool>) {
  return Object.entries(tools).map(([name, descriptor]) =>
    tool(
      () => {
        throw new Error('工具必须由 Agent 调度器执行')
      },
      { name, description: descriptor.description || name, schema: descriptor.inputSchema },
    ),
  )
}
