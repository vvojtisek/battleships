import { expect, test, type Page } from '@playwright/test';

async function enterMultiplayer(page: Page, name: string): Promise<void> {
  await page.goto('/?guest=1');
  await page.getByRole('link', { name: 'Multiplayer', exact: true }).click();
  await page.getByLabel('Guest name').fill(name);
}

test('two LAN players can start a match and leave its terminal state', async ({ browser }) => {
  const creator = await browser.newContext();
  const opponent = await browser.newContext();
  const creatorPage = await creator.newPage();
  const opponentPage = await opponent.newPage();

  await enterMultiplayer(creatorPage, 'Ada');
  await creatorPage.getByRole('button', { name: 'Create room' }).click();
  await expect(creatorPage).toHaveURL(/\/room\/[A-Z0-9]{6}$/);
  const roomUrl = creatorPage.url();

  await enterMultiplayer(opponentPage, 'Grace');
  await expect(opponentPage.getByRole('button', { name: 'Join game' })).toBeVisible();
  await opponentPage.getByRole('button', { name: 'Join game' }).click();
  await expect(opponentPage).toHaveURL(roomUrl);
  await opponentPage.getByRole('button', { name: 'Join room' }).click();

  await expect(opponentPage.getByRole('heading', { name: 'Ready your fleet' })).toBeVisible();
  await expect(creatorPage.getByRole('heading', { name: 'Ready your fleet' })).toBeVisible();
  for (const page of [creatorPage, opponentPage]) {
    await page.getByRole('button', { name: 'Randomize fleet' }).click();
    await page.getByRole('button', { name: 'Start battle' }).click();
  }

  await expect(creatorPage.getByRole('heading', { name: 'Enemy waters' })).toBeVisible();
  await creatorPage.getByRole('button', { name: 'Pause match' }).click();
  await creatorPage.getByRole('button', { name: 'Surrender match' }).click();
  await expect(creatorPage.getByRole('dialog')).toBeVisible();
  await creatorPage.getByRole('button', { name: 'Main menu' }).click();
  await expect(creatorPage).toHaveURL(/\/menu$/);

  await creator.close();
  await opponent.close();
});
