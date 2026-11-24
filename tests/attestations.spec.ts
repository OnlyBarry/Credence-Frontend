import { test, expect, type Page } from '@playwright/test'
import { MOCK_WALLET_ADDRESS } from './mocks/freighter-api.mock'

/**
 * End-to-end coverage for /attestations: connecting the mock wallet, the
 * submission form (validation, confirmation dialog, success) and the timeline
 * tone filter (`attestations.filter.*`).
 *
 * Page state lives in React state seeded from `src/data/activity.ts`, so a
 * fresh navigation always starts from the same five rows and every test is
 * independent. Locators use accessible roles/labels, and assertions are
 * web-first (no sleeps).
 */

// A valid Stellar public key (correct StrKey checksum), distinct from the
// mock wallet's address so the subject is never confused with the actor.
const SUBJECT_ADDRESS = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
// Same length, prefix and alphabet, but the last character is changed so the
// CRC-16 checksum no longer matches.
const SUBJECT_ADDRESS_BAD_CHECKSUM = `${SUBJECT_ADDRESS.slice(0, -1)}A`

const INVALID_ADDRESS_MESSAGE =
  /Invalid address\. Stellar public keys are 56 characters starting with G\./

// Timeline actor for a connected wallet: first 12 + "..." + last 8 characters.
const TRUNCATED_WALLET_ADDRESS = `${MOCK_WALLET_ADDRESS.slice(0, 12)}...${MOCK_WALLET_ADDRESS.slice(-8)}`

// Seed data (newest first) grouped by the tone each status maps to.
const ACCEPTED_TITLES = ['Attestation submitted', 'Bond-backed identity confirmed']
const NEEDS_UPDATE_TITLES = ['Proof mismatch detected', 'Stale credential flagged']
const IN_REVIEW_TITLES = ['Credential refreshed']
const ALL_SEEDED_TITLES = [
  'Attestation submitted',
  'Proof mismatch detected',
  'Credential refreshed',
  'Bond-backed identity confirmed',
  'Stale credential flagged',
]

const FILTER_ALL = 'All statuses'
const FILTER_ACCEPTED = 'Accepted / Submitted'
const FILTER_NEEDS_UPDATE = 'Needs update'
const FILTER_IN_REVIEW = 'In review'

function ui(page: Page) {
  const form = page.getByRole('form', { name: 'Submit Attestation' })
  const timeline = page.getByRole('region', { name: 'Activity and attestations' })
  const dialog = page.getByRole('dialog', { name: 'Confirm Attestation Submission' })
  return {
    form,
    subject: form.getByRole('textbox', { name: 'Subject Address' }),
    type: form.getByRole('combobox', { name: 'Attestation Type' }),
    evidence: form.getByRole('textbox', { name: 'Evidence' }),
    submit: form.getByRole('button', { name: 'Submit Attestation' }),
    errors: form.getByRole('alert'),
    dialog,
    confirmInput: dialog.getByRole('textbox', { name: /Type CONFIRM/ }),
    confirmButton: dialog.getByRole('button', { name: 'Submit Attestation' }),
    cancelButton: dialog.getByRole('button', { name: 'Cancel' }),
    filter: page.getByRole('combobox', { name: 'Filter attestations by status' }),
    rows: timeline.getByRole('list', { name: 'Recent timeline events' }).getByRole('listitem'),
    summary: timeline.getByText(/^\d+ recent events?$/),
    // `exact` matters: "Error notifications" is a sibling region whose name
    // contains "Notifications".
    toast: page.getByRole('region', { name: 'Notifications', exact: true }),
  }
}

async function gotoAttestations(page: Page) {
  await page.goto('/attestations')
  await expect(page.getByRole('heading', { level: 1, name: 'Attestations' })).toBeVisible()
}

async function connectWallet(page: Page) {
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await page
    .getByRole('dialog', { name: 'Connect Freighter Wallet' })
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByRole('button', { name: /^Wallet menu for / })).toBeVisible()
}

async function fillForm(
  page: Page,
  { subject = SUBJECT_ADDRESS, type, evidence }: { subject?: string; type?: string; evidence: string }
) {
  const { subject: subjectInput, type: typeSelect, evidence: evidenceInput } = ui(page)
  await subjectInput.fill(subject)
  if (type) await typeSelect.selectOption({ label: type })
  await evidenceInput.fill(evidence)
}

/** Submits the form and completes the "type CONFIRM" dialog. */
async function submitAndConfirm(page: Page) {
  const { submit, dialog, confirmInput, confirmButton } = ui(page)
  await submit.click()
  await confirmInput.fill('CONFIRM')
  await confirmButton.click()
  await expect(dialog).toBeHidden()
}

test.describe('Attestations page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAttestations(page)
  })

  test('shows the seeded timeline, the form defaults and every filter option', async ({ page }) => {
    const { rows, summary, type, filter } = ui(page)

    await expect(rows).toHaveCount(5)
    await expect(summary).toHaveText('5 recent events')
    await expect(type).toHaveValue('identity')
    await expect(filter).toHaveValue('all')
    await expect(filter.getByRole('option')).toHaveText([
      FILTER_ALL,
      FILTER_ACCEPTED,
      FILTER_NEEDS_UPDATE,
      FILTER_IN_REVIEW,
    ])
  })

  test.describe('wallet', () => {
    test('connects the mock wallet and shows its address in the header', async ({ page }) => {
      await connectWallet(page)

      await expect(page.getByRole('button', { name: 'Connect wallet' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Wallet menu for GBRPYH/ })).toBeVisible()
    })
  })

  test.describe('form validation', () => {
    test('rejects an empty submission with required-field errors and no confirmation dialog', async ({
      page,
    }) => {
      const { submit, errors, dialog, rows } = ui(page)

      await submit.click()

      await expect(errors).toHaveText([/Subject address is required\./, /Evidence is required\./])
      await expect(dialog).toHaveCount(0)
      await expect(rows).toHaveCount(5)
    })

    test('rejects a malformed subject address', async ({ page }) => {
      const { subject, submit, errors, dialog, rows } = ui(page)
      await fillForm(page, { subject: 'not-an-address', evidence: 'Met in person' })

      await submit.click()

      await expect(errors).toHaveText(INVALID_ADDRESS_MESSAGE)
      await expect(subject).toHaveAttribute('aria-invalid', 'true')
      await expect(dialog).toHaveCount(0)
      await expect(rows).toHaveCount(5)
    })

    test('rejects a well-formed subject address whose checksum is wrong', async ({ page }) => {
      const { submit, errors, dialog, rows } = ui(page)
      await fillForm(page, { subject: SUBJECT_ADDRESS_BAD_CHECKSUM, evidence: 'Met in person' })

      await submit.click()

      await expect(errors).toHaveText(INVALID_ADDRESS_MESSAGE)
      await expect(dialog).toHaveCount(0)
      await expect(rows).toHaveCount(5)
    })

    test('requires evidence, including when it is only whitespace', async ({ page }) => {
      const { evidence, submit, errors, dialog } = ui(page)
      await fillForm(page, { evidence: '   ' })

      await submit.click()

      await expect(errors).toHaveText(/Evidence is required\./)
      await expect(evidence).toHaveAttribute('aria-invalid', 'true')
      await expect(dialog).toHaveCount(0)
    })

    test('accepts evidence of exactly 2,000 characters', async ({ page }) => {
      const { form, submit, errors, dialog } = ui(page)
      await fillForm(page, { evidence: 'a'.repeat(2000) })

      await expect(form.getByText('2000 / 2,000 chars')).toBeVisible()
      await submit.click()

      await expect(dialog).toBeVisible()
      await expect(errors).toHaveCount(0)
    })

    test('rejects evidence longer than 2,000 characters', async ({ page }) => {
      const { form, submit, errors, dialog } = ui(page)
      await fillForm(page, { evidence: 'a'.repeat(2001) })

      await expect(form.getByText('2001 / 2,000 chars')).toBeVisible()
      await submit.click()

      await expect(errors).toHaveText(/Evidence cannot exceed 2,000 characters\./)
      await expect(dialog).toHaveCount(0)
    })

    test('clears a field error as soon as the user edits that field', async ({ page }) => {
      const { evidence, submit, errors } = ui(page)
      await fillForm(page, { evidence: '   ' })
      await submit.click()
      await expect(errors).toHaveText(/Evidence is required\./)

      await evidence.fill('Now with real evidence')

      await expect(errors).toHaveCount(0)
    })
  })

  test.describe('submission', () => {
    test('submits a valid attestation after typing CONFIRM and adds it to the top of the timeline', async ({
      page,
    }) => {
      const { subject, type, evidence, submit, dialog, confirmInput, confirmButton, rows, summary, toast } =
        ui(page)
      await connectWallet(page)
      await fillForm(page, {
        type: 'Peer Vouch',
        evidence: 'Worked together on the Stellar grant',
      })

      await submit.click()

      // The confirmation dialog echoes what is about to be recorded.
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(SUBJECT_ADDRESS)
      await expect(dialog).toContainText('Peer Vouch')
      await expect(dialog).toContainText('Worked together on the Stellar grant')

      // Confirmation is gated on typing the phrase exactly.
      await expect(confirmButton).toBeDisabled()
      await confirmInput.fill('nope')
      await expect(confirmButton).toBeDisabled()
      await confirmInput.fill('CONFIRM')
      await expect(confirmButton).toBeEnabled()
      await confirmButton.click()

      await expect(dialog).toBeHidden()
      await expect(toast).toContainText('Attestation submitted successfully.')

      // The new row is first, with the evidence as its description.
      await expect(rows).toHaveCount(6)
      await expect(summary).toHaveText('6 recent events')
      const newRow = rows.first()
      await expect(newRow).toContainText('Peer Vouch')
      await expect(newRow).toContainText('Submitted')
      await expect(newRow).toContainText('Worked together on the Stellar grant')

      // The actor is the connected wallet, truncated; meta carries the subject.
      await newRow.getByRole('button', { name: /Show details/ }).click()
      const details = newRow.getByRole('region', { name: 'Details' })
      await expect(details).toContainText(`Actor: ${TRUNCATED_WALLET_ADDRESS}`)
      await expect(details).toContainText(`Subject: ${SUBJECT_ADDRESS.substring(0, 8)}`)

      // The form is reset for the next attestation.
      await expect(subject).toHaveValue('')
      await expect(evidence).toHaveValue('')
      await expect(type).toHaveValue('identity')
    })

    test('falls back to "Current User" as the actor when no wallet is connected', async ({
      page,
    }) => {
      const { rows } = ui(page)
      await fillForm(page, { evidence: 'Verified in person' })

      await submitAndConfirm(page)

      const newRow = rows.first()
      await expect(newRow).toContainText('Verified in person')
      await newRow.getByRole('button', { name: /Show details/ }).click()
      await expect(newRow.getByRole('region', { name: 'Details' })).toContainText(
        'Actor: Current User'
      )
    })

    for (const { option, timelineTitle } of [
      { option: 'Identity Verification', timelineTitle: 'Identity Attestation' },
      { option: 'Peer Vouch', timelineTitle: 'Peer Vouch' },
      { option: 'Credential / Certification', timelineTitle: 'Credential Certification' },
    ]) {
      test(`titles a "${option}" submission "${timelineTitle}" in the timeline`, async ({ page }) => {
        const { rows } = ui(page)
        await fillForm(page, { type: option, evidence: `Evidence for ${option}` })

        await submitAndConfirm(page)

        await expect(rows).toHaveCount(6)
        await expect(rows.first().getByText(timelineTitle, { exact: true })).toBeVisible()
      })
    }

    test('cancelling the confirmation keeps the form values and leaves the timeline unchanged', async ({
      page,
    }) => {
      const { subject, type, evidence, submit, dialog, cancelButton, rows, toast } = ui(page)
      await fillForm(page, { type: 'Credential / Certification', evidence: 'Diploma' })
      await submit.click()
      await expect(dialog).toBeVisible()

      await cancelButton.click()

      await expect(dialog).toBeHidden()
      await expect(subject).toHaveValue(SUBJECT_ADDRESS)
      await expect(type).toHaveValue('credential')
      await expect(evidence).toHaveValue('Diploma')
      await expect(rows).toHaveCount(5)
      await expect(toast).not.toContainText('Attestation submitted successfully.')
      // Focus returns to the control that opened the dialog.
      await expect(submit).toBeFocused()
    })

    test('can submit more than one attestation in a row', async ({ page }) => {
      const { rows, summary } = ui(page)

      await fillForm(page, { evidence: 'First attestation' })
      await submitAndConfirm(page)
      await fillForm(page, { evidence: 'Second attestation' })
      await submitAndConfirm(page)

      await expect(rows).toHaveCount(7)
      await expect(summary).toHaveText('7 recent events')
      await expect(rows.nth(0)).toContainText('Second attestation')
      await expect(rows.nth(1)).toContainText('First attestation')
    })
  })

  test.describe('timeline filter', () => {
    test('filters the timeline by status and restores all rows on "All statuses"', async ({
      page,
    }) => {
      const { filter, rows, summary } = ui(page)

      await filter.selectOption({ label: FILTER_ACCEPTED })
      await expect(rows).toHaveCount(2)
      await expect(rows).toContainText(ACCEPTED_TITLES)
      await expect(summary).toHaveText('2 recent events')

      await filter.selectOption({ label: FILTER_NEEDS_UPDATE })
      await expect(rows).toHaveCount(2)
      await expect(rows).toContainText(NEEDS_UPDATE_TITLES)
      await expect(summary).toHaveText('2 recent events')

      await filter.selectOption({ label: FILTER_IN_REVIEW })
      await expect(rows).toHaveCount(1)
      await expect(rows).toContainText(IN_REVIEW_TITLES)
      await expect(summary).toHaveText('1 recent event')

      await filter.selectOption({ label: FILTER_ALL })
      await expect(rows).toHaveCount(5)
      await expect(rows).toContainText(ALL_SEEDED_TITLES)
      await expect(summary).toHaveText('5 recent events')
    })

    test('keeps the selected filter value in the Select', async ({ page }) => {
      const { filter } = ui(page)

      await filter.selectOption({ label: FILTER_NEEDS_UPDATE })

      await expect(filter).toHaveValue('warning')
    })

    test('shows a freshly submitted attestation under "Accepted / Submitted" only', async ({
      page,
    }) => {
      const { filter, rows, summary } = ui(page)
      await fillForm(page, { type: 'Peer Vouch', evidence: 'Fresh vouch' })
      await submitAndConfirm(page)

      await filter.selectOption({ label: FILTER_ACCEPTED })
      await expect(rows).toHaveCount(3)
      await expect(rows).toContainText(['Peer Vouch', ...ACCEPTED_TITLES])
      await expect(summary).toHaveText('3 recent events')

      await filter.selectOption({ label: FILTER_NEEDS_UPDATE })
      await expect(rows).toHaveCount(2)
      await expect(rows).toContainText(NEEDS_UPDATE_TITLES)

      await filter.selectOption({ label: FILTER_IN_REVIEW })
      await expect(rows).toHaveCount(1)
      await expect(rows).toContainText(IN_REVIEW_TITLES)
    })

    test('keeps a new attestation hidden while a different filter is active, then reveals it', async ({
      page,
    }) => {
      const { filter, rows, summary, toast } = ui(page)
      await filter.selectOption({ label: FILTER_NEEDS_UPDATE })
      await expect(rows).toHaveCount(2)

      await fillForm(page, { type: 'Peer Vouch', evidence: 'Submitted under a filter' })
      await submitAndConfirm(page)

      // Submission succeeded, but the active filter still excludes the new row.
      await expect(toast).toContainText('Attestation submitted successfully.')
      await expect(filter).toHaveValue('warning')
      await expect(rows).toHaveCount(2)
      await expect(summary).toHaveText('2 recent events')
      await expect(rows).toContainText(NEEDS_UPDATE_TITLES)

      await filter.selectOption({ label: FILTER_ALL })
      await expect(rows).toHaveCount(6)
      await expect(rows.first()).toContainText('Submitted under a filter')
    })
  })
})
