import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_sincronizacao.dart';
import '../widgets/led_button.dart';

String _pendingRequestLabel(SyncRequest request, bool isLegacy) {
  if (isLegacy) {
    final ficha = request.payload['fichaNumber'] ?? request.payload['clientId'];
    final fichaStr = ficha != null ? ' (Ficha $ficha)' : '';
    return 'Venda antiga sem comprovante$fichaStr';
  }
  switch (request.type) {
    case 'REGISTER_SALE':
      final ficha = request.payload['fichaNumber'] ?? request.payload['clientId'];
      return ficha != null ? 'Venda - Ficha $ficha' : 'Venda aguardando envio';
    case 'REGISTER_NONSALE':
      final ficha = request.payload['fichaNumber'] ?? request.payload['clientId'];
      return ficha != null ? 'Não-Venda - Ficha $ficha' : 'Não-Venda aguardando envio';
    case 'REGISTER_APPOINTMENT':
      final title = request.payload['title'] ?? request.payload['clientName'];
      return title != null ? 'Agendamento - $title' : 'Agendamento aguardando envio';
    case 'SUBMIT_COST':
      final desc = request.payload['description'];
      return desc != null ? 'Despesa - $desc' : 'Despesa aguardando envio';
    case 'SYNC_CLIENTS':
      return 'Cadastro aguardando sincronização';
    default:
      return 'Envio aguardando sincronização';
  }
}

class SyncScreen extends StatelessWidget {
  const SyncScreen({super.key});

  void _confirmDelete(
    BuildContext context,
    SyncService syncService,
    SyncRequest req,
    bool isLegacy,
  ) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A2535),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          isLegacy ? 'Remover registro legado?' : 'Remover envio pendente?',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        content: Text(
          isLegacy
              ? 'Esta ação remove o registro apenas da memória deste aparelho. '
                'Ela não altera nem confirma dados no servidor.'
              : 'Deseja realmente remover este envio da fila de sincronização deste aparelho? '
                'O arquivo local do comprovante também será excluído com segurança para liberar espaço.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              syncService.removePendingRequest(req.id);
            },
            child: const Text('Remover somente deste aparelho'),
          ),
        ],
      ),
    );
  }

  void _confirmDeleteAllLegacy(BuildContext context, SyncService syncService) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A2535),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Remover todos os registros legados?',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
        content: const Text(
          'Esta ação removerá todos os registros antigos sem comprovante deste aparelho. '
          'Ela não altera nem confirma dados no servidor.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              syncService.removeLegacyRequests();
            },
            child: const Text('Remover todos deste aparelho'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0030),
        title: const Text(
          'Envios Pendentes',
          style: TextStyle(color: Colors.white, fontSize: 16),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Consumer<SyncService>(
        builder: (context, syncService, child) {
          final syncables = syncService.syncableRequests;
          final legacys = syncService.legacyRequests;

          if (syncables.isEmpty && legacys.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.cloud_done, color: Colors.green, size: 64),
                  SizedBox(height: 16),
                  Text(
                    'Tudo sincronizado!',
                    style: TextStyle(color: Colors.white70, fontSize: 18),
                  ),
                ],
              ),
            );
          }

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  children: [
                    // ── SEÇÃO 1: Envios com comprovante
                    if (syncables.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Row(
                          children: [
                            const Icon(Icons.cloud_upload_outlined, color: Color(0xFF4FC3F7), size: 20),
                            const SizedBox(width: 8),
                            Text(
                              'Envios aguardando sinal (${syncables.length})',
                              style: const TextStyle(
                                color: Color(0xFF4FC3F7),
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                      ...syncables.map((req) {
                        return Container(
                          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.05),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.white12),
                          ),
                          child: ListTile(
                            leading: Icon(
                              req.type == 'REGISTER_SALE'
                                  ? Icons.receipt_long
                                  : req.type == 'REGISTER_NONSALE'
                                      ? Icons.cancel_outlined
                                      : req.type == 'REGISTER_APPOINTMENT'
                                          ? Icons.event
                                          : req.type == 'SUBMIT_COST'
                                              ? Icons.attach_money
                                              : Icons.person_add,
                              color: const Color(0xFF4FC3F7),
                            ),
                            title: Text(
                              _pendingRequestLabel(req, false),
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              req.lastError?.isNotEmpty == true
                                  ? 'Aviso: ${req.lastError}\nData: ${req.createdAt.toLocal().toString().split('.')[0]}'
                                  : 'Data: ${req.createdAt.toLocal().toString().split('.')[0]}',
                              style: const TextStyle(color: Colors.white54, fontSize: 12),
                            ),
                            trailing: req.isSyncing
                                ? const SizedBox(
                                    width: 24,
                                    height: 24,
                                    child: CircularProgressIndicator(strokeWidth: 2))
                                : IconButton(
                                    icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                                    onPressed: () => _confirmDelete(context, syncService, req, false),
                                  ),
                          ),
                        );
                      }),
                      const SizedBox(height: 16),
                    ],

                    // ── SEÇÃO 2: Registros legados sem comprovante
                    if (legacys.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded, color: Colors.amber, size: 20),
                            const SizedBox(width: 8),
                            Text(
                              'Registros legados sem comprovante (${legacys.length})',
                              style: const TextStyle(
                                color: Colors.amber,
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.amber.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: Colors.amber.withOpacity(0.3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Estes registros antigos não possuem o arquivo de foto do comprovante neste aparelho. '
                              'Eles não podem ser enviados e exigem reconciliação manual ou remoção.',
                              style: TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                onPressed: () => _confirmDeleteAllLegacy(context, syncService),
                                icon: const Icon(Icons.delete_sweep, color: Colors.amber, size: 18),
                                label: const Text(
                                  'Remover todos deste aparelho',
                                  style: TextStyle(color: Colors.amber, fontSize: 12, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      ...legacys.map((req) {
                        return Container(
                          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.red.withOpacity(0.06),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.red.withOpacity(0.2)),
                          ),
                          child: ListTile(
                            leading: const Icon(Icons.no_photography_outlined, color: Colors.redAccent),
                            title: Text(
                              _pendingRequestLabel(req, true),
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                            ),
                            subtitle: Text(
                              'Sem foto local. Não será enviado automaticamente.\nData: ${req.createdAt.toLocal().toString().split('.')[0]}',
                              style: const TextStyle(color: Colors.white54, fontSize: 12),
                            ),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                              tooltip: 'Remover somente deste aparelho',
                              onPressed: () => _confirmDelete(context, syncService, req, true),
                            ),
                          ),
                        );
                      }),
                    ],
                  ],
                ),
              ),

              // Botão inferior de sincronização
              if (syncables.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: LedButton.icon(
                    onPressed: () async {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Tentando sincronizar envios com comprovante...')),
                      );
                      await syncService.syncAllPending();
                    },
                    icon: const Icon(Icons.sync),
                    label: const Text('Sincronizar Agora'),
                    style: LedButton.styleFrom(
                      backgroundColor: const Color(0xFF0288D1),
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 50),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
