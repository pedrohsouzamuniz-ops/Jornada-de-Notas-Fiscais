export interface BrazilState {
  uf: string;
  name: string;
}

export const BRAZIL_STATES: BrazilState[] = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' },
];

export const FALLBACK_CITIES_BY_UF: Record<string, string[]> = {
  AC: ['Cruzeiro do Sul', 'Rio Branco', 'Sena Madureira', 'Tarauacá'],
  AL: ['Arapiraca', 'Maceió', 'Palmeira dos Índios', 'Rio Largo'],
  AP: ['Laranjal do Jari', 'Macapá', 'Oiapoque', 'Santana'],
  AM: ['Itacoatiara', 'Manacapuru', 'Manaus', 'Parintins'],
  BA: ['Camaçari', 'Feira de Santana', 'Ilhéus', 'Lauro de Freitas', 'Salvador', 'Vitória da Conquista'],
  CE: ['Caucaia', 'Fortaleza', 'Juazeiro do Norte', 'Maracanaú', 'Sobral'],
  DF: ['Brasília'],
  ES: ['Cachoeiro de Itapemirim', 'Cariacica', 'Linhares', 'Serra', 'Vila Velha', 'Vitória'],
  GO: ['Anápolis', 'Aparecida de Goiânia', 'Goiânia', 'Itumbiara', 'Rio Verde'],
  MA: ['Caxias', 'Imperatriz', 'São José de Ribamar', 'São Luís', 'Timon'],
  MT: ['Cuiabá', 'Lucas do Rio Verde', 'Rondonópolis', 'Sinop', 'Várzea Grande'],
  MS: ['Campo Grande', 'Corumbá', 'Dourados', 'Três Lagoas'],
  MG: ['Belo Horizonte', 'Betim', 'Contagem', 'Extrema', 'Ipatinga', 'Juiz de Fora', 'Montes Claros', 'Pouso Alegre', 'Uberaba', 'Uberlândia'],
  PA: ['Ananindeua', 'Belém', 'Castanhal', 'Marabá', 'Parauapebas', 'Santarém'],
  PB: ['Cabedelo', 'Campina Grande', 'João Pessoa', 'Patos', 'Santa Rita'],
  PR: ['Cascavel', 'Curitiba', 'Foz do Iguaçu', 'Londrina', 'Maringá', 'Paranaguá', 'Ponta Grossa', 'São José dos Pinhais'],
  PE: ['Cabo de Santo Agostinho', 'Caruaru', 'Jaboatão dos Guararapes', 'Olinda', 'Petrolina', 'Recife', 'Suape'],
  PI: ['Floriano', 'Parnaíba', 'Picos', 'Teresina'],
  RJ: ['Campos dos Goytacazes', 'Duque de Caxias', 'Itaguaí', 'Macaé', 'Niterói', 'Nova Iguaçu', 'Resende', 'Rio de Janeiro', 'Volta Redonda'],
  RN: ['Mossoró', 'Natal', 'Parnamirim', 'São Gonçalo do Amarante'],
  RS: ['Bento Gonçalves', 'Canoas', 'Caxias do Sul', 'Gravataí', 'Novo Hamburgo', 'Passo Fundo', 'Pelotas', 'Porto Alegre', 'Rio Grande', 'Santa Maria'],
  RO: ['Ariquemes', 'Cacoal', 'Ji-Paraná', 'Porto Velho', 'Vilhena'],
  RR: ['Boa Vista', 'Rorainópolis'],
  SC: ['Blumenau', 'Chapecó', 'Criciúma', 'Florianópolis', 'Itajaí', 'Joinville', 'Navegantes', 'São José'],
  SP: [
    'Americana',
    'Araçatuba',
    'Araraquara',
    'Barueri',
    'Bauru',
    'Campinas',
    'Cotia',
    'Cubatão',
    'Diadema',
    'Franca',
    'Guarulhos',
    'Indaiatuba',
    'Itapevi',
    'Jundiaí',
    'Limeira',
    'Mauá',
    'Mogi das Cruzes',
    'Osasco',
    'Paulínia',
    'Piracicaba',
    'Presidente Prudente',
    'Ribeirão Preto',
    'Santo André',
    'Santos',
    'São Bernardo do Campo',
    'São Caetano do Sul',
    'São José do Rio Preto',
    'São José dos Campos',
    'São Paulo',
    'Sorocaba',
    'Sumaré',
    'Suzano',
    'Taubaté',
  ],
  SE: ['Aracaju', 'Itabaiana', 'Lagarto', 'Nossa Senhora do Socorro'],
  TO: ['Araguaína', 'Gurupi', 'Palmas', 'Porto Nacional'],
};

const memoryCityCache = new Map<string, string[]>();

export function getFallbackCitiesForUf(uf: string): string[] {
  const code = (uf || '').trim().toUpperCase();
  return FALLBACK_CITIES_BY_UF[code] || [];
}

export async function fetchCitiesByUf(uf: string): Promise<string[]> {
  const code = (uf || '').trim().toUpperCase();
  if (!code || code.length !== 2) return [];

  const cached = memoryCityCache.get(code);
  if (cached) return cached;

  try {
    const storageKey = `ibge_cities_${code}`;
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const list = parsed.filter((x): x is string => typeof x === 'string');
        memoryCityCache.set(code, list);
        return list;
      }
    }

    const resp = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${code}/municipios?orderBy=nome`
    );
    if (!resp.ok) {
      return getFallbackCitiesForUf(code);
    }
    const data = (await resp.json()) as Array<{ nome?: string }>;
    const cities = data
      .map((item) => (item.nome || '').trim())
      .filter(Boolean);
    if (cities.length > 0) {
      memoryCityCache.set(code, cities);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(storageKey, JSON.stringify(cities));
        }
      } catch {
        // Ignore storage quota errors
      }
      return cities;
    }
  } catch {
    // Fallback to built-in city list when offline
  }

  return getFallbackCitiesForUf(code);
}

export const IBGE_CODE_TO_UF: Record<string, string> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

export function getUfFromCodeOrAccessKey(codeOrKey?: string): string {
  const digits = (codeOrKey || '').replace(/\D/g, '');
  if (digits.length < 2) return '';
  return IBGE_CODE_TO_UF[digits.slice(0, 2)] || '';
}

