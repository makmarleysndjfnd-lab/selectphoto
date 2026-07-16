const fs = require('fs');
const content = fs.readFileSync('mobile/lib/telas/painel_admin.dart', 'utf8');

const regex = /  void _showNotificacoesDialog\(\) \{[\s\S]*?    \);\r?\n  \}/;
const newContent = `  void _showNotificacoesDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              title: const Text('Notificações e Pendências', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              content: FutureBuilder<List<dynamic>>(
                future: ApiService().getNotifications(),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const SizedBox(
                      width: 100, height: 100,
                      child: Center(child: CircularProgressIndicator(color: Colors.orangeAccent)),
                    );
                  }
                  if (snapshot.hasError) {
                    return const Text('Erro ao carregar notificações.', style: TextStyle(color: Colors.redAccent));
                  }
                  
                  final notifications = snapshot.data ?? [];
                  if (notifications.isEmpty) {
                    return const Text('Tudo limpo! Nenhuma pendência.', style: TextStyle(color: Colors.white70));
                  }

                  return SizedBox(
                    width: double.maxFinite,
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: notifications.length,
                      itemBuilder: (context, index) {
                        final notif = notifications[index];
                        final senderName = notif['sender'] != null ? notif['sender']['name'] : 'Sistema';
                        
                        IconData icon;
                        switch (notif['type']) {
                          case 'STOCK_TRANSFER_COVER': icon = Icons.layers_rounded; break;
                          case 'STOCK_TRANSFER_BOOK': icon = Icons.menu_book_rounded; break;
                          case 'COST_APPROVAL': icon = Icons.attach_money_rounded; break;
                          case 'FLEET_URGENT': icon = Icons.warning_amber_rounded; break;
                          default: icon = Icons.notifications_active_rounded;
                        }

                        return Card(
                          color: Colors.white.withOpacity(0.05),
                          child: ListTile(
                            leading: Icon(icon, color: Colors.orangeAccent),
                            title: Text(senderName + ' \u2794 Admin', style: const TextStyle(color: Colors.white, fontSize: 14)),
                            subtitle: Text(notif['message'] ?? 'Notificação', style: const TextStyle(color: Colors.white70)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.close, color: Colors.redAccent),
                                  onPressed: () async {
                                    try {
                                      await ApiService().actionNotification(notif['id'], 'REJECT');
                                      setDialogState(() {});
                                    } catch (e) {
                                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: ' + e.toString())));
                                    }
                                  },
                                ),
                                IconButton(
                                  icon: const Icon(Icons.check, color: Colors.greenAccent),
                                  onPressed: () async {
                                    try {
                                      await ApiService().actionNotification(notif['id'], 'ACCEPT');
                                      setDialogState(() {});
                                    } catch (e) {
                                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: ' + e.toString())));
                                    }
                                  },
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Fechar', style: TextStyle(color: Colors.white70)),
                ),
              ],
            );
          }
        );
      }
    );
  }`;

fs.writeFileSync('mobile/lib/telas/painel_admin.dart', content.replace(regex, newContent));
console.log('Feito');
`;
