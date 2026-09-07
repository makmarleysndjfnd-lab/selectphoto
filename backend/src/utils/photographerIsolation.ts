/**
 * Utilitários de Isolamento de Fichas e Restrição de Dados Comerciais para o Fotógrafo.
 * 
 * Regras de Negócio:
 * 1. O fotógrafo só pode acessar informações de produção e envio das próprias fichas.
 * 2. Nenhum resultado comercial (venda, não venda, valores, comissões, vendedor ou rebolo)
 *    deve ser transmitido ao fotógrafo.
 * 3. Quando a cidade da ficha for fechada (cityClosedAt != null / photographerClosedAt != null /
 *    rebolo / commercialCycle > 1 / timeline CITY_CLOSED), ela deve desaparecer permanentemente
 *    do acesso do fotógrafo e não pode ser reativada no rebolo.
 * 4. Administradores e vendedores mantêm acesso integral e histórico inalterado.
 */

export function isClientClosedForPhotographer(client: {
  photographerClosedAt?: Date | null;
  cityClosedAt?: Date | null;
  commercialCycle?: number | null;
  bookStatus?: string | null;
  timeline?: Array<{ action: string }>;
}): boolean {
  if (client.photographerClosedAt != null) return true;
  if (client.cityClosedAt != null) return true;
  if ((client.commercialCycle || 1) > 1) return true;
  if (['IN_STOCK_REBOLO', 'DISTRIBUTED_REBOLO', 'REBOLO_SOLD', 'AWAITING_RETURN', 'DISCARDED'].includes(client.bookStatus || '')) {
    return true;
  }
  if (client.timeline && client.timeline.some(t => t.action === 'CITY_CLOSED')) {
    return true;
  }
  return false;
}

export function sanitizeClientForPhotographer(c: any) {
  // Mapeia bookStatus para etapas estritamente de produção
  // O fotógrafo enxerga apenas se a ficha está sendo produzida, aguardando liberação ou se foi recebida no estoque.
  // Etapas comerciais (DISTRIBUTED, SOLD, NON_SALE, REBOLO, etc.) nunca são expostas.
  let productionBookStatus = 'IN_STOCK';
  if (c.bookStatus === 'CREATED' || c.bookStatus === 'AWAITING_RELEASE') {
    productionBookStatus = c.bookStatus;
  }

  return {
    id: c.id,
    uuid: c.uuid,
    visibleCode: c.visibleCode,
    sequenceNumber: c.sequenceNumber,
    localId: c.localId,
    createdAt: c.createdAt,
    name: c.name,
    mainContact: c.mainContact,
    phone1: c.phone1,
    phone2: c.phone2,
    cep: c.cep,
    street: c.street,
    number: c.number,
    complement: c.complement,
    block: c.block,
    apartment: c.apartment,
    neighborhood: c.neighborhood,
    city: c.city,
    state: c.state,
    referencePoint: c.referencePoint,
    event: c.event,
    eventDate: c.eventDate,
    eventTime: c.eventTime,
    visitDate: c.visitDate,
    visitTime: c.visitTime,
    condo: c.condo,
    houseColor: c.houseColor,
    gateColor: c.gateColor,
    gateObservation: c.gateObservation,
    profession: c.profession,
    clothesColor: c.clothesColor,
    status: c.status,
    bookStatus: productionBookStatus,
    batchId: c.batchId,
    releasedForRouting: c.releasedForRouting,
    photographerId: c.photographerId,
    companyId: c.companyId,
    signatureUrl: c.signatureUrl,
    children: c.children || [],
    // DADOS COMERCIAIS ESTRITAMENTE OMITIDOS / EXPURGADOS NO BACKEND:
    // Não envia sales, nonSales, outcomeStatus, assignedSellerId, assignedSeller,
    // comissões, valores nem ciclos de rebolo.
  };
}
