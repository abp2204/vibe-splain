import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, mkdtemp, writeFile, rm } from 'fs/promises';
import { scanProject } from '@vibesplain/brain';
import assert from 'assert';

async function testLogicFixes() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'vibe-logic-test-'));
  try {
    // 1. Setup a dummy project structure
    await mkdir(join(tmpDir, 'pages/api/stripe'), { recursive: true });
    await mkdir(join(tmpDir, 'app/api/auth'), { recursive: true });
    await mkdir(join(tmpDir, 'app/(booking-page-wrapper)/booking/[uid]'), { recursive: true });
    await mkdir(join(tmpDir, 'app/payment'), { recursive: true });

    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: {
        'next': 'latest',
        'react': 'latest'
      }
    }));

    // API route file (should count as its own entrypoint)
    await writeFile(join(tmpDir, 'pages/api/stripe/webhook.ts'), `
import type { NextApiRequest, NextApiResponse } from "next";
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const sig = req.headers['stripe-signature'];
  // dummy logic
  res.status(200).json({ received: true });
}
    `);

    // App Router route (should count as its own entrypoint)
    await writeFile(join(tmpDir, 'app/api/auth/route.ts'), `
export async function POST(req: Request) {
  return new Response('ok');
}
    `);

    // Booking page wrapper (should NOT hard fail if no mutation logic)
    await writeFile(join(tmpDir, 'app/(booking-page-wrapper)/booking/[uid]/page.tsx'), `
export default function BookingPage() {
  return <div>Booking</div>;
}
    `);

    // Payment UI Page (should NOT trigger webhook validation)
    await writeFile(join(tmpDir, 'app/payment/page.tsx'), `
export default function PaymentPage() {
  return <div>Pay with Stripe</div>;
}
    `);

    console.error('[test_logic_fixes] Running scan...');
    const result = await scanProject(tmpDir);

    // Check API route self-entrypoint
    const webhookFile = result.store.files['pages/api/stripe/webhook.ts'];
    assert(webhookFile, 'Webhook file not found');
    assert(webhookFile.runtimeEntrypoints.length > 0, 'Webhook file should have entrypoints');
    assert(webhookFile.runtimeEntrypoints.some(e => e.path === 'pages/api/stripe/webhook.ts'), 'Webhook file should be its own entrypoint');
    console.error('[test_logic_fixes] PASS: API route counts as its own entrypoint');

    // Check hotSpans for webhook
    assert(webhookFile.hotSpans.length > 0, 'Webhook file should have hotSpans');
    console.error('[test_logic_fixes] PASS: Webhook logic produces hotSpans');

    // Check booking wrapper no hard error
    const bookingPage = result.store.files['app/(booking-page-wrapper)/booking/[uid]/page.tsx'];
    assert(bookingPage, 'Booking page not found');
    const bookingErrors = result.fullValidationReport!.errors.filter(e => e.file === bookingPage.relativePath);
    assert(bookingErrors.length === 0, 'Booking wrapper should not have hard errors if no mutation logic');
    console.error('[test_logic_fixes] PASS: Booking wrapper does not hard fail without mutation');

    // Check payment UI no webhook validation
    const paymentPage = result.store.files['app/payment/page.tsx'];
    assert(paymentPage, 'Payment page not found');
    const paymentErrors = result.fullValidationReport!.errors.filter(e => e.file === paymentPage.relativePath);
    const webhookDomainErrors = paymentErrors.filter(e => e.rule.startsWith('webhook_'));
    assert(webhookDomainErrors.length === 0, 'Payment UI should not trigger webhook validation');
    console.error('[test_logic_fixes] PASS: Payment UI does not trigger webhook validation');

    // Check entrypointTraceCoverage boost
    const coverage = result.fullValidationReport!.summary.entrypointTraceCoverage;
    assert(coverage && coverage > 0, 'Coverage should be > 0');
    console.error(`[test_logic_fixes] PASS: entrypointTraceCoverage is ${coverage}%`);

  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

testLogicFixes().catch(err => {
  console.error('[test_logic_fixes] FAILED:', err);
  process.exit(1);
});
