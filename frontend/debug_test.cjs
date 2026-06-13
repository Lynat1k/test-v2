const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const allLogs = [];
  page.on('console', msg => {
    allLogs.push(msg.text());
  });
  page.on('pageerror', err => {
    allLogs.push('PAGE_ERROR: ' + err.message);
  });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);

  // List all buttons
  const buttons = await page.locator('button').all();
  console.log('Found ' + buttons.length + ' buttons:');
  for (const btn of buttons) {
    const text = await btn.textContent();
    console.log('  Button: "' + text.trim() + '"');
  }

  // Click "Кластеры" or "Clusters" button
  for (const btn of buttons) {
    const text = await btn.textContent();
    if (text && (text.includes('ластер') || text.includes('luster'))) {
      await btn.click();
      console.log('Clicked: ' + text.trim());
      break;
    }
  }

  await page.waitForTimeout(3000);

  console.log('=== CLUSTER/OVERLAY LOGS ===');
  allLogs.filter(l => l.includes('CLUSTER_DEBUG') || l.includes('OVERLAY_DEBUG')).forEach(l => console.log(l));
  console.log('=== ALL LOGS (' + allLogs.length + ') ===');
  allLogs.forEach(l => console.log(l));
  console.log('=== END ===');
  await browser.close();
})();
