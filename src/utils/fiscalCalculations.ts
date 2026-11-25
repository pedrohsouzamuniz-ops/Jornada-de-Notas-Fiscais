import {
  FiscalDocType,
  FiscalInvoice,
  FiscalItemAssociation,
  PhysicalReceipt,
  PurchaseOrder,
  ServiceTaxRegime,
} from '../types/p2p';
import { formatBRL } from './formatters';

export interface FiscalNetCalculationInput {
  docType: FiscalDocType;
  totalProducts: number;
  freightAmount?: number;
  insuranceAmount?: number;
  otherExpensesAmount?: number;
  surchargeAmount?: number;
  ipiAmount?: number;
  icmsStAmount?: number;
  discountAmount?: number;
  retainedTaxesAmount?: number;
  taxRegime?: ServiceTaxRegime | '';
  pisAmount?: number;
  cofinsAmount?: number;
  csllAmount?: number;
  issqnAmount?: number;
  issqnRetained?: boolean;
  inssAmount?: number;
  irrfAmount?: number;
}

export function roundMoney(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function toCents(value: number): number {
  return Math.round(Number(value || 0) * 100);
}

/**
 * Calcula o total de impostos efetivamente retidos na fonte (que reduzem o valor líquido a pagar):
 * - NFS-e:
 *   - MEI: 0
 *   - Simples Nacional: ISSQN (quando retido) + INSS + Outras retenções
 *   - Regime Normal: PIS + COFINS + CSLL + ISSQN (quando retido) + INSS + IRRF + Outras retenções
 * - NF-e e CT-e:
 *   - Impostos destacados de crédito/faturamento (ICMS, PIS, COFINS normais, ISS destacado) NÃO deduzem do líquido.
 *   - Deduz apenas o que é retido: CSLL retido + IRRF + INSS + ISSQN retido + Outras retenções (vRetPIS/vRetCOFINS etc.).
 */
export function getEffectiveRetainedTaxes(input: FiscalNetCalculationInput): number {
  const pis = Math.max(0, Number(input.pisAmount || 0));
  const cofins = Math.max(0, Number(input.cofinsAmount || 0));
  const csll = Math.max(0, Number(input.csllAmount || 0));
  const issqn = input.issqnRetained === false ? 0 : Math.max(0, Number(input.issqnAmount || 0));
  const inss = Math.max(0, Number(input.inssAmount || 0));
  const irrf = Math.max(0, Number(input.irrfAmount || 0));
  const extraRetained = Math.max(0, Number(input.retainedTaxesAmount || 0));

  if (input.docType === 'NFSE') {
    if (input.taxRegime === 'mei') {
      return 0;
    }
    if (input.taxRegime === 'simples_nacional') {
      return roundMoney(issqn + inss + extraRetained);
    }
    return roundMoney(pis + cofins + csll + issqn + inss + irrf + extraRetained);
  }

  return roundMoney(csll + issqn + inss + irrf + extraRetained);
}

/**
 * Calcula automaticamente o Valor Líquido da nota fiscal:
 * - NF-e: Produtos + Frete + Seguro + Outras Despesas + Acréscimos + IPI + ICMS ST - Descontos - Impostos Efetivamente Retidos
 * - NFS-e: Serviços + Outras Despesas + Acréscimos - Descontos - Retenções aplicáveis ao regime
 * - CT-e: Valor da Prestação + Seguro + Outras Despesas + Acréscimos - Descontos - Impostos Efetivamente Retidos (sem duplicar frete)
 */
export function calculateFiscalNetTotal(input: FiscalNetCalculationInput): number {
  const baseProducts = Math.max(0, Number(input.totalProducts || 0));
  const freight = input.docType === 'NFE' ? Math.max(0, Number(input.freightAmount || 0)) : 0;
  const insurance =
    input.docType === 'NFSE' ? 0 : Math.max(0, Number(input.insuranceAmount || 0));
  const otherExpenses = Math.max(0, Number(input.otherExpensesAmount || 0));
  const surcharge = Math.max(0, Number(input.surchargeAmount || 0));
  const ipi = input.docType === 'NFE' ? Math.max(0, Number(input.ipiAmount || 0)) : 0;
  const icmsSt = input.docType === 'NFE' ? Math.max(0, Number(input.icmsStAmount || 0)) : 0;
  const discount = Math.max(0, Number(input.discountAmount || 0));
  const retainedTaxes = getEffectiveRetainedTaxes(input);

  const rawNet =
    baseProducts +
    freight +
    insurance +
    otherExpenses +
    surcharge +
    ipi +
    icmsSt -
    discount -
    retainedTaxes;
  return roundMoney(Math.max(0, rawNet));
}

export interface FinancialComparisonInput {
  docType: FiscalDocType;
  invoiceGrossTotal: number;
  invoiceNetTotal: number;
  invoiceDiscountAmount?: number;
  invoiceOtherExpenses?: number;
  invoiceSurcharge?: number;
  expectedPoAmount: number;
  isPartialBilling?: boolean;
}

export interface FinancialComparisonResult {
  criterion: 'liquid_nfe' | 'liquid_cte' | 'gross_nfse';
  criterionLabel: string;
  poComparedAmount: number;
  invoiceComparedAmount: number;
  differenceCents: number;
  differenceAmount: number;
  matches: boolean;
  isPartialBilling: boolean;
  divergenceReason: string | null;
}

/**
 * Critério obrigatório e centralizado de comparação financeira Pedido x Documento Fiscal:
 * - NF-e: Pedido de Compra × Valor Líquido da NF-e
 * - CT-e: Pedido de Compra × Valor Líquido do CT-e
 * - NFS-e: Pedido de Compra × Valor Bruto dos Serviços (antes das retenções tributárias)
 * Precisão exata em centavos (zero tolerância arbitrária).
 */
export function comparePurchaseOrderAndInvoice(
  input: FinancialComparisonInput
): FinancialComparisonResult {
  const poComparedAmount = roundMoney(Math.max(0, Number(input.expectedPoAmount || 0)));
  const isPartialBilling = Boolean(input.isPartialBilling);

  let criterion: FinancialComparisonResult['criterion'] = 'liquid_nfe';
  let criterionLabel = 'Valor Líquido (NF-e)';
  let invoiceComparedAmount = roundMoney(Math.max(0, Number(input.invoiceNetTotal || 0)));

  if (input.docType === 'CTE') {
    criterion = 'liquid_cte';
    criterionLabel = 'Valor Líquido (CT-e)';
    invoiceComparedAmount = roundMoney(Math.max(0, Number(input.invoiceNetTotal || 0)));
  } else if (input.docType === 'NFSE') {
    criterion = 'gross_nfse';
    criterionLabel = 'Valor Bruto dos Serviços antes das retenções (NFS-e)';
    const gross = Math.max(0, Number(input.invoiceGrossTotal || 0));
    const extras =
      Math.max(0, Number(input.invoiceOtherExpenses || 0)) +
      Math.max(0, Number(input.invoiceSurcharge || 0));
    const discount = Math.max(0, Number(input.invoiceDiscountAmount || 0));
    invoiceComparedAmount = roundMoney(Math.max(0, gross + extras - discount));
  }

  const invCents = toCents(invoiceComparedAmount);
  const poCents = toCents(poComparedAmount);
  const differenceCents = invCents - poCents;
  const differenceAmount = roundMoney(differenceCents / 100);
  const matches = differenceCents === 0;

  let divergenceReason: string | null = null;
  if (!matches) {
    const scopeLabel = isPartialBilling ? 'parcela faturada do pedido' : 'valor do pedido';
    if (input.docType === 'NFSE') {
      divergenceReason = `Valor bruto dos serviços da NFS-e (${formatBRL(
        invoiceComparedAmount
      )}) diverge do ${scopeLabel} (${formatBRL(poComparedAmount)})`;
    } else if (input.docType === 'CTE') {
      divergenceReason = `Valor líquido do CT-e (${formatBRL(
        invoiceComparedAmount
      )}) diverge do ${scopeLabel} (${formatBRL(poComparedAmount)})`;
    } else {
      divergenceReason = `Valor líquido da NF-e (${formatBRL(
        invoiceComparedAmount
      )}) diverge do ${scopeLabel} (${formatBRL(poComparedAmount)})`;
    }
  }

  return {
    criterion,
    criterionLabel,
    poComparedAmount,
    invoiceComparedAmount,
    differenceCents,
    differenceAmount,
    matches,
    isPartialBilling,
    divergenceReason,
  };
}

/**
 * Gera uma assinatura determinística da versão dos dados de conferência.
 * Qualquer alteração nos valores/itens da NF, PO, Recebimento ou mapeamento de itens
 * altera essa assinatura e invalida confirmações manuais anteriores.
 */
export function buildConferenceFingerprint(params: {
  invoice: Pick<
    FiscalInvoice,
    | 'docType'
    | 'grossAmount'
    | 'totalProducts'
    | 'freightAmount'
    | 'insuranceAmount'
    | 'otherExpensesAmount'
    | 'surchargeAmount'
    | 'discountAmount'
    | 'ipiAmount'
    | 'icmsStAmount'
    | 'pisAmount'
    | 'cofinsAmount'
    | 'csllAmount'
    | 'issqnAmount'
    | 'issqnRetained'
    | 'inssAmount'
    | 'irrfAmount'
    | 'retainedTaxesAmount'
    | 'taxRegime'
    | 'totalInvoice'
    | 'items'
  >;
  po?: Pick<PurchaseOrder, 'id' | 'totalAmount' | 'freightAmount' | 'discountAmount' | 'items'>;
  receipt?: Pick<PhysicalReceipt, 'id' | 'status' | 'items'>;
  itemAssociations?: FiscalItemAssociation[];
  requiresPhysicalReceipt?: boolean;
  isPartialBilling?: boolean;
}): string {
  const inv = params.invoice;
  const invItemsSig = (inv.items || [])
    .map(
      (it) =>
        `${it.code}|${it.description}|${it.unit}|${Number(it.qty || 0)}|${Number(
          it.unitPrice || 0
        ).toFixed(4)}|${Number(it.totalPrice || 0).toFixed(2)}`
    )
    .join(';');

  const poSig = params.po
    ? `${params.po.id}:${Number(params.po.totalAmount || 0).toFixed(2)}:${Number(
        params.po.freightAmount || 0
      ).toFixed(2)}:${Number(params.po.discountAmount || 0).toFixed(2)}:[${params.po.items
        .map(
          (p) =>
            `${p.code}|${p.description}|${p.unit}|${Number(p.qtyOrdered || 0)}|${Number(
              p.unitPrice || 0
            ).toFixed(4)}`
        )
        .join(';')}]`
    : 'NO_PO';

  const recSig = params.receipt
    ? `${params.receipt.id}:${params.receipt.status}:[${params.receipt.items
        .map((r) => `${r.code}|${r.description}|${Number(r.qtyReceived || 0)}|${r.condition}`)
        .join(';')}]`
    : 'NO_REC';

  const assocSig = (params.itemAssociations || [])
    .map(
      (a) =>
        `${a.invoiceItemIndexes.join(',')}->${a.poItemIndexes.join(',')}@${Number(
          a.conversionFactor || 1
        )}`
    )
    .sort()
    .join(';');

  const raw = [
    inv.docType || 'NFE',
    Number(inv.grossAmount ?? inv.totalProducts ?? 0).toFixed(2),
    Number(inv.totalProducts || 0).toFixed(2),
    Number(inv.freightAmount || 0).toFixed(2),
    Number(inv.insuranceAmount || 0).toFixed(2),
    Number(inv.otherExpensesAmount || 0).toFixed(2),
    Number(inv.surchargeAmount || 0).toFixed(2),
    Number(inv.discountAmount || 0).toFixed(2),
    Number(inv.ipiAmount || 0).toFixed(2),
    Number(inv.icmsStAmount || 0).toFixed(2),
    Number(inv.pisAmount || 0).toFixed(2),
    Number(inv.cofinsAmount || 0).toFixed(2),
    Number(inv.csllAmount || 0).toFixed(2),
    Number(inv.issqnAmount || 0).toFixed(2),
    String(inv.issqnRetained ?? true),
    Number(inv.inssAmount || 0).toFixed(2),
    Number(inv.irrfAmount || 0).toFixed(2),
    Number(inv.retainedTaxesAmount || 0).toFixed(2),
    inv.taxRegime || '',
    Number(inv.totalInvoice || 0).toFixed(2),
    String(params.requiresPhysicalReceipt ?? true),
    String(params.isPartialBilling ?? false),
    invItemsSig,
    poSig,
    recSig,
    assocSig,
  ].join('||');

  // FNV-1a 64-bit equivalent pair hash (fast, synchronous, deterministic across environments)
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `cfv1_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function formatFiscalActionError(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const msg = error.message || '';
  if (msg.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(msg) as {
        error?: string;
        operationType?: string;
        path?: string | null;
      };
      if (parsed && typeof parsed.error === 'string') {
        const op = parsed.operationType || 'write';
        const targetPath = parsed.path ? ` (${parsed.path})` : '';
        if (
          parsed.error.toLowerCase().includes('missing or insufficient permissions') ||
          parsed.error.toLowerCase().includes('permission-denied')
        ) {
          return `Permissão ou validação negada pelo Firestore em ${op}${targetPath}. Verifique: (1) seu usuário autenticado e permissões do setor, (2) os vínculos obrigatórios (Pedido de Compra e, quando exigido, Recebimento Físico) para o status selecionado e (3) se o arquivo firestore.rules atualizado já foi publicado no console do Firebase.`;
        }
        return `Falha no Firestore (${op}${targetPath}): ${parsed.error}`;
      }
    } catch {
      // Fallback to raw message
    }
  }

  return msg || fallbackMessage;
}
