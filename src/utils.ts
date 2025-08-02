import chalk from 'chalk'

export function logTitle(message: string) {
  const totalLength = 120
  const messageLength = message.length
  const padding = Math.max(0, totalLength - messageLength - 4) // 4 for the "=="
  const paddedMessage = `${'='.repeat(Math.floor(padding / 2))} ${message} ${'='.repeat(Math.ceil(padding / 2))}`
  console.log('\n')
  console.log(chalk.bold.cyanBright(paddedMessage))
}
