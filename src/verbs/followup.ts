import { registerVerb } from '../verbs.ts'
import { followupCommand } from '../followup-cli.ts'

registerVerb({
  name: 'followup',
  summary: 'followup <ticket> --class plan|build --found review|after-merge --why ".." [--catchable yes|no] [--of n] | --list   record a request to change a done ticket (#werk-cli-followup)',
  run: ({ positional, flags, actor }) => followupCommand(positional, flags, actor),
})
