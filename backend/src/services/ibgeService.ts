import { isExternalServicesDisabled } from '../utils/externalServices';

// Cache in memory for city IDs to avoid fetching municipalities repeatedly
let municipalitiesCache: { [uf: string]: { id: number; nome: string }[] } = {};

const MOCK_IBGE_CITIES: Record<string, { id: number; population: string; gdp: string; perCapitaIncome: string }> = {
  'goiania': { id: 5208707, population: '1.437.237', gdp: 'R$ 59.86 Bi', perCapitaIncome: 'R$ 3.471,00 (PotC: Alto)' },
  'aparecida de goiania': { id: 5201405, population: '527.550', gdp: 'R$ 16.90 Bi', perCapitaIncome: 'R$ 2.670,00 (PotC: Alto)' },
  'anapolis': { id: 5201108, population: '398.817', gdp: 'R$ 15.20 Bi', perCapitaIncome: 'R$ 3.176,00 (PotC: Alto)' },
  'cuiaba': { id: 5103403, population: '650.912', gdp: 'R$ 29.70 Bi', perCapitaIncome: 'R$ 3.802,00 (PotC: Alto)' },
  'campo grande': { id: 5002704, population: '897.938', gdp: 'R$ 34.70 Bi', perCapitaIncome: 'R$ 3.220,00 (PotC: Alto)' },
};

export async function getIbgeCityId(stateUF: string, cityName: string): Promise<number | null> {
  const uf = stateUF.toUpperCase();
  const cleanCity = cityName.toLowerCase().trim();

  if (isExternalServicesDisabled()) {
    return MOCK_IBGE_CITIES[cleanCity]?.id || 5200000;
  }

  if (!municipalitiesCache[uf]) {
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      municipalitiesCache[uf] = await response.json();
    } catch (e) {
      console.error(`Erro ao buscar municípios para UF ${uf}:`, e);
      return null;
    }
  }

  const city = municipalitiesCache[uf].find(
    (c) => c.nome.toLowerCase().trim() === cleanCity
  );

  return city ? city.id : null;
}

export async function enrichCityData(stateUF: string, cityName: string) {
  const cleanCity = cityName.toLowerCase().trim();

  if (isExternalServicesDisabled()) {
    const mock = MOCK_IBGE_CITIES[cleanCity];
    if (mock) {
      return {
        population: mock.population,
        gdp: mock.gdp,
        perCapitaIncome: mock.perCapitaIncome,
      };
    }
    return {
      population: '50.000',
      gdp: 'R$ 1.50 Bi',
      perCapitaIncome: 'R$ 2.500,00 (PotC: Alto)',
    };
  }

  const cityId = await getIbgeCityId(stateUF, cityName);
  
  const defaultData = {
    population: 'N/A',
    gdp: 'N/A',
    perCapitaIncome: 'N/A',
  };

  if (!cityId) return defaultData;

  try {
    const popResponse = await fetch(
      `https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[${cityId}]`
    );
    let population = 0;
    if (popResponse.ok) {
      const popData = await popResponse.json();
      if (popData && popData.length > 0) {
        population = parseInt(popData[0].resultados[0].series[0].serie['2022'], 10);
        if (!isNaN(population)) {
          defaultData.population = population.toLocaleString('pt-BR').replace(/[\u00A0\u202F\s]/g, '.');
        }
      }
    }

    const pibResponse = await fetch(
      `https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/2021/variaveis/37?localidades=N6[${cityId}]`
    );
    let pib = 0;
    if (pibResponse.ok) {
      const pibData = await pibResponse.json();
      if (pibData && pibData.length > 0) {
        const pibMilReais = parseFloat(pibData[0].resultados[0].series[0].serie['2021']);
        if (!isNaN(pibMilReais)) {
          pib = pibMilReais * 1000;
          if (pib >= 1000000000) {
            defaultData.gdp = `R$ ${(pib / 1000000000).toFixed(2)} Bi`;
          } else {
            defaultData.gdp = `R$ ${(pib / 1000000).toFixed(2)} Mi`;
          }
        }
      }
    }

    if (population > 0 && pib > 0) {
      const annualPerCapita = pib / population;
      const monthlyPerCapita = annualPerCapita / 12;
      
      let creditPotential = '';
      if (monthlyPerCapita >= 4000) {
        creditPotential = ' (PotC: Altíssimo)';
      } else if (monthlyPerCapita >= 2500) {
        creditPotential = ' (PotC: Alto)';
      } else if (monthlyPerCapita >= 1500) {
        creditPotential = ' (Potencial de Crédito: Médio)';
      } else {
        creditPotential = ' (Potencial de Crédito: Baixo)';
      }

      const parts = monthlyPerCapita.toFixed(2).split('.');
      const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const formattedIncome = `${integerPart},${parts[1]}`;
      
      defaultData.perCapitaIncome = `R$ ${formattedIncome}${creditPotential}`;
    }

  } catch (e) {
    console.error(`Erro ao enriquecer dados do IBGE para a cidade ${cityName}:`, e);
  }

  return defaultData;
}
