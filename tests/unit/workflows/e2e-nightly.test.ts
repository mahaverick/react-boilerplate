// @vitest-environment node
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAKE_FLAGS_PROJECT_KEY, FAKE_FLAGS_SECURE_KEY } from '../../../e2e/helpers/fake-flags.mjs'

/**
 * .github/workflows/e2e-nightly.yml, read as text. A run is the real check;
 * these pin the lines a quiet edit could break with every run still green.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..')
const WORKFLOW = readFileSync(path.join(ROOT, '.github/workflows/e2e-nightly.yml'), 'utf8')

/** The text of the step with this `id`. */
function stepOf(id: string): string {
  const step = WORKFLOW.split(/^ {6}- /m).find((text) =>
    new RegExp(`^(id: |\\s+id: )${id}$`, 'm').test(text)
  )
  if (step === undefined) throw new Error(`no step ${id}`)
  return step
}

describe('e2e-nightly.yml', () => {
  it('reads exercise_issue once, as none when absent, since a schedule run has no inputs', () => {
    expect(WORKFLOW).toContain("EXERCISE: ${{ inputs.exercise_issue || 'none' }}")
    expect(WORKFLOW.match(/inputs\.exercise_issue/g)).toHaveLength(1)
  })

  it('touches issues only from main, unless exercise_issue asks', () => {
    expect(WORKFLOW).toContain(
      "if: always() && (env.EXERCISE != 'none' || github.ref == 'refs/heads/main')"
    )
  })

  it('runs both suites whatever the other did, once the API is up', () => {
    expect(
      WORKFLOW.match(
        /if: "!cancelled\(\) && env\.EXERCISE == 'none' && steps\.api\.outcome == 'success'"/g
      )
    ).toHaveLength(2)
  })

  it('runs express on local with scaled rate limits, the default CORS list and its own compose project', () => {
    expect(WORKFLOW).toContain('APP_ENV=local')
    expect(WORKFLOW).toContain('RATE_LIMIT_SCALE=10')
    expect(WORKFLOW).toContain('COMPOSE_PROJECT_NAME=e2e')
    expect(WORKFLOW).not.toContain('CORS_ALLOWED_ORIGINS=')
  })

  it("points express at the fake flags host with the fake's own keys", () => {
    expect(WORKFLOW).toContain('POSTHOG_HOST=http://127.0.0.1:4064')
    expect(WORKFLOW).toContain(`POSTHOG_PROJECT_KEY=${FAKE_FLAGS_PROJECT_KEY}`)
    expect(WORKFLOW).toContain(`POSTHOG_FEATURE_FLAGS_KEY=${FAKE_FLAGS_SECURE_KEY}`)
  })

  it('hands live/flags.test.ts the executable set script as E2E_FLAGS_SET_CMD', () => {
    expect(WORKFLOW).toContain(
      'E2E_FLAGS_SET_CMD: ${{ github.workspace }}/app/scripts/e2e-flags-set.mjs'
    )
    expect(statSync(path.join(ROOT, 'scripts/e2e-flags-set.mjs')).mode & 0o111).not.toBe(0)
  })

  it('gives every step an id, so a failure there is named in the issue', () => {
    const steps = WORKFLOW.split('\n    steps:\n')[1]!
      .split(/^ {6}- /m)
      .slice(1)
    expect(steps.length).toBeGreaterThan(10)
    for (const step of steps) {
      expect(step, step.split('\n')[0]).toMatch(/^id: [a-z][a-z0-9-]*$|^\s+id: [a-z][a-z0-9-]*$/m)
    }
  })

  it('keeps the fake flags files out of app/, the image build context', () => {
    expect(WORKFLOW).toContain('$RUNNER_TEMP/fake-flags.log')
    expect(WORKFLOW).toContain('$RUNNER_TEMP/fake-flags.pid')
    expect(WORKFLOW).not.toMatch(/app\/fake-flags|[^/]fake-flags\.(log|pid)/)
  })

  it('stops the suites and the report move on a cancel, but still uploads, tears down and files the issue', () => {
    for (const id of ['live', 'move-reports', 'nginx']) {
      expect(stepOf(id), id).toMatch(/if: "!cancelled\(\) && /)
    }
    for (const id of ['upload-artifact', 'teardown', 'issue']) {
      expect(stepOf(id), id).toMatch(/if: always\(\) && /)
    }
  })
})
