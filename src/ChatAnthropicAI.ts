import OpenAI from 'openai'
import { Tool } from '@modelcontextprotocol/sdk/types.js'
import 'dotenv/config'
import { logTitle } from './utils'
import { LLMInterface, ToolCall } from './LLMInterface'

export default class ChatAnthropicAI implements LLMInterface {
  private model: string
  private messages: any[] = []
  private tools: Tool[]

  constructor(model: string, systemPrompt: string = '', tools: Tool[] = [], context: string = '') {
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
      if (!process.env.aws_bedrock_key || !process.env.aws_bedrock_stream_url) {
        console.log('aws_bedrock_key or aws_bedrock_stream_url environment variable is not defined')
        return { content: '', toolCalls: [] }
      }
      const headers = {
        'Content-Type': 'application/json',
        'api-key': process.env.aws_bedrock_key,
      }
      const body = {
        anthropic_version: 'bedrock-2023-05-31',
        messages: this.messages,
        max_tokens: 1024,
        temperature: 0.9,
        tools: this.getToolsDefinition(),
      }
      try {
        let toolCalls: { [key: number]: ToolCall } = {}
        const response = await fetch(process.env.aws_bedrock_stream_url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
        if (!response.ok) {
          const errorText = await response.text()
          console.error('response error:', errorText)
          return { content: '', toolCalls: [] }
        }
        // Handle streaming response
        const reader = response.body?.getReader()
        if (!reader) {
          console.error('No response body')
          return { content: '', toolCalls: [] }
        }
        const decoder = new TextDecoder()
        let buffer = ''

        console.log('response processing...')

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('stream ended')
            break
          }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.trim() === '') continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.chunk && parsed.chunk.bytes) {
                const chunkData = JSON.parse(atob(parsed.chunk.bytes))
                console.log('Decoded chunk:', chunkData)

                if (chunkData.type === 'message_start') {
                  console.log('message_start:', chunkData.message)
                } else if (chunkData.type === 'message_stop') {
                  console.log('message_stop')
                  let tools = Object.values(toolCalls)
                  if (tools.length > 0) {
                    // Fix incomplete JSON arguments before processing
                    tools = tools.map(tool => {
                      if (tool.function.arguments && !tool.function.arguments.trim().endsWith('}')) {
                        // Try to complete the JSON by adding missing closing braces
                        let fixedArgs = tool.function.arguments.trim()
                        // Count opening and closing braces to see what's missing
                        const openBraces = (fixedArgs.match(/\{/g) || []).length
                        const closeBraces = (fixedArgs.match(/\}/g) || []).length
                        const missingBraces = openBraces - closeBraces
                        if (missingBraces > 0) {
                          // Add missing closing braces
                          fixedArgs += '}'.repeat(missingBraces)
                          console.log(`Fixed incomplete JSON for tool ${tool.id}:`, {
                            original: tool.function.arguments,
                            fixed: fixedArgs,
                          })
                        }
                        tool.function.arguments = fixedArgs
                      }
                      return tool
                    })
                    this.appendMessage('assistant', '', tools)
                    yield { content: '', toolCalls: tools }
                  }
                } else if (chunkData.type === 'message_delta') {
                  console.log('message_delta:', chunkData.delta)
                } else if (chunkData.type === 'content_block_start') {
                  if (chunkData.content_block?.type === 'text') {
                    console.log('text start received index:', chunkData.index)
                  } else if (chunkData.content_block?.type === 'tool_use') {
                    const toolCall = {
                      id: chunkData.content_block.id || '',
                      function: {
                        name: chunkData.content_block.name || '',
                        arguments: '',
                      },
                    }
                    toolCalls[chunkData.index] = toolCall
                  }
                } else if (chunkData.type === 'content_block_stop') {
                  console.log('stop received index:', chunkData.index)
                } else if (chunkData.type === 'content_block_delta') {
                  if (chunkData.delta?.type === 'text_delta') {
                    yield { content: chunkData.delta.text, toolCalls: [] }
                  } else if (chunkData.delta?.type === 'input_json_delta') {
                    toolCalls[chunkData.index].function.arguments += chunkData.delta.partial_json
                  }
                }
              }
            } catch (e) {
              console.log('Error parsing line:', e)
            }
          }
        }
      } catch (error) {
        console.error('请求报错:', error)
        yield { content: '', toolCalls: [] }
      }
    } catch (error: any) {
      logTitle('CHAT ERROR')
      console.error(error)
      yield { content: '', toolCalls: [] }
    } finally {
      logTitle('CHAT END')
    }
  }

  async *invoke(prompt?: string): AsyncGenerator<{ content: string; toolCalls: ToolCall[] }> {
    logTitle('CHAT')
    try {
      if (prompt) {
        this.messages.push({ role: 'user', content: prompt })
      }
      if (!process.env.aws_bedrock_key || !process.env.aws_bedrock_url) {
        console.log('aws_bedrock_key or aws_bedrock_url environment variable is not defined')
        return { content: '', toolCalls: [] }
      }

      const headers = {
        'Content-Type': 'application/json',
        'api-key': process.env.aws_bedrock_key,
      }

      const body = {
        anthropic_version: 'bedrock-2023-05-31',
        messages: this.messages,
        max_tokens: 1024,
        temperature: 0.9,
        tools: this.getToolsDefinition(),
      }

      try {
        const response = await fetch(process.env.aws_bedrock_url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('response error:', errorText)
          return { content: '', toolCalls: [] }
        }

        // Handle non-streaming response
        const responseText = await response.text()
        try {
          const parsed = JSON.parse(responseText)
          console.log('parsed:', parsed)
          // Handle AWS Bedrock Claude format
          if (parsed.content && Array.isArray(parsed.content)) {
            for (const content of parsed.content) {
              if (content.type === 'text') {
                yield { content: content.text, toolCalls: [] }
              } else if (content.type === 'tool_use') {
                const toolCalls = [
                  {
                    id: content.id || '',
                    function: {
                      name: content.name || '',
                      arguments: JSON.stringify(content.input || {}),
                    },
                  },
                ]
                this.appendMessage('assistant', '', toolCalls)
                yield { content: '', toolCalls }
              }
            }
          }
        } catch (e) {
          console.log('Error parsing response:', e)
          yield { content: responseText, toolCalls: [] }
        }
      } catch (error) {
        console.error('请求报错:', error)
        yield { content: '', toolCalls: [] }
      }
    } catch (error: any) {
      logTitle('CHAT ERROR')
      console.error(error)
      yield { content: '', toolCalls: [] }
    } finally {
      logTitle('CHAT END')
    }
  }

  public appendMessage(role: 'user' | 'assistant', content: string, tool_calls: ToolCall[] = []) {
    const message: any = { role, content }
    if (tool_calls.length > 0) {
      const contentArray = []
      for (const tool_call of tool_calls) {
        contentArray.push({
          type: 'tool_use',
          id: tool_call.id,
          name: tool_call.function.name,
          input: JSON.parse(tool_call.function.arguments || '{}'),
        })
      }
      message.content = contentArray
    }
    this.messages.push(message)
  }

  public appendToolResult(toolCallId: string, toolOutput: string) {
    this.messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: toolOutput,
        },
      ],
    })
  }

  private getToolsDefinition(): any[] {
    return this.tools.map(tool => {
      const { inputSchema, ...rest } = tool
      return {
        ...rest,
        input_schema: inputSchema,
      }
    })
  }
}
