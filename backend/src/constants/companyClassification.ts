/**
 * Classificação canônica e imutável de empresas do ecossistema SelectPhoto / Lumora.
 * 
 * Fonte da evidência:
 * - Manifesto CLASSIFICACAO_EMPRESAS.json (02/11/2026)
 * - 51 identificadores confirmados de fixtures/fábricas de testes anteriores.
 * - 1 empresa operacional de projeto: Select Photo Default (91f736ae-93af-4f7a-b5d5-87c98e53cdf6).
 */

export const PROJECT_COMPANY_ID = '91f736ae-93af-4f7a-b5d5-87c98e53cdf6';

export const COMPANY_CLASSIFICATION = {
  OPERATIONAL: 'OPERATIONAL',
  TEST_DEMO: 'TEST_DEMO',
} as const;

export type CompanyClassification = typeof COMPANY_CLASSIFICATION[keyof typeof COMPANY_CLASSIFICATION];

export const CONFIRMED_TEST_COMPANY_IDS: readonly string[] = Object.freeze([
  'comp_a_et2_1792666952082',
  'comp_a_et2_1792664253651',
  'comp_a_et2_1792640930639',
  'comp_a_et2_1792667092637',
  'comp_a_et2_1792640777822',
  'comp_a_et2_1792666721900',
  'comp_a_et2_1792640715399',
  '7d0438ab-bf11-4ae4-8ccf-2e07a6fd2c11',
  '9374b9c5-cd5b-4d3f-bc27-3872f59a0aad',
  'ea804598-6bf2-4b28-80d9-9740ae1375a2',
  '0b392f2b-fea1-4568-ae22-112fe525f91f',
  'fd03a33f-c9a9-436d-ba38-eaf26f2d3c50',
  '48bc4cbd-5639-4c5c-ba5b-ae466b1bb35e',
  '60f0ac43-62d6-4a18-af02-1518e4693653',
  '3d81f176-ef36-4511-87c6-3fe6c1ccdb20',
  'comp_b_et2_1792667092637',
  'comp_b_et2_1792640777822',
  'comp_b_et2_1792640715399',
  'comp_b_et2_1792664253651',
  'comp_b_et2_1792640930639',
  'comp_b_et2_1792666952082',
  'comp_b_et2_1792666721900',
  '5bfcfe61-c926-4ccd-93d5-68e0f9b657f1',
  '4a5138cb-3b7c-48c9-b219-ff672091c73b',
  'b450839d-0149-4d9a-aa2b-7a98a6e28833',
  '78e0fb8f-89f4-4731-accb-75f6a4eaa073',
  '4119bb0e-70cc-46d9-b3eb-a86800242096',
  '2242f06a-39d0-4c6b-96a7-078fbcd689f2',
  '4e992f39-eacc-4994-9dfc-0bddf8f63769',
  '7147c90a-ca87-4119-919b-11a11860c57e',
  'comp_comm_1792640433388',
  'comp_comm_1792630482347',
  'comp_comm_1792635440788',
  'comp_comm_1792635667457',
  'comp_comm_1792635898006',
  'comp_comm_1792640109902',
  'comp_comm_1792640208055',
  'comp_comm_1792640338637',
  'comp_fin_1792666671696',
  'comp_fin_1792666601343',
  'comp_fin_1792666577373',
  'comp_fin_1792667347593',
  'comp_fin_1792785623130',
  'comp_fin_1792666531946',
  'comp_fin_1792666506513',
  'comp_fin_1792666479344',
  'comp-batch-5454d072-1d57-4529-a262-4db7578bdca2',
  '97d20c7e-14e8-4121-9db6-7247b12787b4',
  '16c23257-3114-4c69-9bcc-815159561bc4',
  '239542e1-502c-46d9-a435-64b7fb4b8985',
  '2df16ff2-aacd-40bb-89ad-802a027c456b',
]);

const TEST_IDS_SET = new Set<string>(CONFIRMED_TEST_COMPANY_IDS);

export function isConfirmedTestCompany(companyId?: string | null): boolean {
  if (!companyId) return false;
  return TEST_IDS_SET.has(companyId);
}

