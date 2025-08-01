import OpenAI from 'openai'
import { Tool } from '@modelcontextprotocol/sdk/types.js'
import 'dotenv/config'
import { logTitle } from './utils'

export interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

export default class ChatOpenAI {
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

  async chat(prompt?: string): Promise<{ content: string; toolCalls: ToolCall[] }> {
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

      let content = ''
      let toolCalls: { [key: number]: ToolCall } = {}
      logTitle('STREAM')
      for await (const chunk of stream) {
        // 检查 choices 是否存在且有效
        if (!chunk.choices || chunk.choices.length === 0) {
          console.warn('Warning: Invalid chunk.choices detected:', chunk.choices)
          continue
        }
        const delta = chunk.choices[0].delta

        // 处理普通Content
        if (delta.content) {
          const contentChunk = delta.content || ''
          content += contentChunk
          process.stdout.write(contentChunk)
        }
        // 处理ToolCall
        if (delta.tool_calls && delta.tool_calls.length > 0) {
          for (const toolCallChunk of delta.tool_calls) {
            if (toolCallChunk.index === undefined) {
              console.warn('Warning: toolCallChunk.index is undefined')
              continue
            }
            // 使用 index 作为键
            if (!toolCalls[toolCallChunk.index]) {
              toolCalls[toolCallChunk.index] = { id: '', function: { name: '', arguments: '' } }
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
      // 将字典转换为数组，按 index 排序
      const sortToolCalls = Object.keys(toolCalls)
        .map(key => parseInt(key))
        .sort((a, b) => a - b)
        .map(index => toolCalls[index])

      console.log('sortToolCalls', sortToolCalls)

      this.messages.push({
        role: 'assistant',
        content: content,
        tool_calls: sortToolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: call.function,
        })),
      })

      return {
        content: content,
        toolCalls: sortToolCalls,
      }
    } catch (error: any) {
      logTitle('CHAT ERROR')
      console.error(error)
      return {
        content: '',
        toolCalls: [],
      }
    }
  }

  public appendToolResult(toolCallId: string, toolOutput: string) {
    this.messages.push({
      role: 'tool',
      content: toolOutput,
      tool_call_id: toolCallId,
    })
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
