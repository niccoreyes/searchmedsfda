import { test, expect } from 'playwright/test';
import type { Page } from 'playwright';

const TEST_CSV = [
  'Updated as of Playwright fixture',
  'Registration Number,Generic Name,Brand Name,Dosage Form,Dosage Strength,Classification,Pharmacologic Category,Manufacturer',
  'TEST-1,Paracetamol,Test Brand,Tablet,500 mg,Prescription Drug (Rx),Analgesic,Test Manufacturer',
].join('\n');

async function openPrescription(page: Page, savedDraft?: object) {
  await page.route('https://tx.fhirlab.net/**', (route) => route.abort());
  await page.route('https://api.github.com/**', (route) => route.abort());
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.route('**/Combined_All_CPR.csv', (route) => route.fulfill({
    status: 200,
    contentType: 'text/csv',
    body: TEST_CSV,
  }));

  if (savedDraft) {
    await page.addInitScript((draft) => {
      localStorage.setItem('rxBuilderSave_v2', JSON.stringify(draft));
    }, savedDraft);
  }

  await page.goto('/');
  await page.locator('[data-tab="rx"]').click();
}

test('loading a patient preserves medications already selected', async ({ page }) => {
  await openPrescription(page, {
    meta: { ptName: 'Loaded Patient' },
    items: [{ genericName: 'Saved Medication', qty: '30' }],
    signature: '',
  });

  await page.locator('#addBlank').click();
  await page.locator('#rxItems .rx-item').first().locator('.rx-generic').fill('Selected Medication');
  await page.locator('#rxItems .rx-item').first().locator('.rx-qty').fill('10');

  await page.locator('#loadLocal').click();

  await expect(page.locator('#ptName')).toHaveValue('Loaded Patient');
  await expect(page.locator('#rxItems .rx-item')).toHaveCount(1);
  await expect(page.locator('#rxItems .rx-item').first().locator('.rx-generic')).toHaveValue('Selected Medication');
  await expect(page.locator('#rxItems .rx-item').first().locator('.rx-qty')).toHaveValue('10');
});

test('loading a patient restores saved medications when the active prescription is empty', async ({ page }) => {
  await openPrescription(page, {
    meta: { ptName: 'Empty Prescription Patient' },
    items: [{ genericName: 'Saved Medication', qty: '30' }],
    signature: '',
  });

  await page.locator('#loadLocal').click();

  await expect(page.locator('#ptName')).toHaveValue('Empty Prescription Patient');
  await expect(page.locator('#rxItems .rx-item')).toHaveCount(1);
  await expect(page.locator('#rxItems .rx-item').first().locator('.rx-generic')).toHaveValue('Saved Medication');
  await expect(page.locator('#rxItems .rx-item').first().locator('.rx-qty')).toHaveValue('30');
});
