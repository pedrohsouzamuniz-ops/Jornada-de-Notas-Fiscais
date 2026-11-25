import {
  BLUEPRINT_LIMITS,
  FiscalDocType,
  FiscalInvoiceItem,
  PurchaseOrder,
  ServiceTaxRegime,
} from '../types/p2p';
import { getUfFromCodeOrAccessKey } from './brazilLocations';
import {
  calculateFiscalNetTotal,
  resolveEffectiveIcmsDesonDeducted,
  roundMoney,
} from './fiscalCalculations';
import { formatCnpj, sanitizeText, todayISO } from './formatters';
import { isValidGtin } from './itemReconciliation';

export interface ParsedFiscalXml {
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
  insuranceAmount: number;
  otherExpensesAmount: number;
  surchargeAmount: number;
  discountAmount: number;
  totalProducts: number;
  icmsAmount: number;
  icmsDesonAmount: number;
  icmsDesonDeducted?: boolean;
  icmsStAmount: number;
  fcpStAmount?: number;
  iiAmount?: number;
  ipiAmount: number;
  ipiDevolAmount?: number;
  pisAmount: number;
  cofinsAmount: number;
  csllAmount: number;
  issqnAmount: number;
  issqnRetained: boolean;
  inssAmount: number;
  irrfAmount: number;
  retainedTaxesAmount: number;
  taxRegime?: ServiceTaxRegime;
  originState?: string;
  originCity?: string;
  destinationState?: string;
  destinationCity?: string;
  referencedNfeKey?: string;
  totalInvoice: number;
  xmlDeclaredTotal?: number;
  complementaryInfo: string;
  items: FiscalInvoiceItem[];
}

function getElementsByLocalName(root: Element | Document, localName: string): Element[] {
  const all = root.getElementsByTagName('*');
  const matches: Element[] = [];
  const target = localName.toLowerCase();
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const elLocal = (el.localName || el.tagName.split(':').pop() || '').toLowerCase();
    if (elLocal === target) {
      matches.push(el);
    }
  }
  return matches;
}

function getTagText(parent: Element | Document | null, tagName: string): string {
  if (!parent) return '';
  const els = getElementsByLocalName(parent, tagName);
  if (els.length === 0) return '';
  return (els[0].textContent || '').trim();
}

function getTagNumber(parent: Element | Document | null, tagName: string): number {
  const txt = getTagText(parent, tagName).replace(',', '.');
  const num = parseFloat(txt);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function getFirstPositiveTagNumber(
  parents: Array<Element | Document | null>,
  tagNames: string[]
): number {
  for (const tag of tagNames) {
    for (const parent of parents) {
      const val = getTagNumber(parent, tag);
      if (val > 0) return roundMoney(val);
    }
  }
  return 0;
}

function extractDateISO(raw: string): string {
  const match = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : todayISO();
}

function sanitizeAccessKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, BLUEPRINT_LIMITS.MAX_ACCESS_KEY);
}

export function parseFiscalXml(xmlContent: string): ParsedFiscalXml {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Arquivo XML inválido ou malformado.');
  }

  // 1. Detect CT-e (<infCte> or <CTe> or <cteProc>)
  const infCte = getElementsByLocalName(doc, 'infCte')[0];
  if (infCte) {
    return parseCTe(doc, infCte);
  }

  // 2. Detect NFS-e Padrão Nacional / ABRASF (<infNFSe>, <NFSe>, <CompNfse>, <Nfse>)
  const infNFSe =
    getElementsByLocalName(doc, 'infNFSe')[0] ||
    getElementsByLocalName(doc, 'InfNfse')[0] ||
    getElementsByLocalName(doc, 'NFSe')[0] ||
    getElementsByLocalName(doc, 'Nfse')[0];
  if (infNFSe) {
    return parseNFSe(doc, infNFSe);
  }

  // 3. Detect NF-e (<infNFe>)
  const infNFe = getElementsByLocalName(doc, 'infNFe')[0];
  if (infNFe) {
    return parseNFe(doc, infNFe);
  }

  throw new Error(
    'Formato XML não reconhecido. Envie um XML válido de NF-e (<infNFe>), NFS-e Padrão Nacional (<infNFSe>) ou CT-e (<infCte>).'
  );
}

function parseNFe(doc: Document, infNFe: Element): ParsedFiscalXml {
  const ide = getElementsByLocalName(infNFe, 'ide')[0] || null;
  const emit = getElementsByLocalName(infNFe, 'emit')[0] || null;
  const totalEl = getElementsByLocalName(infNFe, 'total')[0] || null;
  const total =
    getElementsByLocalName(infNFe, 'ICMSTot')[0] ||
    totalEl ||
    null;
  const issqnTot = totalEl ? getElementsByLocalName(totalEl, 'ISSQNtot')[0] || null : null;
  const protNFe = getElementsByLocalName(doc, 'protNFe')[0] || null;

  let accessKey = getTagText(protNFe, 'chNFe').replace(/\D/g, '');
  if (accessKey.length !== 44) {
    const idAttr = infNFe.getAttribute('Id') || '';
    accessKey = idAttr.replace(/^NFe/i, '').replace(/\D/g, '');
  }
  accessKey = sanitizeAccessKey(accessKey);
  if (accessKey.length < 8) {
    throw new Error('Chave de Acesso da NF-e não localizada (<chNFe> ou Id da infNFe).');
  }

  const nfeNumber = sanitizeText(getTagText(ide, 'nNF') || accessKey.slice(25, 34), 20);
  const series = sanitizeText(getTagText(ide, 'serie') || '1', 10);
  const issueDate = extractDateISO(getTagText(ide, 'dhEmi') || getTagText(ide, 'dEmi'));

  const issuerName = sanitizeText(
    getTagText(emit, 'xNome') || 'Emitente NF-e',
    BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME
  );
  const rawCnpj = getTagText(emit, 'CNPJ').replace(/\D/g, '');
  const issuerCnpj =
    rawCnpj.length === 14 ? formatCnpj(rawCnpj) : sanitizeText(rawCnpj || '00.000.000/0001-00', 20);
  const enderEmit = emit ? getElementsByLocalName(emit, 'enderEmit')[0] || null : null;
  const rawEmitUf = (
    getTagText(enderEmit || emit, 'UF') ||
    getUfFromCodeOrAccessKey(getTagText(ide, 'cUF') || accessKey)
  )
    .trim()
    .toUpperCase();
  const issuerState = /^[A-Z]{2}$/.test(rawEmitUf) ? rawEmitUf : '';

  const detNodes = getElementsByLocalName(infNFe, 'det').slice(0, BLUEPRINT_LIMITS.MAX_ITEMS);
  if (detNodes.length === 0) {
    throw new Error('Nenhum item (<det>) encontrado na NF-e.');
  }

  const items: FiscalInvoiceItem[] = detNodes.map((det, idx) => {
    const prod = getElementsByLocalName(det, 'prod')[0] || det;
    const qty = Math.max(0.0001, getTagNumber(prod, 'qCom') || 1);
    const unitPrice = getTagNumber(prod, 'vUnCom');
    const totalPrice = getTagNumber(prod, 'vProd') || roundMoney(qty * unitPrice);
    const rawGtin = (getTagText(prod, 'cEAN') || getTagText(prod, 'cEANTrib')).replace(/\D/g, '');
    const gtin = isValidGtin(rawGtin) ? rawGtin : undefined;
    return {
      code: sanitizeText(getTagText(prod, 'cProd') || `ITEM-${idx + 1}`, 40),
      description: sanitizeText(
        getTagText(prod, 'xProd') || `Item NF-e ${idx + 1}`,
        BLUEPRINT_LIMITS.MAX_ITEM_DESC
      ),
      ncm: sanitizeText(getTagText(prod, 'NCM') || '00000000', 12),
      cfop: sanitizeText(getTagText(prod, 'CFOP') || '5102', 16),
      unit: sanitizeText(getTagText(prod, 'uCom') || 'UN', 12),
      qty,
      unitPrice,
      totalPrice,
      ...(gtin ? { gtin } : {}),
    };
  });

  const mainCfop = sanitizeText(items[0]?.cfop || '5102', 16);
  const sumItems = items.reduce((acc, item) => acc + item.totalPrice, 0);
  const vProdTag = getTagNumber(total, 'vProd');
  const vServNfe = issqnTot ? getTagNumber(issqnTot, 'vServ') : 0;
  const totalProducts = roundMoney(vProdTag > 0 ? vProdTag + vServNfe : sumItems);
  const freightAmount = roundMoney(
    getTagNumber(total, 'vFrete') ||
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vFrete'), 0)
  );
  const insuranceAmount = roundMoney(
    getTagNumber(total, 'vSeg') ||
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vSeg'), 0)
  );
  const otherExpensesAmount = roundMoney(
    getTagNumber(total, 'vOutro') ||
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vOutro'), 0)
  );
  const surchargeAmount = 0;
  const issqnDesc = issqnTot
    ? roundMoney(getTagNumber(issqnTot, 'vDescIncond') + getTagNumber(issqnTot, 'vDescCond'))
    : 0;
  const discountAmount = roundMoney(
    (getTagNumber(total, 'vDesc') ||
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vDesc'), 0)) + issqnDesc
  );
  const icmsAmount = roundMoney(getTagNumber(total, 'vICMS'));

  let icmsDesonAmount = roundMoney(getTagNumber(total, 'vICMSDeson'));
  if (icmsDesonAmount === 0) {
    icmsDesonAmount = roundMoney(
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vICMSDeson'), 0)
    );
  }
  let hasExplicitIndOne = false;
  let hasExplicitIndZero = false;
  let deductedDesonSum = 0;
  detNodes.forEach((det) => {
    const icmsNode = getElementsByLocalName(det, 'ICMS')[0] || det;
    const ind = getTagText(icmsNode, 'indDeduzDeson').trim();
    const val = getTagNumber(icmsNode, 'vICMSDeson');
    if (ind === '1') {
      hasExplicitIndOne = true;
      deductedDesonSum += val;
    } else if (ind === '0') {
      hasExplicitIndZero = true;
    }
  });
  if (hasExplicitIndOne && hasExplicitIndZero && deductedDesonSum > 0) {
    icmsDesonAmount = roundMoney(deductedDesonSum);
  }

  let icmsStAmount = roundMoney(getTagNumber(total, 'vST'));
  if (icmsStAmount === 0) {
    icmsStAmount = roundMoney(
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vICMSST'), 0)
    );
  }
  let fcpStAmount = roundMoney(getTagNumber(total, 'vFCPST'));
  if (fcpStAmount === 0) {
    fcpStAmount = roundMoney(
      detNodes.reduce((acc, det) => acc + getTagNumber(det, 'vFCPST'), 0)
    );
  }
  let iiAmount = roundMoney(getTagNumber(total, 'vII'));
  if (iiAmount === 0) {
    iiAmount = roundMoney(
      detNodes.reduce((acc, det) => {
        const iiNode = getElementsByLocalName(det, 'II')[0];
        return acc + (iiNode ? getTagNumber(iiNode, 'vII') : 0);
      }, 0)
    );
  }
  let ipiAmount = roundMoney(getTagNumber(total, 'vIPI'));
  if (ipiAmount === 0) {
    ipiAmount = roundMoney(
      detNodes.reduce((acc, det) => {
        const ipiNode = getElementsByLocalName(det, 'IPI')[0];
        return acc + (ipiNode ? getTagNumber(ipiNode, 'vIPI') : 0);
      }, 0)
    );
  }
  let ipiDevolAmount = roundMoney(getTagNumber(total, 'vIPIDevol'));
  if (ipiDevolAmount === 0) {
    ipiDevolAmount = roundMoney(
      detNodes.reduce((acc, det) => {
        const devNode = getElementsByLocalName(det, 'impostoDevol')[0];
        return acc + (devNode ? getTagNumber(devNode, 'vIPIDevol') : 0);
      }, 0)
    );
  }

  const pisAmount = roundMoney(getTagNumber(total, 'vPIS'));
  const cofinsAmount = roundMoney(getTagNumber(total, 'vCOFINS'));

  const retTrib = getElementsByLocalName(infNFe, 'retTrib')[0] || null;
  const csllAmount = retTrib ? roundMoney(getTagNumber(retTrib, 'vRetCSLL')) : 0;
  const irrfAmount = retTrib ? roundMoney(getTagNumber(retTrib, 'vIRRF')) : 0;
  const inssAmount = retTrib ? roundMoney(getTagNumber(retTrib, 'vRetPrev')) : 0;
  // vRetPIS and vRetCOFINS stay in retainedTaxesAmount so highlighted vPIS/vCOFINS in ICMSTot are never deducted
  const retainedTaxesAmount = retTrib
    ? roundMoney(getTagNumber(retTrib, 'vRetPIS') + getTagNumber(retTrib, 'vRetCOFINS'))
    : 0;
  const issRetNfe = issqnTot ? roundMoney(getTagNumber(issqnTot, 'vISSRet')) : 0;

  const vnfDeclared = getTagNumber(total, 'vNF');
  const xmlDeclaredTotal = vnfDeclared > 0 ? roundMoney(vnfDeclared) : undefined;

  const totalWithoutDeson = calculateFiscalNetTotal({
    docType: 'NFE',
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
    icmsDesonAmount: 0,
    icmsDesonDeducted: false,
    discountAmount,
    csllAmount,
    issqnAmount: issRetNfe,
    issqnRetained: issRetNfe > 0,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
  });

  const explicitDesonFlag =
    icmsDesonAmount <= 0
      ? false
      : hasExplicitIndOne
      ? true
      : hasExplicitIndZero
      ? false
      : undefined;

  const icmsDesonDeducted = resolveEffectiveIcmsDesonDeducted({
    docType: 'NFE',
    icmsDesonAmount,
    icmsDesonDeducted: explicitDesonFlag,
    xmlDeclaredTotal,
    totalWithoutDeson,
  });

  const totalInvoice = calculateFiscalNetTotal({
    docType: 'NFE',
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
    csllAmount,
    issqnAmount: issRetNfe,
    issqnRetained: issRetNfe > 0,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
  });

  const infAdic = getElementsByLocalName(infNFe, 'infAdic')[0] || null;
  const infCpl = getTagText(infAdic || infNFe, 'infCpl');
  const infAdFisco = getTagText(infAdic || infNFe, 'infAdFisco');
  const obsContNodes = infAdic ? getElementsByLocalName(infAdic, 'obsCont') : [];
  const obsContLines = obsContNodes
    .map((node) => {
      const campo = node.getAttribute('xCampo') || getTagText(node, 'xCampo');
      const texto = getTagText(node, 'xTexto');
      return texto ? (campo ? `${campo}: ${texto}` : texto) : '';
    })
    .filter(Boolean);
  const compParts = [
    infAdFisco ? `[Fisco] ${infAdFisco}` : '',
    infCpl,
    ...obsContLines,
  ].filter(Boolean);
  const complementaryInfo = sanitizeText(
    compParts.join('\n'),
    BLUEPRINT_LIMITS.MAX_COMPLEMENTARY_INFO
  );

  return {
    docType: 'NFE',
    accessKey,
    nfeNumber,
    series,
    issuerName,
    issuerCnpj,
    issuerState,
    issueDate,
    cfop: mainCfop,
    grossAmount: totalProducts,
    freightAmount,
    insuranceAmount,
    otherExpensesAmount,
    surchargeAmount,
    discountAmount,
    totalProducts,
    icmsAmount,
    icmsDesonAmount,
    icmsDesonDeducted,
    icmsStAmount,
    fcpStAmount,
    iiAmount,
    ipiAmount,
    ipiDevolAmount,
    pisAmount,
    cofinsAmount,
    csllAmount,
    issqnAmount: issRetNfe,
    issqnRetained: issRetNfe > 0,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
    totalInvoice,
    ...(xmlDeclaredTotal !== undefined ? { xmlDeclaredTotal } : {}),
    complementaryInfo,
    items,
  };
}

function parseNFSe(doc: Document, infNFSe: Element): ParsedFiscalXml {
  const dps = getElementsByLocalName(doc, 'DPS')[0] || getElementsByLocalName(doc, 'infDPS')[0] || null;
  const emit =
    getElementsByLocalName(infNFSe, 'emit')[0] ||
    getElementsByLocalName(infNFSe, 'PrestadorServico')[0] ||
    getElementsByLocalName(dps || infNFSe, 'prest')[0] ||
    null;

  const nfeNumber = sanitizeText(
    getTagText(infNFSe, 'nNFSe') ||
      getTagText(infNFSe, 'Numero') ||
      getTagText(infNFSe, 'nDFSe') ||
      '1',
    20
  );
  // Série é opcional em NFS-e (não forçar 'NFS' quando ausente no XML)
  const rawSeries = getTagText(dps || infNFSe, 'serie') || getTagText(infNFSe, 'Serie');
  const series = sanitizeText(rawSeries, 10);

  const idAttr = infNFSe.getAttribute('Id') || '';
  const chNFSe = getTagText(doc, 'chNFSe') || idAttr.replace(/^NFS/i, '');
  const codVer = getTagText(infNFSe, 'CodigoVerificacao');
  const rawCnpj = (
    getTagText(emit, 'CNPJ') ||
    getTagText(emit, 'Cnpj') ||
    getTagText(infNFSe, 'CNPJ')
  ).replace(/\D/g, '');
  const issuerCnpj =
    rawCnpj.length === 14 ? formatCnpj(rawCnpj) : sanitizeText(rawCnpj || '00.000.000/0001-00', 20);

  let accessKey = sanitizeAccessKey(
    chNFSe || (codVer ? `NFSE_${rawCnpj}_${nfeNumber}_${codVer}` : `NFSE_${rawCnpj}_${nfeNumber}`)
  );
  if (accessKey.length < 8) {
    accessKey = sanitizeAccessKey(`NFSE_${rawCnpj || '00000000'}_${nfeNumber}`);
  }

  const issuerName = sanitizeText(
    getTagText(emit, 'xNome') || getTagText(emit, 'RazaoSocial') || 'Prestador de Serviço (NFS-e)',
    BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME
  );
  const enderEmitNfse = emit
    ? getElementsByLocalName(emit, 'end')[0] ||
      getElementsByLocalName(emit, 'Endereco')[0] ||
      null
    : null;
  const rawNfseUf = (getTagText(enderEmitNfse || emit, 'UF') || getTagText(enderEmitNfse || emit, 'Uf'))
    .trim()
    .toUpperCase();
  const issuerState = /^[A-Z]{2}$/.test(rawNfseUf) ? rawNfseUf : '';

  const issueDate = extractDateISO(
    getTagText(infNFSe, 'dhProc') ||
      getTagText(infNFSe, 'dhEmi') ||
      getTagText(infNFSe, 'DataEmissao') ||
      getTagText(dps, 'dhEmi')
  );

  const valores =
    getElementsByLocalName(infNFSe, 'valores')[0] ||
    getElementsByLocalName(infNFSe, 'Valores')[0] ||
    getElementsByLocalName(infNFSe, 'vServPrest')[0] ||
    infNFSe;
  const tribFed =
    getElementsByLocalName(dps || infNFSe, 'tribFed')[0] ||
    getElementsByLocalName(infNFSe, 'tribFed')[0] ||
    null;
  const tribMun =
    getElementsByLocalName(dps || infNFSe, 'tribMun')[0] ||
    getElementsByLocalName(infNFSe, 'tribMun')[0] ||
    null;
  const totTrib = getElementsByLocalName(infNFSe, 'totTrib')[0] || null;
  const taxScopes = [valores, tribFed, tribMun, infNFSe, dps];

  const grossAmount = roundMoney(
    getFirstPositiveTagNumber([valores, infNFSe, dps], [
      'vServ',
      'ValorServicos',
      'vBC',
      'vLiq',
    ])
  );

  const tpRetPisCofins = getTagText(tribFed || dps || infNFSe, 'tpRetPisCofins').trim();
  const explicitRetPis = getFirstPositiveTagNumber(taxScopes, ['vRetPIS']);
  const explicitRetCofins = getFirstPositiveTagNumber(taxScopes, ['vRetCOFINS']);
  const rawPisAmount =
    tpRetPisCofins === '2' && explicitRetPis === 0
      ? 0
      : getFirstPositiveTagNumber(taxScopes, ['vRetPIS', 'vPIS', 'ValorPis']);
  const rawCofinsAmount =
    tpRetPisCofins === '2' && explicitRetCofins === 0
      ? 0
      : getFirstPositiveTagNumber(taxScopes, ['vRetCOFINS', 'vCOFINS', 'ValorCofins']);
  const rawCsllAmount = getFirstPositiveTagNumber(taxScopes, ['vRetCSLL', 'vCSLL', 'ValorCsll']);
  const rawInssAmount = getFirstPositiveTagNumber(taxScopes, [
    'vRetINSS',
    'vRetCP',
    'vINSS',
    'ValorInss',
  ]);
  const rawIrrfAmount = getFirstPositiveTagNumber(taxScopes, [
    'vRetIRRF',
    'vIRRF',
    'vIR',
    'ValorIr',
  ]);
  const rawOutrasRetencoes = getFirstPositiveTagNumber(taxScopes, [
    'OutrasRetencoes',
    'vOutrasRet',
  ]);

  // Consolidated federal retention tag (only fallback if individual federal withholdings are absent to prevent double counting!)
  const hasIndividualFed =
    rawPisAmount > 0 || rawCofinsAmount > 0 || rawCsllAmount > 0 || rawIrrfAmount > 0;
  const rawConsolidatedFed = hasIndividualFed
    ? 0
    : getFirstPositiveTagNumber([valores, totTrib, tribFed, infNFSe], ['vTotRetFed', 'vRetTrib']);

  const explicitIssRet = getFirstPositiveTagNumber(taxScopes, ['vISSRet', 'ValorIssRetido']);
  const rawIssqnAmount =
    explicitIssRet > 0
      ? explicitIssRet
      : getFirstPositiveTagNumber(taxScopes, ['vISSQN', 'vISS', 'ValorIss']);

  const declaredLiq = getFirstPositiveTagNumber([valores, infNFSe], ['vLiq', 'ValorLiquidoNfse']);
  const xmlDeclaredTotal = declaredLiq > 0 ? declaredLiq : undefined;

  const tpRetISSQN = getTagText(tribMun || dps || infNFSe, 'tpRetISSQN').trim();
  const issRetidoAbrasf = getTagText(valores || infNFSe, 'IssRetido').trim();

  const discountIncond = getFirstPositiveTagNumber([valores, infNFSe, dps], [
    'vDescIncond',
    'DescontoIncondicionado',
  ]);
  const discountCond = getFirstPositiveTagNumber([valores, infNFSe, dps], [
    'vDescCond',
    'DescontoCondicionado',
  ]);
  const discountAmount = roundMoney(discountIncond + discountCond);
  const otherExpensesAmount = roundMoney(
    getFirstPositiveTagNumber([valores, infNFSe, dps], ['vOutro', 'OutrasDespesas'])
  );

  const opSimpNac = getTagText(dps || infNFSe, 'opSimpNac') || getTagText(infNFSe, 'opSimpNac');
  const regEspTrib =
    getTagText(dps || infNFSe, 'regEspTrib') ||
    getTagText(infNFSe, 'RegimeEspecialTributacao');
  const optanteSn = getTagText(infNFSe, 'OptanteSimplesNacional');
  const rawRegimeText = (
    getTagText(infNFSe, 'RegimeTributario') ||
    getTagText(infNFSe, 'xRegTrib') ||
    ''
  ).toUpperCase();

  let taxRegime: ServiceTaxRegime = 'regime_normal';
  if (
    opSimpNac === '2' ||
    regEspTrib === '5' ||
    rawRegimeText.includes('MEI') ||
    rawRegimeText.includes('SIMEI')
  ) {
    taxRegime = 'mei';
  } else if (
    opSimpNac === '3' ||
    optanteSn === '1' ||
    rawRegimeText.includes('SIMPLES')
  ) {
    taxRegime = 'simples_nacional';
  } else if (opSimpNac === '1' || optanteSn === '2') {
    taxRegime = 'regime_normal';
  } else if (
    rawPisAmount > 0 ||
    rawCofinsAmount > 0 ||
    rawCsllAmount > 0 ||
    rawIrrfAmount > 0 ||
    rawConsolidatedFed > 0
  ) {
    taxRegime = 'regime_normal';
  } else if (rawIssqnAmount > 0 || rawInssAmount > 0 || rawOutrasRetencoes > 0) {
    taxRegime = 'simples_nacional';
  }

  const pisAmount = taxRegime === 'regime_normal' ? rawPisAmount : 0;
  const cofinsAmount = taxRegime === 'regime_normal' ? rawCofinsAmount : 0;
  const csllAmount = taxRegime === 'regime_normal' ? rawCsllAmount : 0;
  const issqnAmount = taxRegime === 'mei' ? 0 : rawIssqnAmount;
  const inssAmount = taxRegime === 'mei' ? 0 : rawInssAmount;
  const irrfAmount = taxRegime === 'regime_normal' ? rawIrrfAmount : 0;
  const retainedTaxesAmount =
    taxRegime === 'mei'
      ? 0
      : roundMoney(
          (taxRegime === 'regime_normal' ? rawConsolidatedFed : 0) + rawOutrasRetencoes
        );

  // Distinguish highlighted ISSQN (prestador recolhe) vs retained ISSQN (tomador retém e deduz do líquido)
  let issqnRetained = issqnAmount > 0;
  if (explicitIssRet > 0) {
    issqnRetained = true;
  } else if (tpRetISSQN === '1' || issRetidoAbrasf === '2') {
    issqnRetained = false;
  } else if (tpRetISSQN === '2' || tpRetISSQN === '3' || issRetidoAbrasf === '1') {
    issqnRetained = issqnAmount > 0;
  } else if (declaredLiq > 0 && issqnAmount > 0) {
    const netWithoutIss = roundMoney(
      Math.max(
        0,
        grossAmount +
          otherExpensesAmount -
          discountAmount -
          (pisAmount + cofinsAmount + csllAmount + inssAmount + irrfAmount + retainedTaxesAmount)
      )
    );
    const netWithIss = roundMoney(Math.max(0, netWithoutIss - issqnAmount));
    if (
      Math.abs(netWithoutIss - declaredLiq) <= 0.02 &&
      Math.abs(netWithIss - declaredLiq) > 0.02
    ) {
      issqnRetained = false;
    }
  }

  const servDesc = sanitizeText(
    getTagText(infNFSe, 'xDescServ') ||
      getTagText(infNFSe, 'Discriminacao') ||
      getTagText(dps, 'xDescServ') ||
      `Prestação de Serviços - NFS-e ${nfeNumber}`,
    BLUEPRINT_LIMITS.MAX_ITEM_DESC
  );
  const cTrib = sanitizeText(
    getTagText(infNFSe, 'cTribNac') || getTagText(infNFSe, 'ItemListaServico') || 'ISS',
    16
  );

  const totalInvoice = calculateFiscalNetTotal({
    docType: 'NFSE',
    totalProducts: grossAmount,
    otherExpensesAmount,
    discountAmount,
    taxRegime,
    pisAmount,
    cofinsAmount,
    csllAmount,
    issqnAmount,
    issqnRetained,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
  });

  const items: FiscalInvoiceItem[] = [
    {
      code: cTrib || 'SERV-01',
      description: servDesc,
      ncm: '00000000',
      cfop: cTrib,
      unit: 'SV',
      qty: 1,
      unitPrice: grossAmount,
      totalPrice: grossAmount,
    },
  ];

  const complementaryInfo = sanitizeText(
    getTagText(infNFSe, 'OutrasInformacoes') ||
      getTagText(infNFSe, 'xInfComp') ||
      getTagText(dps, 'xInfComp'),
    BLUEPRINT_LIMITS.MAX_COMPLEMENTARY_INFO
  );

  return {
    docType: 'NFSE',
    accessKey,
    nfeNumber,
    series,
    issuerName,
    issuerCnpj,
    issuerState,
    issueDate,
    cfop: cTrib,
    grossAmount,
    freightAmount: 0,
    insuranceAmount: 0,
    otherExpensesAmount,
    surchargeAmount: 0,
    discountAmount,
    totalProducts: grossAmount,
    icmsAmount: 0,
    icmsDesonAmount: 0,
    icmsStAmount: 0,
    ipiAmount: 0,
    pisAmount,
    cofinsAmount,
    csllAmount,
    issqnAmount,
    issqnRetained,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
    taxRegime,
    totalInvoice,
    ...(xmlDeclaredTotal !== undefined ? { xmlDeclaredTotal } : {}),
    complementaryInfo,
    items,
  };
}

function parseCTe(doc: Document, infCte: Element): ParsedFiscalXml {
  const ide = getElementsByLocalName(infCte, 'ide')[0] || null;
  const emit = getElementsByLocalName(infCte, 'emit')[0] || null;
  const vPrest = getElementsByLocalName(infCte, 'vPrest')[0] || null;
  const imp = getElementsByLocalName(infCte, 'imp')[0] || null;
  const protCTe = getElementsByLocalName(doc, 'protCTe')[0] || null;

  let accessKey = getTagText(protCTe, 'chCTe').replace(/\D/g, '');
  if (accessKey.length !== 44) {
    const idAttr = infCte.getAttribute('Id') || '';
    accessKey = idAttr.replace(/^CTe/i, '').replace(/\D/g, '');
  }
  accessKey = sanitizeAccessKey(accessKey);
  if (accessKey.length < 8) {
    throw new Error('Chave de Acesso do CT-e não localizada (<chCTe> ou Id da infCte).');
  }

  const nfeNumber = sanitizeText(getTagText(ide, 'nCT') || accessKey.slice(25, 34), 20);
  const series = sanitizeText(getTagText(ide, 'serie') || '1', 10);
  const issueDate = extractDateISO(getTagText(ide, 'dhEmi'));
  const cfop = sanitizeText(getTagText(ide, 'CFOP') || '5352', 16);

  const originState = sanitizeText(getTagText(ide, 'UFIni').toUpperCase(), 2);
  const originCity = sanitizeText(getTagText(ide, 'xMunIni'), 120);
  const destinationState = sanitizeText(getTagText(ide, 'UFFim').toUpperCase(), 2);
  const destinationCity = sanitizeText(getTagText(ide, 'xMunFim'), 120);

  const infDocNode = getElementsByLocalName(infCte, 'infDoc')[0] || null;
  const infNFeRefNode = infDocNode ? getElementsByLocalName(infDocNode, 'infNFe')[0] : null;
  const referencedNfeKey = sanitizeAccessKey(
    getTagText(infNFeRefNode, 'chave').replace(/\D/g, '')
  );

  const issuerName = sanitizeText(
    getTagText(emit, 'xNome') || 'Transportadora (CT-e)',
    BLUEPRINT_LIMITS.MAX_SUPPLIER_NAME
  );
  const rawCnpj = getTagText(emit, 'CNPJ').replace(/\D/g, '');
  const issuerCnpj =
    rawCnpj.length === 14 ? formatCnpj(rawCnpj) : sanitizeText(rawCnpj || '00.000.000/0001-00', 20);
  const enderEmitCte = emit ? getElementsByLocalName(emit, 'enderEmit')[0] || null : null;
  const rawCteUf = (
    getTagText(enderEmitCte || emit, 'UF') ||
    getUfFromCodeOrAccessKey(getTagText(ide, 'cUF') || accessKey)
  )
    .trim()
    .toUpperCase();
  const issuerState = /^[A-Z]{2}$/.test(rawCteUf) ? rawCteUf : '';

  const vTPrest = roundMoney(getTagNumber(vPrest, 'vTPrest'));
  const vRec = roundMoney(getTagNumber(vPrest, 'vRec'));
  const xmlDeclaredTotal = vRec > 0 ? vRec : vTPrest > 0 ? vTPrest : undefined;

  const icmsAmount = roundMoney(getTagNumber(imp, 'vICMS'));
  const csllAmount = roundMoney(getTagNumber(imp, 'vRetCSLL'));
  const irrfAmount = roundMoney(getTagNumber(imp, 'vIRRF') || getTagNumber(imp, 'vRetIRRF'));
  const inssAmount = roundMoney(getTagNumber(imp, 'vINSS') || getTagNumber(imp, 'vRetINSS'));
  const retainedTaxesAmount = roundMoney(
    getTagNumber(imp, 'vRetPIS') + getTagNumber(imp, 'vRetCOFINS')
  );

  const compNodes = vPrest ? getElementsByLocalName(vPrest, 'Comp') : [];
  let freightAmount = 0;
  const items: FiscalInvoiceItem[] = compNodes
    .slice(0, BLUEPRINT_LIMITS.MAX_ITEMS)
    .map((comp, idx) => {
      const compName = sanitizeText(
        getTagText(comp, 'xNome') || `Componente Frete ${idx + 1}`,
        BLUEPRINT_LIMITS.MAX_ITEM_DESC
      );
      const compVal = getTagNumber(comp, 'vComp');
      if (compName.toUpperCase().includes('FRETE')) {
        freightAmount += compVal;
      }
      return {
        code: `CTE-${idx + 1}`,
        description: compName,
        ncm: '00000000',
        cfop,
        unit: 'SV',
        qty: 1,
        unitPrice: compVal,
        totalPrice: compVal,
      };
    });

  if (freightAmount === 0) {
    freightAmount = vTPrest;
  }
  freightAmount = roundMoney(freightAmount);

  if (items.length === 0) {
    const proPred = getTagText(infCte, 'proPred') || 'Serviço de Transporte Rodoviário de Cargas';
    items.push({
      code: 'CTE-FRETE',
      description: sanitizeText(`Frete CT-e ${nfeNumber} — ${proPred}`, BLUEPRINT_LIMITS.MAX_ITEM_DESC),
      ncm: '00000000',
      cfop,
      unit: 'SV',
      qty: 1,
      unitPrice: vTPrest,
      totalPrice: vTPrest,
    });
  }

  const complementaryInfo = sanitizeText(
    getTagText(infCte, 'xObs') || getTagText(infCte, 'xCaracAd'),
    BLUEPRINT_LIMITS.MAX_COMPLEMENTARY_INFO
  );

  const totalInvoice = calculateFiscalNetTotal({
    docType: 'CTE',
    totalProducts: vTPrest,
    freightAmount,
    insuranceAmount: 0,
    otherExpensesAmount: 0,
    surchargeAmount: 0,
    discountAmount: 0,
    csllAmount,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
  });

  return {
    docType: 'CTE',
    accessKey,
    nfeNumber,
    series,
    issuerName,
    issuerCnpj,
    issuerState,
    issueDate,
    cfop,
    grossAmount: vTPrest,
    freightAmount,
    insuranceAmount: 0,
    otherExpensesAmount: 0,
    surchargeAmount: 0,
    discountAmount: 0,
    totalProducts: vTPrest,
    icmsAmount,
    icmsDesonAmount: 0,
    icmsStAmount: 0,
    ipiAmount: 0,
    pisAmount: 0,
    cofinsAmount: 0,
    csllAmount,
    issqnAmount: 0,
    issqnRetained: false,
    inssAmount,
    irrfAmount,
    retainedTaxesAmount,
    originState,
    originCity,
    destinationState,
    destinationCity,
    referencedNfeKey: referencedNfeKey.length >= 8 ? referencedNfeKey : undefined,
    totalInvoice,
    ...(xmlDeclaredTotal !== undefined ? { xmlDeclaredTotal } : {}),
    complementaryInfo,
    items,
  };
}

// Re-export backward-compatible alias
export const parseNFeXml = parseFiscalXml;

export function buildSampleNFeXml(linkedPo?: PurchaseOrder): string {
  const randomDigits = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
  const cnpjDigits = linkedPo
    ? linkedPo.supplierCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14)
    : '12345678000195';
  const nfeNum = String(Math.floor(10000 + Math.random() * 89999));
  const chNFe = `352611${cnpjDigits}550010000${nfeNum}1${randomDigits(8)}`.slice(0, 44);
  const supplierName = linkedPo?.supplierName || 'Metalúrgica Paulista Industrial Ltda';
  const issueDate = todayISO();

  const items = linkedPo?.items?.length
    ? linkedPo.items
    : [
        {
          code: 'MAT-1042',
          description: 'Chapa de Aço Carbono 1020 - 3mm',
          unit: 'UN',
          qtyOrdered: 25,
          unitPrice: 420.0,
          totalPrice: 10500.0,
        },
        {
          code: 'MAT-2088',
          description: 'Parafuso Sextavado Inox M12',
          unit: 'CX',
          qtyOrdered: 10,
          unitPrice: 185.0,
          totalPrice: 1850.0,
        },
      ];

  const totalProd = items.reduce((acc, it) => acc + it.totalPrice, 0);
  const frete = linkedPo?.freightAmount ?? 250.0;
  const icms = Number((totalProd * 0.18).toFixed(2));
  const ipi = Number((totalProd * 0.05).toFixed(2));
  const pis = Number((totalProd * 0.0165).toFixed(2));
  const cofins = Number((totalProd * 0.076).toFixed(2));
  const totalNF = Number((totalProd + frete + ipi).toFixed(2));

  const detXml = items
    .map(
      (item, index) => `
      <det nItem="${index + 1}">
        <prod>
          <cProd>${escapeXml(item.code)}</cProd>
          <xProd>${escapeXml(item.description)}</xProd>
          <NCM>72085100</NCM>
          <CFOP>5102</CFOP>
          <uCom>${escapeXml(item.unit)}</uCom>
          <qCom>${item.qtyOrdered.toFixed(4)}</qCom>
          <vUnCom>${item.unitPrice.toFixed(2)}</vUnCom>
          <vProd>${item.totalPrice.toFixed(2)}</vProd>
        </prod>
      </det>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${chNFe}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <nNF>${nfeNum}</nNF>
        <serie>1</serie>
        <dhEmi>${issueDate}T10:30:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>${cnpjDigits}</CNPJ>
        <xNome>${escapeXml(supplierName)}</xNome>
        <enderEmit>
          <UF>SP</UF>
        </enderEmit>
      </emit>
      ${detXml}
      <total>
        <ICMSTot>
          <vProd>${totalProd.toFixed(2)}</vProd>
          <vFrete>${frete.toFixed(2)}</vFrete>
          <vDesc>0.00</vDesc>
          <vICMS>${icms.toFixed(2)}</vICMS>
          <vICMSDeson>${Number((totalProd * 0.04).toFixed(2)).toFixed(2)}</vICMSDeson>
          <vIPI>${ipi.toFixed(2)}</vIPI>
          <vPIS>${pis.toFixed(2)}</vPIS>
          <vCOFINS>${cofins.toFixed(2)}</vCOFINS>
          <vNF>${totalNF.toFixed(2)}</vNF>
        </ICMSTot>
      </total>
      <infAdic>
        <infCpl>Pedido Ref: ${escapeXml(linkedPo?.poNumber || 'N/A')} | ICMS Desonerado ref. Convênio ICMS 87/02 | Mercadoria conferida para entrega na doca central.</infCpl>
      </infAdic>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <chNFe>${chNFe}</chNFe>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
}

export function buildSampleNFSeXml(linkedPo?: PurchaseOrder): string {
  const num = String(Math.floor(1000 + Math.random() * 8999));
  const cnpjDigits = linkedPo
    ? linkedPo.supplierCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14)
    : '27865757000102';
  const supplierName = linkedPo?.supplierName || 'Consultoria Técnica Brasil Ltda';
  const issueDate = todayISO();
  const key = `355030822${cnpjDigits}00000${num}2611${Math.floor(100000 + Math.random() * 899999)}`;
  const valor = linkedPo ? linkedPo.totalAmount : 4800.0;

  const issqn = Number((valor * 0.03).toFixed(2));
  const inss = Number((valor * 0.11).toFixed(2));
  const liq = Number(Math.max(0, valor - issqn - inss).toFixed(2));

  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infNFSe Id="NFS${key}">
    <nNFSe>${num}</nNFSe>
    <dhProc>${issueDate}T14:15:00-03:00</dhProc>
    <emit>
      <CNPJ>${cnpjDigits}</CNPJ>
      <xNome>${escapeXml(supplierName)}</xNome>
      <regTrib>
        <opSimpNac>3</opSimpNac>
      </regTrib>
    </emit>
    <valores>
      <vBC>${valor.toFixed(2)}</vBC>
      <vISSQN>${issqn.toFixed(2)}</vISSQN>
      <vRetINSS>${inss.toFixed(2)}</vRetINSS>
      <vLiq>${liq.toFixed(2)}</vLiq>
    </valores>
    <DPS>
      <infDPS>
        <serie>900</serie>
        <dhEmi>${issueDate}T14:14:00-03:00</dhEmi>
        <serv>
          <cServ>
            <cTribNac>170101</cTribNac>
            <xDescServ>Serviços técnicos especializados de engenharia e manutenção industrial</xDescServ>
          </cServ>
        </serv>
        <valores>
          <vServPrest>
            <vServ>${valor.toFixed(2)}</vServ>
          </vServPrest>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
}

export function buildSampleCTeXml(): string {
  const randomDigits = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
  const cnpjDigits = '44556677000188';
  const nct = String(Math.floor(10000 + Math.random() * 89999));
  const chCTe = `352611${cnpjDigits}570010000${nct}1${randomDigits(8)}`.slice(0, 44);
  const issueDate = todayISO();

  return `<?xml version="1.0" encoding="UTF-8"?>
<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <CTe>
    <infCte Id="CTe${chCTe}" versao="4.00">
      <ide>
        <CFOP>5352</CFOP>
        <nCT>${nct}</nCT>
        <serie>1</serie>
        <dhEmi>${issueDate}T09:00:00-03:00</dhEmi>
        <UFIni>SP</UFIni>
        <xMunIni>São Paulo</xMunIni>
        <UFFim>RJ</UFFim>
        <xMunFim>Rio de Janeiro</xMunFim>
      </ide>
      <emit>
        <CNPJ>${cnpjDigits}</CNPJ>
        <xNome>Expresso Rodoviário Nacional S.A.</xNome>
      </emit>
      <vPrest>
        <vTPrest>1450.00</vTPrest>
        <vRec>1450.00</vRec>
        <Comp>
          <xNome>FRETE PESO</xNome>
          <vComp>1250.00</vComp>
        </Comp>
        <Comp>
          <xNome>GRIS / PEDÁGIO</xNome>
          <vComp>200.00</vComp>
        </Comp>
      </vPrest>
      <imp>
        <ICMS>
          <ICMS00>
            <vICMS>174.00</vICMS>
          </ICMS00>
        </ICMS>
      </imp>
      <infCTeNorm>
        <infCarga>
          <proPred>Aço e Materiais Industriais</proPred>
        </infCarga>
      </infCTeNorm>
    </infCte>
  </CTe>
  <protCTe versao="4.00">
    <infProt>
      <chCTe>${chCTe}</chCTe>
      <cStat>100</cStat>
    </infProt>
  </protCTe>
</cteProc>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
