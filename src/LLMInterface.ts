export interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

export interface LLMInterface {
  chat(prompt?: string): AsyncGenerator<{ content: string; toolCalls: ToolCall[] }>
  appendToolResult(toolCallId: string, toolOutput: string): void
  appendMessage(
    role: 'user' | 'assistant' | 'tool' | 'system' | 'developer',
    content: string,
    tool_calls?: ToolCall[]
  ): void
}
