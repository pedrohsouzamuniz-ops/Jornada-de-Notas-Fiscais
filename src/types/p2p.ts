export type UserRole = 'adm_titular' | 'compras' | 'recebimento' | 'fiscal' | 'pendente';

export type UserSector =
  | 'Administração'
  | 'Compras'
  | 'Recebimento'
  | 'Fiscal'
  | 'Aguardando Aprovação';

export type UserStatus = 'ativo' | 'inativo' | 'pendente';

export type SectorKey = 'compras' | 'recebimento' | 'fiscal';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoUrl: string;
  role: UserRole;
  sector: UserSector;
  status: UserStatus;
  inviteId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserInvite {
  id: string;
  email: string;
  name: string;
  role: Exclude<UserRole, 'pendente'>;
  createdByUid: string;
  createdAt?: unknown;
}

export interface SectorPermission {
  sector: SectorKey;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewOtherSectors: boolean;
  updatedByUid: string;
  updatedAt?: unknown;
}

export interface PurchaseOrderItem {
  code: string;
  description: string;
  unit: string;
  qtyOrdered: number;
  unitPrice: number;
  totalPrice: number;
}

export type PurchaseOrderStatus =
  | 'aberto'
  | 'parcialmente_atendido'
  | 'concluido'
  | 'cancelado';

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierCnpj: string;
  costCenter: string;
  issueDate: string;
  expectedDeliveryDate: string;
  paymentTerms: string;
  items: PurchaseOrderItem[];
  freightAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: PurchaseOrderStatus;
  notes: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ReceiptItemCondition = 'conforme' | 'avaria' | 'divergente';

export interface PhysicalReceiptItem {
  code: string;
  description: string;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  condition: ReceiptItemCondition;
}

export type PhysicalReceiptStatus = 'conferido' | 'divergencia';

export interface PhysicalReceipt {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  poNumber: string;
  fiscalInvoiceId: string;
  supplierName: string;
  supplierCnpj: string;
  receiptDate: string;
  invoiceNumberRef: string;
  warehouseLocation: string;
  items: PhysicalReceiptItem[];
  status: PhysicalReceiptStatus;
  observations: string;
  receivedByUid: string;
  receivedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type FiscalDocType = 'NFE' | 'NFSE' | 'CTE';
export type ServiceTaxRegime = 'mei' | 'simples_nacional' | 'regime_normal';

export const SERVICE_TAX_REGIME_LABELS: Record<ServiceTaxRegime, string> = {
  mei: 'MEI (Não retém impostos)',
  simples_nacional: 'Simples Nacional (Retém ISSQN e INSS)',
  regime_normal: 'Regime Normal (Retém todos)',
};

export interface FiscalInvoiceItem {
  code: string;
  description: string;
  ncm: string;
  cfop: string;
  unit: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  gtin?: string;
}

export type ItemMatchOrigin = 'smart' | 'equivalence' | 'manual';

export interface FiscalItemAssociation {
  id: string;
  invoiceItemIndexes: number[];
  poItemIndexes: number[];
  conversionFactor: number;
  origin: ItemMatchOrigin;
  confidence?: number;
  equivalenceId?: string;
  confirmedByUid?: string;
  confirmedByName?: string;
  confirmedAt?: string;
}

export interface ProductEquivalence {
  id: string;
  supplierCnpj: string;
  supplierItemCode: string;
  supplierDescription: string;
  supplierNormalizedDesc: string;
  internalCode: string;
  poDescription: string;
  poUnit: string;
  invoiceUnit: string;
  conversionFactor: number;
  active: boolean;
  createdByUid: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AdjustmentRequestStatus =
  | 'Ajuste solicitado'
  | 'Em análise'
  | 'Ajustado'
  | 'Devolvido para revisão fiscal'
  | 'Reaberto'
  | 'Resolvido'
  | 'Cancelado';

export interface AdjustmentDivergentItemSnapshot {
  invoiceItemDescription: string;
  poItemDescription?: string;
  poQty: number | null;
  invoiceQty: number | null;
  poUnitPrice: number | null;
  invoiceUnitPrice: number | null;
  reason: string;
}

export interface AdjustmentHistoryEntry {
  status: AdjustmentRequestStatus;
  actorUid: string;
  actorName: string;
  actorSector: string;
  note: string;
  timestamp: string;
}

export interface AdjustmentRequest {
  id: string;
  fiscalInvoiceId: string;
  invoiceNumber: string;
  docType: FiscalDocType;
  supplierName: string;
  supplierCnpj: string;
  purchaseOrderId: string;
  poNumber: string;
  status: AdjustmentRequestStatus;
  divergenceReasons: string[];
  divergentItems: AdjustmentDivergentItemSnapshot[];
  poGrossTotal: number;
  poNetTotal: number;
  invoiceGrossTotal: number;
  invoiceNetTotal: number;
  fiscalObservation: string;
  requestedByUid: string;
  requestedByName: string;
  requestedAt: string;
  comprasResponse?: string;
  comprasRespondedByUid?: string;
  comprasRespondedByName?: string;
  comprasRespondedAt?: string;
  resolvedByUid?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  history: AdjustmentHistoryEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MatchingStatus = 'pendente_vinculo' | 'conciliada' | 'divergente';
export type FiscalStatus =
  | 'aguardando_recebimento'
  | 'pendente'
  | 'lancado'
  | 'substituida'
  | 'aguardando_escrituracao'
  | 'escriturada'
  | 'rejeitada';

export interface FiscalInvoice {
  id: string;
  docType: FiscalDocType;
  accessKey: string;
  nfeNumber: string;
  series: string;
  issuerName: string;
  issuerCnpj: string;
  issuerState?: string;
  issueDate: string;
  cfop: string;
  grossAmount: number;
  freightAmount: number;
  insuranceAmount?: number;
  otherExpensesAmount?: number;
  surchargeAmount?: number;
  discountAmount?: number;
  totalProducts: number;
  icmsAmount: number;
  icmsDesonAmount?: number;
  icmsDesonDeducted?: boolean;
  icmsStAmount?: number;
  fcpStAmount?: number;
  iiAmount?: number;
  ipiAmount: number;
  ipiDevolAmount?: number;
  pisAmount: number;
  cofinsAmount: number;
  csllAmount?: number;
  issqnAmount?: number;
  issqnRetained?: boolean;
  inssAmount?: number;
  irrfAmount?: number;
  retainedTaxesAmount?: number;
  taxRegime?: ServiceTaxRegime | '';
  totalInvoice: number;
  xmlDeclaredTotal?: number;
  complementaryInfo?: string;
  items: FiscalInvoiceItem[];
  itemAssociations?: FiscalItemAssociation[];
  purchaseOrderId: string;
  poNumber: string;
  receiptId: string;
  receiptNumber: string;
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
  originState?: string;
  originCity?: string;
  destinationState?: string;
  destinationCity?: string;
  suframaPinNumber?: string;
  suframaPinAcceptanceDate?: string;
  suframaPinReceiptDate?: string;
  suframaClearanceDate?: string;
  matchingStatus: MatchingStatus;
  fiscalStatus: FiscalStatus;
  requiresPhysicalReceipt?: boolean;
  isPartialBilling?: boolean;
  conferenceStatus?: 'pendente' | 'conferido';
  conferenceOriginalOutcome?: 'sem_divergencia' | 'divergente';
  conferenceConfirmedByUid?: string;
  conferenceConfirmedByName?: string;
  conferenceConfirmedAt?: string;
  conferenceJustification?: string;
  conferenceDataVersion?: string;
  pendingAdjustmentId?: string;
  pendingAdjustmentPoId?: string;
  pendingAdjustmentPoNumber?: string;
  adjustmentStatus?: AdjustmentRequestStatus | '';
  replacedByInvoiceId?: string;
  replacedByInvoiceNumber?: string;
  bookkeepingDate: string;
  xmlImported: boolean;
  notes: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DeletionPolicy {
  enabled: boolean;
  salt: string;
  updatedByUid: string;
  updatedByName: string;
  updatedAt?: unknown;
}

export interface DeletionLog {
  id: string;
  targetCollection: 'purchase_orders' | 'physical_receipts' | 'fiscal_invoices';
  targetId: string;
  targetLabel: string;
  submittedHash: string;
  deletedByUid: string;
  deletedByName: string;
  createdAt?: unknown;
}

export type NavModule = 'compras' | 'recebimento' | 'fiscal' | 'administracao';

export const ROLE_LABELS: Record<UserRole, string> = {
  adm_titular: 'ADM Titular',
  compras: 'Compras',
  recebimento: 'Recebimento',
  fiscal: 'Fiscal',
  pendente: 'Pendente',
};

export const ROLE_TO_SECTOR: Record<UserRole, UserSector> = {
  adm_titular: 'Administração',
  compras: 'Compras',
  recebimento: 'Recebimento',
  fiscal: 'Fiscal',
  pendente: 'Aguardando Aprovação',
};

// Volumetric boundaries synchronized with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  MAX_ITEMS: 50,
  MAX_ITEM_ASSOCIATIONS: 60,
  MAX_ADJUSTMENT_REASONS: 30,
  MAX_ADJUSTMENT_HISTORY: 40,
  MAX_PO_NUMBER: 40,
  MAX_RECEIPT_NUMBER: 40,
  MAX_SUPPLIER_NAME: 160,
  MAX_CNPJ: 20,
  MAX_COST_CENTER: 80,
  MAX_PAYMENT_TERMS: 80,
  MAX_WAREHOUSE: 100,
  MAX_NOTES: 600,
  MAX_JUSTIFICATION: 600,
  MAX_COMPLEMENTARY_INFO: 3000,
  MAX_ITEM_DESC: 200,
  MAX_USER_NAME: 120,
  MAX_EMAIL: 200,
  MAX_ACCESS_KEY: 64,
  MAX_SUFRAMA_PIN: 40,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  ACCESS_KEY_PATTERN: /^[a-zA-Z0-9_\-]+$/,
} as const;
