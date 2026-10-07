// Parcelamento para checkout e cobrança. Valores em reais na API, centavos por dentro.

const toCents = (v) => Math.round(v * 100);
const fromCents = (c) => c / 100;

function check(principal, rate, n) {
  if (!(principal > 0)) throw new RangeError('principal deve ser maior que zero');
  if (!(rate >= 0)) throw new RangeError('taxa (rate) não pode ser negativa');
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n deve ser um inteiro ≥ 1');
}

/** "R$ 1.234,56" sem depender do ICU do Node (mesma saída em qualquer ambiente). */
export function brl(value) {
  const cents = toCents(value);
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${int},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Divide um valor em n parcelas que somam exatamente o total.
 * Os centavos que sobram vão para as primeiras parcelas: 100 / 3 = 33,34 + 33,33 + 33,33.
 */
export function split(total, n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n deve ser um inteiro ≥ 1');
  const cents = toCents(total);
  const base = Math.trunc(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => fromCents(base + (i < Math.abs(rest) ? Math.sign(rest) : 0)));
}

/** Parcela fixa da Tabela Price: P · i / (1 − (1 + i)^−n). */
export function pmt(principal, ratePercent, n) {
  check(principal, ratePercent, n);
  const i = ratePercent / 100;
  if (i === 0) return fromCents(Math.ceil(toCents(principal) / n));
  return fromCents(Math.round((toCents(principal) * i) / (1 - (1 + i) ** -n)));
}

function table(principal, ratePercent, n, amortizationOf) {
  const i = ratePercent / 100;
  let balance = toCents(principal);
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const interest = Math.round(balance * i);
    // a última parcela quita o saldo: o arredondamento nunca deixa resto
    const amortization = k === n ? balance : Math.min(balance, amortizationOf(k, interest));
    balance -= amortization;
    rows.push({
      n: k,
      payment: fromCents(interest + amortization),
      interest: fromCents(interest),
      amortization: fromCents(amortization),
      balance: fromCents(balance),
    });
  }
  const sum = (key) => fromCents(rows.reduce((s, r) => s + toCents(r[key]), 0));
  return { installments: rows, total: sum('payment'), totalInterest: sum('interest') };
}

/** Tabela Price (parcelas iguais). A última absorve a diferença de arredondamento. */
export function price(principal, ratePercent, n) {
  const payment = toCents(pmt(principal, ratePercent, n));
  return table(principal, ratePercent, n, (_, interest) => payment - interest);
}

/** SAC: amortização constante, parcelas decrescentes. */
export function sac(principal, ratePercent, n) {
  check(principal, ratePercent, n);
  const parts = split(principal, n).map(toCents);
  return table(principal, ratePercent, n, (k) => parts[k - 1]);
}

/**
 * Taxa mensal implícita (%) de um parcelamento: "12x de 99,90 num produto de 999 — quanto de juros?".
 * Resolve por bisseção, que sempre converge (o valor presente cai conforme a taxa sobe).
 */
export function impliedRate(principal, payment, n) {
  check(principal, 0, n);
  if (payment * n < principal - 0.005) throw new RangeError('As parcelas somam menos que o valor à vista');
  if (Math.abs(payment * n - principal) < 0.005 * n) return 0;
  const pv = (i) => payment * (1 - (1 + i) ** -n) / i;
  let lo = 1e-9;
  let hi = 1;
  while (pv(hi) > principal) hi *= 2;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > principal) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100 * 1e4) / 1e4;
}

/** Taxa mensal → anual equivalente (juros compostos), em %. */
export function annualRate(monthlyPercent) {
  return Math.round(((1 + monthlyPercent / 100) ** 12 - 1) * 100 * 100) / 100;
}

/**
 * Valor a cobrar para receber `net` líquido depois da taxa da maquininha/gateway.
 * Arredonda para cima: o lojista nunca recebe menos que o combinado.
 */
export function grossUp(net, feePercent) {
  if (!(feePercent >= 0 && feePercent < 100)) throw new RangeError('feePercent deve estar entre 0 e 100');
  return fromCents(Math.ceil(toCents(net) / (1 - feePercent / 100) - 1e-9));
}

/** [33.34, 33.33, 33.33] → "1x de R$ 33,34 + 2x de R$ 33,33" (o cliente vê exatamente o que paga). */
function describe(parts) {
  const groups = [];
  for (const v of parts) {
    const last = groups.at(-1);
    if (last && last.value === v) last.count++;
    else groups.push({ value: v, count: 1 });
  }
  return groups.map((g) => `${g.count}x de ${brl(g.value)}`).join(' + ');
}

/**
 * Opções de parcelamento para o checkout.
 * - até `interestFreeUpTo` parcelas: sem juros (o valor dividido)
 * - acima: Tabela Price com `rate` ao mês, ou repasse da taxa do cartão por número de parcelas (`fees`)
 * - para quando a parcela ficaria abaixo de `minInstallment`
 */
export function checkoutOptions(amount, { maxInstallments = 12, interestFreeUpTo = 1, minInstallment = 5, rate, fees } = {}) {
  if (!(amount > 0)) throw new RangeError('amount deve ser maior que zero');
  if (rate === undefined && fees === undefined && interestFreeUpTo < maxInstallments) {
    throw new TypeError('Informe rate ou fees para as parcelas com juros');
  }
  const options = [];
  for (let n = 1; n <= maxInstallments; n++) {
    let parts;
    let interestFree = n <= interestFreeUpTo;
    if (interestFree) parts = split(amount, n);
    else if (fees) {
      const fee = fees[n];
      if (fee === undefined) throw new RangeError(`fees sem a taxa de ${n}x`);
      parts = split(grossUp(amount, fee), n);
    } else {
      // no cartão, as parcelas da Price são todas iguais (é assim que o gateway cobra)
      parts = Array(n).fill(pmt(amount, rate, n));
    }
    if (n > 1 && Math.min(...parts) < minInstallment) break;
    const total = fromCents(parts.reduce((s, v) => s + toCents(v), 0));
    options.push({
      installments: n,
      payment: parts[0],
      payments: parts,
      total,
      interestFree,
      label: `${describe(parts)}${interestFree ? ' sem juros' : ` (total ${brl(total)})`}`,
    });
  }
  return options;
}

/**
 * Datas de vencimento mensais mantendo o dia original: 31/01 → 28/02 → 31/03 → 30/04.
 * (Encadear "mais um mês" a partir de 28/02 prenderia todas as parcelas no dia 28.)
 */
export function dueDates(first, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(first);
  if (!m) throw new TypeError('first deve estar no formato AAAA-MM-DD');
  const [y, mo, d] = m.slice(1).map(Number);
  return Array.from({ length: n }, (_, k) => {
    const month0 = mo - 1 + k;
    const year = y + Math.floor(month0 / 12);
    const month = (month0 % 12) + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  });
}
