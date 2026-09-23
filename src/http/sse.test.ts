import { describe, expect, it } from 'vitest'
import { parseSseStream } from '@/http/sse'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('parseSseStream', () => {
  it('yields one event per frame', async () => {
    const events = []
    for await (const event of parseSseStream(streamOf('data: one\n\ndata: two\n\n'))) {
      events.push(event)
    }
    expect(events.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('reassembles a frame split across chunks', async () => {
    // The case a naive split-per-chunk parser gets wrong, and the reason the
    // buffer survives across reads.
    const events = []
    for await (const event of parseSseStream(streamOf('data: sp', 'lit\n\n'))) {
      events.push(event)
    }
    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('split')
  })

  it('carries id and event name, which is what makes replay work', async () => {
    const events = []
    for await (const event of parseSseStream(
      streamOf('id: 42\nevent: notification\ndata: x\n\n')
    )) {
      events.push(event)
    }
    expect(events[0]).toMatchObject({ id: '42', event: 'notification', data: 'x' })
  })

  it('skips a heartbeat comment without yielding an event', async () => {
    const events = []
    for await (const event of parseSseStream(streamOf(': ping\n\ndata: real\n\n'))) {
      events.push(event)
    }
    expect(events.map((e) => e.data)).toEqual(['real'])
  })
})
