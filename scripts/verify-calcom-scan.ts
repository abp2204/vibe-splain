import { scanProject } from '@vibe-splain/brain';
import { join } from 'path';

async function runCalcomScan() {
  const projectRoot = '/Users/aayushpatel/Desktop/Code/calcom/apps/web';
  console.error(`[runCalcomScan] Scanning ${projectRoot}...`);
  const result = await scanProject(projectRoot);
  
  const report = result.fullValidationReport!;
  console.log(JSON.stringify({
    passed: report.passed,
    summary: report.summary,
    errorCount: report.errors.length,
    warningCount: report.warnings.length,
    errors: report.errors
  }, null, 2));

  // Check specific files hotSpans
  const webhookFiles = [
    'pages/api/integrations/alby/webhook.ts',
    'pages/api/integrations/btcpayserver/webhook.ts',
    'pages/api/integrations/paypal/webhook.ts',
    'pages/api/integrations/stripepayment/webhook.ts',
    'pages/api/stripe/webhook.ts'
  ];

  console.error('\n--- hotSpans for Webhook Files ---');
  for (const f of webhookFiles) {
    const pf = result.store.files[f];
    console.error(`${f}: ${pf?.hotSpans.length ?? 'NOT FOUND'} hotSpans`);
  }
}

runCalcomScan().catch(err => {
  console.error(err);
  process.exit(1);
});
