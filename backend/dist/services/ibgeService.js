"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIbgeCityId = getIbgeCityId;
exports.enrichCityData = enrichCityData;
// Cache in memory for city IDs to avoid fetching municipalities repeatedly
let municipalitiesCache = {};
async function getIbgeCityId(stateUF, cityName) {
    const uf = stateUF.toUpperCase();
    if (!municipalitiesCache[uf]) {
        try {
            const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
            if (!response.ok)
                throw new Error(`HTTP Error ${response.status}`);
            municipalitiesCache[uf] = await response.json();
        }
        catch (e) {
            console.error(`Erro ao buscar municípios para UF ${uf}:`, e);
            return null;
        }
    }
    const city = municipalitiesCache[uf].find((c) => c.nome.toLowerCase().trim() === cityName.toLowerCase().trim());
    return city ? city.id : null;
}
async function enrichCityData(stateUF, cityName) {
    const cityId = await getIbgeCityId(stateUF, cityName);
    const defaultData = {
        population: 'N/A',
        gdp: 'N/A',
        perCapitaIncome: 'N/A',
    };
    if (!cityId)
        return defaultData;
    try {
        // Busca População (Agregado 4709 - Censo 2022)
        // variavel 93: População residente
        const popResponse = await fetch(`https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[${cityId}]`);
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
        // Busca PIB (Agregado 5938 - PIB dos Municípios)
        // variavel 37: Produto Interno Bruto a preços correntes (em mil reais)
        const pibResponse = await fetch(`https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/2021/variaveis/37?localidades=N6[${cityId}]`);
        let pib = 0;
        if (pibResponse.ok) {
            const pibData = await pibResponse.json();
            if (pibData && pibData.length > 0) {
                // Valor vem em Mil Reais (x 1000)
                const pibMilReais = parseFloat(pibData[0].resultados[0].series[0].serie['2021']);
                if (!isNaN(pibMilReais)) {
                    pib = pibMilReais * 1000;
                    // Format as R$ bilhões or milhões
                    if (pib >= 1000000000) {
                        defaultData.gdp = `R$ ${(pib / 1000000000).toFixed(2)} Bi`;
                    }
                    else {
                        defaultData.gdp = `R$ ${(pib / 1000000).toFixed(2)} Mi`;
                    }
                }
            }
        }
        // Calcular Renda Per Capita Mensal (PIB Anual Per Capita / 12)
        if (population > 0 && pib > 0) {
            const annualPerCapita = pib / population;
            const monthlyPerCapita = annualPerCapita / 12;
            let creditPotential = '';
            if (monthlyPerCapita >= 4000) {
                creditPotential = ' (PotC: Altíssimo)';
            }
            else if (monthlyPerCapita >= 2500) {
                creditPotential = ' (PotC: Alto)';
            }
            else if (monthlyPerCapita >= 1500) {
                creditPotential = ' (Potencial de Crédito: Médio)';
            }
            else {
                creditPotential = ' (Potencial de Crédito: Baixo)';
            }
            // Format to Brazilian currency format manually
            const parts = monthlyPerCapita.toFixed(2).split('.');
            const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            const formattedIncome = `${integerPart},${parts[1]}`;
            defaultData.perCapitaIncome = `R$ ${formattedIncome}${creditPotential}`;
        }
    }
    catch (e) {
        console.error(`Erro ao enriquecer dados do IBGE para a cidade ${cityName}:`, e);
    }
    return defaultData;
}
