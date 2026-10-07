import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brl, split, pmt, price, sac, impliedRate, annualRate, grossUp, checkoutOptions, dueDates } from '../src/index.js';

const cents = (arr) => Math.round(arr.reduce((s, v) => s + v * 100, 0));

test('split: as parcelas somam exatamente o total, sobra nas primeiras', () => {
  assert.deepEqual(split(100, 3), [33.34, 33.33, 33.33]);
  assert.deepEqual(split(0.05, 3), [0.02, 0.02, 0.01]);
  assert.deepEqual(split(10, 1), [10]);
  for (const [total, n] of [[1999.99, 7], [0.01, 12], [123456.78, 11]]) {
    assert.equal(cents(split(total, n)), Math.round(total * 100));
  }
  assert.throws(() => split(100, 0), RangeError);
});

test('Tabela Price: R$ 1.000 a 1% a.m. em 12x', () => {
  // PMT = 1000 · 0,01 / (1 − 1,01^−12) = 88,8488 → 88,85
  assert.equal(pmt(1000, 1, 12), 88.85);
  const t = price(1000, 1, 12);
  assert.deepEqual(t.installments[0], { n: 1, payment: 88.85, interest: 10, amortization: 78.85, balance: 921.15 });
  const last = t.installments.at(-1);
  assert.equal(last.balance, 0, 'quita o saldo');
  assert.equal(last.payment, 88.84, 'a última absorve o arredondamento');
  assert.equal(t.total, 1066.19);
  assert.equal(t.totalInterest, 66.19);
  assert.equal(cents(t.installments.map((r) => r.amortization)), 100000, 'amortizações somam o principal');
});

test('Tabela Price sem juros', () => {
  assert.equal(pmt(100, 0, 3), 33.34);
  const t = price(100, 0, 3);
  assert.deepEqual(t.installments.map((r) => r.payment), [33.34, 33.34, 33.32]);
  assert.equal(t.totalInterest, 0);
});

test('SAC: amortização constante e juros decrescentes', () => {
  // 1.200 em 12x a 1%: amortiza 100 por mês; juros 12, 11, ..., 1 = 78
  const t = sac(1200, 1, 12);
  assert.deepEqual(t.installments[0], { n: 1, payment: 112, interest: 12, amortization: 100, balance: 1100 });
  assert.deepEqual(t.installments.at(-1), { n: 12, payment: 101, interest: 1, amortization: 100, balance: 0 });
  assert.equal(t.totalInterest, 78);
  assert.ok(t.totalInterest < price(1200, 1, 12).totalInterest, 'SAC paga menos juros que a Price');
});

test('taxa implícita e anual equivalente', () => {
  assert.equal(impliedRate(1000, 88.85, 12), 1.0002);
  assert.equal(impliedRate(999, 99.9, 10), 0, '10x de 99,90 = sem juros');
  assert.equal(impliedRate(1000, 100, 12), 2.9229);
  // a taxa encontrada reproduz a parcela
  assert.equal(pmt(1000, impliedRate(1000, 100, 12), 12), 100);
  assert.throws(() => impliedRate(1000, 50, 12), RangeError);
  assert.equal(annualRate(1), 12.68);
  assert.equal(annualRate(0), 0);
});

test('repasse da taxa do cartão: o lojista recebe pelo menos o líquido', () => {
  assert.equal(grossUp(100, 4.99), 105.26);
  assert.equal(grossUp(100, 0), 100);
  for (const fee of [1.99, 3.49, 4.99, 12.37]) {
    for (const net of [9.9, 100, 1234.56]) {
      // conta exata, em centavos: o valor cobrado é o menor que cobre o líquido
      const gross = Math.round(grossUp(net, fee) * 100);
      const received = (g) => g * (1 - fee / 100);
      assert.ok(received(gross) >= net * 100 - 1e-6, `${net} @ ${fee}%`);
      assert.ok(received(gross - 1) < net * 100, 'e não cobra um centavo a mais');
    }
  }
  assert.throws(() => grossUp(100, 100), RangeError);
});

test('checkout: sem juros até 3x, depois Price, e parcela mínima', () => {
  const options = checkoutOptions(100, { interestFreeUpTo: 3, rate: 1.99, minInstallment: 10 });
  assert.deepEqual(options.map((o) => o.label), [
    '1x de R$ 100,00 sem juros',
    '2x de R$ 50,00 sem juros',
    '1x de R$ 33,34 + 2x de R$ 33,33 sem juros',
    '4x de R$ 26,26 (total R$ 105,04)',
    '5x de R$ 21,21 (total R$ 106,05)',
    '6x de R$ 17,85 (total R$ 107,10)',
    '7x de R$ 15,45 (total R$ 108,15)',
    '8x de R$ 13,65 (total R$ 109,20)',
    '9x de R$ 12,25 (total R$ 110,25)',
    '10x de R$ 11,13 (total R$ 111,30)',
    '11x de R$ 10,21 (total R$ 112,31)',
  ]);
  assert.equal(options.length, 11, '12x daria parcela abaixo de R$ 10');
  for (const o of options) assert.equal(cents(o.payments), Math.round(o.total * 100));
});

test('checkout com repasse da taxa por número de parcelas', () => {
  const options = checkoutOptions(1000, { interestFreeUpTo: 2, maxInstallments: 4, fees: { 3: 6.5, 4: 7.2 } });
  assert.deepEqual(options.map((o) => [o.installments, o.total, o.interestFree]), [
    [1, 1000, true], [2, 1000, true], [3, 1069.52, false], [4, 1077.59, false],
  ]);
  assert.equal(options[2].label, '2x de R$ 356,51 + 1x de R$ 356,50 (total R$ 1.069,52)');
  assert.throws(() => checkoutOptions(1000, { interestFreeUpTo: 2, maxInstallments: 4, fees: { 3: 6.5 } }), /4x/);
  assert.throws(() => checkoutOptions(1000, { interestFreeUpTo: 2 }), TypeError);
});

test('vencimentos mantêm o dia original no fim do mês', () => {
  assert.deepEqual(dueDates('2026-01-31', 5), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(dueDates('2027-12-29', 3), ['2027-12-29', '2028-01-29', '2028-02-29'], 'ano bissexto');
  assert.deepEqual(dueDates('2026-11-10', 3), ['2026-11-10', '2026-12-10', '2027-01-10']);
  assert.throws(() => dueDates('10/11/2026', 3), TypeError);
});

test('formatação em reais', () => {
  assert.equal(brl(1234567.8), 'R$ 1.234.567,80');
  assert.equal(brl(0.5), 'R$ 0,50');
  assert.equal(brl(-12.3), '-R$ 12,30');
  assert.equal(brl(999), 'R$ 999,00');
});
