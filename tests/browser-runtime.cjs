// Verify the runner's existing libraries before requesting OS packages.
// Missing dependencies still fail CI unless installation and this check succeed.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>Browser runtime</title><p>LiveBoard browser check</p>');
    await page.screenshot();
    console.log('Chromium launches and renders successfully.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
