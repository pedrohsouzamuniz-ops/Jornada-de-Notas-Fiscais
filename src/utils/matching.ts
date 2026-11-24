import {
  FiscalInvoice,
  MatchingStatus,
  PhysicalReceipt,
  PurchaseOrder,
} from '../types/p2p';
import { formatBRL, normalizeCnpjDigits } from './formatters';

export interface ThreeWayItemComparison {
  code: string;
  description: string;
  poQty: number | null;
  invoiceQty: number | null;
  poUnitPrice: number | null;
  invoiceUnitPrice: number | null;
  qtyMatch: boolean;
  unitPriceMatch: boolean;
  matchedInPo: boolean;
}

export interface ThreeWayMatchDetails {
  status: MatchingStatus;
  reasons: string[];
  poGrossTotal: number | null;
  poTotal: number | null; // Valor líquido do pedido
  invoiceGrossTotal: number;
  invoiceTotal: number; // Valor líquido da nota
  grossMatch: boolean | null;
  netMatch: boolean | null;
  qtyMatch: boolean | null;
  unitPricesMatch: boolean | null;
  receivedQtyTotal: number | null;
  orderedQtyTotal: number | null;
  invoiceQtyTotal: number;
  itemComparisons: ThreeWayItemComparison[];
}

function normalizeItemText(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericCode(code: string): boolean {
  const c = normalizeItemText(code);
  return !c || /^(item|mat|prod|serv)[-_\s]*\d+$/.test(c);
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeItemText(a).split(' ').filter((t) => t.length >= 2));
  const tokensB = new Set(normalizeItemText(b).split(' ').filter((t) => t.length >= 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let hits = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) hits += 1;
  });
  return hits / Math.max(tokensA.size, tokensB.size);
}

function buildItemComparisons(
  po: PurchaseOrder,
  invoiceItems: FiscalInvoice['items']
): {
  comparisons: ThreeWayItemComparison[];
  itemReasons: string[];
  unitPricesMatch: boolean;
} {
  const comparisons: ThreeWayItemComparison[] = [];
  const itemReasons: string[] = [];
  const usedPoIndices = new Set<number>();
  let allUnitPricesMatch = true;

  const findBestPoIndex = (invItem: FiscalInvoice['items'][number], invIdx: number): number => {
    const invCode = normalizeItemText(invItem.code);
    const invDesc = normalizeItemText(invItem.description);

    // 1. Non-generic exact code match
    if (invCode && !isGenericCode(invItem.code)) {
      const idx = po.items.findIndex(
        (p, i) => !usedPoIndices.has(i) && normalizeItemText(p.code) === invCode
      );
      if (idx !== -1) return idx;
    }

    // 2. Exact normalized description match
    if (invDesc) {
      const idx = po.items.findIndex(
        (p, i) => !usedPoIndices.has(i) && normalizeItemText(p.description) === invDesc
      );
      if (idx !== -1) return idx;
    }

    // 3. Single item 1-to-1 pairing
    if (po.items.length === 1 && invoiceItems.length === 1 && !usedPoIndices.has(0)) {
      return 0;
    }

    // 4. Token similarity / substring match
    let bestIdx = -1;
    let bestScore = 0;
    po.items.forEach((p, i) => {
      if (usedPoIndices.has(i)) return;
      const poDesc = normalizeItemText(p.description);
      if (invDesc && poDesc && (invDesc.includes(poDesc) || poDesc.includes(invDesc))) {
        if (0.85 > bestScore) {
          bestScore = 0.85;
          bestIdx = i;
        }
        return;
      }
      const sim = tokenSimilarity(p.description, invItem.description);
      if (sim >= 0.45 && sim > bestScore) {
        bestScore = sim;
        bestIdx = i;
      }
    });
    if (bestIdx !== -1) return bestIdx;

    // 5. Exact positional fallback if same count and exact same code even if generic
    if (
      po.items.length === invoiceItems.length &&
      !usedPoIndices.has(invIdx) &&
      invCode &&
      normalizeItemText(po.items[invIdx].code) === invCode
    ) {
      return invIdx;
    }

    return -1;
  };

  invoiceItems.forEach((invItem, invIdx) => {
    const poIdx = findBestPoIndex(invItem, invIdx);
    const invQty = Number(invItem.qty || 0);
    const invUnit = Number(invItem.unitPrice || 0);

    if (poIdx === -1) {
      allUnitPricesMatch = false;
      comparisons.push({
        code: invItem.code,
        description: invItem.description,
        poQty: null,
        invoiceQty: invQty,
        poUnitPrice: null,
        invoiceUnitPrice: invUnit,
        qtyMatch: false,
        unitPriceMatch: false,
        matchedInPo: false,
      });
      itemReasons.push(`Item "${invItem.description}" da nota não localizado no Pedido de Compra`);
      return;
    }

    usedPoIndices.add(poIdx);
    const poItem = po.items[poIdx];
    const poQty = Number(poItem.qtyOrdered || 0);
    const poUnit = Number(poItem.unitPrice || 0);

    const qtyMatch = Math.abs(poQty - invQty) <= 0.001;
    const unitPriceMatch = Math.abs(poUnit - invUnit) <= 0.02;

    if (!unitPriceMatch) {
      allUnitPricesMatch = false;
    }
    if (!qtyMatch) {
      itemReasons.push(
        `Qtd de "${invItem.description}" na NF (${invQty}) diverge do Pedido (${poQty})`
      );
    }

    comparisons.push({
      code: invItem.code || poItem.code,
      description: invItem.description || poItem.description,
      poQty,
      invoiceQty: invQty,
      poUnitPrice: poUnit,
      invoiceUnitPrice: invUnit,
      qtyMatch,
      unitPriceMatch,
      matchedInPo: true,
    });
  });

  // Any remaining PO items not present on the invoice
  po.items.forEach((poItem, idx) => {
    if (usedPoIndices.has(idx)) return;
    comparisons.push({
      code: poItem.code,
      description: poItem.description,
      poQty: Number(poItem.qtyOrdered || 0),
      invoiceQty: null,
      poUnitPrice: Number(poItem.unitPrice || 0),
      invoiceUnitPrice: null,
      qtyMatch: false,
      unitPriceMatch: true,
      matchedInPo: true,
    });
    itemReasons.push(
      `Item "${poItem.description}" do Pedido (qtd ${poItem.qtyOrdered}) não faturado na nota`
    );
  });

  return {
    comparisons,
    itemReasons,
    unitPricesMatch: allUnitPricesMatch,
  };
}

export function evaluateThreeWayMatch(
  invoice: Pick<
    FiscalInvoice,
    'issuerCnpj' | 'totalProducts' | 'totalInvoice' | 'items' | 'purchaseOrderId' | 'receiptId'
  > & { grossAmount?: number },
  po?: PurchaseOrder,
  receipt?: PhysicalReceipt
): ThreeWayMatchDetails {
  const invoiceQtyTotal = Number(
    invoice.items.reduce((sum, it) => sum + Number(it.qty || 0), 0).toFixed(4)
  );
  const invoiceGrossTotal = Number(
    Number(invoice.grossAmount ?? invoice.totalProducts ?? 0).toFixed(2)
  );
  const invoiceNetTotal = Number(Number(invoice.totalInvoice || 0).toFixed(2));

  const poGrossTotal = po
    ? Number(
        po.items
          .reduce((sum, it) => sum + Number(it.qtyOrdered || 0) * Number(it.unitPrice || 0), 0)
          .toFixed(2)
      )
    : null;
  const poNetTotal = po ? Number(Number(po.totalAmount || 0).toFixed(2)) : null;
  const orderedQtyTotal = po
    ? Number(po.items.reduce((sum, it) => sum + Number(it.qtyOrdered || 0), 0).toFixed(4))
    : null;
  const receivedQtyTotal = receipt
    ? Number(receipt.items.reduce((sum, it) => sum + Number(it.qtyReceived || 0), 0).toFixed(4))
    : null;

  const grossMatch =
    poGrossTotal !== null ? Math.abs(poGrossTotal - invoiceGrossTotal) <= 0.5 : null;
  const netMatch = poNetTotal !== null ? Math.abs(poNetTotal - invoiceNetTotal) <= 0.5 : null;
  const itemEval = po ? buildItemComparisons(po, invoice.items) : null;

  if (!invoice.purchaseOrderId || !po || !invoice.receiptId || !receipt) {
    const missing: string[] = [];
    if (!invoice.purchaseOrderId || !po) missing.push('Pedido de Compra não vinculado');
    if (!invoice.receiptId || !receipt) {
      missing.push('Recebimento Físico não sinalizado (obrigatório para liberar lançamento)');
    }
    return {
      status: 'pendente_vinculo',
      reasons: missing,
      poGrossTotal,
      poTotal: poNetTotal,
      invoiceGrossTotal,
      invoiceTotal: invoiceNetTotal,
      grossMatch,
      netMatch,
      qtyMatch:
        orderedQtyTotal !== null ? Math.abs(orderedQtyTotal - invoiceQtyTotal) <= 0.001 : null,
      unitPricesMatch: itemEval ? itemEval.unitPricesMatch : null,
      receivedQtyTotal,
      orderedQtyTotal,
      invoiceQtyTotal,
      itemComparisons: itemEval ? itemEval.comparisons : [],
    };
  }

  const reasons: string[] = [];

  const poCnpj = normalizeCnpjDigits(po.supplierCnpj);
  const invCnpj = normalizeCnpjDigits(invoice.issuerCnpj);
  if (poCnpj && invCnpj && poCnpj !== invCnpj) {
    reasons.push('CNPJ do emitente da nota difere do fornecedor do Pedido');
  }

  const orderedQty = orderedQtyTotal ?? 0;
  const receivedQty = receivedQtyTotal ?? 0;
  let qtyOk = true;

  if (Math.abs(orderedQty - receivedQty) > 0.001) {
    qtyOk = false;
    reasons.push(`Qtd recebida na doca (${receivedQty}) difere da pedida (${orderedQty})`);
  }

  if (Math.abs(receivedQty - invoiceQtyTotal) > 0.001) {
    qtyOk = false;
    reasons.push(`Qtd faturada na nota (${invoiceQtyTotal}) difere do recebimento (${receivedQty})`);
  }

  if (Math.abs(orderedQty - invoiceQtyTotal) > 0.001) {
    qtyOk = false;
  }

  if (receipt.status === 'divergencia') {
    reasons.push('Recebimento físico registrado com divergência/avaria');
  }

  // Somente o Valor Líquido da nota vs Valor do Pedido gera alerta de divergência financeira
  if (netMatch === false && poNetTotal !== null) {
    reasons.push(
      `Valor líquido da nota (${formatBRL(invoiceNetTotal)}) diverge do valor do pedido (${formatBRL(poNetTotal)})`
    );
  }

  // Conferência de quantidades por item (Pedido x Nota)
  if (itemEval && itemEval.itemReasons.length > 0) {
    reasons.push(...itemEval.itemReasons);
  }

  return {
    status: reasons.length === 0 ? 'conciliada' : 'divergente',
    reasons,
    poGrossTotal,
    poTotal: poNetTotal,
    invoiceGrossTotal,
    invoiceTotal: invoiceNetTotal,
    grossMatch,
    netMatch,
    qtyMatch: qtyOk,
    unitPricesMatch: itemEval ? itemEval.unitPricesMatch : true,
    receivedQtyTotal,
    orderedQtyTotal,
    invoiceQtyTotal,
    itemComparisons: itemEval ? itemEval.comparisons : [],
  };
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
