import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';
import { env } from '../config/env';
import { FeesApi } from '../api-clients/fees-api';
import { PaymentsApi } from '../api-clients/payments-api';

test('PAY-API-001 Create payment returns a PENDING payment without moving money', { tag: ['@api', '@payments'] }, async ({ apiAs, dev }) => {
  let payments: PaymentsApi;
  let fees: FeesApi;
  let feeId: string;
  let balanceBefore: number;
  let created: Record<string, any>;

  await test.step('Precondition: restore simulation defaults', async () => {
    await dev.restoreSimulation();
  });

  await test.step('S1 Log in as loadtest050 and GET fees/outstanding; take Term 3 Tuition', async () => {
    const payer = await apiAs(env.loadtestUser);
    payments = new PaymentsApi(payer);
    fees = new FeesApi(payer);
    const res = await fees.outstanding();
    expect(res.status()).toBe(200);
    const fee = (await res.json()).items.find((f: { description: string }) => f.description === 'Term 3 Tuition');
    expect(fee).toBeDefined();
    feeId = fee.id;
    balanceBefore = fee.balance_cents;
  });

  await test.step('S2 POST payments with a new Idempotency-Key', async () => {
    const key = randomUUID();
    const res = await payments.create({ fee_id: feeId, amount_cents: 10000, payment_method: 'CARD' }, key);
    created = await res.json();

    expect(res.status()).toBe(201);
    expect(res.headers()['location']).toBe(`/api/v1/payments/${created.id}`);
    expect(res.headers()['idempotency-key']).toBe(key);
    expect(res.headers()['idempotent-replayed']).toBeUndefined();

    expect(created).toMatchObject({
      status: 'PENDING',
      amount_cents: 10000,
      currency: 'ZAR',
      fee_id: feeId,
      payment_method: 'CARD',
      is_final: false,
      is_cancellable: true,
      confirm_attempts: 0,
      card_last4: null,
    });
    expect(created.reference).toMatch(/^SF-\d{8}-[0-9A-F]{6}$/);
    expect(created.id).toMatch(/^pay_[0-9a-f]{24}$/);

    expect(created.events.map(({ type, to_status }: { type: string; to_status: string }) => ({ type, to_status }))).toEqual([
      { type: 'PAYMENT_CREATED', to_status: 'PENDING' },
    ]);
  });

  await test.step('S3 GET payments/{id}', async () => {
    const res = await payments.get(created.id);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(created);
  });

  await test.step('S4 GET fees/{feeId}', async () => {
    const res = await fees.get(feeId);
    expect(res.status()).toBe(200);
    expect((await res.json()).balance_cents).toBe(balanceBefore);
  });
});
