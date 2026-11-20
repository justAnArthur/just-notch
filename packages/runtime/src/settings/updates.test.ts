import { expect, test } from 'vitest'
import { lastCheckedText } from './updates'

const now = Date.UTC(2026, 10, 20, 12)

test.each([
  [null, 'Never checked'],
  [now - 10_000, 'Last checked just now'],
  [now + 5_000, 'Last checked just now'],
  [now - 5 * 60_000, 'Last checked 5 minutes ago'],
  [now - 3 * 3_600_000, 'Last checked 3 hours ago'],
  [now - 26 * 3_600_000, 'Last checked yesterday'],
  [now - 4 * 86_400_000, 'Last checked 4 days ago'],
])('%s', (lastChecked, expected) => expect(lastCheckedText(lastChecked, now)).toBe(expected))
