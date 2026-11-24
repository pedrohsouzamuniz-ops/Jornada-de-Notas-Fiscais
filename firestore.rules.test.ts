/**
 * Security Rules Verification Suite (Dirty Dozen Test Matrix)
 * Used to verify Firestore security invariants for Controle Fiscal P2P.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  actorRole: 'compras' | 'recebimento' | 'fiscal' | 'pendente';
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  path: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const dirtyDozenPayloads: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Privilege Escalation on Signup after Bootstrap',
    actorRole: 'pendente',
    operation: 'create',
    path: 'users/attacker_uid',
    payload: {
      uid: 'attacker_uid',
      name: 'Attacker',
      email: 'attacker@empresa.com',
      photoUrl: '',
      role: 'adm_titular',
      sector: 'Administração',
      status: 'ativo',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Role Upgrade on Update',
    actorRole: 'compras',
    operation: 'update',
    path: 'users/compras_uid',
    payload: { role: 'adm_titular' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on PurchaseOrder',
    actorRole: 'compras',
    operation: 'create',
    path: 'purchase_orders/po_shadow',
    payload: {
      poNumber: 'PC-2026-9999',
      isApprovedOverride: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-Sector Write: Compras writing PhysicalReceipt',
    actorRole: 'compras',
    operation: 'create',
    path: 'physical_receipts/rec_1',
    payload: { receiptNumber: 'REC-2026-0001' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Cross-Sector Write: Recebimento deleting FiscalInvoice',
    actorRole: 'recebimento',
    operation: 'delete',
    path: 'fiscal_invoices/inv_1',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-Sector Write: Fiscal editing PurchaseOrder',
    actorRole: 'fiscal',
    operation: 'update',
    path: 'purchase_orders/po_1',
    payload: { status: 'cancelado' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'PII Scraping on /users',
    actorRole: 'compras',
    operation: 'get',
    path: 'users/other_uid',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID Poisoning with oversized invalid ID',
    actorRole: 'compras',
    operation: 'create',
    path: `purchase_orders/${'x'.repeat(200)}`,
    payload: { poNumber: 'PC-2026-0002' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Identity Spoofing via createdByUid',
    actorRole: 'compras',
    operation: 'create',
    path: 'purchase_orders/po_spoof',
    payload: { createdByUid: 'victim_uid' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Timestamp Tampering with client date',
    actorRole: 'compras',
    operation: 'create',
    path: 'purchase_orders/po_time',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Orphaned Relational Reference on FiscalInvoice',
    actorRole: 'fiscal',
    operation: 'create',
    path: 'fiscal_invoices/inv_orphan',
    payload: { purchaseOrderId: 'nonexistent_po_id' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Terminal State Bypass on Escriturada FiscalInvoice',
    actorRole: 'fiscal',
    operation: 'update',
    path: 'fiscal_invoices/inv_escriturada',
    payload: { notes: 'Alteração indevida após escrituração' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
