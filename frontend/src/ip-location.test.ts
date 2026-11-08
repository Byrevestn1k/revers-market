import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const city = { location: { country_code: 'UA', city: 'Kyiv', latitude: 50.45, longitude: 30.52 } }
describe('IP lookup retries only after an explicit new call', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it.each(['network', 'http', 'json', 'invalid'])('does not cache a %s failure', async failure => {
    const fetchMock = vi.fn()
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'))
    if (failure === 'http') fetchMock.mockResolvedValueOnce({ ok: false })
    if (failure === 'json') fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad json') } })
    if (failure === 'invalid') fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ location: { country_code: 'UA', city: 'bad', latitude: 999, longitude: 999 } }) })
    fetchMock.mockResolvedValue({ ok: true, json: async () => city })
    vi.stubGlobal('fetch', fetchMock)
    const { lookupIpCity } = await import('./SearchLocationControls')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await lookupIpCity()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1) // No automatic network retry.
    expect((await lookupIpCity())?.name).toBe('Київ')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await lookupIpCity()
    expect(fetchMock).toHaveBeenCalledTimes(2) // Successful result remains shared.
  })

  it('coalesces concurrent requests without sending two IP disclosures', async () => {
    let resolve!: (value: unknown) => void
    const fetchMock = vi.fn(() => new Promise(done => { resolve = done }))
    vi.stubGlobal('fetch', fetchMock)
    const { lookupIpCity } = await import('./SearchLocationControls')
    const first = lookupIpCity(), second = lookupIpCity()
    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolve({ ok: true, json: async () => city })
    expect((await first)?.name).toBe('Київ')
    expect((await second)?.name).toBe('Київ')
  })
})
