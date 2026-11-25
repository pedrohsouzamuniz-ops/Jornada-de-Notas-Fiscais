import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAdjustmentRequestCreatePayload,
  buildFiscalInvoiceCreatePayload,
  sanitizeItemAssociations,
} from '../src/utils/fiscalPayloads';
import { calculateFiscalNetTotal, roundMoney } from '../src/utils/fiscalCalculations';
import { generateDocId, sanitizeText } from '../src/utils/formatters';
import { BLUEPRINT_LIMITS, FiscalInvoice, PurchaseOrder } from '../src/types/p2p';

setLogLevel('error');

let testEnv: RulesTestEnvironment;
let passed = 0;

async function runCase(name: string, fn: () => Promise<void>) {
  console.log(`RUN: ${name}`);
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    throw err;
  }
}

async function main() {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'polar-primacy-4pz3c-test',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  await testEnv.clearFirestore();

  const nowTs = Timestamp.now();

  const seededPo: PurchaseOrder = {
    id: 'po_open_1',
    poNumber: 'PC-2026-001',
    supplierName: 'Fornecedor Industrial LTDA',
    supplierCnpj: '12.345.678/0001-95',
    costCenter: 'CC-100',
    issueDate: '2026-11-20',
    expectedDeliveryDate: '2026-11-30',
    paymentTerms: '30 dias',
    items: [
      {
        code: 'MAT-01',
        description: 'Chapa de Aço Carbono',
        unit: 'UN',
        qtyOrdered: 10,
        unitPrice: 100,
        totalPrice: 1000,
      },
    ],
    freightAmount: 0,
    discountAmount: 0,
    totalAmount: 1000,
    status: 'aberto',
    notes: '',
    createdByUid: 'compras_uid',
    createdByName: 'Comprador',
    createdAt: nowTs,
    updatedAt: nowTs,
  };

  // Seed users, permissions, and an open purchase order
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'system_config', 'bootstrap'), {
      initialized: true,
      firstAdminUid: 'admin_uid',
      firstAdminEmail: 'admin@empresa.com',
      createdAt: nowTs,
    });
    await setDoc(doc(db, 'admins', 'admin_uid'), {
      uid: 'admin_uid',
      email: 'admin@empresa.com',
      createdAt: nowTs,
    });
    await setDoc(doc(db, 'users', 'admin_uid'), {
      uid: 'admin_uid',
      name: 'Administrador Titular',
      email: 'admin@empresa.com',
      photoUrl: '',
      role: 'adm_titular',
      sector: 'Administração',
      status: 'ativo',
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    await setDoc(doc(db, 'users', 'fiscal_uid'), {
      uid: 'fiscal_uid',
      name: 'Analista Fiscal',
      email: 'fiscal@empresa.com',
      photoUrl: '',
      role: 'fiscal',
      sector: 'Fiscal',
      status: 'ativo',
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    await setDoc(doc(db, 'users', 'compras_uid'), {
      uid: 'compras_uid',
      name: 'Comprador',
      email: 'compras@empresa.com',
      photoUrl: '',
      role: 'compras',
      sector: 'Compras',
      status: 'ativo',
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    await setDoc(doc(db, 'users', 'recebimento_uid'), {
      uid: 'recebimento_uid',
      name: 'Conferente Doca',
      email: 'recebimento@empresa.com',
      photoUrl: '',
      role: 'recebimento',
      sector: 'Recebimento',
      status: 'ativo',
      createdAt: nowTs,
      updatedAt: nowTs,
    });
    await setDoc(doc(db, 'users', 'pendente_uid'), {
      uid: 'pendente_uid',
      name: 'Usuário Pendente',
      email: 'pendente@empresa.com',
      photoUrl: '',
      role: 'pendente',
      sector: 'Aguardando Aprovação',
      status: 'pendente',
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    for (const sec of ['compras', 'recebimento', 'fiscal']) {
      await setDoc(doc(db, 'sector_permissions', sec), {
        sector: sec,
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canViewOtherSectors: true,
        updatedByUid: 'admin_uid',
        updatedAt: nowTs,
      });
    }

    const { id: _poId, ...poBody } = seededPo;
    await setDoc(doc(db, 'purchase_orders', seededPo.id), poBody);
  });

  const fiscalCtx = testEnv.authenticatedContext('fiscal_uid', {
    email: 'fiscal@empresa.com',
    email_verified: true,
  });
  const fiscalUnverifiedCtx = testEnv.authenticatedContext('fiscal_uid', {
    email: 'fiscal@empresa.com',
    email_verified: false,
  });
  const adminCtx = testEnv.authenticatedContext('admin_uid', {
    email: 'admin@empresa.com',
    email_verified: true,
  });
  const comprasCtx = testEnv.authenticatedContext('compras_uid', {
    email: 'compras@empresa.com',
    email_verified: true,
  });
  const recebimentoCtx = testEnv.authenticatedContext('recebimento_uid', {
    email: 'recebimento@empresa.com',
    email_verified: true,
  });
  const pendenteCtx = testEnv.authenticatedContext('pendente_uid', {
    email: 'pendente@empresa.com',
    email_verified: true,
  });

  const baseManualNfe = (
    overrides: Partial<
      Omit<FiscalInvoice, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'>
    > = {}
  ): Omit<FiscalInvoice, 'id' | 'createdByUid' | 'createdByName' | 'createdAt' | 'updatedAt'> => ({
    docType: 'NFE',
    accessKey: `MANUAL-NFE-1001-${Date.now()}`,
    nfeNumber: '1001',
    series: '1',
    issuerName: 'Fornecedor Industrial LTDA',
    issuerCnpj: '12.345.678/0001-95',
    issueDate: '2026-11-25',
    cfop: '0000',
    grossAmount: 1000,
    freightAmount: 0,
    insuranceAmount: 0,
    otherExpensesAmount: 0,
    surchargeAmount: 0,
    discountAmount: 0,
    totalProducts: 1000,
    icmsAmount: 0,
    icmsDesonAmount: 0,
    icmsStAmount: 0,
    ipiAmount: 0,
    pisAmount: 0,
    cofinsAmount: 0,
    csllAmount: 0,
    issqnAmount: 0,
    issqnRetained: true,
    inssAmount: 0,
    irrfAmount: 0,
    retainedTaxesAmount: 0,
    taxRegime: '',
    linkedInvoiceId: '',
    linkedInvoiceNumber: '',
    originState: '',
    originCity: '',
    destinationState: '',
    destinationCity: '',
    issuerState: 'SP',
    suframaPinNumber: '',
    suframaPinAcceptanceDate: '',
    suframaPinReceiptDate: '',
    suframaClearanceDate: '',
    totalInvoice: 1000,
    complementaryInfo: '',
    items: [
      {
        code: 'MAT-01',
        description: 'Chapa de Aço Carbono',
        ncm: '72085100',
        cfop: '0000',
        unit: 'UN',
        qty: 10,
        unitPrice: 100,
        totalPrice: 1000,
      },
    ],
    itemAssociations: [],
    purchaseOrderId: '',
    poNumber: '',
    receiptId: '',
    receiptNumber: '',
    matchingStatus: 'pendente_vinculo',
    fiscalStatus: 'aguardando_recebimento',
    requiresPhysicalReceipt: true,
    isPartialBilling: false,
    conferenceStatus: 'pendente',
    bookkeepingDate: '',
    xmlImported: false,
    notes: '',
    ...overrides,
  });

  // 1. Single valid NF-e WITHOUT PO and WITHOUT adjustment (both aguardando_recebimento and pendente)
  await runCase('1a. Fiscal authorized creates manual NF-e without PO (aguardando_recebimento)', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'fiscal_invoices', invId),
      buildFiscalInvoiceCreatePayload(baseManualNfe(), 'fiscal_uid', 'Analista Fiscal')
    );
    await assertSucceeds(batch.commit());
  });

  await runCase('1b. Fiscal authorized creates manual NF-e without PO (pendente / dispenses receipt)', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'fiscal_invoices', invId),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          accessKey: `MANUAL-NFE-1002-${Date.now()}`,
          nfeNumber: '1002',
          fiscalStatus: 'pendente',
          requiresPhysicalReceipt: false,
        }),
        'fiscal_uid',
        'Analista Fiscal'
      )
    );
    await assertSucceeds(batch.commit());
  });

  await runCase('1c. Fiscal authorized creates NFS-e with empty series (manual and XML)', async () => {
    const db = fiscalCtx.firestore();
    const invId1 = generateDocId('nfe');
    const invId2 = generateDocId('nfe');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'fiscal_invoices', invId1),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          docType: 'NFSE',
          accessKey: `MANUAL-NFSE-2001-${Date.now()}`,
          nfeNumber: '2001',
          series: '',
          taxRegime: 'regime_normal',
          csllAmount: 10,
          issqnAmount: 20,
          issqnRetained: true,
          fiscalStatus: 'pendente',
          requiresPhysicalReceipt: false,
        }),
        'fiscal_uid',
        'Analista Fiscal'
      )
    );
    batch.set(
      doc(db, 'fiscal_invoices', invId2),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          docType: 'NFSE',
          accessKey: 'NFSE_12345678000195_2002',
          nfeNumber: '2002',
          series: '',
          taxRegime: 'simples_nacional',
          xmlImported: true,
          xmlDeclaredTotal: 1000,
          complementaryInfo: 'Serviço prestado em\nduas linhas',
          fiscalStatus: 'aguardando_recebimento',
          requiresPhysicalReceipt: true,
        }),
        'fiscal_uid',
        'Analista Fiscal'
      )
    );
    await assertSucceeds(batch.commit());
  });

  await runCase('1d. NF-e and CT-e with empty series are rejected', async () => {
    const db = fiscalCtx.firestore();
    for (const docType of ['NFE', 'CTE'] as const) {
      const invId = generateDocId('nfe');
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            docType,
            accessKey: `MANUAL-${docType}-NOSERIE-${Date.now()}`,
            series: '',
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      );
      await assertFails(batch.commit());
    }
  });

  // 2. Invoice WITH existing PO (linked before goods arrive) + CT-e XML batch
  await runCase('2a. Fiscal authorized creates XML NF-e linked to existing PO (aguardando_recebimento)', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'fiscal_invoices', invId),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          accessKey: '35261112345678000195550010000100031000000011',
          nfeNumber: '10003',
          xmlImported: true,
          xmlDeclaredTotal: 1000,
          complementaryInfo: 'Pedido vinculado PC-2026-001\nEntrega programada doca 1',
          purchaseOrderId: 'po_open_1',
          poNumber: 'PC-2026-001',
          matchingStatus: 'conciliada',
          fiscalStatus: 'aguardando_recebimento',
          requiresPhysicalReceipt: true,
          conferenceStatus: 'conferido',
          conferenceOriginalOutcome: 'sem_divergencia',
          conferenceConfirmedByUid: 'fiscal_uid',
          conferenceConfirmedByName: 'Analista Fiscal',
          conferenceConfirmedAt: new Date().toISOString(),
          conferenceDataVersion: 'v1_test',
          itemAssociations: [
            {
              id: 'assoc_0',
              invoiceItemIndexes: [0],
              poItemIndexes: [0],
              conversionFactor: 1,
              origin: 'smart',
              confidence: 1,
            },
          ],
        }),
        'fiscal_uid',
        'Analista Fiscal'
      )
    );
    await assertSucceeds(batch.commit());
  });

  await runCase('2b. Fiscal authorized imports CT-e XML linked to PO (dispenses receipt)', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'fiscal_invoices', invId),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          docType: 'CTE',
          accessKey: '35261112345678000195570010000003011000000012',
          nfeNumber: '301',
          series: '1',
          originState: 'SP',
          originCity: 'São Paulo',
          destinationState: 'MG',
          destinationCity: 'Belo Horizonte',
          xmlImported: true,
          xmlDeclaredTotal: 250,
          totalProducts: 250,
          grossAmount: 250,
          totalInvoice: 250,
          purchaseOrderId: 'po_open_1',
          poNumber: 'PC-2026-001',
          matchingStatus: 'conciliada',
          fiscalStatus: 'pendente',
          requiresPhysicalReceipt: false,
        }),
        'fiscal_uid',
        'Analista Fiscal'
      )
    );
    await assertSucceeds(batch.commit());
  });

  // 3. Multi-invoice batch WITH adjustment_requests in the SAME batch
  await runCase('3a. Fiscal authorized creates multi-invoice batch + adjustment_request atomically', async () => {
    const db = fiscalCtx.firestore();
    const invId1 = generateDocId('nfe');
    const invId2 = generateDocId('nfe');
    const adjId = generateDocId('adj');
    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);

    const invoiceInputForAdj = baseManualNfe({
      accessKey: '35261112345678000195550010000100041000000012',
      nfeNumber: '10004',
      xmlImported: true,
      purchaseOrderId: '',
      poNumber: '',
      matchingStatus: 'pendente_vinculo',
      pendingAdjustmentId: adjId,
      pendingAdjustmentPoId: 'po_open_1',
      pendingAdjustmentPoNumber: 'PC-2026-001',
      adjustmentStatus: 'Ajuste solicitado',
    });

    batch.set(
      doc(db, 'adjustment_requests', adjId),
      buildAdjustmentRequestCreatePayload({
        fiscalInvoiceId: invId1,
        invoiceInput: invoiceInputForAdj,
        adjustmentRequest: {
          po: seededPo,
          divergenceReasons: ['Diferença financeira'],
          divergentItems: [
            {
              invoiceItemDescription: 'Chapa de Aço Carbono',
              poItemDescription: 'Chapa de Aço Carbono',
              poQty: 10,
              invoiceQty: 10,
              poUnitPrice: 100,
              invoiceUnitPrice: 120,
              reason: 'Valor unitário divergente',
            },
          ],
          poGrossTotal: 1000,
          poNetTotal: 1000,
          invoiceGrossTotal: 1200,
          invoiceNetTotal: 1200,
          fiscalObservation: 'Valor unitário acima do pedido',
        },
        actorUid: 'fiscal_uid',
        actorName: 'Analista Fiscal',
        actorSector: 'Fiscal',
        nowIso,
      })
    );

    batch.set(
      doc(db, 'fiscal_invoices', invId1),
      buildFiscalInvoiceCreatePayload(invoiceInputForAdj, 'fiscal_uid', 'Analista Fiscal')
    );

    batch.set(
      doc(db, 'fiscal_invoices', invId2),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          accessKey: '35261112345678000195550010000100061000000013',
          nfeNumber: '10006',
          xmlImported: true,
          purchaseOrderId: 'po_open_1',
          poNumber: 'PC-2026-001',
          matchingStatus: 'conciliada',
          isPartialBilling: true,
        }),
        'fiscal_uid',
        'Analista Fiscal'
      )
    );

    await assertSucceeds(batch.commit());
  });

  // 4. ADM Titular also succeeds + Full-payload updateFiscalInvoice simulation
  await runCase('4a. ADM Titular creates NF-e via batch', async () => {
    const db = adminCtx.firestore();
    const invId = generateDocId('nfe');
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'fiscal_invoices', invId),
      buildFiscalInvoiceCreatePayload(
        baseManualNfe({
          accessKey: `MANUAL-ADMIN-${Date.now()}`,
          nfeNumber: '10005',
        }),
        'admin_uid',
        'Administrador Titular'
      )
    );
    await assertSucceeds(batch.commit());
  });

  await runCase('4b. Full-payload updateFiscalInvoice (55+ fields) succeeds as Fiscal and ADM Titular', async () => {
    const fDb = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    await assertSucceeds(
      setDoc(
        doc(fDb, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            accessKey: `FULL-UPD-${Date.now()}`,
            nfeNumber: '7701',
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );

    const buildFullUpdatePayload = (nextStatus: 'pendente' | 'lancado') => ({
      docType: 'NFE',
      nfeNumber: '7701',
      series: '2',
      issuerName: 'Fornecedor Industrial LTDA',
      issuerCnpj: '12.345.678/0001-95',
      issueDate: '2026-11-25',
      purchaseOrderId: 'po_open_1',
      poNumber: 'PC-2026-001',
      receiptId: '',
      receiptNumber: '',
      linkedInvoiceId: '',
      linkedInvoiceNumber: '',
      originState: 'SP',
      originCity: 'São Paulo',
      destinationState: 'SP',
      destinationCity: 'Campinas',
      issuerState: 'SP',
      suframaPinNumber: '',
      suframaPinAcceptanceDate: '',
      suframaPinReceiptDate: '',
      suframaClearanceDate: '',
      grossAmount: 1050,
      freightAmount: 50,
      insuranceAmount: 0,
      otherExpensesAmount: 0,
      surchargeAmount: 0,
      discountAmount: 0,
      totalProducts: 1000,
      icmsAmount: 180,
      icmsDesonAmount: 0,
      icmsStAmount: 0,
      ipiAmount: 0,
      taxRegime: '',
      pisAmount: 16.5,
      cofinsAmount: 76,
      csllAmount: 0,
      issqnAmount: 0,
      issqnRetained: true,
      inssAmount: 0,
      irrfAmount: 0,
      retainedTaxesAmount: 0,
      totalInvoice: calculateFiscalNetTotal({
        docType: 'NFE',
        totalProducts: 1000,
        freightAmount: 50,
      }),
      items: [
        {
          code: 'MAT-01',
          description: 'Chapa de Aço Carbono',
          ncm: '72085100',
          cfop: '5102',
          unit: 'UN',
          qty: 10,
          unitPrice: 100,
          totalPrice: 1000,
        },
      ],
      itemAssociations: sanitizeItemAssociations([
        {
          id: 'assoc_manual_0',
          invoiceItemIndexes: [0],
          poItemIndexes: [0],
          conversionFactor: 1,
          origin: 'manual',
          confirmedByUid: 'fiscal_uid',
          confirmedByName: 'Analista Fiscal',
          confirmedAt: new Date().toISOString(),
        },
      ]),
      matchingStatus: 'conciliada',
      fiscalStatus: nextStatus,
      requiresPhysicalReceipt: false,
      isPartialBilling: true,
      replacedByInvoiceId: '',
      replacedByInvoiceNumber: '',
      bookkeepingDate: nextStatus === 'lancado' ? '2026-11-25' : '',
      cfop: '5102',
      notes: sanitizeText('Atualização completa da ficha fiscal', BLUEPRINT_LIMITS.MAX_NOTES),
      conferenceStatus: 'conferido',
      conferenceOriginalOutcome: 'sem_divergencia',
      conferenceConfirmedByUid: 'fiscal_uid',
      conferenceConfirmedByName: 'Analista Fiscal',
      conferenceConfirmedAt: new Date().toISOString(),
      conferenceJustification: 'Conferência validada na ficha',
      conferenceDataVersion: 'v2_full_update',
      updatedAt: serverTimestamp(),
    });

    await assertSucceeds(updateDoc(doc(fDb, 'fiscal_invoices', invId), buildFullUpdatePayload('pendente')));
    await assertSucceeds(
      updateDoc(doc(adminCtx.firestore(), 'fiscal_invoices', invId), buildFullUpdatePayload('lancado'))
    );
    // Fiscal must remain blocked from editing an already launched invoice
    await assertFails(
      updateDoc(doc(fDb, 'fiscal_invoices', invId), {
        notes: 'Tentativa após lançamento',
        updatedAt: serverTimestamp(),
      })
    );
  });

  // 5. Negative tests: unauthorized roles, unverified email, invalid types/invariants, missing PO on lancado, missing receipt when required
  await runCase('5a. Unverified email cannot create fiscal_invoice', async () => {
    const db = fiscalUnverifiedCtx.firestore();
    const invId = generateDocId('nfe');
    await assertFails(
      setDoc(
        doc(db, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({ accessKey: `UNVERIFIED-${Date.now()}` }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );
  });

  await runCase('5b. Compras, Recebimento, and Pendente cannot create fiscal_invoice', async () => {
    for (const [uid, ctx] of [
      ['compras_uid', comprasCtx],
      ['recebimento_uid', recebimentoCtx],
      ['pendente_uid', pendenteCtx],
    ] as const) {
      const db = ctx.firestore();
      const invId = generateDocId('nfe');
      await assertFails(
        setDoc(
          doc(db, 'fiscal_invoices', invId),
          buildFiscalInvoiceCreatePayload(
            baseManualNfe({ accessKey: `DENY-${uid}-${Date.now()}` }),
            uid,
            'Denied'
          )
        )
      );
    }
  });

  await runCase('5c. Invoice without PO cannot be launched as lancado', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    await assertFails(
      setDoc(
        doc(db, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            accessKey: `NOPO-LANCADO-${Date.now()}`,
            purchaseOrderId: '',
            fiscalStatus: 'lancado',
            requiresPhysicalReceipt: false,
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );
  });

  await runCase('5d. Invoice requiring physical receipt cannot be launched without receipt', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    await assertFails(
      setDoc(
        doc(db, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            accessKey: `NORECEIPT-LANCADO-${Date.now()}`,
            purchaseOrderId: 'po_open_1',
            poNumber: 'PC-2026-001',
            receiptId: '',
            fiscalStatus: 'lancado',
            requiresPhysicalReceipt: true,
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );
  });

  await runCase('5e. Invoice with PO and requiresPhysicalReceipt=false CAN be updated to lancado', async () => {
    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    await assertSucceeds(
      setDoc(
        doc(db, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            accessKey: `DIRECT-PENDENTE-${Date.now()}`,
            purchaseOrderId: 'po_open_1',
            poNumber: 'PC-2026-001',
            fiscalStatus: 'pendente',
            requiresPhysicalReceipt: false,
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );
    await assertSucceeds(
      updateDoc(doc(db, 'fiscal_invoices', invId), {
        fiscalStatus: 'lancado',
        bookkeepingDate: '2026-11-25',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await runCase('5f. Recebimento confirms receipt and transitions invoice aguardando_recebimento -> pendente', async () => {
    const invId = generateDocId('nfe');
    const recId = generateDocId('rec');
    const fDb = fiscalCtx.firestore();
    await assertSucceeds(
      setDoc(
        doc(fDb, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            accessKey: `REC-FLOW-${Date.now()}`,
            fiscalStatus: 'aguardando_recebimento',
            requiresPhysicalReceipt: true,
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );

    const rDb = recebimentoCtx.firestore();
    const batch = writeBatch(rDb);
    batch.set(doc(rDb, 'physical_receipts', recId), {
      receiptNumber: 'REC-2026-0001',
      purchaseOrderId: 'po_open_1',
      poNumber: 'PC-2026-001',
      fiscalInvoiceId: invId,
      supplierName: 'Fornecedor Industrial LTDA',
      supplierCnpj: '12.345.678/0001-95',
      receiptDate: '2026-11-25',
      invoiceNumberRef: '1001',
      warehouseLocation: 'Doca 1',
      items: [
        {
          description: 'Chapa de Aço Carbono',
          unit: 'UN',
          qtyExpected: 10,
          qtyReceived: 10,
        },
      ],
      status: 'conferido',
      observations: '',
      receivedByUid: 'recebimento_uid',
      receivedByName: 'Conferente Doca',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(rDb, 'fiscal_invoices', invId), {
      purchaseOrderId: 'po_open_1',
      poNumber: 'PC-2026-001',
      receiptId: recId,
      receiptNumber: 'REC-2026-0001',
      matchingStatus: 'conciliada',
      fiscalStatus: 'pendente',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    // After physical receipt is confirmed, Fiscal CAN launch as lancado
    await assertSucceeds(
      updateDoc(doc(fDb, 'fiscal_invoices', invId), {
        fiscalStatus: 'lancado',
        bookkeepingDate: '2026-11-25',
        updatedAt: serverTimestamp(),
      })
    );
  });

  await runCase('5g. Invalid numeric types, negative amounts, shadow fields, and invalid adjustment+PO link are rejected', async () => {
    const db = fiscalCtx.firestore();

    const basePayload = buildFiscalInvoiceCreatePayload(
      baseManualNfe({ accessKey: `NEG-${Date.now()}` }),
      'fiscal_uid',
      'Analista Fiscal'
    );

    // Negative grossAmount
    await assertFails(
      setDoc(doc(db, 'fiscal_invoices', generateDocId('nfe')), {
        ...basePayload,
        grossAmount: -1,
      })
    );

    // String csllAmount (non-number)
    await assertFails(
      setDoc(doc(db, 'fiscal_invoices', generateDocId('nfe')), {
        ...basePayload,
        csllAmount: '10' as unknown as number,
      })
    );

    // Shadow field
    await assertFails(
      setDoc(doc(db, 'fiscal_invoices', generateDocId('nfe')), {
        ...basePayload,
        isApprovedOverride: true,
      })
    );

    // Linking PO while adjustmentStatus is still 'Ajuste solicitado'
    await assertFails(
      setDoc(
        doc(db, 'fiscal_invoices', generateDocId('nfe')),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({
            accessKey: `BAD-ADJ-${Date.now()}`,
            purchaseOrderId: 'po_open_1',
            poNumber: 'PC-2026-001',
            pendingAdjustmentId: 'adj_pending_1',
            adjustmentStatus: 'Ajuste solicitado',
          }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );
  });

  await runCase('6. product_equivalences read/write permissions match Compras/Recebimento/Fiscal/Admin', async () => {
    const eqId = generateDocId('eq');
    const eqPayload = {
      supplierCnpj: '12.345.678/0001-95',
      supplierItemCode: 'FORN-01',
      supplierDescription: 'Chapa Carbono Forn',
      supplierNormalizedDesc: 'chapa carbono forn',
      internalCode: 'MAT-01',
      poDescription: 'Chapa de Aço Carbono',
      poUnit: 'UN',
      invoiceUnit: 'UN',
      conversionFactor: 1,
      active: true,
      createdByUid: 'fiscal_uid',
      createdByName: 'Analista Fiscal',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Compras cannot create product_equivalences
    await assertFails(
      setDoc(doc(comprasCtx.firestore(), 'product_equivalences', eqId), {
        ...eqPayload,
        createdByUid: 'compras_uid',
      })
    );

    // Fiscal can create and list product_equivalences
    await assertSucceeds(setDoc(doc(fiscalCtx.firestore(), 'product_equivalences', eqId), eqPayload));
    await assertSucceeds(getDoc(doc(fiscalCtx.firestore(), 'product_equivalences', eqId)));
    await assertSucceeds(getDocs(collection(fiscalCtx.firestore(), 'product_equivalences')));

    // Compras and ADM Titular can list/get product_equivalences
    await assertSucceeds(getDocs(collection(comprasCtx.firestore(), 'product_equivalences')));
    await assertSucceeds(getDocs(collection(adminCtx.firestore(), 'product_equivalences')));
  });

  await runCase('7. Fiscal with canCreate=false is blocked', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sector_permissions', 'fiscal'), {
        sector: 'fiscal',
        canCreate: false,
        canEdit: true,
        canDelete: true,
        canViewOtherSectors: true,
        updatedByUid: 'admin_uid',
        updatedAt: Timestamp.now(),
      });
    });

    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    await assertFails(
      setDoc(
        doc(db, 'fiscal_invoices', invId),
        buildFiscalInvoiceCreatePayload(
          baseManualNfe({ accessKey: `NO-CANCREATE-${Date.now()}` }),
          'fiscal_uid',
          'Analista Fiscal'
        )
      )
    );
  });

  await runCase('8. Fiscal can create NF-e with ICMS Desonerado deducted and FCP-ST / II / IPI Devol.', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sector_permissions', 'fiscal'), {
        sector: 'fiscal',
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canViewOtherSectors: true,
        updatedByUid: 'admin_uid',
        updatedAt: Timestamp.now(),
      });
    });

    const db = fiscalCtx.firestore();
    const invId = generateDocId('nfe');
    const payload = buildFiscalInvoiceCreatePayload(
      baseManualNfe({
        accessKey: `NFE-TAXES-${Date.now()}`,
        totalProducts: 6895.63,
        grossAmount: 6895.63,
        icmsDesonAmount: 1379.13,
        icmsDesonDeducted: true,
        fcpStAmount: 12.5,
        iiAmount: 25.0,
        ipiDevolAmount: 10.0,
        xmlDeclaredTotal: 5564.0,
      }),
      'fiscal_uid',
      'Analista Fiscal'
    );
    await assertSucceeds(setDoc(doc(db, 'fiscal_invoices', invId), payload));
    const snap = await getDoc(doc(db, 'fiscal_invoices', invId));
    const saved = snap.data() as FiscalInvoice;
    if (Math.abs(saved.totalInvoice - 5564.0) > 0.01) {
      throw new Error(`Expected totalInvoice 5564.0, got ${saved.totalInvoice}`);
    }
  });

  await testEnv.cleanup();
  console.log(`\nALL EMULATOR TESTS PASSED (${passed}/${passed})`);
}

main().catch(async (err) => {
  console.error('EMULATOR TEST FAILED:', err);
  if (testEnv) await testEnv.cleanup();
  process.exit(1);
});
