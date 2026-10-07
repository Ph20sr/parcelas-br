# parcelas-br

[![CI](https://github.com/Ph20sr/parcelas-br/actions/workflows/ci.yml/badge.svg)](https://github.com/Ph20sr/parcelas-br/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

**Parcelamento para checkout e cobrança**: o "12x de R$ 26,26" da página de produto, a Tabela Price de um financiamento, o repasse da taxa da maquininha e as datas de vencimento. Todos os valores são calculados em **centavos inteiros**, e as parcelas sempre somam exatamente o total. Não tem dependências.

## O que tem

| função | para quê |
| --- | --- |
| `checkoutOptions(valor, opções)` | lista "1x… 12x" com sem juros até N vezes, juros ou repasse de taxa e parcela mínima |
| `split(total, n)` | divide sem perder centavo: 100 / 3 = 33,34 + 33,33 + 33,33 |
| `price(valor, taxa, n)` | Tabela Price completa: juros, amortização e saldo de cada parcela |
| `sac(valor, taxa, n)` | Sistema de Amortização Constante (parcelas decrescentes) |
| `pmt(valor, taxa, n)` | só o valor da parcela da Price |
| `impliedRate(valor, parcela, n)` | "10x de 119,90 num produto de 999 à vista: quanto de juros?" |
| `annualRate(taxaMensal)` | 1% a.m. = 12,68% a.a. |
| `grossUp(líquido, taxa)` | quanto cobrar para receber o líquido depois da taxa do cartão |
| `dueDates(primeiro, n)` | vencimentos mensais: 31/01 → 28/02 → 31/03 → 30/04 |
| `brl(valor)` | `R$ 1.234,56`, igual em qualquer ambiente (não depende do ICU) |

## Checkout

```js
import { checkoutOptions } from 'parcelas-br';

checkoutOptions(100, { interestFreeUpTo: 3, rate: 1.99, minInstallment: 10 }).map((o) => o.label);
// [
//   '1x de R$ 100,00 sem juros',
//   '2x de R$ 50,00 sem juros',
//   '1x de R$ 33,34 + 2x de R$ 33,33 sem juros',
//   '4x de R$ 26,26 (total R$ 105,04)',
//   ...
//   '11x de R$ 10,21 (total R$ 112,31)'      // 12x ficaria abaixo de R$ 10
// ]
```

Quando a divisão não é exata, o rótulo mostra **exatamente** o que o cliente vai pagar ("1x de R$ 33,34 + 2x de R$ 33,33") em vez de arredondar e cobrar diferente do anunciado.

Para **repassar a taxa do cartão** em vez de cobrar juros, passe as taxas da sua maquininha ou gateway por número de parcelas:

```js
checkoutOptions(1000, { interestFreeUpTo: 2, maxInstallments: 12, fees: { 3: 6.5, 4: 7.2, /* ... */ 12: 13.9 } });
// 3x → total R$ 1.069,52: depois de 6,5% de taxa, você recebe os R$ 1.000 inteiros
```

## Financiamento (Price e SAC)

```js
import { price, sac } from 'parcelas-br';

const t = price(1000, 1, 12);           // R$ 1.000 a 1% ao mês em 12x
t.installments[0];  // { n: 1, payment: 88.85, interest: 10, amortization: 78.85, balance: 921.15 }
t.installments[11]; // { n: 12, payment: 88.84, interest: 0.88, amortization: 87.96, balance: 0 }
t.totalInterest;    // 66.19

sac(1200, 1, 12).totalInterest;          // 78 (menos juros que a Price, parcelas decrescentes)
```

A última parcela absorve a diferença de arredondamento, então o saldo sempre termina em **zero**, não em R$ 0,03.

## Detalhes que costumam dar errado

- **Taxa da maquininha:** cobrar `valor × (1 + taxa)` não basta, porque a taxa incide sobre o valor cobrado. `grossUp` divide por `(1 − taxa)` e arredonda para cima. O teste garante que o lojista recebe o líquido e que não é cobrado nenhum centavo a mais.
- **Dia 31:** somar um mês a partir da data anterior prende as parcelas no dia 28 depois de fevereiro. `dueDates` calcula cada vencimento a partir do dia original.
- **Taxa implícita:** é calculada por bisseção, que sempre converge (Newton pode divergir com chutes ruins).

## Desenvolvimento

```bash
npm test
```

## Licença

MIT
