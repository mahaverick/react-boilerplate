/**
 * @file The hermetic fixture's navigation abort is never silent
 * while another tab is open: an unmocked call made then is recorded, and
 * teardown fails on it.
 */
import { expect, test } from '../hermetic'

// Teardown must report tab A's unmocked call; test.fail turns that report into the pass.
test.fail(
  'another tab’s unmocked call during a navigation is recorded, and teardown fails on it',
  async ({ context, apiFallback }) => {
    const a = await context.newPage()
    await a.goto('/e2e/harness/?session=none&path=/login')
    const b = await context.newPage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await b.route('**/slow-nav', async (route) => {
      await gate
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>b</title>' })
    })

    const held = b.waitForRequest('**/slow-nav')
    const navigation = b.goto('/slow-nav')
    await held
    // B's navigation is in flight (its request is held) while A calls an endpoint nothing mocked.
    await a.evaluate(() => fetch('/api/v1/nothing-mocks-this').catch(() => null))
    release()
    await navigation

    // The call was not silently dropped: it is on record, and teardown fails on it.
    expect(apiFallback.swallowed).toEqual(['GET /api/v1/nothing-mocks-this'])
  }
)
