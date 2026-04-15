import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, describe, expect, it } from "vitest"

import { EventBus } from "../src/modules/events/event-bus.js"

describe("EventBus.releaseTopic", () => {
  let tempDir = ""

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = ""
    }
  })

  it("clears subscribers and prunes persisted self-check event logs", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-event-bus-"))

    const eventBus = new EventBus(tempDir, 10)
    const topic = "self-check:session-1"

    await eventBus.publish(topic, {
      type: "self_check_complete",
      session_id: "session-1",
      status: "completed",
    })

    const subscription = await eventBus.subscribe(topic)
    expect(subscription.history).toHaveLength(1)

    const pendingEvent = subscription.queue.dequeue()
    eventBus.releaseTopic(topic, { deleteEventLog: true })

    await expect(pendingEvent).resolves.toEqual({})

    const nextSubscription = await eventBus.subscribe(topic)
    expect(nextSubscription.history).toEqual([])
  })
})
