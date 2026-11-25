import { FieldValue, serverTimestamp } from 'firebase/firestore';
import {
  AdjustmentDivergentItemSnapshot,
  AdjustmentRequestStatus,
  BLUEPRINT_LIMITS,
  FiscalInvoice,
  FiscalItemAssociation,
  PurchaseOrder,
} from '../types/p2p';
import { calculateFiscalNetTotal, roundMoney } from './fiscalCalculations';
import { sanitizeText } from './formatters';

export function sanitizeItemAssociations(
  list?: FiscalItemAssociation[]
): FiscalItemAssociation[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, BLUEPRINT_LIMITS.MAX_ITEM_ASSOCIATIONS).map((a) => ({
    id: sanitizeText(a.id || 'assoc', 64),
    invoiceItemIndexes: (a.invoiceItemIndexes || []).filter((n) => Number.isInteger(n) && n >= 0),
    poItemIndexes: (a.poItemIndexes || []).filter((n) => Number.isInteger(n) && n >= 0),
    conversionFactor: Number(a.conversionFactor) > 0 ? Number(a.conversionFactor) : 1,
    origin: a.origin,
    ...(typeof a.confidence === 'number' ? { confidence: Number(a.confidence.toFixed(2)) } : {}),
    ...(a.equivalenceId ? { equivalenceId: sanitizeText(a.equivalenceId, 128) } : {}),
    ...(a.confirmedByUid ? { confirmedByUid: sanitizeText(a.confirmedByUid, 128) } : {}),
    ...(a.confirmedByName
      ? { confirmedByName: sanitizeText(a.confirmedByName, BLUEPRINT_LIMITS.MAX_USER_NAME) }
      : {}),
    ...(a.confirmedAt ? { confirmedAt: sanitizeText(a.confirmedAt, 40) } : {}),
  }));
}

export function buildFiscalInvoiceCreatePayload(
  data: Omit<FiscalInvoice, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'>,
  uid: string,
  userName: string,
  timestampValue: FieldValue = serverTimestamp()
) {
  const totalProducts = roundMoney(Math.max(0, Number(data.totalProducts || 0)));
  const grossAmount = roundMoney(Math.max(0, Number(data.grossAmount ?? totalProducts)));
  const freightAmount =
    data.docType === 'NFSE' ? 0 : roundMoney(Math.max(0, Number(data.freightAmount ?? 0)));
  const insuranceAmount =
    data.docType === 'NFSE' ? 0 : roundMoney(Math.max(0, Number(data.insuranceAmount ?? 0)));
  const otherExpensesAmount = roundMoney(Math.max(0, Number(data.otherExpensesAmount ?? 0)));
  const surchargeAmount = roundMoney(Math.max(0, Number(data.surchargeAmount ?? 0)));
  const discountAmount = roundMoney(Math.max(0, Number(data.discountAmount ?? 0)));
  const icmsAmount =
    data.docType === 'NFSE' ? 0 : roundMoney(Math.max(0, Number(data.icmsAmount || 0)));
  const icmsDesonAmount =
    data.docType === 'NFSE' ? 0 : roundMoney(Math.max(0, Number(data.icmsDesonAmount ?? 0)));
  const icmsDesonDeducted =
    data.docType === 'NFE'
      ? typeof data.icmsDesonDeducted === 'boolean'
        ? data.icmsDesonDeducted
        : icmsDesonAmount > 0
      : false;
  const icmsStAmount =
    data.docType === 'NFE' ? roundMoney(Math.max(0, Number(data.icmsStAmount ?? 0))) : 0;
  const fcpStAmount =
    data.docType === 'NFE' ? roundMoney(Math.max(0, Number(data.fcpStAmount ?? 0))) : 0;
  const iiAmount =
    data.docType === 'NFE' ? roundMoney(Math.max(0, Number(data.iiAmount ?? 0))) : 0;
  const ipiAmount =
    data.docType === 'NFE' ? roundMoney(Math.max(0, Number(data.ipiAmount || 0))) : 0;
  const ipiDevolAmount =
    data.docType === 'NFE' ? roundMoney(Math.max(0, Number(data.ipiDevolAmount ?? 0))) : 0;
  const taxRegime = data.docType === 'NFSE' ? data.taxRegime || 'simples_nacional' : '';
  const pisAmount = roundMoney(Math.max(0, Number(data.pisAmount || 0)));
  const cofinsAmount = roundMoney(Math.max(0, Number(data.cofinsAmount || 0)));
  const csllAmount = roundMoney(Math.max(0, Number(data.csllAmount ?? 0)));
  const issqnAmount = roundMoney(Math.max(0, Number(data.issqnAmount ?? 0)));
  const issqnRetained = data.issqnRetained ?? true;
  const inssAmount = roundMoney(Math.max(0, Number(data.inssAmount ?? 0)));
  const irrfAmount = roundMoney(Math.max(0, Number(data.irrfAmount ?? 0)));
  const retainedTaxesAmount = roundMoney(Math.max(0, Number(data.retainedTaxesAmount ?? 0)));

  const computedTotalInvoice = calculateFiscalNetTotal({
    docType: data.docType,
    totalProducts,
    freightAmount,
    insuranceAmount,
    otherExpensesAmount,
    surchargeAmount,
    ipiAmount,
    ipiDevolAmount,
    icmsStAmount,
    fcpStAmount,
    iiAmount,
    icmsDesonAmount,
    icmsDesonDeducted,
    discountAmount,
    retainedTaxesAmount,
    taxRegime,
    pisAmount,
    cofinsAmount,
    csllAmount,
    issqnAmount,
    issqnRetained,
    inssAmount,
    irrfAmount,
  });

  const requiresPhysicalReceipt =
    data.fiscalStatus === 'aguardando_recebimento'
      ? true
      : typeof data.requiresPhysicalReceipt === 'boolean'
      ? data.requiresPhysicalReceipt
      : false;
  const itemAssociations = sanitizeItemAssociations(data.itemAssociations);

  return {
    docType: data.docType,
    accessKey: data.accessKey
      .replace(/[^a-zA-Z0-9_\-]/g, '')
      .slice(0, BLUEPRINT_LIMITS.MAX_ACCESS_KEY),
    nfeNumber: sanitizeText(data.nfeNumber, 20),
    series: sanitizeText(data.series ?? (data.docType === 'NFSE' ? '' : '1'), 10),
    issuerName: sanitizeText(data.issuerName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
    issuerCnpj: sanitizeText(data.issuerCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
    issuerState: sanitizeText((data.issuerState || '').toUpperCase(), 2),
    issueDate: data.issueDate,
    cfop: sanitizeText(data.cfop || '0000', 16),
    grossAmount,
    freightAmount,
    insuranceAmount,
    otherExpensesAmount,
    surchargeAmount,
    discountAmount,
    totalProducts,
    icmsAmount,
    icmsDesonAmount,
    ...(data.docType === 'NFE' && (icmsDesonAmount > 0 || typeof data.icmsDesonDeducted === 'boolean')
      ? { icmsDesonDeducted }
      : {}),
    icmsStAmount,
    ...(fcpStAmount > 0 ? { fcpStAmount } : {}),
    ...(iiAmount > 0 ? { iiAmount } : {}),
    ipiAmount,
    ...(ipiDevolAmount > 0 ? { ipiDevolAmount } : {}),
    pisAmount,
    cofinsAmount,
    csllAmount,
    issqnAmount,
    issqnRetained,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
    taxRegime,
    totalInvoice: computedTotalInvoice,
    ...(typeof data.xmlDeclaredTotal === 'number' && Number.isFinite(data.xmlDeclaredTotal)
      ? { xmlDeclaredTotal: roundMoney(Math.max(0, data.xmlDeclaredTotal)) }
      : {}),
    complementaryInfo: sanitizeText(
      data.complementaryInfo || '',
      BLUEPRINT_LIMITS.MAX_COMPLEMENTARY_INFO
    ),
    items: data.items.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS).map((it) => ({
      code: sanitizeText(it.code, 40),
      description: sanitizeText(it.description, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      ncm: sanitizeText(it.ncm, 12),
      cfop: sanitizeText(it.cfop, 16),
      unit: sanitizeText(it.unit, 12),
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      totalPrice: Number(it.totalPrice),
      ...(it.gtin ? { gtin: sanitizeText(it.gtin, 20) } : {}),
    })),
    ...(itemAssociations.length > 0 ? { itemAssociations } : {}),
    purchaseOrderId: sanitizeText(data.purchaseOrderId || '', 128),
    poNumber: sanitizeText(data.poNumber || '', BLUEPRINT_LIMITS.MAX_PO_NUMBER),
    receiptId: sanitizeText(data.receiptId || '', 128),
    receiptNumber: sanitizeText(data.receiptNumber || '', BLUEPRINT_LIMITS.MAX_RECEIPT_NUMBER),
    linkedInvoiceId: sanitizeText(data.linkedInvoiceId || '', 128),
    linkedInvoiceNumber: sanitizeText(data.linkedInvoiceNumber || '', 20),
    originState: sanitizeText((data.originState || '').toUpperCase(), 2),
    originCity: sanitizeText(data.originCity || '', 120),
    destinationState: sanitizeText((data.destinationState || '').toUpperCase(), 2),
    destinationCity: sanitizeText(data.destinationCity || '', 120),
    suframaPinNumber: sanitizeText(data.suframaPinNumber || '', 40),
    suframaPinAcceptanceDate: sanitizeText(data.suframaPinAcceptanceDate || '', 10),
    suframaPinReceiptDate: sanitizeText(data.suframaPinReceiptDate || '', 10),
    suframaClearanceDate: sanitizeText(data.suframaClearanceDate || '', 10),
    matchingStatus: data.matchingStatus,
    fiscalStatus: data.fiscalStatus,
    requiresPhysicalReceipt,
    isPartialBilling: Boolean(data.isPartialBilling),
    conferenceStatus: data.conferenceStatus || '',
    conferenceOriginalOutcome: data.conferenceOriginalOutcome || '',
    conferenceConfirmedByUid: sanitizeText(data.conferenceConfirmedByUid || '', 128),
    conferenceConfirmedByName: sanitizeText(
      data.conferenceConfirmedByName || '',
      BLUEPRINT_LIMITS.MAX_USER_NAME
    ),
    conferenceConfirmedAt: sanitizeText(data.conferenceConfirmedAt || '', 40),
    conferenceJustification: sanitizeText(
      data.conferenceJustification || '',
      BLUEPRINT_LIMITS.MAX_JUSTIFICATION
    ),
    conferenceDataVersion: sanitizeText(data.conferenceDataVersion || '', 40),
    pendingAdjustmentId: sanitizeText(data.pendingAdjustmentId || '', 128),
    pendingAdjustmentPoId: sanitizeText(data.pendingAdjustmentPoId || '', 128),
    pendingAdjustmentPoNumber: sanitizeText(
      data.pendingAdjustmentPoNumber || '',
      BLUEPRINT_LIMITS.MAX_PO_NUMBER
    ),
    adjustmentStatus: data.adjustmentStatus || '',
    replacedByInvoiceId: sanitizeText(data.replacedByInvoiceId || '', 128),
    replacedByInvoiceNumber: sanitizeText(data.replacedByInvoiceNumber || '', 20),
    bookkeepingDate: data.bookkeepingDate || '',
    xmlImported: Boolean(data.xmlImported),
    notes: sanitizeText(data.notes || '', BLUEPRINT_LIMITS.MAX_NOTES),
    createdByUid: uid,
    createdByName: sanitizeText(userName, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo',
    createdAt: timestampValue,
    updatedAt: timestampValue,
  };
}

export interface AdjustmentBatchRequestInput {
  po: PurchaseOrder;
  divergenceReasons: string[];
  divergentItems: AdjustmentDivergentItemSnapshot[];
  poGrossTotal: number;
  poNetTotal: number;
  invoiceGrossTotal: number;
  invoiceNetTotal: number;
  fiscalObservation: string;
}

export function buildAdjustmentRequestCreatePayload(params: {
  fiscalInvoiceId: string;
  invoiceInput: Pick<FiscalInvoice, 'nfeNumber' | 'docType' | 'issuerName' | 'issuerCnpj'>;
  adjustmentRequest: AdjustmentBatchRequestInput;
  actorUid: string;
  actorName: string;
  actorSector: string;
  nowIso: string;
  timestampValue?: FieldValue;
}) {
  const {
    fiscalInvoiceId,
    invoiceInput,
    adjustmentRequest: adj,
    actorUid,
    actorName,
    actorSector,
    nowIso,
    timestampValue = serverTimestamp(),
  } = params;
  const sanitizedActorName =
    sanitizeText(actorName, BLUEPRINT_LIMITS.MAX_USER_NAME) || 'Usuário Corporativo';

  return {
    fiscalInvoiceId,
    invoiceNumber: sanitizeText(invoiceInput.nfeNumber, 20),
    docType: invoiceInput.docType,
    supplierName: sanitizeText(invoiceInput.issuerName, BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME),
    supplierCnpj: sanitizeText(invoiceInput.issuerCnpj, BLUEPRINT_LIMITS.MAX_CNPJ),
    purchaseOrderId: adj.po.id,
    poNumber: sanitizeText(adj.po.poNumber, BLUEPRINT_LIMITS.MAX_PO_NUMBER),
    status: 'Ajuste solicitado' as AdjustmentRequestStatus,
    divergenceReasons: adj.divergenceReasons.slice(0, BLUEPRINT_LIMITS.MAX_ADJUSTMENT_REASONS),
    divergentItems: adj.divergentItems.slice(0, BLUEPRINT_LIMITS.MAX_ITEMS),
    poGrossTotal: roundMoney(adj.poGrossTotal),
    poNetTotal: roundMoney(adj.poNetTotal),
    invoiceGrossTotal: roundMoney(adj.invoiceGrossTotal),
    invoiceNetTotal: roundMoney(adj.invoiceNetTotal),
    fiscalObservation: sanitizeText(adj.fiscalObservation || '', BLUEPRINT_LIMITS.MAX_NOTES),
    requestedByUid: actorUid,
    requestedByName: sanitizedActorName,
    requestedAt: nowIso,
    history: [
      {
        status: 'Ajuste solicitado' as AdjustmentRequestStatus,
        actorUid,
        actorName: sanitizedActorName,
        actorSector: actorSector || 'Fiscal',
        note:
          sanitizeText(adj.fiscalObservation || '', BLUEPRINT_LIMITS.MAX_NOTES) ||
          'Solicitação gerada na conferência pré-importação do XML.',
        timestamp: nowIso,
      },
    ],
    createdAt: timestampValue,
    updatedAt: timestampValue,
  };
}
