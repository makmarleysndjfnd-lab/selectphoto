import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('ETAPA 4 — Agenda Unificada (DTOs, Normalização, Janela de 4 Dias e Ordenação)', () => {
  interface PersonalAppointmentModel {
    id: string;
    sellerId: string;
    title: string;
    description: string | null;
    dateTime: Date;
  }

  interface ClientAppointmentModel {
    id: string;
    clientId: string;
    responsibleId: string;
    date: Date;
    time: string | null;
    observation: string | null;
    client?: {
      id: string;
      name: string;
      sequenceNumber: string;
      city: string | null;
    } | null;
  }

  function buildUnifiedAppointments(
    personalApps: PersonalAppointmentModel[],
    clientApps: ClientAppointmentModel[],
    windowStart: Date
  ) {
    const unifiedList: Array<{
      id: string;
      type: 'PERSONAL' | 'CLIENT';
      title: string;
      description?: string | null;
      dateTime: string;
      clientId?: string | null;
      clientName?: string | null;
      sequenceNumber?: string | null;
      city?: string | null;
    }> = [];

    for (const p of personalApps) {
      unifiedList.push({
        id: p.id,
        type: 'PERSONAL',
        title: p.title,
        description: p.description,
        dateTime: p.dateTime.toISOString(),
        clientId: null,
        clientName: null,
        sequenceNumber: null,
        city: null,
      });
    }

    for (const c of clientApps) {
      const appDateTime = new Date(c.date);
      if (c.time && c.time.includes(':')) {
        const [h, m] = c.time.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          appDateTime.setHours(h, m, 0, 0);
        }
      }

      unifiedList.push({
        id: c.id,
        type: 'CLIENT',
        title: c.client ? `Visita: ${c.client.name}` : 'Visita de Ficha',
        description: c.observation,
        dateTime: appDateTime.toISOString(),
        clientId: c.client?.id ?? c.clientId,
        clientName: c.client?.name ?? null,
        sequenceNumber: c.client?.sequenceNumber ?? null,
        city: c.client?.city ?? null,
      });
    }

    return unifiedList
      .filter((item) => new Date(item.dateTime).getTime() >= windowStart.getTime())
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
  }

  it('1. Deve normalizar compromissos pessoais e de ficha em DTOs unificados', () => {
    const baseDate = new Date('2026-08-25T00:00:00.000Z');
    const windowStart = new Date('2026-08-20T00:00:00.000Z');

    const personalApps: PersonalAppointmentModel[] = [
      {
        id: 'p-1',
        sellerId: 'seller-1',
        title: 'Reunião Pessoal',
        description: 'Alinhamento de metas',
        dateTime: new Date('2026-08-25T15:00:00.000Z'),
      },
    ];

    const clientApps: ClientAppointmentModel[] = [
      {
        id: 'c-1',
        clientId: 'client-123',
        responsibleId: 'seller-1',
        date: new Date('2026-08-25T00:00:00.000Z'),
        time: '10:00',
        observation: 'Levar catálogo de fotos',
        client: {
          id: 'client-123',
          name: 'Maria Oliveira',
          sequenceNumber: 'CF-GOI-001',
          city: 'Goiânia',
        },
      },
    ];

    const result = buildUnifiedAppointments(personalApps, clientApps, windowStart);

    assert.strictEqual(result.length, 2);
    // Primeiro deve ser o de cliente (1h depois) e depois o pessoal (2h depois)
    assert.strictEqual(result[0].type, 'CLIENT');
    assert.strictEqual(result[0].clientName, 'Maria Oliveira');
    assert.strictEqual(result[0].sequenceNumber, 'CF-GOI-001');
    assert.strictEqual(result[0].city, 'Goiânia');
    assert.strictEqual(result[0].title, 'Visita: Maria Oliveira');

    assert.strictEqual(result[1].type, 'PERSONAL');
    assert.strictEqual(result[1].title, 'Reunião Pessoal');
    assert.strictEqual(result[1].clientName, null);
  });

  it('2. Deve filtrar estritamente agendamentos mais antigos que a janela de 4 dias', () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    windowStart.setHours(0, 0, 0, 0);

    // 10 dias atrás (fora da janela)
    const oldPersonal: PersonalAppointmentModel = {
      id: 'p-old',
      sellerId: 'seller-1',
      title: 'Compromisso Antigo',
      description: null,
      dateTime: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
    };

    // 2 dias atrás (dentro da janela de 4 dias anteriores)
    const recentPersonal: PersonalAppointmentModel = {
      id: 'p-recent',
      sellerId: 'seller-1',
      title: 'Compromisso Recente',
      description: null,
      dateTime: new Date(now.getTime() - 2 * 24 * 3600 * 1000),
    };

    const result = buildUnifiedAppointments([oldPersonal, recentPersonal], [], windowStart);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'p-recent');
  });

  it('3. Deve calcular corretamente dateTime combinando date e time', () => {
    const targetDate = new Date('2026-08-25T00:00:00.000Z');
    const clientApp: ClientAppointmentModel = {
      id: 'c-time-test',
      clientId: 'client-1',
      responsibleId: 'seller-1',
      date: targetDate,
      time: '16:45',
      observation: null,
      client: {
        id: 'client-1',
        name: 'Carlos Silva',
        sequenceNumber: 'CF-002',
        city: 'Anápolis',
      },
    };

    const windowStart = new Date('2026-08-20T00:00:00.000Z');
    const result = buildUnifiedAppointments([], [clientApp], windowStart);

    assert.strictEqual(result.length, 1);
    const parsedDate = new Date(result[0].dateTime);
    assert.strictEqual(parsedDate.getHours(), 16);
    assert.strictEqual(parsedDate.getMinutes(), 45);
  });
});
