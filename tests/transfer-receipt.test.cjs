const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NextResponse } = require('next/server');
const load = require('./helpers/load-typescript.cjs');
const { parseReceipt } = load('lib/receipts/parse.ts');
const { parseTelegramJournal } = load('lib/telegram-journal.ts');
const { transferPreview } = load('lib/receipts/transfer-preview.ts');

// Synthetic account/reference numbers; no customer image or personal bank data.
const proof = `Transfer Successful
29 Oct 2026 16:32:06
IDR 11,000.00
Beneficiary Name TEST RECIPIENT
Beneficiary Account 123-456-7890
Transaction Type Transfer to BCA Account
Transfer Currency IDR - Indonesian Rupiah
Source of Fund 123-0**-**88
Transfer Amount IDR 11,000.00
Reference No. 999999202610291632
06203TRF987654321
0`;

test('bank proof uses Transfer Amount, recipient and English date, never reference numbers', () => {
  const result = parseReceipt(proof, 88);
  assert.equal(result.kind, 'bank_transfer'); assert.equal(result.amount, 11000);
  assert.equal(result.date, '2026-10-29'); assert.equal(result.merchant, 'Transfer ke TEST RECIPIENT');
  assert.equal(result.issue, null);
});
test('bank proof supports split label/value, Indonesian date and exact cents', () => {
  const result = parseReceipt('Transfer Berhasil\n29 Oktober 2026\nNama Penerima\nTEST RECIPIENT\nNominal Transfer\nRp 11.000,75\nReferensi 987654321', 90);
  assert.equal(result.amount, '11000.75'); assert.equal(result.date, '2026-10-29');
  assert.equal(result.merchant, 'Transfer ke TEST RECIPIENT');
});
test('ambiguous, foreign, failed or malformed proofs never suggest a saveable amount', () => {
  for (const text of [proof + '\nTransfer Amount IDR 12,000.00', proof.replace('11,000.00', 'USD 11,000.00'), proof.replace('Successful', 'Failed'), proof.replace('Successful', 'Pending'), proof.replace('Transfer Amount IDR 11,000.00', 'Transfer Amount IDR 12.3456')]) {
    assert.equal(parseReceipt(text, 95).amount, null, text);
  }
  assert.equal(parseReceipt('Transfer Failed\nIDR 11,000.00', 90).issue, 'unsuccessful');
  assert.equal(parseReceipt('Transfer Successful\nReference No 123456789\n06203TRF987654321', 90).amount, null);
  assert.equal(parseReceipt('SHOP\nTelp 123456789\n123456789\nInvoice No 999999', 90).amount, null);
});
test('rupiah header fallback works, invalid dates and invalid precision are not invented', () => {
  assert.equal(parseReceipt(proof.replace('Transfer Amount IDR 11,000.00', ''), 90).amount, 11000);
  assert.equal(parseReceipt('SHOP\nTOTAL\nRp 25.000\nKasir 10000000', 90).amount, 25000);
  assert.equal(parseReceipt('SHOP\nTOTAL Rp25.000', 90).amount, 25000);
  assert.equal(parseReceipt('Transfer Successful\nTransfer Amount IDR11,000.00', 90).amount, 11000);
  assert.equal(parseReceipt(proof.replace('29 Oct', '32 Oct'), 90).date, null);
  assert.equal(parseReceipt('SHOP\nTOTAL Rp 12.3456\nRp 11000', 90).amount, null);
});
test('bank preview is an unsaved draft with dated journal command and no account/reference leak', () => {
  const preview = transferPreview(parseReceipt(proof, 88));
  assert.match(preview, /belum disimpan/); assert.match(preview, /piutang/);
  assert.doesNotMatch(preview, /123-456|987654321|9999992026/);
  const command = parseTelegramJournal(preview.split('\n').find(line => line.startsWith('/jurnal')));
  assert.equal(command.amount, 11000); assert.equal(command.date, '2026-10-29');
  assert.equal(command.debit, '5000'); assert.equal(command.credit, '1010');
  for (const date of ['2026-02-30', '2026-13-01', '2026-2-1', 'junk']) {
    assert.equal(parseTelegramJournal(`/jurnal 5000 1010 11000 @${date} Test`), 'invalid_format');
  }
});

function routeApp({ signedOut = false, allowed = true, normalizeError = false } = {}) {
  let reads = 0, authenticates = 0, normalizations = 0;
  const route = load('app/api/receipts/recognize/route.ts', { modules: {
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => { authenticates++; return { data: { user: signedOut ? null : { id: 'verified-owner' } }, error: null }; } } }) },
    '@/lib/supabase/admin': { createAdminClient: () => ({}) },
    '@/lib/security-limits': { consumeSecurityLimits: async (admin, limits) => { assert.equal(limits[0].value, 'verified-owner'); return { allowed }; } },
    '@/lib/receipts/ocr': { recognizeReceipt: async () => { reads++; return parseReceipt(proof, 88); }, ReceiptOcrBusyError: class extends Error {} },
    '@/lib/telegram-media': { MAX_RECEIPT_IMAGE_BYTES: 20 * 1024 * 1024, ReceiptImageError: class extends Error {}, normalizeReceiptImage: async bytes => { normalizations++; if (normalizeError) throw new Error('private decoder details'); return bytes; } },
  } });
  return { route, reads: () => reads, authenticates: () => authenticates, normalizations: () => normalizations };
}
function request({ origin = 'https://saku.example', body = Buffer.from('bounded test image'), headers = {} } = {}) {
  return new Request('https://saku.example/api/receipts/recognize', { method: 'POST', headers: { origin, 'content-type': 'image/jpeg', ...headers }, body });
}
test('web OCR requires same-origin verified login and shared quota before decoding', async () => {
  for (const [options, req, status] of [[{}, { origin: 'https://evil.example' }, 403], [{ signedOut: true }, {}, 401], [{ allowed: false }, {}, 429]]) {
    const app = routeApp(options); assert.equal((await app.route.POST(request(req))).status, status);
    assert.equal(app.reads(), 0); assert.equal(app.normalizations(), 0);
  }
});
test('web OCR bounds streamed bytes, sanitizes failures and does not cache or store proof', async () => {
  let app = routeApp();
  assert.equal((await app.route.POST(request({ body: Buffer.alloc(4 * 1024 * 1024 + 1) }))).status, 413);
  assert.equal(app.normalizations(), 0);
  app = routeApp({ normalizeError: true });
  let response = await app.route.POST(request()); assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private decoder/);
  app = routeApp(); response = await app.route.POST(request());
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const result = await response.json(); assert.equal(result.candidate.amount, 11000);
  assert.equal(result.text, undefined); assert.equal(result.image, undefined);
});
