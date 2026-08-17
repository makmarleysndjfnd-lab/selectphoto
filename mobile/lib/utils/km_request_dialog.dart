import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';

class KmRequestHelper {
  static Future<void> checkKmRequests(BuildContext context) async {
    try {
      final api = ApiService();
      final notifications = await api.getNotifications();
      
      // Find the first pending KM_REQUEST
      final kmRequest = notifications.firstWhere(
        (n) => n['type'] == 'KM_REQUEST' && n['status'] != 'RESOLVED',
        orElse: () => null,
      );

      if (kmRequest == null) return;

      final createdAt = DateTime.parse(kmRequest['createdAt']);
      final isOverdue = DateTime.now().difference(createdAt).inHours >= 48;

      if (!context.mounted) return;
      _showKmDialog(context, kmRequest['id'], kmRequest['actionData']?['carId'], isOverdue);
    } catch (e) {
      print('Erro ao checar KM request: $e');
    }
  }

  static void _showKmDialog(BuildContext context, String notificationId, String? carId, bool isOverdue) {
    final kmController = TextEditingController();
    bool isLoading = false;
    String? errorMessage;

    showDialog(
      context: context,
      barrierDismissible: true, // Liberado para testes (não trava o app)
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setState) {
            return PopScope(
              canPop: true,
              child: AlertDialog(
                title: Row(
                  children: [
                    Icon(Icons.speed, color: isOverdue ? Colors.amberAccent : Colors.blue),
                    const SizedBox(width: 8),
                    const Text('Atualizar KM', style: TextStyle(fontSize: 18)),
                  ],
                ),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isOverdue)
                      const Text(
                        'Lembrete: Você está há mais de 2 dias sem atualizar o KM do veículo.',
                        style: TextStyle(color: Colors.amberAccent, fontWeight: FontWeight.bold),
                      )
                    else
                      const Text('Por favor, informe a quilometragem atual do veículo da empresa.'),
                    const SizedBox(height: 16),
                    TextField(
                      controller: kmController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'KM Atual',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.directions_car),
                      ),
                    ),
                    if (errorMessage != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(errorMessage!, style: const TextStyle(color: Colors.red, fontSize: 12)),
                      ),
                  ],
                ),
                actions: [
                  if (!isLoading)
                    TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Mais Tarde / Fechar', style: TextStyle(color: Colors.grey)),
                    ),
                  ElevatedButton(
                    onPressed: isLoading ? null : () async {
                      final kmText = kmController.text.trim();
                      if (kmText.isEmpty) {
                        setState(() => errorMessage = 'Informe o KM');
                        return;
                      }
                      final km = int.tryParse(kmText);
                      if (km == null) {
                        setState(() => errorMessage = 'KM inválido');
                        return;
                      }

                      setState(() {
                        isLoading = true;
                        errorMessage = null;
                      });

                      try {
                        final api = ApiService();
                        await api.actionNotification(notificationId, 'UPDATE_KM', extraData: {'km': km});
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            const SnackBar(content: Text('KM atualizado com sucesso!')),
                          );
                        }
                      } catch (e) {
                        setState(() {
                          isLoading = false;
                          errorMessage = e.toString().replaceAll('Exception: ', '');
                        });
                      }
                    },
                    child: isLoading 
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Salvar KM'),
                  ),
                ],
              ),
            );
          }
        );
      }
    );
  }
}
