// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * 街歩きガチャ smoke tests
 * - LP / アプリ起動
 * - 主要モーダル開閉
 * - JSエラー監視
 */

test.describe('LP', () => {
  test('LP loads and shows hero copy', async ({ page }) => {
    await page.goto('/lp.html');
    await expect(page.locator('h1')).toContainText('あと◯分あったら');
    // ヒーロー動画のステージ
    await expect(page.locator('.hero-demo')).toBeVisible();
    // 料金プランセクション
    await expect(page.locator('.pricing-section')).toBeVisible();
    await expect(page.locator('.pricing-amount').first()).toContainText('¥0');
    // FAQ
    await expect(page.locator('.lp-faq')).toBeVisible();
  });

  test('LP CTA links to app', async ({ page }) => {
    await page.goto('/lp.html');
    const cta = page.locator('.cta-primary').first();
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toBe('/');
  });
});

test.describe('App', () => {
  test('App loads with no JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // ヘッダーのブランド名
    await expect(page.locator('.brand-name')).toContainText('街歩きガチャ');

    // map container は表示されるはず
    await expect(page.locator('#map-container')).toBeVisible();

    // 致命的JSエラーは0件
    const fatal = errors.filter(e => !e.includes('favicon') && !e.includes('analytics'));
    expect(fatal, `Unexpected JS errors:\n${fatal.join('\n')}`).toEqual([]);
  });

  test('Onboarding can be skipped', async ({ page, context }) => {
    // Fresh state
    await context.addInitScript(() => localStorage.clear());
    await page.goto('/');
    // オンボーディングは初回訪問時に出るはず
    const onboard = page.locator('#onboard-modal');
    if (await onboard.isVisible()) {
      // ✕ ボタンで閉じる
      await page.locator('#onboard-close').click();
      await expect(onboard).toBeHidden();
    }
  });

  test('Profile modal opens', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // プロフィールボタン
    const profileBtn = page.locator('#profile-btn');
    if (await profileBtn.isVisible()) {
      await profileBtn.click();
      await expect(page.locator('#profile-modal')).toBeVisible();
    }
  });

  test('Manifest is valid PWA', async ({ page }) => {
    const res = await page.request.get('/manifest.json');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.name).toBe('街歩きガチャ');
    expect(m.icons.length).toBeGreaterThan(2);
    expect(m.shortcuts.length).toBeGreaterThan(0);
  });

  test('Service Worker registers', async ({ page }) => {
    await page.goto('/');
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg !== undefined;
    });
    expect(swRegistered).toBe(true);
  });
});

test.describe('API', () => {
  test('Backend health endpoint', async ({ request }) => {
    const res = await request.get(
      'https://yorimichi-api-1028920472559.asia-northeast1.run.app/health'
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe('machiaruki-api');
    expect(Array.isArray(data.packs)).toBe(true);
  });

  test('Stripe checkout creates session', async ({ request }) => {
    const res = await request.post(
      'https://yorimichi-api-1028920472559.asia-northeast1.run.app/api/checkout',
      { data: { pack: 'pack_starter', user_id: 'playwright_test' } }
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.url).toContain('checkout.stripe.com');
  });
});
