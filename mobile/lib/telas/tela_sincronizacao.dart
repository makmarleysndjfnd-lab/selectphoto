import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_sincronizacao.dart';
import '../widgets/led_button.dart';

String _pendingRequestLabel(SyncRequest request) {
  if (request.type == 'REGISTER_SALE' &&
      (request.payload['pendingReceiptPath'] == null ||
          request.payload['pendingReceiptPath'].toString().isEmpty)) {
    return 'Venda antiga sem comprovante — refaça a venda';
  }
  switch (request.type) {
    case 'REGISTER_SALE':
      return 'Venda aguardando confirmação';
    case 'REGISTER_NONSALE':
      return 'Não-venda aguardando confirmação';
    case 'REGISTER_APPOINTMENT':
      return 'Agendamento aguardando confirmação';
    case 'SUBMIT_COST':
      return 'Despesa aguardando confirmação';
    case 'SYNC_CLIENTS':
      return 'Cadastro aguardando sincronização';
    default:
      return 'Envio aguardando confirmação';
  }
}

class SyncScreen extends StatelessWidget {
  const SyncScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0030),
        title: const Text('Envios Pendentes',
            style: TextStyle(color: Colors.white, fontSize: 16)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Consumer<SyncService>(
        builder: (context, syncService, child) {
          final requests = syncService.pendingRequests;

          if (requests.isEmpty) {
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
              Container(
                padding: const EdgeInsets.all(16),
                color: Colors.orange.withOpacity(0.1),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded,
                        color: Colors.orange),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Há ${requests.length} envio(s) salvo(s) somente neste aparelho e ainda não confirmado(s) pelo servidor. Isso não é uma venda concluída nem um backup do banco. O app tentará novamente quando houver conexão.',
                        style: const TextStyle(color: Colors.orange),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: requests.length,
                  itemBuilder: (context, index) {
                    final req = requests[index];
                    return ListTile(
                      leading: Icon(
                        req.type == 'SYNC_CLIENTS'
                            ? Icons.person_add
                            : req.type == 'SUBMIT_COST'
                                ? Icons.attach_money
                                : req.type == 'REGISTER_SALE'
                                    ? Icons.point_of_sale
                                    : Icons.cloud_upload,
                        color: Colors.white54,
                      ),
                      title: Text(_pendingRequestLabel(req),
                          style: const TextStyle(color: Colors.white)),
                      subtitle: Text(
                        req.lastError?.isNotEmpty == true
                            ? '${req.lastError}\nData: ${req.createdAt.toLocal().toString().split('.')[0]}'
                            : 'Data: ${req.createdAt.toLocal().toString().split('.')[0]}',
                        style: const TextStyle(color: Colors.white54),
                      ),
                      trailing: req.isSyncing
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2))
                          : IconButton(
                              icon: const Icon(Icons.delete, color: Colors.red),
                              onPressed: () {
                                syncService.removePendingRequest(req.id);
                              },
                            ),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: LedButton.icon(
                  onPressed: () async {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Tentando sincronizar...')),
                    );
                    await syncService.syncAllPending();
                  },
                  icon: const Icon(Icons.sync),
                  label: const Text('Tentar Sincronizar Agora'),
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
