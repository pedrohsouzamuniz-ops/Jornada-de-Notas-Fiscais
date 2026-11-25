import {
  buildConferenceFingerprint,
  calculateFiscalNetTotal,
  comparePurchaseOrderAndInvoice,
  getEffectiveRetainedTaxes,
  resolveEffectiveIcmsDesonDeducted,
} from '../src/utils/fiscalCalculations';
import {
  buildDeterministicItemAssociations,
  computeAssociationMetrics,
} from '../src/utils/itemReconciliation';
import {
  evaluatePreImportMatch,
  evaluateThreeWayMatch,
  shouldShowPoInReceivingList,
} from '../src/utils/matching';
import { PhysicalReceipt, ProductEquivalence, PurchaseOrder } from '../src/types/p2p';

let passed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} | expected: ${String(expected)}, actual: ${String(actual)}`);
  }
}

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

const samplePo: PurchaseOrder = {
  id: 'po_1',
  poNumber: 'PC-2026-001',
  supplierName: 'Fornecedor Industrial LTDA',
  supplierCnpj: '12.345.678/0001-95',
  issueDate: '2026-10-01',
  expectedDeliveryDate: '2026-10-15',
  items: [
    {
      code: 'MAT-01',
      description: 'Parafuso Sextavado 10mm Inox',
      unit: 'UN',
      qtyOrdered: 100,
      unitPrice: 10.0,
      totalPrice: 1000.0,
    },
  ],
  freightAmount: 0,
  discountAmount: 0,
  totalAmount: 1000.0,
  status: 'aberto',
  costCenter: 'CC-100',
  paymentTerms: '30 dias',
  notes: '',
  createdByUid: 'test_uid',
  createdByName: 'Comprador Teste',
};

const servicePo: PurchaseOrder = {
  id: 'po_srv_1',
  poNumber: 'PC-2026-002',
  supplierName: 'Consultoria Tecnica S/A',
  supplierCnpj: '12.345.678/0001-95',
  issueDate: '2026-10-01',
  expectedDeliveryDate: '2026-10-15',
  items: [
    {
      code: 'SRV-01',
      description: 'Manutencao Preventiva Mensal',
      unit: 'SV',
      qtyOrdered: 1,
      unitPrice: 350.0,
      totalPrice: 350.0,
    },
  ],
  freightAmount: 0,
  discountAmount: 0,
  totalAmount: 350.0,
  status: 'aberto',
  costCenter: 'CC-200',
  paymentTerms: '28 dias',
  notes: '',
  createdByUid: 'test_uid',
  createdByName: 'Comprador Teste',
};

// 1. Net value calculations (NF-e, CT-e, NFS-e with CSLL & ISSQN flag & extras)
test('calculateFiscalNetTotal NF-e sums freight/insurance/other/surcharge/IPI/ST and deducts discounts & retentions only', () => {
  const net = calculateFiscalNetTotal({
    docType: 'NFE',
    totalProducts: 1000,
    freightAmount: 50,
    insuranceAmount: 10,
    otherExpensesAmount: 20,
    surchargeAmount: 5,
    ipiAmount: 40,
    icmsStAmount: 25,
    discountAmount: 15,
    pisAmount: 16.5, // normal highlighted credit tax (NOT deducted)
    cofinsAmount: 76, // normal highlighted credit tax (NOT deducted)
    csllAmount: 10, // retained CSLL (deducted)
    retainedTaxesAmount: 5, // other retained taxes (deducted)
  });
  // 1000 + 50 + 10 + 20 + 5 + 40 + 25 - 15 - (10 + 5) = 1120
  assertEqual(net, 1120, 'NF-e net total calculation');
});

test('calculateFiscalNetTotal CT-e does not duplicate freight and excludes IPI/ICMS-ST', () => {
  const net = calculateFiscalNetTotal({
    docType: 'CTE',
    totalProducts: 450,
    freightAmount: 450, // must NOT be added a second time
    insuranceAmount: 12,
    otherExpensesAmount: 8,
    surchargeAmount: 0,
    ipiAmount: 50,
    icmsStAmount: 30,
    discountAmount: 20,
    csllAmount: 5,
    retainedTaxesAmount: 5,
  });
  // 450 + 12 + 8 - 20 - 10 = 440
  assertEqual(net, 440, 'CT-e net total calculation');
});

test('calculateFiscalNetTotal NFS-e handles MEI, Simples Nacional, Regime Normal + CSLL & ISSQN retained toggle', () => {
  const meiRet = getEffectiveRetainedTaxes({
    docType: 'NFSE',
    totalProducts: 350,
    taxRegime: 'mei',
    pisAmount: 10,
    cofinsAmount: 10,
    csllAmount: 3.5,
    issqnAmount: 17.5,
    inssAmount: 38.5,
    irrfAmount: 5.25,
  });
  assertEqual(meiRet, 0, 'MEI must retain zero taxes');

  const simplesIssNotRetained = calculateFiscalNetTotal({
    docType: 'NFSE',
    totalProducts: 350,
    taxRegime: 'simples_nacional',
    pisAmount: 5, // ignored for Simples
    cofinsAmount: 10, // ignored for Simples
    csllAmount: 3.5, // ignored for Simples
    issqnAmount: 17.5,
    issqnRetained: false, // highlighted only, not withheld
    inssAmount: 38.5,
  });
  assertEqual(simplesIssNotRetained, 311.5, 'Simples Nacional deducts INSS only when ISSQN is not retained');

  const normalWithCsll = calculateFiscalNetTotal({
    docType: 'NFSE',
    totalProducts: 350,
    taxRegime: 'regime_normal',
    pisAmount: 2.28,
    cofinsAmount: 10.5,
    csllAmount: 3.5,
    issqnAmount: 17.5,
    issqnRetained: true,
    inssAmount: 0,
    irrfAmount: 5.25,
  });
  // 350 - (2.28 + 10.50 + 3.50 + 17.50 + 5.25) = 350 - 39.03 = 310.97
  assertEqual(normalWithCsll, 310.97, 'Regime Normal deducts PIS+COFINS+CSLL+ISSQN+IRRF');
});

// 2. Centralized Financial Comparison Criterion
test('NFS-e R$ 350 gross with R$ 15.30 retained taxes (net R$ 334.70) matches PO R$ 350 with zero divergence', () => {
  const cmp = comparePurchaseOrderAndInvoice({
    docType: 'NFSE',
    invoiceGrossTotal: 350,
    invoiceNetTotal: 334.7,
    expectedPoAmount: 350,
  });
  assertEqual(cmp.matches, true, 'NFS-e gross matches PO despite tax retention');
  assertEqual(cmp.differenceCents, 0, 'NFS-e difference must be zero cents');
  assertEqual(cmp.invoiceComparedAmount, 350, 'NFS-e compared amount is gross');
});

test('NF-e and CT-e compare PO against liquid value with 1-cent precision (no hidden tolerance)', () => {
  const nfeExact = comparePurchaseOrderAndInvoice({
    docType: 'NFE',
    invoiceGrossTotal: 950,
    invoiceNetTotal: 1000,
    expectedPoAmount: 1000,
  });
  assertEqual(nfeExact.matches, true, 'NF-e liquid 1000 matches PO 1000');

  const nfeOneCentOff = comparePurchaseOrderAndInvoice({
    docType: 'NFE',
    invoiceGrossTotal: 1000,
    invoiceNetTotal: 1000.01,
    expectedPoAmount: 1000,
  });
  assertEqual(nfeOneCentOff.matches, false, 'NF-e 1-cent mismatch must NOT be tolerated');
  assertEqual(nfeOneCentOff.differenceCents, 1, 'Difference must be exact 1 cent');

  const cteCompare = comparePurchaseOrderAndInvoice({
    docType: 'CTE',
    invoiceGrossTotal: 500,
    invoiceNetTotal: 490,
    expectedPoAmount: 490,
  });
  assertEqual(cteCompare.matches, true, 'CT-e compares liquid total');
});

// 3. Partial Billing (e.g., 6 or 10 partial NFs for 1 PO)
test('Partial billing allows multi-NF partial deliveries (10 units out of 100) without qty divergence', () => {
  const res = evaluatePreImportMatch(
    {
      id: 'nf_p1',
      docType: 'NFE',
      issuerCnpj: '12.345.678/0001-95',
      grossAmount: 100,
      totalProducts: 100,
      totalInvoice: 100,
      items: [
        {
          code: 'MAT-01',
          description: 'Parafuso Sextavado 10mm Inox',
          ncm: '73181500',
          cfop: '5102',
          unit: 'UN',
          qty: 10,
          unitPrice: 10,
          totalPrice: 100,
        },
      ],
      purchaseOrderId: 'po_1',
      receiptId: '',
      requiresPhysicalReceipt: false,
      isPartialBilling: true,
    },
    samplePo
  );
  assertEqual(res.status, 'conciliada', 'First of 10 partial NFs is conciliada');
  assertEqual(res.conferenceBadgeState, 'sem_divergencia', 'Badge sem_divergencia for valid partial parcel');
  assertEqual(res.qtyMatch, true, 'Partial qty <= PO balance passes');
  assertEqual(res.netMatch, true, 'Financial parcel comparison (10 x 10 = 100) matches');
});

test('Partial billing flags cumulative over-billing above PO total qty', () => {
  const res = evaluatePreImportMatch(
    {
      id: 'nf_p2',
      docType: 'NFE',
      issuerCnpj: '12.345.678/0001-95',
      grossAmount: 200,
      totalProducts: 200,
      totalInvoice: 200,
      items: [
        {
          code: 'MAT-01',
          description: 'Parafuso Sextavado 10mm Inox',
          ncm: '73181500',
          cfop: '5102',
          unit: 'UN',
          qty: 20,
          unitPrice: 10,
          totalPrice: 200,
        },
      ],
      purchaseOrderId: 'po_1',
      receiptId: '',
      requiresPhysicalReceipt: false,
      isPartialBilling: true,
    },
    samplePo,
    {
      otherLinkedInvoicesForPo: [
        {
          id: 'nf_prev',
          docType: 'NFE',
          grossAmount: 900,
          totalProducts: 900,
          totalInvoice: 900,
          items: [
            {
              code: 'MAT-01',
              description: 'Parafuso Sextavado 10mm Inox',
              ncm: '73181500',
              cfop: '5102',
              unit: 'UN',
              qty: 90,
              unitPrice: 10,
              totalPrice: 900,
            },
          ],
        },
      ],
    }
  );
  assertEqual(res.status, 'divergente', 'Cumulative 90+20 > 100 must diverge');
  assertEqual(res.qtyMatch, false, 'qtyMatch must be false when cumulative qty exceeds PO');
});

// 4. Physical Receipt Exemption (Two-Way Match without dock receipt)
test('Invoice with requiresPhysicalReceipt=false conciliates cleanly without receiptId', () => {
  const res = evaluateThreeWayMatch(
    {
      id: 'nf_srv_1',
      docType: 'NFSE',
      issuerCnpj: '12.345.678/0001-95',
      grossAmount: 350,
      totalProducts: 350,
      totalInvoice: 334.7,
      items: [
        {
          code: 'SRV-01',
          description: 'Manutencao Preventiva Mensal',
          ncm: '',
          cfop: '0000',
          unit: 'SV',
          qty: 1,
          unitPrice: 350,
          totalPrice: 350,
        },
      ],
      purchaseOrderId: 'po_srv_1',
      receiptId: '',
      requiresPhysicalReceipt: false,
    },
    servicePo,
    undefined
  );
  assertEqual(res.status, 'conciliada', 'Direct-flow NFS-e without receipt is conciliada');
  assertEqual(res.conferenceBadgeState, 'sem_divergencia', 'NFS-e with retention has zero financial divergence');
});

test('Invoice with requiresPhysicalReceipt=true stays pendente_vinculo when receipt is missing', () => {
  const receiptDummy: PhysicalReceipt | undefined = undefined;
  const res = evaluateThreeWayMatch(
    {
      id: 'nf_prod_wait',
      docType: 'NFE',
      issuerCnpj: '12.345.678/0001-95',
      grossAmount: 1000,
      totalProducts: 1000,
      totalInvoice: 1000,
      items: [
        {
          code: 'MAT-01',
          description: 'Parafuso Sextavado 10mm Inox',
          ncm: '73181500',
          cfop: '5102',
          unit: 'UN',
          qty: 100,
          unitPrice: 10,
          totalPrice: 1000,
        },
      ],
      purchaseOrderId: 'po_1',
      receiptId: '',
      requiresPhysicalReceipt: true,
    },
    samplePo,
    receiptDummy
  );
  assertEqual(res.status, 'pendente_vinculo', 'Physical receipt required blocks conciliada');
});

// 5. Item Reconciliation: Tech spec conflict guard, saved equivalences + conversion factor, 1:N & N:1
test('Technical spec conflict (10mm vs 12mm) blocks auto-association even if similar words', () => {
  const match = buildDeterministicItemAssociations({
    docType: 'NFE',
    supplierCnpj: '12.345.678/0001-95',
    invoiceItems: [
      {
        code: 'X-12',
        description: 'Parafuso Sextavado 12mm Inox',
        ncm: '73181500',
        cfop: '5102',
        unit: 'UN',
        qty: 100,
        unitPrice: 10,
        totalPrice: 1000,
      },
    ],
    poItems: samplePo.items,
  });
  assertEqual(match.associations.length, 0, '12mm must NEVER auto-match 10mm');
});

test('Saved supplier equivalence applies conversionFactor accurately', () => {
  const equiv: ProductEquivalence = {
    id: 'eq_1',
    supplierCnpj: '12.345.678/0001-95',
    supplierItemCode: 'CX-PAR-50',
    supplierDescription: 'Caixa Parafuso Inox 50pcs',
    supplierNormalizedDesc: 'caixa parafuso inox 50pcs',
    internalCode: 'MAT-01',
    poDescription: 'Parafuso Sextavado 10mm Inox',
    poUnit: 'UN',
    invoiceUnit: 'CX',
    conversionFactor: 50,
    active: true,
    createdByUid: 'u1',
    createdByName: 'Fiscal',
  };

  const match = buildDeterministicItemAssociations({
    docType: 'NFE',
    supplierCnpj: '12.345.678/0001-95',
    invoiceItems: [
      {
        code: 'CX-PAR-50',
        description: 'Caixa Parafuso Inox 50pcs',
        ncm: '73181500',
        cfop: '5102',
        unit: 'CX',
        qty: 2,
        unitPrice: 500,
        totalPrice: 1000,
      },
    ],
    poItems: samplePo.items,
    savedEquivalences: [equiv],
  });

  assertEqual(match.associations.length, 1, 'Equivalence matched 1 pair');
  assertEqual(match.associations[0].conversionFactor, 50, 'Conversion factor 50 applied');
  const metrics = computeAssociationMetrics({
    assoc: match.associations[0],
    invoiceItems: [
      {
        code: 'CX-PAR-50',
        description: 'Caixa Parafuso Inox 50pcs',
        ncm: '73181500',
        cfop: '5102',
        unit: 'CX',
        qty: 2,
        unitPrice: 500,
        totalPrice: 1000,
      },
    ],
    poItems: samplePo.items,
  });
  assertEqual(metrics.invoiceQtyConverted, 100, '2 CX * 50 = 100 UN');
  assertEqual(metrics.qtyMatch, true, 'Converted qty matches PO 100 UN');
  assertEqual(metrics.unitPriceMatch, true, '1000 / 100 = 10/UN matches PO');
});

test('1:N Kit decomposition computes qty & effective unit price accurately', () => {
  const kitPoItems = [
    {
      code: 'KIT-01',
      description: 'Ferro de Cova com Cabo',
      unit: 'UN',
      qtyOrdered: 5,
      unitPrice: 100,
      totalPrice: 500,
    },
  ];
  const splitInvItems = [
    {
      code: 'P-1',
      description: 'Cavadeira Metalica',
      ncm: '',
      cfop: '5102',
      unit: 'UN',
      qty: 5,
      unitPrice: 70,
      totalPrice: 350,
    },
    {
      code: 'P-2',
      description: 'Cabo de Madeira',
      ncm: '',
      cfop: '5102',
      unit: 'UN',
      qty: 5,
      unitPrice: 30,
      totalPrice: 150,
    },
  ];
  const metrics = computeAssociationMetrics({
    assoc: {
      id: 'kit_assoc',
      invoiceItemIndexes: [0, 1],
      poItemIndexes: [0],
      conversionFactor: 1,
      origin: 'manual',
    },
    invoiceItems: splitInvItems,
    poItems: kitPoItems,
  });
  assertEqual(metrics.invoiceQtyConverted, 5, '5 sets of Cavadeira+Cabo = 5 units of kit');
  assertEqual(metrics.invoiceUnitPriceEffective, 100, '350+150 / 5 = 100/UN');
  assertEqual(metrics.qtyMatch, true, 'Kit qty matches PO');
  assertEqual(metrics.unitPriceMatch, true, 'Kit unit price matches PO');
});

// 6. Conference Fingerprint Change Detection
test('buildConferenceFingerprint changes deterministically when PO or invoice changes', () => {
  const baseFp = buildConferenceFingerprint({
    invoice: {
      docType: 'NFE',
      grossAmount: 1000,
      totalProducts: 1000,
      freightAmount: 0,
      ipiAmount: 0,
      pisAmount: 0,
      cofinsAmount: 0,
      totalInvoice: 1000,
      items: samplePo.items.map((p) => ({
        code: p.code,
        description: p.description,
        ncm: '',
        cfop: '5102',
        unit: p.unit,
        qty: p.qtyOrdered,
        unitPrice: p.unitPrice,
        totalPrice: p.totalPrice,
      })),
    },
    po: samplePo,
    requiresPhysicalReceipt: false,
    isPartialBilling: false,
  });

  const changedPoFp = buildConferenceFingerprint({
    invoice: {
      docType: 'NFE',
      grossAmount: 1000,
      totalProducts: 1000,
      freightAmount: 0,
      ipiAmount: 0,
      pisAmount: 0,
      cofinsAmount: 0,
      totalInvoice: 1000,
      items: samplePo.items.map((p) => ({
        code: p.code,
        description: p.description,
        ncm: '',
        cfop: '5102',
        unit: p.unit,
        qty: p.qtyOrdered,
        unitPrice: p.unitPrice,
        totalPrice: p.totalPrice,
      })),
    },
    po: { ...samplePo, totalAmount: 999 },
    requiresPhysicalReceipt: false,
    isPartialBilling: false,
  });

  assert(baseFp !== changedPoFp, 'Fingerprint must change when PO totalAmount is edited');
});

// 7. Receiving PO List Visibility (Dispensed Invoices)
test('shouldShowPoInReceivingList hides POs linked only to dispensed invoices and keeps POs with pending physical receipts', () => {
  assertEqual(
    shouldShowPoInReceivingList(
      { id: 'po_1', status: 'aberto' },
      [
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'pendente',
          requiresPhysicalReceipt: false,
        },
      ]
    ),
    false,
    'PO with active dispensed invoice (pendente) must be hidden from Receiving PO list'
  );

  assertEqual(
    shouldShowPoInReceivingList(
      { id: 'po_1', status: 'aberto' },
      [
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'lancado',
          requiresPhysicalReceipt: false,
        },
      ]
    ),
    false,
    'PO with active dispensed invoice (lancado) must be hidden from Receiving PO list'
  );

  assertEqual(
    shouldShowPoInReceivingList(
      { id: 'po_1', status: 'aberto' },
      [
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'aguardando_recebimento',
          requiresPhysicalReceipt: true,
        },
      ]
    ),
    true,
    'PO with invoice awaiting physical receipt must appear in Receiving PO list'
  );

  assertEqual(
    shouldShowPoInReceivingList({ id: 'po_1', status: 'aberto' }, []),
    true,
    'PO without linked invoices must appear in Receiving PO list'
  );

  assertEqual(
    shouldShowPoInReceivingList(
      { id: 'po_1', status: 'parcialmente_atendido' },
      [
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'lancado',
          requiresPhysicalReceipt: false,
        },
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'aguardando_recebimento',
          requiresPhysicalReceipt: true,
        },
      ]
    ),
    true,
    'PO with a dispensed invoice and another invoice awaiting physical receipt must remain visible'
  );

  assertEqual(
    shouldShowPoInReceivingList(
      { id: 'po_1', status: 'aberto' },
      [
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'substituida',
          requiresPhysicalReceipt: false,
        },
        {
          purchaseOrderId: 'po_1',
          fiscalStatus: 'rejeitada',
          requiresPhysicalReceipt: false,
        },
      ]
    ),
    true,
    'Replaced or rejected dispensed invoices must not hide the PO'
  );

  assertEqual(
    shouldShowPoInReceivingList({ id: 'po_1', status: 'cancelado' }, []),
    false,
    'Cancelled PO must remain hidden'
  );
});

// 8. NF-e Tax Additions & Reductions (ICMS Desonerado, FCP-ST, II, IPI Devol.)
test('calculateFiscalNetTotal and resolveEffectiveIcmsDesonDeducted handle NF-e tax additions and ICMS Desonerado reduction accurately', () => {
  // User case: vProd = 6895.63, vICMSDeson = 1379.13, vNF = 5516.50
  const deduced = resolveEffectiveIcmsDesonDeducted({
    docType: 'NFE',
    icmsDesonAmount: 1379.13,
    xmlDeclaredTotal: 5516.5,
    totalWithoutDeson: 6895.63,
  });
  assertEqual(deduced, true, 'Must detect ICMS Desonerado deducted from vNF');

  const netWithDeson = calculateFiscalNetTotal({
    docType: 'NFE',
    totalProducts: 6895.63,
    icmsDesonAmount: 1379.13,
    icmsDesonDeducted: deduced,
  });
  assertEqual(netWithDeson, 5516.5, 'NF-e net total must match XML vNF R$ 5.516,50');

  // Informative ICMS Deson. (not deducted from vNF)
  const informativeDeson = resolveEffectiveIcmsDesonDeducted({
    docType: 'NFE',
    icmsDesonAmount: 494,
    xmlDeclaredTotal: 13217.5,
    totalWithoutDeson: 13217.5,
  });
  assertEqual(informativeDeson, false, 'Informative ICMS Deson. must not be deducted from vNF');

  // Additions: FCP-ST + II + IPI Devol. + IPI + ICMS-ST + Freight + Insurance + Other - Discount - ICMS Deson.
  const fullNfeNet = calculateFiscalNetTotal({
    docType: 'NFE',
    totalProducts: 1000,
    freightAmount: 50,
    insuranceAmount: 10,
    otherExpensesAmount: 20,
    ipiAmount: 40,
    ipiDevolAmount: 15,
    icmsStAmount: 25,
    fcpStAmount: 5,
    iiAmount: 80,
    discountAmount: 10,
    icmsDesonAmount: 100,
    icmsDesonDeducted: true,
  });
  // 1000 + 50 + 10 + 20 + 40 + 15 + 25 + 5 + 80 - 10 - 100 = 1135
  assertEqual(fullNfeNet, 1135, 'NF-e net total includes FCP-ST, II, IPI Devol. and deducts ICMS Deson.');
});

console.log(`\nAll ${passed} P2P Fiscal Engine tests passed!`);

