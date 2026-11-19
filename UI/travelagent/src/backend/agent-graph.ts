import type { AIMessage } from '@langchain/core/messages'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const State = Annotation.Root({
  response: Annotation<AIMessage>(),
  awaitingUser: Annotation<boolean>(),
})

/** Execution stays sequential: command review, approvals and tool dependencies share this path. */
export async function runAgentGraph(options: {
  signal: AbortSignal
  model: () => Promise<AIMessage>
  tools: (response: AIMessage) => Promise<boolean | void>
}) {
  const pending = new Set<Promise<unknown>>()
  async function tracked<T>(work: () => Promise<T>) {
    const task = work()
    pending.add(task)
    try {
      return await task
    } finally {
      pending.delete(task)
    }
  }
  const graph = new StateGraph(State)
    .addNode('model', async () => {
      options.signal.throwIfAborted()
      return { response: await tracked(options.model) }
    })
    .addNode('tools', async ({ response }) => {
      options.signal.throwIfAborted()
      return { awaitingUser: (await tracked(() => options.tools(response))) === true }
    })
    .addEdge(START, 'model')
    .addConditionalEdges('model', ({ response }) => (response.tool_calls?.length ? 'tools' : END))
    .addConditionalEdges('tools', ({ awaitingUser }) => (awaitingUser ? END : 'model'))
    .compile()
  // Preserve user-controlled stopping, including legitimate runs longer than 25 steps.
  try {
    await graph.invoke({}, { signal: options.signal, recursionLimit: Number.MAX_SAFE_INTEGER })
  } finally {
    // LangGraph can reject immediately on abort while a node is still cleaning up.
    // Drain it before releasing the session lock, closing MCP or accepting a new turn.
    await Promise.allSettled(pending)
  }
}
