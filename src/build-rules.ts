/**
 * A project's build rules: the decided cards under its build-rules top card (#st-build-howto).
 * werk adds their titles to the prompt of every stage agent it starts, so no agent has to
 * remember to look (#st-build-howto-titles). The agent reads a card in full when its task
 * touches that rule.
 */
import { fold } from './fold.ts'
import type { AgentRole } from './instructions.ts'
import { readEvents } from './log.ts'
import { paths } from './project.ts'
import type { Graph } from './types.ts'

/** #st-build-howto-titles: the top card that holds the build rules, the same id in every map. */
export const HOW = 'how'

/** The roles of the agents that get the werk agent instructions: the chat agent, each build
 *  pass and the plan writers (#st-build-howto-titles-sample). A judge, a classifier, a sampler,
 *  a prototyper and the diagram agents have narrow contracts that no build rule changes. */
const STAGE_ROLES = new Set<string>(['chat', 'builder', 'spec-writer', 'ticket-writer'])
const isStageRole = (role: AgentRole) => STAGE_ROLES.has(role)

/** The title list, one line per decided card under the build-rules card, indented by depth.
 *  An open card is not a rule yet, so it is left out, but its decided children are not. A ghost
 *  is not in the map. Empty when the map has no build rule. Pure. */
export function buildRuleTitles(g: Graph): string {
  const lines: string[] = []
  const walk = (id: string, depth: number) => {
    for (const e of g.edges) {
      if (e.type !== 'refines' || e.to !== id) continue
      const n = g.nodes.get(e.from)
      if (!n || n.kind !== 'card' || n.proposed) continue
      const rule = n.status === 'decided'
      if (rule) lines.push(`${'  '.repeat(depth)}- #${n.id} — ${n.title}`)
      walk(n.id, rule ? depth + 1 : depth)
    }
  }
  walk(HOW, 0)
  if (!lines.length) return ''
  return [
    "## This project's build rules",
    "Each line is the title of a decided card in this project's map that says how this project is built. Follow every one. When your task touches a rule, read its card in full before you act on it.",
    lines.join('\n'),
  ].join('\n\n')
}

/** The build-rule text for an agent of `role`, from the map at `log`. Empty for an agent
 *  outside the stages, and for a map that cannot be read: a broken map starts the agent with
 *  less guidance instead of not starting it. */
export function buildRulesFor(role: AgentRole, log: string = paths.log): string {
  if (!isStageRole(role)) return ''
  try {
    return buildRuleTitles(fold(readEvents(log)))
  } catch {
    return ''
  }
}
