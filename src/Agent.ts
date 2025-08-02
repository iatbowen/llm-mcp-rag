import MCPClient from './MCPClient'
import ChatOpenAI from './ChatOpenAI'
import { logTitle } from './utils'

export default class Agent {
  private mcpClients: MCPClient[]
  private llm: ChatOpenAI | null = null
  private model: string
  private systemPrompt: string
  private context: string

  constructor(model: string, mcpClients: MCPClient[], systemPrompt: string = '', context: string = '') {
    logTitle('AGENT')
    console.log('🔧 Agent constructor called with model:', model)
    this.mcpClients = mcpClients
    this.model = model
    this.systemPrompt = systemPrompt
    this.context = context
  }

  async init() {
    logTitle('TOOLS')
    for await (const client of this.mcpClients) {
      await client.init()
    }
    const tools = this.mcpClients.flatMap(client => client.getTools())
    this.llm = new ChatOpenAI(this.model, this.systemPrompt, tools, this.context)
  }

  async close() {
    for await (const client of this.mcpClients) {
      await client.close()
    }
  }

  async invoke(prompt: string) {
    if (!this.llm) throw new Error('Agent not initialized')
    let showToolCalls = false
    for await (const response of this.llm.chat(prompt)) {
      if (response.content) {
        process.stdout.write(response.content)
        continue
      }
      if (response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          const mcp = this.mcpClients.find(client =>
            client.getTools().some((t: any) => t.name === toolCall.function.name)
          )
          if (mcp) {
            showToolCalls = true
            logTitle(`TOOL USE`)
            let params: Record<string, any> = {}
            if (toolCall.function.arguments) {
              params = JSON.parse(toolCall.function.arguments)
            }
            console.log(`call tool: ${toolCall.function.name}`, `params: ${JSON.stringify(params)}`)
            const result = await mcp.callTool(toolCall.function.name, params)
            console.log(`result: ${JSON.stringify(result)}`)
            this.llm.appendToolResult(toolCall.id, JSON.stringify(result))
          } else {
            this.llm.appendToolResult(toolCall.id, 'Tool not found')
          }
        }
        continue
      }
    }
    if (showToolCalls) {
      // 工具调用后,继续对话
      await this.invoke('')
    }
    await this.close()
  }
}
