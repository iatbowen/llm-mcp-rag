import OpenAI from 'openai'
import { Tool } from '@modelcontextprotocol/sdk/types.js'
import 'dotenv/config'
import { logTitle } from './utils'
import { LLMInterface, ToolCall } from './LLMInterface'

export default class ChatOpenAI implements LLMInterface {
  private llm: OpenAI
  private model: string
  private messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  private tools: Tool[]

  constructor(model: string, systemPrompt: string = '', tools: Tool[] = [], context: string = '') {
    this.llm = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    })
    this.model = model
    this.tools = tools
    if (systemPrompt) this.messages.push({ role: 'system', content: systemPrompt })
    if (context) this.messages.push({ role: 'user', content: context })
  }

  async *chat(prompt?: string): AsyncGenerator<{ content: string; toolCalls: ToolCall[] }> {
    logTitle('CHAT')
    try {
      if (prompt) {
        this.messages.push({ role: 'user', content: prompt })
      }
      const stream = await this.llm.chat.completions.create({
        model: this.model,
        messages: this.messages,
        stream: true,
        tools: this.getToolsDefinition(),
      })
      console.log('processing data...', JSON.stringify(stream))
      for await (const message of this.fromChatResponse(stream)) {
        if (message.content) {
          yield { content: message.content?.toString() || '', toolCalls: [] }
          continue
        }
        if (message.toolCalls && message.toolCalls.length > 0) {
          console.log('\ntoolCalls:', message.toolCalls)
          this.appendMessage('assistant', '', message.toolCalls)
          yield { content: '', toolCalls: message.toolCalls }
          continue
        }
      }
    } catch (error: any) {
      logTitle('CHAT ERROR')
      console.error(error)
      yield { content: '', toolCalls: [] }
    } finally {
      logTitle('CHAT END')
    }
  }

  async *fromChatResponse(
    stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
  ): AsyncGenerator<{ content: string; toolCalls: ToolCall[] }> {
    let toolCalls: { [key: number]: ToolCall } = {}
    for await (const chunk of stream) {
      // 检查 choices 是否存在且有效
      if (!chunk.choices || chunk.choices.length === 0) {
        console.warn('Warning: Invalid chunk.choices detected:', chunk.choices)
        continue
      }
      const delta = chunk.choices[0].delta
      // 处理普通Content - 立即返回
      if (delta.content) {
        yield { content: delta.content, toolCalls: [] }
        continue
      }
      // 处理ToolCall - 累积数据，不立即返回
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        for (const toolCallChunk of delta.tool_calls) {
          if (toolCallChunk.index === undefined) {
            console.warn('Warning: toolCallChunk.index is undefined')
            continue
          }
          // 使用 index 作为键
          if (!toolCalls[toolCallChunk.index]) {
            toolCalls[toolCallChunk.index] = {
              id: '',
              function: { name: '', arguments: '' },
            }
          }
          let currentCall = toolCalls[toolCallChunk.index]
          if (toolCallChunk?.id) {
            currentCall.id = toolCallChunk?.id || ''
          }
          if (toolCallChunk?.function?.name) {
            currentCall.function.name = toolCallChunk?.function?.name || ''
          }
          if (toolCallChunk?.function?.arguments) {
            currentCall.function.arguments += toolCallChunk?.function?.arguments || ''
          }
        }
      }
    }

    const sortToolCalls = Object.keys(toolCalls)
      .map(key => parseInt(key))
      .sort((a, b) => a - b)
      .map(index => toolCalls[index])
    yield {
      content: '',
      toolCalls: sortToolCalls.map((tool_call: ToolCall) => ({
        id: tool_call.id,
        function: {
          name: tool_call.function.name,
          arguments: tool_call.function.arguments,
        },
      })),
    }
  }

  public appendToolResult(toolCallId: string, toolOutput: string) {
    this.messages.push({
      role: 'tool',
      content: toolOutput,
      tool_call_id: toolCallId,
    })
  }
  public appendMessage(
    role: 'user' | 'assistant' | 'tool' | 'system' | 'developer',
    content: string,
    tool_calls: ToolCall[] = []
  ) {
    const message: any = { role, content }
    if (role === 'assistant' && tool_calls.length > 0) {
      message.tool_calls = tool_calls.map(tool_call => ({
        id: tool_call.id,
        type: 'function',
        function: {
          name: tool_call.function.name,
          arguments: tool_call.function.arguments,
        },
      }))
    }
    this.messages.push(message)
  }

  private getToolsDefinition(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))
  }
}
