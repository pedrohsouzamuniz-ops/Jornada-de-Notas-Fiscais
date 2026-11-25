import {
  FiscalDocType,
  FiscalInvoice,
  FiscalItemAssociation,
  MatchingStatus,
  PhysicalReceipt,
  ProductEquivalence,
  PurchaseOrder,
} from '../types/p2p';
import {
  FinancialComparisonResult,
  comparePurchaseOrderAndInvoice,
  roundMoney,
} from './fiscalCalculations';
import { formatBRL, normalizeCnpjDigits } from './formatters';
import {
  ItemMatchSuggestion,
  buildDeterministicItemAssociations,
  computeAssociationMetrics,
} from './itemReconciliation';

export interface ThreeWayItemComparison {
  associationId?: string;
  invoiceItemIndexes: number[];
  poItemIndexes: number[];
  code: string;
  description: string;
  poCode?: string;
  poDescription?: string;
  poUnit?: string;
  invoiceUnit?: string;
  conversionFactor: number;
  origin: 'smart' | 'equivalence' | 'manual' | 'unmatched';
  poQty: number | null;
  invoiceQty: number | null;
  invoiceRawQty?: number | null;
  poUnitPrice: number | null;
  invoiceUnitPrice: number | null;
  qtyMatch: boolean;
  unitPriceMatch: boolean;
  matchedInPo: boolean;
}

export type ConferenceBadgeState =
  | 'sem_divergencia'
  | 'divergente'
  | 'aguardando_conciliacao'
  | 'aguardando_vinculo'
  | 'aguardando_ajuste_compras';

export interface OtherLinkedInvoiceInput {
  id: string;
  docType?: FiscalDocType;
  grossAmount?: number;
  totalProducts?: number;
  totalInvoice?: number;
  discountAmount?: number;
  otherExpensesAmount?: number;
  surchargeAmount?: number;
  items: FiscalInvoice['items'];
  itemAssociations?: FiscalItemAssociation[];
}

export interface EvaluateMatchOptions {
  savedEquivalences?: ProductEquivalence[];
  otherLinkedInvoicesForPo?: OtherLinkedInvoiceInput[];
  isPreImport?: boolean;
}

export interface ThreeWayMatchDetails {
  status: MatchingStatus;
  conferenceBadgeState: ConferenceBadgeState;
  reasons: string[];
  poGrossTotal: number | null;
  poTotal: number | null; // Valor de referência do Pedido utilizado na comparação (total ou parcela faturada)
  poFullTotal: number | null; // Valor líquido total do Pedido de Compra
  invoiceGrossTotal: number;
  invoiceTotal: number; // Valor líquido da nota
  grossMatch: boolean | null;
  netMatch: boolean | null;
  financialComparison: FinancialComparisonResult | null;
  isPartialBilling: boolean;
  qtyMatch: boolean | null;
  unitPricesMatch: boolean | null;
  receivedQtyTotal: number | null;
  orderedQtyTotal: number | null;
  invoiceQtyTotal: number;
  itemComparisons: ThreeWayItemComparison[];
  associations: FiscalItemAssociation[];
  suggestions: ItemMatchSuggestion[];
  unmatchedInvoiceItemIndexes: number[];
  unmatchedPoItemIndexes: number[];
}

function getOtherInvoicesBilledByPoItem(
  po: PurchaseOrder,
  otherInvoices: OtherLinkedInvoiceInput[],
  savedEquivalences: ProductEquivalence[]
): Map<number, number> {
  const billedByPo = new Map<number, number>();
  otherInvoices.forEach((other) => {
    const { associations } = buildDeterministicItemAssociations({
      docType: other.docType || 'NFE',
      supplierCnpj: po.supplierCnpj,
      invoiceItems: other.items || [],
      poItems: po.items,
      savedEquivalences,
      existingAssociations: other.itemAssociations,
    });
    associations.forEach((assoc) => {
      const metrics = computeAssociationMetrics({
        assoc,
        invoiceItems: other.items || [],
        poItems: po.items,
      });
      if (assoc.poItemIndexes.length === 1) {
        const poIdx = assoc.poItemIndexes[0];
        billedByPo.set(
          poIdx,
          Number(((billedByPo.get(poIdx) || 0) + metrics.invoiceQtyConverted).toFixed(4))
        );
      } else {
        assoc.poItemIndexes.forEach((poIdx) => {
          const poItem = po.items[poIdx];
          if (!poItem) return;
          const addQty = Math.min(Number(poItem.qtyOrdered || 0), metrics.invoiceQtyConverted);
          billedByPo.set(
            poIdx,
            Number(((billedByPo.get(poIdx) || 0) + addQty).toFixed(4))
          );
        });
      }
    });
  });
  return billedByPo;
}

export function evaluateThreeWayMatch(
  invoice: Pick<
    FiscalInvoice,
    'issuerCnpj' | 'totalProducts' | 'totalInvoice' | 'items' | 'purchaseOrderId' | 'receiptId'
  > & {
    id?: string;
    docType?: FiscalDocType;
    grossAmount?: number;
    discountAmount?: number;
    otherExpensesAmount?: number;
    surchargeAmount?: number;
    requiresPhysicalReceipt?: boolean;
    isPartialBilling?: boolean;
    itemAssociations?: FiscalItemAssociation[];
    pendingAdjustmentId?: string;
  },
  po?: PurchaseOrder,
  receipt?: PhysicalReceipt,
  options?: EvaluateMatchOptions
): ThreeWayMatchDetails {
  const docType: FiscalDocType = invoice.docType || 'NFE';
  const isPreImport = Boolean(options?.isPreImport);
  const requiresPhysicalReceipt = invoice.requiresPhysicalReceipt ?? true;
  const explicitPartialBilling = Boolean(invoice.isPartialBilling);
  const savedEquivalences = options?.savedEquivalences || [];
  const otherInvoices = (options?.otherLinkedInvoicesForPo || []).filter(
    (other) => !invoice.id || other.id !== invoice.id
  );

  const invoiceQtyTotal = Number(
    (invoice.items || []).reduce((sum, it) => sum + Number(it.qty || 0), 0).toFixed(4)
  );
  const invoiceGrossTotal = roundMoney(
    Number(invoice.grossAmount ?? invoice.totalProducts ?? 0)
  );
  const invoiceNetTotal = roundMoney(Number(invoice.totalInvoice || 0));

  const poFullGrossTotal = po
    ? roundMoney(
        po.items.reduce(
          (sum, it) => sum + Number(it.qtyOrdered || 0) * Number(it.unitPrice || 0),
          0
        )
      )
    : null;
  const poFullNetTotal = po ? roundMoney(Number(po.totalAmount || 0)) : null;
  const orderedQtyTotal = po
    ? Number(po.items.reduce((sum, it) => sum + Number(it.qtyOrdered || 0), 0).toFixed(4))
    : null;
  const receivedQtyTotal = receipt
    ? Number(receipt.items.reduce((sum, it) => sum + Number(it.qtyReceived || 0), 0).toFixed(4))
    : null;

  const missingPo = !po || (!isPreImport && !invoice.purchaseOrderId);
  const missingRequiredReceipt =
    !isPreImport && requiresPhysicalReceipt && (!invoice.receiptId || !receipt);

  if (missingPo) {
    return {
      status: 'pendente_vinculo',
      conferenceBadgeState: invoice.pendingAdjustmentId
        ? 'aguardando_ajuste_compras'
        : 'aguardando_vinculo',
      reasons: [
        invoice.pendingAdjustmentId
          ? 'Aguardando ajuste do Pedido de Compra pelo setor de Compras'
          : 'Pedido de Compra não vinculado (obrigatório para liberar lançamento)',
      ],
      poGrossTotal: null,
      poTotal: null,
      poFullTotal: null,
      invoiceGrossTotal,
      invoiceTotal: invoiceNetTotal,
      grossMatch: null,
      netMatch: null,
      financialComparison: null,
      isPartialBilling: false,
      qtyMatch: null,
      unitPricesMatch: null,
      receivedQtyTotal,
      orderedQtyTotal: null,
      invoiceQtyTotal,
      itemComparisons: (invoice.items || []).map((it, idx) => ({
        invoiceItemIndexes: [idx],
        poItemIndexes: [],
        code: it.code,
        description: it.description,
        invoiceUnit: it.unit,
        conversionFactor: 1,
        origin: 'unmatched',
        poQty: null,
        invoiceQty: Number(it.qty || 0),
        invoiceRawQty: Number(it.qty || 0),
        poUnitPrice: null,
        invoiceUnitPrice: Number(it.unitPrice || 0),
        qtyMatch: false,
        unitPriceMatch: false,
        matchedInPo: false,
      })),
      associations: [],
      suggestions: [],
      unmatchedInvoiceItemIndexes: (invoice.items || []).map((_, idx) => idx),
      unmatchedPoItemIndexes: [],
    };
  }

  // Deterministic item reconciliation (preserving manual links & applying saved supplier equivalences)
  const { associations, suggestions } = buildDeterministicItemAssociations({
    docType,
    supplierCnpj: po.supplierCnpj || invoice.issuerCnpj,
    invoiceItems: invoice.items || [],
    poItems: po.items,
    savedEquivalences,
    existingAssociations: invoice.itemAssociations,
  });

  const otherBilledByPoItem = getOtherInvoicesBilledByPoItem(
    po,
    otherInvoices,
    savedEquivalences
  );

  const usedInv = new Set<number>();
  const usedPo = new Set<number>();
  const currentBilledByPoItem = new Map<number, number>();
  const itemComparisons: ThreeWayItemComparison[] = [];
  const itemReasons: string[] = [];
  let allUnitPricesMatch = true;
  let allQuantitiesMatchPo = true;
  let hasAnyPartialPoItem = otherInvoices.length > 0;
  let parcelAuthorizedExpectedItemsTotal = 0;

  associations.forEach((assoc) => {
    assoc.invoiceItemIndexes.forEach((i) => usedInv.add(i));
    assoc.poItemIndexes.forEach((i) => usedPo.add(i));

    const metrics = computeAssociationMetrics({
      assoc,
      invoiceItems: invoice.items || [],
      poItems: po.items,
    });

    const firstInv = (invoice.items || [])[assoc.invoiceItemIndexes[0]];
    const firstPo = po.items[assoc.poItemIndexes[0]];
    const invLabel = assoc.invoiceItemIndexes
      .map((i) => invoice.items[i]?.description)
      .filter(Boolean)
      .join(' + ');
    const poLabel = assoc.poItemIndexes
      .map((i) => po.items[i]?.description)
      .filter(Boolean)
      .join(' + ');

    let priorBilled = 0;
    let remainingAuthorizedQty = 0;
    if (assoc.poItemIndexes.length === 1) {
      const poIdx = assoc.poItemIndexes[0];
      priorBilled = otherBilledByPoItem.get(poIdx) || 0;
      remainingAuthorizedQty = Math.max(0, Number(po.items[poIdx].qtyOrdered || 0) - priorBilled);
      currentBilledByPoItem.set(
        poIdx,
        Number(((currentBilledByPoItem.get(poIdx) || 0) + metrics.invoiceQtyConverted).toFixed(4))
      );
    } else {
      priorBilled = assoc.poItemIndexes.reduce(
        (s, idx) => s + (otherBilledByPoItem.get(idx) || 0),
        0
      );
      remainingAuthorizedQty = Math.max(0, metrics.poQtyTotal - priorBilled);
      assoc.poItemIndexes.forEach((poIdx) => {
        currentBilledByPoItem.set(
          poIdx,
          Number(((currentBilledByPoItem.get(poIdx) || 0) + metrics.invoiceQtyConverted).toFixed(4))
        );
      });
    }

    const cumulativeQty = Number((priorBilled + metrics.invoiceQtyConverted).toFixed(4));
    const exceedsPoQty = cumulativeQty > metrics.poQtyTotal + 0.001;
    const isPartialForItem =
      metrics.invoiceQtyConverted + 0.001 < remainingAuthorizedQty || priorBilled > 0.001;
    if (isPartialForItem) {
      hasAnyPartialPoItem = true;
    }

    // Parcel authorized value caps at remaining PO qty so excessive billing still flags financially!
    const authorizedQtyForParcel = Math.min(metrics.invoiceQtyConverted, remainingAuthorizedQty);
    parcelAuthorizedExpectedItemsTotal += authorizedQtyForParcel * metrics.poUnitPriceEffective;

    if (!metrics.unitPriceMatch) {
      allUnitPricesMatch = false;
      itemReasons.push(
        `Valor unitário de "${invLabel}" na nota (${formatBRL(
          metrics.invoiceUnitPriceEffective
        )}) diverge do Pedido (${formatBRL(metrics.poUnitPriceEffective)})`
      );
    }

    const effectiveQtyMatch = exceedsPoQty
      ? false
      : explicitPartialBilling
      ? metrics.invoiceQtyConverted > 0
      : priorBilled > 0.001
      ? Math.abs(metrics.invoiceQtyConverted - remainingAuthorizedQty) <= 0.001
      : metrics.qtyMatch;

    if (!effectiveQtyMatch) {
      allQuantitiesMatchPo = false;
      if (exceedsPoQty) {
        itemReasons.push(
          priorBilled > 0.001
            ? `Qtd acumulada de "${invLabel}" (${cumulativeQty}, sendo ${priorBilled} em notas anteriores + ${metrics.invoiceQtyConverted} nesta nota) excede o Pedido (${metrics.poQtyTotal})`
            : `Qtd de "${invLabel}" na NF (${metrics.invoiceQtyConverted}) excede o Pedido (${metrics.poQtyTotal})`
        );
      } else {
        itemReasons.push(
          `Qtd de "${invLabel}" na NF (${metrics.invoiceQtyConverted}) diverge do Pedido (${metrics.poQtyTotal})`
        );
      }
    }

    itemComparisons.push({
      associationId: assoc.id,
      invoiceItemIndexes: assoc.invoiceItemIndexes,
      poItemIndexes: assoc.poItemIndexes,
      code: firstInv?.code || firstPo?.code || '',
      description: invLabel || poLabel,
      poCode: firstPo?.code,
      poDescription: poLabel,
      poUnit: firstPo?.unit,
      invoiceUnit: firstInv?.unit,
      conversionFactor: assoc.conversionFactor,
      origin: assoc.origin,
      poQty: metrics.poQtyTotal,
      invoiceQty: metrics.invoiceQtyConverted,
      invoiceRawQty: metrics.invoiceRawQtySum,
      poUnitPrice: metrics.poUnitPriceEffective,
      invoiceUnitPrice: metrics.invoiceUnitPriceEffective,
      qtyMatch: effectiveQtyMatch,
      unitPriceMatch: metrics.unitPriceMatch,
      matchedInPo: true,
    });
  });

  const unmatchedInvoiceItemIndexes: number[] = [];
  (invoice.items || []).forEach((invItem, idx) => {
    if (usedInv.has(idx)) return;
    unmatchedInvoiceItemIndexes.push(idx);
    allUnitPricesMatch = false;
    allQuantitiesMatchPo = false;
    itemComparisons.push({
      invoiceItemIndexes: [idx],
      poItemIndexes: [],
      code: invItem.code,
      description: invItem.description,
      invoiceUnit: invItem.unit,
      conversionFactor: 1,
      origin: 'unmatched',
      poQty: null,
      invoiceQty: Number(invItem.qty || 0),
      invoiceRawQty: Number(invItem.qty || 0),
      poUnitPrice: null,
      invoiceUnitPrice: Number(invItem.unitPrice || 0),
      qtyMatch: false,
      unitPriceMatch: false,
      matchedInPo: false,
    });
    itemReasons.push(
      `Item "${invItem.description}" da nota aguardando conciliação com o Pedido de Compra`
    );
  });

  const unmatchedPoItemIndexes: number[] = [];
  po.items.forEach((poItem, idx) => {
    if (usedPo.has(idx)) return;
    unmatchedPoItemIndexes.push(idx);
    const priorBilled = otherBilledByPoItem.get(idx) || 0;
    const remaining = Math.max(0, Number(poItem.qtyOrdered || 0) - priorBilled);
    if (remaining > 0.001) {
      hasAnyPartialPoItem = true;
      if (!explicitPartialBilling) {
        allQuantitiesMatchPo = false;
      }
      itemComparisons.push({
        invoiceItemIndexes: [],
        poItemIndexes: [idx],
        code: poItem.code,
        description: poItem.description,
        poCode: poItem.code,
        poDescription: poItem.description,
        poUnit: poItem.unit,
        conversionFactor: 1,
        origin: 'unmatched',
        poQty: Number(poItem.qtyOrdered || 0),
        invoiceQty: priorBilled > 0 ? priorBilled : null,
        invoiceRawQty: priorBilled > 0 ? priorBilled : null,
        poUnitPrice: Number(poItem.unitPrice || 0),
        invoiceUnitPrice: null,
        qtyMatch: explicitPartialBilling,
        unitPriceMatch: true,
        matchedInPo: true,
      });
      if (!explicitPartialBilling) {
        itemReasons.push(
          `Item "${poItem.description}" do Pedido (qtd ${poItem.qtyOrdered}) não faturado nesta nota`
        );
      }
    }
  });

  // Check if entire PO is fully billed by this single invoice or if it is a partial billing parcel
  const allPoItemsCovered100PercentInThisSingleInvoice =
    otherInvoices.length === 0 &&
    po.items.every((p, idx) => {
      const billedNow = currentBilledByPoItem.get(idx) || 0;
      return Math.abs(billedNow - Number(p.qtyOrdered || 0)) <= 0.001;
    });

  const isPartialBilling =
    explicitPartialBilling ||
    (!allPoItemsCovered100PercentInThisSingleInvoice &&
      (hasAnyPartialPoItem || otherInvoices.length > 0));

  let expectedPoForComparison = poFullNetTotal ?? 0;
  let poGrossForComparison = poFullGrossTotal ?? 0;

  if (isPartialBilling && associations.length > 0) {
    // Check if this invoice finishes all remaining quantities of the PO when combined with other linked invoices
    const completesRemainingPo = po.items.every((p, idx) => {
      const prior = otherBilledByPoItem.get(idx) || 0;
      const now = currentBilledByPoItem.get(idx) || 0;
      return Math.abs(prior + now - Number(p.qtyOrdered || 0)) <= 0.001;
    });

    if (completesRemainingPo && otherInvoices.length > 0) {
      const priorComparedSum = otherInvoices.reduce((s, o) => {
        const comp = comparePurchaseOrderAndInvoice({
          docType: o.docType || 'NFE',
          invoiceGrossTotal: Number(o.grossAmount ?? o.totalProducts ?? 0),
          invoiceNetTotal: Number(o.totalInvoice || 0),
          invoiceDiscountAmount: o.discountAmount,
          invoiceOtherExpenses: o.otherExpensesAmount,
          invoiceSurcharge: o.surchargeAmount,
          expectedPoAmount: 0,
        });
        return s + comp.invoiceComparedAmount;
      }, 0);
      expectedPoForComparison = roundMoney(Math.max(0, (poFullNetTotal ?? 0) - priorComparedSum));
      poGrossForComparison = roundMoney(parcelAuthorizedExpectedItemsTotal);
    } else {
      expectedPoForComparison = roundMoney(parcelAuthorizedExpectedItemsTotal);
      poGrossForComparison = roundMoney(parcelAuthorizedExpectedItemsTotal);
    }
  }

  const financialComparison = comparePurchaseOrderAndInvoice({
    docType,
    invoiceGrossTotal,
    invoiceNetTotal,
    invoiceDiscountAmount: invoice.discountAmount,
    invoiceOtherExpenses: invoice.otherExpensesAmount,
    invoiceSurcharge: invoice.surchargeAmount,
    expectedPoAmount: expectedPoForComparison,
    isPartialBilling,
  });

  const grossMatch =
    poGrossForComparison !== null
      ? Math.round(poGrossForComparison * 100) === Math.round(invoiceGrossTotal * 100)
      : null;
  const netMatch = financialComparison.matches;

  const reasons: string[] = [];

  const poCnpj = normalizeCnpjDigits(po.supplierCnpj);
  const invCnpj = normalizeCnpjDigits(invoice.issuerCnpj);
  if (poCnpj && invCnpj && poCnpj !== invCnpj) {
    reasons.push('CNPJ do emitente da nota difere do fornecedor do Pedido');
  }

  let qtyOk = allQuantitiesMatchPo;

  if (!isPreImport && receipt) {
    const receivedQty = receivedQtyTotal ?? 0;
    const orderedQty = orderedQtyTotal ?? 0;
    if (explicitPartialBilling) {
      if (receivedQty > orderedQty + 0.001) {
        qtyOk = false;
        reasons.push(
          `Qtd recebida na doca (${receivedQty}) excede a quantidade total pedida (${orderedQty})`
        );
      }
    } else if (Math.abs(orderedQty - receivedQty) > 0.001) {
      qtyOk = false;
      reasons.push(`Qtd recebida na doca (${receivedQty}) difere da pedida (${orderedQty})`);
    }
    if (Math.abs(receivedQty - invoiceQtyTotal) > 0.001) {
      qtyOk = false;
      reasons.push(`Qtd faturada na nota (${invoiceQtyTotal}) difere do recebimento (${receivedQty})`);
    }
    if (receipt.status === 'divergencia') {
      reasons.push('Recebimento físico registrado com divergência/avaria');
    }
  }

  if (financialComparison.divergenceReason) {
    reasons.push(financialComparison.divergenceReason);
  }

  if (itemReasons.length > 0) {
    reasons.push(...itemReasons);
  }

  const hasUnreconciledItems = unmatchedInvoiceItemIndexes.length > 0;
  let conferenceBadgeState: ConferenceBadgeState = 'sem_divergencia';
  if (hasUnreconciledItems) {
    conferenceBadgeState = 'aguardando_conciliacao';
  } else if (reasons.length > 0) {
    conferenceBadgeState = 'divergente';
  }

  if (missingRequiredReceipt) {
    const missingReason =
      'Recebimento Físico não sinalizado (obrigatório para liberar lançamento)';
    return {
      status: 'pendente_vinculo',
      conferenceBadgeState:
        hasUnreconciledItems
          ? 'aguardando_conciliacao'
          : reasons.length > 0
          ? 'divergente'
          : 'sem_divergencia',
      reasons: [missingReason, ...reasons],
      poGrossTotal: poGrossForComparison,
      poTotal: expectedPoForComparison,
      poFullTotal: poFullNetTotal,
      invoiceGrossTotal,
      invoiceTotal: invoiceNetTotal,
      grossMatch,
      netMatch,
      financialComparison,
      isPartialBilling,
      qtyMatch: qtyOk,
      unitPricesMatch: allUnitPricesMatch,
      receivedQtyTotal,
      orderedQtyTotal,
      invoiceQtyTotal,
      itemComparisons,
      associations,
      suggestions,
      unmatchedInvoiceItemIndexes,
      unmatchedPoItemIndexes,
    };
  }

  return {
    status: reasons.length === 0 ? 'conciliada' : 'divergente',
    conferenceBadgeState,
    reasons,
    poGrossTotal: poGrossForComparison,
    poTotal: expectedPoForComparison,
    poFullTotal: poFullNetTotal,
    invoiceGrossTotal,
    invoiceTotal: invoiceNetTotal,
    grossMatch,
    netMatch,
    financialComparison,
    isPartialBilling,
    qtyMatch: qtyOk,
    unitPricesMatch: allUnitPricesMatch,
    receivedQtyTotal,
    orderedQtyTotal,
    invoiceQtyTotal,
    itemComparisons,
    associations,
    suggestions,
    unmatchedInvoiceItemIndexes,
    unmatchedPoItemIndexes,
  };
}

export function evaluatePreImportMatch(
  params: Parameters<typeof evaluateThreeWayMatch>[0],
  po?: PurchaseOrder,
  options?: Omit<EvaluateMatchOptions, 'isPreImport'>
): ThreeWayMatchDetails {
  return evaluateThreeWayMatch(params, po, undefined, {
    ...options,
    isPreImport: true,
  });
}

export function getPoReceptionSummary(
  po: PurchaseOrder,
  receipts: PhysicalReceipt[]
): {
  totalOrdered: number;
  totalReceived: number;
  hasDivergence: boolean;
  label: 'Aguardando Recebimento' | 'Recebido Parcial' | 'Recebido Total' | 'Com Divergência';
  linkedReceipts: PhysicalReceipt[];
} {
  const linkedReceipts = receipts.filter((r) => r.purchaseOrderId === po.id);
  const totalOrdered = po.items.reduce((acc, it) => acc + Number(it.qtyOrdered || 0), 0);
  const totalReceived = linkedReceipts.reduce(
    (acc, r) => acc + r.items.reduce((s, it) => s + Number(it.qtyReceived || 0), 0),
    0
  );
  const hasDivergence = linkedReceipts.some((r) => r.status === 'divergencia');

  let label: 'Aguardando Recebimento' | 'Recebido Parcial' | 'Recebido Total' | 'Com Divergência' =
    'Aguardando Recebimento';
  if (linkedReceipts.length > 0) {
    if (hasDivergence) {
      label = 'Com Divergência';
    } else if (totalReceived >= totalOrdered && totalOrdered > 0) {
      label = 'Recebido Total';
    } else if (totalReceived > 0) {
      label = 'Recebido Parcial';
    }
  }

  return {
    totalOrdered,
    totalReceived,
    hasDivergence,
    label,
    linkedReceipts,
  };
}
