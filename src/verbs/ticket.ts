import { registerVerb } from '../verbs.ts'
import { ticketCommand } from '../ticket-cli.ts'

registerVerb({
  name: 'ticket',
  summary: 'ticket list|move|archive|restore|import   the agent\'s side of the board (#werk-board-control)',
  run: ({ positional, flags, actor }) => ticketCommand(positional, flags, actor),
})
