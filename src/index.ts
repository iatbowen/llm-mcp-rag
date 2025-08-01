import MCPClient from './MCPClient'
import Agent from './Agent'
import path from 'path'
import EmbeddingRetriever from './EmbeddingRetriever'
import fs from 'fs'
import { logTitle } from './utils'

const outPath = path.join(process.cwd(), 'output')
const TASK = `
告诉我Bret的信息,先从我给你的context中找到相关信息,总结后创作一个关于她的故事
把故事和她的基本信息保存到${outPath}/Bret.md,输出一个漂亮md文件
`
const ContentTask = `
爬取 https://jsonplaceholder.typicode.com/users 的内容,分别提取出每个人的基本信息, 自动保存到${outPath}/users 的文件夹中, 要求为md文件
`

const fetchMCP = new MCPClient('mcp-server-fetch', 'uvx', ['mcp-server-fetch'])
const fileMCP = new MCPClient('mcp-server-file', 'npx', ['-y', '@modelcontextprotocol/server-filesystem', outPath])

// 付费模型 openrouter
// async function main() {
//   // RAG
//   const context = await retrieveContext()
//   // Agent
//   const agent = new Agent('deepseek/deepseek-r1-0528', [fetchMCP, fileMCP], '', context)
//   // const agent = new Agent('openai/gpt-4o-mini', [fetchMCP, fileMCP], '', context)

//   await agent.init()
//   await agent.invoke(TASK)
//   await agent.close()
// }

// // 免费模型 openrouter
// async function main() {
//   console.log('🚀 Starting main function...')
//   const context =
//     'Antonette is a woman who lives in a small town in the mountains. She is 30 years old and works as a teacher. She is married to a man named John and has two children, a son named James and a daughter named Emily. She is a very kind and caring person and is loved by all who know her.'
//   // Agent
//   // const agent = new Agent('deepseek/deepseek-chat-v3-0324:free', [fetchMCP, fileMCP], '', context)
//   // const agent = new Agent('qwen/qwen3-235b-a22b:free', [fetchMCP, fileMCP], '', context)
//   // const agent = new Agent('qwen/qwen3-coder:free', [fetchMCP, fileMCP], '', context)
//   // const agent = new Agent('google/gemini-2.0-flash-exp:free', [fetchMCP, fileMCP], '', context)
//   const agent = new Agent('moonshotai/kimi-k2:free', [fetchMCP, fileMCP], '', context)
//   await agent.init()
//   await agent.invoke(TASK)
//   await agent.close()
// }

// 使用本地模型
async function main() {
  console.log('🚀 Starting main function...')
  const context = await retrieveContext()
  // Agent - 使用本地模型
  const agent = new Agent('qwen2.5:7b', [fetchMCP, fileMCP], '', context)
  await agent.init()
  await agent.invoke(TASK)
  await agent.close()
}

// 爬取内容
// async function main() {
//   console.log('🚀 Starting main function...')
//   const agent = new Agent('deepseek/deepseek-chat', [fetchMCP, fileMCP])
//   await agent.init()
//   await agent.invoke(ContentTask)
//   await agent.close()
// }

main()

async function retrieveContext() {
  // RAG
  const embeddingRetriever = new EmbeddingRetriever('BAAI/bge-m3')
  const usersDir = path.join(outPath, 'users')
  const files = fs.readdirSync(usersDir)
  for await (const file of files) {
    const content = fs.readFileSync(path.join(usersDir, file), 'utf-8')
    await embeddingRetriever.embedDocument(content)
  }
  const context = (await embeddingRetriever.retrieve(TASK, 3)).join('\n')
  logTitle('CONTEXT')
  console.log(context)
  return context
}
