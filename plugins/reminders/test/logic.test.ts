import { describe, expect, it } from 'bun:test'
import { parseReminder } from '../src/logic'

// Thursday 2026-11-26, 14:10 local time.
const now = new Date(2026, 10, 26, 14, 10)
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

describe('remind …', () => {
  it('reads a time at the end or the start', () => {
    expect(parseReminder('call the bank at 5pm', now)).toEqual({ title: 'Call the bank', due: local(26, 17) })
    expect(parseReminder('5pm call the bank', now)).toEqual({ title: 'Call the bank', due: local(26, 17) })
    expect(parseReminder('standup 17:30', now)).toEqual({ title: 'Standup', due: local(26, 17, 30) })
    expect(parseReminder('me to water plants at 18', now)).toEqual({ title: 'Water plants', due: local(26, 18) })
  })

  it('rolls a passed time to tomorrow', () => {
    expect(parseReminder('pay rent at 9am', now)).toEqual({ title: 'Pay rent', due: local(27, 9) })
  })

  it('reads in … and day words', () => {
    expect(parseReminder('in 20m stretch', now)).toEqual({ title: 'Stretch', due: now.getTime() + 20 * 60_000 })
    expect(parseReminder('check the oven in 1.5 hours', now)?.due).toBe(now.getTime() + 90 * 60_000)
    expect(parseReminder('tomorrow pay rent', now)).toEqual({ title: 'Pay rent', due: local(27, 9) })
    expect(parseReminder('tomorrow at 9:30 standup', now)).toEqual({ title: 'Standup', due: local(27, 9, 30) })
    expect(parseReminder('take out the trash tonight', now)).toEqual({ title: 'Take out the trash', due: local(26, 20) })
  })

  it('keeps numbers that are not times, and needs a title', () => {
    expect(parseReminder('buy 3 apples', now)).toEqual({ title: 'Buy 3 apples', due: undefined })
    expect(parseReminder('at 5pm', now)).toBeNull()
    expect(parseReminder('', now)).toBeNull()
  })
})
