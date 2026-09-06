/** First human-prompt preview shared by list projection and cold lookup. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SESSION_FIRST_PROMPT_MAX_CODE_POINTS } from './types.ts'

/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - source text.
 * @param maximum - maximum number of Unicode code points.
 * @returns the source text or its longest allowed prefix.
 */
export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end)
    count++
    end += codePoint.length
  }
  return value
}

/**
 * Extract bounded text from a human-authored user message.
 * @param event - committed Session event to inspect.
 * @returns bounded joined text, including an empty string for a textless human prompt, or undefined for other events.
 */
export function firstPromptText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  return truncateUnicodeCodePoints(
    event.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n\n')
      .trim(),
    SESSION_FIRST_PROMPT_MAX_CODE_POINTS,
  )
}
