import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'tela_configuracoes.dart';
import 'tela_detalhes_cliente_vendedor.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../utils/ui_helpers.dart';
import '../servicos/servico_sincronizacao.dart';

import 'tela_cadastro_custos.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../servicos/servico_api.dart';
import '../utils/km_request_dialog.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';
import 'tela_agenda.dart';
import 'tela_sincronizacao.dart';

class SellerDashboard extends StatefulWidget {
  const SellerDashboard({super.key});

  @override
  State<SellerDashboard> createState() => _SellerDashboardState();
}

class _SellerDashboardState extends State<SellerDashboard>
    with SingleTickerProviderStateMixin {
  final _codeController = TextEditingController();
  final _filterController = TextEditingController();
  String _searchQuery = '';
  bool _searched = false;
  bool _isManager = false; // Flag para Vendedor Gerente (Carregada via SharedPreferences)
  
  String _userName = '';
  String _greeting = 'Olá';
  String _verse = '';
  List<Map<String, dynamic>> _sellerClients = [];
  List<dynamic> _personalAppointments = [];
  bool _isLoadingClients = true;
  
  // Variáveis para a Agenda no Painel
  DateTime _selectedAgendaMonth = DateTime.now();
  DateTime _selectedAgendaDay = DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day);

  // Variáveis para Distribuição de Equipe e Trocas
  Map<String, dynamic>? _selectedSellerForTransfer;
  List<Map<String, dynamic>> _companySellers = [];
  final Set<String> _selectedClientIds = {};

  Map<String, dynamic>? _foundClient;
  late AnimationController _animController;
  late Animation<double> _fadeAnim;
  final DateTime _selectedDate = DateTime.now();

  int _unreadNotifs = 0;
  bool _isQuickMenuOpen = false; // Proteção contra duplo clique no menu de ações
  bool _atendidasExpanded = false; // Controle da seção recolhida de fichas atendidas

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim =
        CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
    _fetchUnreadNotifications();
    _checkManagerRole();
    _loadUserData();
    _fetchClients();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      KmRequestHelper.checkKmRequests(context);
    });
  }

  Future<void> _loadUserData() async {
    final name = await UIHelpers.getUserName();
    final quote = await ApiService().getDailyQuote();
    if (mounted) {
      setState(() {
        _userName = name;
        _greeting = UIHelpers.getGreeting();
        _verse = quote.isNotEmpty ? quote : '"A persistência realiza o impossível." - Provérbio Chinês';
      });
    }
  }

  Future<void> _fetchTeamSellers() async {
    try {
      final users = await ApiService().getCompanyUsers();
      final currentUserId = await UIHelpers.getUserId();
      final sellers = List<Map<String, dynamic>>.from(
        users.where((u) {
          final isNotSelf = currentUserId == null || u['id'] != currentUserId;
          return isNotSelf;
        })
      );
      if (mounted) {
        setState(() {
          _companySellers = sellers.isNotEmpty ? sellers : List<Map<String, dynamic>>.from(users);
        });
      }
    } catch (e) {
      debugPrint('Erro ao buscar vendedores da equipe: $e');
    }
  }

  Future<void> _fetchClients() async {
    try {
      final clients = await ApiService().getClientsBySeller();
      final userId = await UIHelpers.getUserId();
      final now = DateTime.now();
      final startOfToday = DateTime(now.year, now.month, now.day);
      final fromWindow = startOfToday.subtract(const Duration(days: 4));
      final appointments = userId != null ? await ApiService().getUnifiedAppointments(userId, from: fromWindow) : [];
      if (mounted) {
        setState(() {
          _sellerClients = List<Map<String, dynamic>>.from(clients);
          _personalAppointments = appointments;
          _isLoadingClients = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoadingClients = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao buscar fichas/agendamentos: $e')));
      }
    }
  }

  Future<void> _checkManagerRole() async {
    final prefs = await SharedPreferences.getInstance();
    final role = prefs.getString('user_role');
    if ((role == 'SELLER_MANAGER' || role == 'SUPER_ADMIN' || role == 'COMPANY_ADMIN' || role == 'ADMIN') && mounted) {
      setState(() {
        _isManager = true;
      });
    }
    await _fetchTeamSellers();
  }

  Future<void> _fetchUnreadNotifications() async {
    try {
      final api = ApiService();
      final notifs = await api.getNotifications();
      if (mounted) setState(() => _unreadNotifs = notifs.length);
    } catch (e) {
      debugPrint('Error fetching notifications: $e');
    }
  }

  @override
  void dispose() {
    _codeController.dispose();
    _filterController.dispose();
    _animController.dispose();
    super.dispose();
  }

  void _filterClientList(String query) {
    setState(() {
      _searchQuery = query;
    });
  }

  void _searchClient() async {
    final code = _codeController.text.trim().toUpperCase();
    if (code.isEmpty) return;

    final found = _sellerClients.firstWhere(
      (c) => (c['sequenceNumber'] as String).toUpperCase() == code,
      orElse: () => {},
    );

    if (found.isNotEmpty) {
      setState(() {
        _searched = true;
        _foundClient = found;
      });
      _openClientDetail(found);
      return;
    }

    // Busca global (Estoque/Outros Vendedores)
    try {
      final results = await ApiService().searchBooks(code);
      if (results.isNotEmpty) {
        final book = results.first;
        String locationStr = '';
        if (book['bookStatus'] == 'IN_STOCK' || book['bookStatus'] == 'IN_STOCK_REBOLO') {
          locationStr = 'Disponível no Estoque';
        } else if (book['assignedSeller'] != null) {
          locationStr = 'Com vendedor(a): ${book['assignedSeller']['name']}';
        } else {
          locationStr = 'Status: ${book['bookStatus']}';
        }
        
        if (mounted) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              title: const Text('Localização do Book', style: TextStyle(color: Colors.white)),
              content: Text('Ficha: ${book['sequenceNumber']}\nNome: ${book['name']}\n\n$locationStr', style: const TextStyle(color: Colors.white70)),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fechar', style: TextStyle(color: Color(0xFF4FC3F7))))
              ],
            )
          );
        }
      } else {
        setState(() {
          _searched = true;
          _foundClient = null;
        });
      }
    } catch(e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro na busca: $e')));
      }
    }
  }

  void _openClientDetail(Map<String, dynamic> client) {
    Navigator.push(
      context,
      PageRouteBuilder(
        pageBuilder: (_, __, ___) =>
            SellerClientDetailScreen(clientData: client),
        transitionsBuilder: (_, anim, __, child) => SlideTransition(
          position:
              Tween<Offset>(begin: const Offset(1, 0), end: Offset.zero)
                  .animate(
                      CurvedAnimation(parent: anim, curve: Curves.easeOut)),
          child: child,
        ),
        transitionDuration: const Duration(milliseconds: 350),
      ),
    );
  }

  List<Map<String, dynamic>> get _filteredClients {
    if (_searchQuery.isEmpty) return _sellerClients;
    final q = _searchQuery.toLowerCase();
    return _sellerClients.where((c) {
      return (c['name'] as String).toLowerCase().contains(q) ||
          (c['sequenceNumber'] as String).toLowerCase().contains(q) ||
          ((c['city'] as String?) ?? '').toLowerCase().contains(q);
    }).toList();
  }

  void _showFechamentoCidadeDialog() async {
    // 1. Verificar conectividade e fila offline pendente
    final syncService = Provider.of<SyncService>(context, listen: false);
    final syncables = syncService.syncableRequests;
    final legacys = syncService.legacyRequests;

    if (syncables.isNotEmpty || legacys.isNotEmpty) {
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: [
              Icon(
                syncables.isNotEmpty ? Icons.sync_problem_rounded : Icons.warning_amber_rounded,
                color: Colors.orangeAccent,
              ),
              const SizedBox(width: 8),
              const Text(
                'Operações Pendentes',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (syncables.isNotEmpty) ...[
                Text(
                  'Você possui ${syncables.length} operação(ões) com comprovante aguardando sincronização com a internet.',
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 8),
              ],
              if (legacys.isNotEmpty) ...[
                Text(
                  'Você possui ${legacys.length} registro(s) antigo(s) sem foto de comprovante neste aparelho. Eles não podem ser enviados automaticamente e exigem reconciliação ou remoção.',
                  style: const TextStyle(color: Colors.amber),
                ),
                const SizedBox(height: 8),
              ],
              const Text(
                'Abra a tela de Envios Pendentes para verificar e gerenciar suas pendências.',
                style: TextStyle(color: Colors.white54, fontSize: 13),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Fechar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF4FC3F7),
                foregroundColor: Colors.black,
              ),
              onPressed: () {
                Navigator.pop(context);
                Navigator.push(context, MaterialPageRoute(builder: (_) => const SyncScreen()));
              },
              child: const Text('Ver Envios Pendentes', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
      return;
    }

    final cities = _sellerClients
        .map((c) => (c['city'] as String?)?.trim())
        .where((c) => c != null && c.isNotEmpty)
        .cast<String>()
        .toSet()
        .toList();

    if (cities.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Nenhuma cidade encontrada nas suas fichas.')),
      );
      return;
    }

    String selectedCity = cities.first;
    bool isLoadingPreview = true;
    bool isSubmitting = false;
    Map<String, dynamic>? previewData;
    String? previewError;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            void loadPreview(String city) async {
              setDialogState(() {
                isLoadingPreview = true;
                previewError = null;
              });
              try {
                final preview = await ApiService().getCityClosingPreview(city);
                if (context.mounted) {
                  setDialogState(() {
                    previewData = preview;
                    isLoadingPreview = false;
                  });
                }
              } catch (e) {
                if (context.mounted) {
                  setDialogState(() {
                    previewError = e.toString().replaceAll('Exception: ', '');
                    isLoadingPreview = false;
                  });
                }
              }
            }

            if (isLoadingPreview && previewData == null && previewError == null) {
              loadPreview(selectedCity);
            }

            final pendingCount = previewData?['pendingCount'] ?? 0;
            final nonSaleCount = previewData?['nonSaleCount'] ?? 0;
            final soldCount = previewData?['soldCount'] ?? 0;
            final totalCount = previewData?['totalCount'] ?? 0;
            final totalSalesVal = (previewData?['totalSalesValue'] is num)
                ? (previewData!['totalSalesValue'] as num).toDouble()
                : (double.tryParse(previewData?['totalSalesValue']?.toString() ?? '0') ?? 0.0);
            final pendingReceipts = previewData?['pendingReceiptsCount'] ?? 0;
            final isAlreadyClosed = previewData?['isAlreadyClosed'] == true;
            final hasUnresolved = (pendingCount + nonSaleCount) > 0;

            return AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Row(
                children: [
                  Icon(Icons.location_city_rounded, color: Color(0xFF4FC3F7)),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Fechamento de Cidade',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
                    ),
                  ),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Selecione a cidade:', style: TextStyle(color: Colors.white70, fontSize: 12)),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<String>(
                      value: selectedCity,
                      dropdownColor: const Color(0xFF1A2535),
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: Colors.white.withOpacity(0.05),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                      ),
                      items: cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                      onChanged: isSubmitting ? null : (val) {
                        if (val != null && val != selectedCity) {
                          selectedCity = val;
                          loadPreview(val);
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                    if (isLoadingPreview) ...[
                      const Center(
                        child: Padding(
                          padding: EdgeInsets.all(16),
                          child: CircularProgressIndicator(color: Color(0xFF4FC3F7)),
                        ),
                      ),
                    ] else if (previewError != null) ...[
                      Text('Erro ao carregar prévia: $previewError', style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                    ] else ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.04),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white12),
                        ),
                        child: Column(
                          children: [
                            _buildStatRow('Total de Fichas:', '$totalCount'),
                            const SizedBox(height: 6),
                            _buildStatRow('Fichas Pendentes:', '$pendingCount', color: pendingCount > 0 ? const Color(0xFF40C4FF) : Colors.white70),
                            const SizedBox(height: 6),
                            _buildStatRow('Revisitas / Não-Venda:', '$nonSaleCount', color: nonSaleCount > 0 ? const Color(0xFFFFB74D) : Colors.white70),
                            const SizedBox(height: 6),
                            _buildStatRow('Fichas Vendidas:', '$soldCount', color: const Color(0xFF00E676)),
                            const Divider(color: Colors.white12, height: 16),
                            _buildStatRow('Total Vendido (R\$):', 'R\$ ${totalSalesVal.toStringAsFixed(2)}', isBold: true, color: const Color(0xFF00E676)),
                            if (pendingReceipts > 0) ...[
                              const SizedBox(height: 6),
                              _buildStatRow('Comprovantes Pendentes:', '$pendingReceipts', color: Colors.orangeAccent),
                            ],
                          ],
                        ),
                      ),
                      if (isAlreadyClosed) ...[
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.amber.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.amberAccent.withOpacity(0.5)),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.info_outline, color: Colors.amberAccent, size: 16),
                              SizedBox(width: 8),
                              Expanded(
                                child: Text('Esta cidade já foi encerrada anteriormente.',
                                    style: TextStyle(color: Colors.amberAccent, fontSize: 11)),
                              ),
                            ],
                          ),
                        ),
                      ],
                      if (!isAlreadyClosed && hasUnresolved) ...[
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.red.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.redAccent.withOpacity(0.5)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 18),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Atenção: Existem ${pendingCount + nonSaleCount} fichas sem venda nesta cidade. '
                                  'Ao confirmar o fechamento, elas serão encerradas definitivamente e não poderão mais ser alteradas.',
                                  style: const TextStyle(color: Colors.redAccent, fontSize: 11, fontWeight: FontWeight.w500),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isSubmitting ? null : () => Navigator.pop(dialogContext),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white70)),
                ),
                LedButton(
                  onPressed: (isSubmitting || isLoadingPreview || isAlreadyClosed)
                      ? null
                      : () async {
                          setDialogState(() => isSubmitting = true);
                          try {
                            await ApiService().closeCity(selectedCity);
                            if (dialogContext.mounted) {
                              Navigator.pop(dialogContext);
                            }
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text('Cidade $selectedCity encerrada com sucesso!'),
                                  backgroundColor: Colors.green,
                                ),
                              );
                              _fetchClients();
                            }
                          } catch (e) {
                            setDialogState(() => isSubmitting = false);
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text('Erro no fechamento: ${e.toString().replaceAll("Exception: ", "")}'),
                                  backgroundColor: Colors.red,
                                ),
                              );
                            }
                          }
                        },
                  style: LedButton.styleFrom(backgroundColor: const Color(0xFF4FC3F7)),
                  child: isSubmitting
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2))
                      : const Text('Confirmar Fechamento'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildStatRow(String label, String value, {bool isBold = false, Color? color}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        Text(
          value,
          style: TextStyle(
            color: color ?? Colors.white,
            fontSize: 13,
            fontWeight: isBold ? FontWeight.bold : FontWeight.w500,
          ),
        ),
      ],
    );
  }

  void _showNotificacoesVendedorDialog() {
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
                          case 'COVER_TRANSFER_REQUEST':
                          case 'STOCK_TRANSFER_COVER': icon = Icons.layers_rounded; break;
                          case 'STOCK_TRANSFER_BOOK': icon = Icons.menu_book_rounded; break;
                          case 'COST_APPROVAL': icon = Icons.attach_money_rounded; break;
                          case 'FLEET_URGENT': icon = Icons.warning_amber_rounded; break;
                          case 'KM_REQUEST': icon = Icons.speed_rounded; break;
                          default: icon = Icons.notifications_active_rounded;
                        }

                        return LedCard(
                          color: Colors.white.withOpacity(0.05),
                          child: ListTile(
                            leading: Icon(icon, color: Colors.orangeAccent),
                            title: Text('$senderName \u2794 Você', style: const TextStyle(color: Colors.white, fontSize: 14)),
                            subtitle: Text(notif['message'] ?? 'Notificação', style: const TextStyle(color: Colors.white70)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (notif['type'] == 'KM_REQUEST')
                                  IconButton(
                                    icon: const Icon(Icons.edit, color: Colors.blueAccent),
                                    onPressed: () {
                                      Navigator.pop(context); // Close notifications dialog
                                      KmRequestHelper.checkKmRequests(context);
                                    },
                                  )
                                else ...[
                                  IconButton(
                                    icon: const Icon(Icons.close, color: Colors.redAccent),
                                    onPressed: () async {
                                      try {
                                        await ApiService().actionNotification(notif['id'], 'REJECT');
                                        setDialogState(() {}); // Refreshes FutureBuilder
                                      } catch (e) {
                                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
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
                                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                                      }
                                    },
                                  ),
                                ],
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
                  onPressed: () {
                    Navigator.pop(context);
                    _fetchUnreadNotifications();
                  },
                  child: const Text('Fechar', style: TextStyle(color: Colors.white70)),
                ),
              ],
            );
          }
        );
      },
    );
  }



  void _openQRScanner() {
    Navigator.push(context, MaterialPageRoute(builder: (context) {
      return Scaffold(
        appBar: AppBar(title: const Text('Ler QR Code', style: TextStyle(color: Colors.white)), backgroundColor: const Color(0xFF0D1B2A), iconTheme: const IconThemeData(color: Colors.white)),
        body: MobileScanner(
          onDetect: (capture) {
            final List<Barcode> barcodes = capture.barcodes;
            if (barcodes.isNotEmpty && barcodes.first.rawValue != null) {
              final String code = barcodes.first.rawValue!;
              Navigator.pop(context);
              _codeController.text = code;
              _searchClient();
            }
          },
        ),
      );
    }));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      body: FadeTransition(
        opacity: _fadeAnim,
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _buildClientList(),
                    const SizedBox(height: 20),
                    _buildSearchCard(),
                    if (_isManager) ...[
                      const SizedBox(height: 20),
                      _buildDistribuicaoEquipeCard(),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: _selectedClientIds.isNotEmpty
          ? FloatingActionButton.extended(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Solicitando troca de ${_selectedClientIds.length} ficha(s)...')));
                setState(() {
                  _selectedClientIds.clear();
                });
              },
              backgroundColor: const Color(0xFFCE93D8),
              icon: const Icon(Icons.swap_horiz_rounded, color: Colors.white),
              label: Text('Trocar ${_selectedClientIds.length}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            )
          : null,
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0D1B2A), Color(0xFF0D3B6E)],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Linha superior: ícone + saudação + botão de ações
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [Color(0xFF4FC3F7), Color(0xFF0288D1)]),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                            color: const Color(0xFF0288D1).withOpacity(0.4),
                            blurRadius: 12,
                            offset: const Offset(0, 4)),
                      ],
                    ),
                    child: const Icon(Icons.sell_rounded,
                        color: Colors.white, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '$_greeting, $_userName',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.bold),
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                        ),
                        const Text('Painel do Vendedor',
                            style: TextStyle(
                                color: Color(0xFF90CAF9), fontSize: 12)),
                      ],
                    ),
                  ),
                  // 2 botões verticais independentes: Notificações (topo) e Configurações (baixo)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Botão Superior: Notificações
                      Semantics(
                        label: 'Notificações',
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: _showNotificacoesVendedorDialog,
                          child: Container(
                            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                            alignment: Alignment.center,
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.08),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white.withOpacity(0.18)),
                            ),
                            child: _unreadNotifs > 0
                                ? Badge(
                                    label: Text(_unreadNotifs.toString()),
                                    child: const Icon(Icons.notifications_active_rounded, color: Colors.orangeAccent, size: 20),
                                  )
                                : const Icon(Icons.notifications_none_rounded, color: Colors.white70, size: 20),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      // Botão Inferior: Configurações
                      Semantics(
                        label: 'Configurações',
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const SettingsScreen(
                                  canManageRoi: false,
                                  isFotografo: false,
                                  isVendedor: true,
                                ),
                              ),
                            ).then((_) => _fetchClients());
                          },
                          child: Container(
                            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                            alignment: Alignment.center,
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.08),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white.withOpacity(0.18)),
                            ),
                            child: const Icon(Icons.settings_outlined, color: Colors.white70, size: 20),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              // Frase motivacional — máx 2 linhas com reticências
              if (_verse.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  _verse,
                  style: const TextStyle(
                      color: Colors.white60,
                      fontSize: 11,
                      fontStyle: FontStyle.italic),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showRepassBookDialog() {
    if (_selectedSellerForTransfer == null) return;
    final codeCtrl = TextEditingController();
    final sellerName = _selectedSellerForTransfer!['name'] ?? 'Vendedor';
    final sellerId = _selectedSellerForTransfer!['id'] as String;

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text('Repassar Book para $sellerName', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Informe o código da ficha/book que deseja repassar para $sellerName:', style: const TextStyle(color: Colors.white70, fontSize: 13)),
              const SizedBox(height: 14),
              TextField(
                controller: codeCtrl,
                style: const TextStyle(color: Colors.white, fontFamily: 'monospace'),
                decoration: InputDecoration(
                  labelText: 'Código da Ficha (Ex: CF-EQP1-0001)',
                  labelStyle: const TextStyle(color: Colors.white70),
                  prefixIcon: const Icon(Icons.qr_code, color: Color(0xFFCE93D8)),
                  filled: true,
                  fillColor: Colors.white.withOpacity(0.05),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            LedButton(
              onPressed: () async {
                final code = codeCtrl.text.trim();
                if (code.isEmpty) return;
                try {
                  await ApiService().assignSeller(code, sellerId);
                  if (mounted) {
                    Navigator.pop(context);
                    _fetchClients();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Book $code repassado para $sellerName com sucesso!'), backgroundColor: Colors.green),
                    );
                  }
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Erro ao repassar book: $e'), backgroundColor: Colors.red),
                  );
                }
              },
              style: LedButton.styleFrom(backgroundColor: const Color(0xFF9C27B0)),
              child: const Text('Confirmar Repasse'),
            ),
          ],
        );
      },
    );
  }

  Widget _buildDistribuicaoEquipeCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFCE93D8).withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 4,
            children: [
              const Text('Distribuição entre Vendedores',
                  style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: const Color(0xFFCE93D8).withOpacity(0.2), borderRadius: BorderRadius.circular(8)),
                child: const Text('GERENTE', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 10, fontWeight: FontWeight.bold)),
              )
            ],
          ),
          const SizedBox(height: 12),
          const Text('Atribua os books da sua rota para os vendedores da sua equipe.', style: TextStyle(color: Colors.white70, fontSize: 13)),
          const SizedBox(height: 16),
          DropdownButtonFormField<Map<String, dynamic>>(
            isExpanded: true,
            value: _selectedSellerForTransfer,
            hint: const Text('Selecione o vendedor da empresa', style: TextStyle(color: Colors.white54), overflow: TextOverflow.ellipsis),
            dropdownColor: const Color(0xFF1A1A2E),
            items: _companySellers.map((seller) {
              return DropdownMenuItem<Map<String, dynamic>>(
                value: seller,
                child: Text(seller['name'] ?? 'Vendedor', style: const TextStyle(color: Colors.white), overflow: TextOverflow.ellipsis),
              );
            }).toList(),
            onChanged: (val) {
              setState(() {
                _selectedSellerForTransfer = val;
              });
            },
            decoration: InputDecoration(
              filled: true,
              fillColor: const Color(0xFF1A2535),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white12)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFCE93D8))),
            ),
          ),
          const SizedBox(height: 16),
          LedButton.icon(
            onPressed: _selectedSellerForTransfer == null ? null : _showRepassBookDialog,
            icon: const Icon(Icons.qr_code_scanner, color: Colors.white),
            label: const Text('Escanear / Repassar Book', style: TextStyle(color: Colors.white)),
            style: LedButton.styleFrom(
              backgroundColor: const Color(0xFF9C27B0), 
              disabledBackgroundColor: Colors.grey.shade800,
              minimumSize: const Size(double.infinity, 45)
            ),
          ),
        ],
      )
    );
  }



  Widget _buildSearchCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2535),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
            color: const Color(0xFF4FC3F7).withOpacity(0.2), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Row(children: [
                  Icon(Icons.qr_code_scanner_rounded,
                      color: Color(0xFF4FC3F7), size: 20),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text('Buscar por código da ficha',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14),
                        overflow: TextOverflow.ellipsis),
                  ),
                ]),
              ),
              IconButton(
                onPressed: _openQRScanner,
                icon: const Icon(Icons.camera_alt, color: Color(0xFF4FC3F7)),
                tooltip: 'Ler QR Code',
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text('Ex: CF-EQP1-0001',
              style:
                  TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _codeController,
                  style: const TextStyle(
                      color: Colors.white, fontFamily: 'monospace'),
                  textCapitalization: TextCapitalization.characters,
                  onSubmitted: (_) => _searchClient(),
                  decoration: InputDecoration(
                    hintText: 'CF-EQP1-0001',
                    hintStyle: TextStyle(
                        color: Colors.white.withOpacity(0.3),
                        fontFamily: 'monospace'),
                    prefixIcon: const Icon(Icons.tag_rounded,
                        color: Color(0xFF4FC3F7), size: 18),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(
                          color: Colors.white.withOpacity(0.15)),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: const BorderSide(
                          color: Color(0xFF4FC3F7), width: 1.5),
                    ),
                    filled: true,
                    fillColor: Colors.white.withOpacity(0.05),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF0288D1), Color(0xFF4FC3F7)],
                  ),
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                        color: const Color(0xFF0288D1).withOpacity(0.4),
                        blurRadius: 8,
                        offset: const Offset(0, 4)),
                  ],
                ),
                child: IconButton(
                  onPressed: _searchClient,
                  icon: const Icon(Icons.search_rounded,
                      color: Colors.white, size: 22),
                  tooltip: 'Buscar ficha',
                ),
              ),
            ],
          ),
          if (_searched && _foundClient == null) ...[
            const SizedBox(height: 12),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFFEF5350).withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                    color: const Color(0xFFEF5350).withOpacity(0.4)),
              ),
              child: const Row(children: [
                Icon(Icons.error_outline,
                    color: Color(0xFFEF5350), size: 16),
                SizedBox(width: 8),
                Text('Ficha não encontrada.',
                    style: TextStyle(
                        color: Color(0xFFEF5350), fontSize: 13)),
              ]),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildClientList() {
    final pendingClients = _filteredClients.where((c) {
      final outcome = c['outcomeStatus'] as String?;
      final sales = (c['sales'] as List?) ?? [];
      final hasSales = sales.isNotEmpty;
      final hasNonSales = c['nonSales'] != null && (c['nonSales'] as List).isNotEmpty;

      // Trava de Comprovante: Se a ficha foi vendida, mas ainda falta comprovante, permanece nas Pendentes
      if (outcome == 'SOLD' || hasSales) {
        final hasReceipt = sales.isNotEmpty && sales.every((s) => s['receiptUrl'] != null && s['receiptUrl'].toString().trim().isNotEmpty);
        return !hasReceipt;
      }

      if (outcome == 'PENDING') return true;
      if (outcome == 'NON_SALE') return false;
      return !hasSales && !hasNonSales;
    }).toList();

    final revisitClients = _filteredClients.where((c) {
      final outcome = c['outcomeStatus'] as String?;
      final hasSales = c['sales'] != null && (c['sales'] as List).isNotEmpty;
      final hasNonSales = c['nonSales'] != null && (c['nonSales'] as List).isNotEmpty;
      if (outcome == 'SOLD' || hasSales) return false;
      if (outcome == 'NON_SALE') return true;
      return hasNonSales;
    }).toList();

    final soldClients = _filteredClients.where((c) {
      final outcome = c['outcomeStatus'] as String?;
      final sales = (c['sales'] as List?) ?? [];
      final isSold = outcome == 'SOLD' || sales.isNotEmpty;
      if (!isSold) return false;
      // Para entrar nos resolvidos/vendidos, todos os comprovantes devem estar anexados
      final hasReceipt = sales.isNotEmpty && sales.every((s) => s['receiptUrl'] != null && s['receiptUrl'].toString().trim().isNotEmpty);
      return hasReceipt;
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 4,
          children: [
            const Text('Clientes do Dia',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold)),
            GestureDetector(
              onTap: () {
                Navigator.push(context, MaterialPageRoute(builder: (_) => const TelaAgenda())).then((_) => _fetchClients());
              },
              child: Text('${_filteredClients.length} fichas | ${_personalAppointments.length} agenda',
                  style: const TextStyle(
                      color: Color(0xFF00E5FF), fontSize: 14, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _buildAppointmentsSummaryCard(),
        const SizedBox(height: 16),
        TextField(
          controller: _filterController,
          onChanged: _filterClientList,
          style: const TextStyle(color: Colors.white),
          decoration: InputDecoration(
            hintText: 'Filtrar por nome, ficha ou cidade',
            hintStyle: TextStyle(color: Colors.white.withOpacity(0.5)),
            prefixIcon: const Icon(Icons.filter_list_rounded,
                color: Color(0xFF90CAF9)),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.white.withOpacity(0.15)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide:
                  const BorderSide(color: Color(0xFF4FC3F7), width: 1.5),
            ),
            filled: true,
            fillColor: Colors.white.withOpacity(0.05),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          ),
        ),
        const SizedBox(height: 20),

        // ── 1. GRUPO: FICHAS PENDENTES ──────────────────────────────────────────
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            const Icon(Icons.hourglass_top_rounded, color: Color(0xFF4FC3F7), size: 18),
            Text(
              'Fichas Pendentes (${pendingClients.length})',
              style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (pendingClients.isEmpty) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.03),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white10),
            ),
            child: const Center(
              child: Text('Nenhuma ficha pendente.', style: TextStyle(color: Colors.white54, fontSize: 13)),
            ),
          ),
        ] else ...[
          ...pendingClients.map((client) => _buildClientCard(client, outcome: 'PENDING')),
        ],

        const SizedBox(height: 24),

        // ── 2. SEÇÃO RECOLHÍVEL: ATENDIDAS ─────────────────────────────────────
        InkWell(
          onTap: () => setState(() => _atendidasExpanded = !_atendidasExpanded),
          borderRadius: BorderRadius.circular(14),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: const Color(0xFF1E293B),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withOpacity(0.12)),
            ),
            child: Row(
              children: [
                const Icon(Icons.done_all_rounded, color: Color(0xFF81C784), size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Fichas Atendidas (${revisitClients.length + soldClients.length})',
                    style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ),
                Icon(
                  _atendidasExpanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                  color: Colors.white70,
                ),
              ],
            ),
          ),
        ),

        if (_atendidasExpanded) ...[
          const SizedBox(height: 16),
          // Subgrupo Revisitas / Não Vendidas
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 6,
            children: [
              const Icon(Icons.replay_rounded, color: Color(0xFFFFB74D), size: 16),
              Text(
                'Revisitas / Não Vendidas (${revisitClients.length})',
                style: const TextStyle(color: Color(0xFFFFB74D), fontSize: 14, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (revisitClients.isEmpty) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.02),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.white10),
              ),
              child: const Center(
                child: Text('Nenhuma ficha em revisita.', style: TextStyle(color: Colors.white38, fontSize: 12)),
              ),
            ),
          ] else ...[
            ...revisitClients.map((client) => _buildClientCard(client, outcome: 'NON_SALE')),
          ],

          const SizedBox(height: 16),
          // Subgrupo Vendidas
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 6,
            children: [
              const Icon(Icons.check_circle_rounded, color: Color(0xFF00E676), size: 16),
              Text(
                'Vendidas (${soldClients.length})',
                style: const TextStyle(color: Color(0xFF00E676), fontSize: 14, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (soldClients.isEmpty) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.02),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.white10),
              ),
              child: const Center(
                child: Text('Nenhuma ficha vendida ainda.', style: TextStyle(color: Colors.white38, fontSize: 12)),
              ),
            ),
          ] else ...[
            ...soldClients.map((client) => _buildClientCard(client, outcome: 'SOLD')),
          ],
        ],

        const SizedBox(height: 24),
        LedButton.icon(
          onPressed: () {
            _showFechamentoCidadeDialog();
          },
          icon: const Icon(Icons.check_circle_outline, color: Colors.white),
          label: const Text('Fechamento de Cidade', style: TextStyle(color: Colors.white)),
          style: LedButton.styleFrom(
            backgroundColor: const Color(0xFFCE93D8),
            minimumSize: const Size(double.infinity, 45),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ],
    );
  }

  Widget _buildAppointmentsSummaryCard() {
    final today = DateTime.now();
    final startOfToday = DateTime(today.year, today.month, today.day);

    final sortedApps = List<Map<String, dynamic>>.from(_personalAppointments);
    sortedApps.sort((a, b) {
      if (a['dateTime'] == null) return 1;
      if (b['dateTime'] == null) return -1;
      return DateTime.parse(a['dateTime']).compareTo(DateTime.parse(b['dateTime']));
    });

    // Pega os agendamentos a partir do início do dia atual em diante (sem fallback para o passado)
    final upcomingAppointments = sortedApps.where((app) {
      if (app['dateTime'] == null) return false;
      final dt = DateTime.parse(app['dateTime']).toLocal();
      return !dt.isBefore(startOfToday);
    }).toList();

    final List<Map<String, dynamic>> displayApps = upcomingAppointments.take(3).toList();

    return GestureDetector(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (context) => const TelaAgenda()),
        ).then((_) => _fetchClients());
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.event_note_rounded, color: Colors.white),
                SizedBox(width: 8),
                Expanded(
                  child: Text('Abrir Agenda Completa',
                      style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                      overflow: TextOverflow.ellipsis),
                ),
                SizedBox(width: 8),
                Icon(Icons.arrow_forward_ios, color: Colors.white54, size: 16),
              ],
            ),
            if (displayApps.isEmpty) ...[
              const SizedBox(height: 8),
              const Text('Nenhum agendamento para hoje ou datas futuras.', style: TextStyle(color: Colors.white54, fontSize: 13)),
            ] else ...[
              const SizedBox(height: 12),
              const Text('Próximos Agendamentos:', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              ...displayApps.map((app) {
                final dt = DateTime.parse(app['dateTime']).toLocal();
                final dateString = '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}';
                final timeString = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
                final isClientApp = app['type'] == 'CLIENT';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Icon(isClientApp ? Icons.business_center : Icons.access_time, size: 14, color: isClientApp ? const Color(0xFF00E5FF) : Colors.amber),
                      const SizedBox(width: 6),
                      Text('$dateString $timeString', style: TextStyle(color: isClientApp ? const Color(0xFF00E5FF) : Colors.amber, fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          app['title'] ?? app['clientName'] ?? 'Compromisso',
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildAgendaItem(Map<String, dynamic> client) {
    final status = client['bookStatus'] as String?;
    
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: UIHelpers.getLedDecoration(status, isAgenda: true),
      child: ListTile(
        onTap: () => _openClientDetail(client),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: Colors.white.withOpacity(0.1),
          child: Text(client['name'].toString().substring(0, 1).toUpperCase(),
              style: const TextStyle(color: Colors.white)),
        ),
        title: Text(client['name'], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        subtitle: Text('Ficha ${client['sequenceNumber']} - ${client['visitTime'] ?? 'Sem horário'}', 
          style: TextStyle(color: Colors.white.withOpacity(0.7))),
        trailing: const Icon(Icons.chevron_right, color: Colors.white54),
      ),
    );
  }

  Widget _buildClientCard(Map<String, dynamic> client, {String outcome = 'PENDING'}) {
    final initials = client['name'].toString().substring(0, 1).toUpperCase();
    final clientId = client['id'] as String;
    final isSelected = _selectedClientIds.contains(clientId);
    final isCityClosed = client['cityClosedAt'] != null;

    final List sales = (client['sales'] is List) ? (client['sales'] as List) : [];
    final Map<String, dynamic>? firstSale = sales.isNotEmpty ? Map<String, dynamic>.from(sales.first) : null;
    final hasReceipt = firstSale != null && firstSale['receiptUrl'] != null && firstSale['receiptUrl'].toString().trim().isNotEmpty;

    final isSoldWithoutReceipt = sales.isNotEmpty && !hasReceipt;

    // Badges e cores
    Color cardBorderColor = const Color(0xFF4FC3F7);
    Widget badgeWidget;

    if (isCityClosed) {
      cardBorderColor = Colors.grey;
      badgeWidget = Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.grey.withOpacity(0.2),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: Colors.grey),
        ),
        child: const Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Icon(Icons.lock_rounded, size: 12, color: Colors.white70),
            Text('Cidade Fechada', style: TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    } else if (isSoldWithoutReceipt) {
      cardBorderColor = Colors.amberAccent;
      badgeWidget = Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.amber.withOpacity(0.2),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: Colors.amberAccent),
        ),
        child: const Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Icon(Icons.warning_amber_rounded, size: 12, color: Colors.amberAccent),
            Text('Comprovante Pendente', style: TextStyle(color: Colors.amberAccent, fontSize: 10, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    } else if (outcome == 'SOLD' || (sales.isNotEmpty && hasReceipt)) {
      cardBorderColor = const Color(0xFF00E676);
      badgeWidget = Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xFF00E676).withOpacity(0.2),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color(0xFF00E676)),
        ),
        child: const Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Icon(Icons.check_circle, size: 12, color: Color(0xFF00E676)),
            Text('Vendida', style: TextStyle(color: Color(0xFF00E676), fontSize: 10, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    } else if (outcome == 'NON_SALE') {
      cardBorderColor = const Color(0xFFFF9100);
      badgeWidget = Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xFFFF9100).withOpacity(0.2),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color(0xFFFF9100)),
        ),
        child: const Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Icon(Icons.replay_rounded, size: 12, color: Color(0xFFFF9100)),
            Text('Revisita', style: TextStyle(color: Color(0xFFFF9100), fontSize: 10, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    } else {
      cardBorderColor = const Color(0xFF4FC3F7);
      badgeWidget = Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: const Color(0xFF4FC3F7).withOpacity(0.2),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color(0xFF4FC3F7)),
        ),
        child: const Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 4,
          children: [
            Icon(Icons.access_time_rounded, size: 12, color: Color(0xFF4FC3F7)),
            Text('Pendente', style: TextStyle(color: Color(0xFF4FC3F7), fontSize: 10, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    }

    return LedCard(
      color: isSelected ? const Color(0xFFCE93D8) : cardBorderColor,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: isSelected ? const BorderSide(color: Color(0xFFCE93D8), width: 2) : BorderSide.none,
      ),
      child: Column(
        children: [
          ListTile(
            onTap: () {
              if (_selectedClientIds.isNotEmpty) {
                setState(() {
                  if (isSelected) {
                    _selectedClientIds.remove(clientId);
                  } else {
                    _selectedClientIds.add(clientId);
                  }
                });
              } else {
                _openClientDetail(client);
              }
            },
            onLongPress: () {
              setState(() {
                if (isSelected) {
                  _selectedClientIds.remove(clientId);
                } else {
                  _selectedClientIds.add(clientId);
                }
              });
            },
            leading: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Checkbox(
                  value: isSelected,
                  onChanged: (val) {
                    setState(() {
                      if (val == true) {
                        _selectedClientIds.add(clientId);
                      } else {
                        _selectedClientIds.remove(clientId);
                      }
                    });
                  },
                  activeColor: const Color(0xFFCE93D8),
                  checkColor: Colors.black,
                ),
                CircleAvatar(
                  backgroundColor: const Color(0xFF0288D1).withOpacity(0.2),
                  child: Text(initials, style: const TextStyle(color: Color(0xFF4FC3F7))),
                ),
              ],
            ),
            title: Text(
              client['name'] ?? 'Cliente',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      Text(
                        'Ficha ${client['sequenceNumber'] ?? ''} · ${client['city'] ?? ''}',
                        style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12),
                      ),
                      badgeWidget,
                    ],
                  ),
                  if (isSoldWithoutReceipt && firstSale != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.amber.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.amberAccent.withOpacity(0.4)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.receipt_long, color: Colors.amberAccent, size: 16),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Venda R\$ ${firstSale['value'] ?? '---'} registrada. Anexe o comprovante para finalizar!',
                              style: const TextStyle(color: Colors.amberAccent, fontSize: 11, fontWeight: FontWeight.w500),
                            ),
                          ),
                          const SizedBox(width: 6),
                          GestureDetector(
                            onTap: () => _openClientDetail(client),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.amberAccent,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text('Anexar', style: TextStyle(color: Colors.black, fontSize: 11, fontWeight: FontWeight.bold)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ] else if (outcome == 'SOLD' && firstSale != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Valor: R\$ ${firstSale['value'] ?? '---'}',
                      style: const TextStyle(color: Color(0xFF00E676), fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                  ],
                ],
              ),
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, color: Colors.white54),
                  color: const Color(0xFF2A2A3E),
                  onSelected: (val) async {
                    if (val == 'forcar_devolucao') {
                      final confirm = await showDialog<bool>(
                        context: context,
                        builder: (_) => AlertDialog(
                          backgroundColor: const Color(0xFF1A1A2E),
                          title: const Text('Forçar Devolução?', style: TextStyle(color: Colors.white)),
                          content: const Text('Isso devolverá a ficha ao administrador imediatamente. Deseja continuar?', style: TextStyle(color: Colors.white70)),
                          actions: [
                            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
                            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Devolver', style: TextStyle(color: Colors.orangeAccent))),
                          ],
                        ),
                      );
                      if (confirm == true) {
                        try {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Devolvendo ficha...')));
                          if (client['bookStatus'] == 'DISTRIBUTED_REBOLO') {
                            await ApiService().forceReturnRebolo(clientId);
                          } else {
                            await ApiService().forceReturn(clientId);
                          }
                          setState(() {
                            _sellerClients.remove(client);
                            _selectedClientIds.remove(clientId);
                            if (_foundClient != null && _foundClient!['id'] == client['id']) {
                              _foundClient = null;
                            }
                          });
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Ficha devolvida!'), backgroundColor: Colors.green));
                        } catch (e) {
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao devolver: $e'), backgroundColor: Colors.red));
                        }
                      }
                    }
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: 'forcar_devolucao',
                      child: Text('Forçar Devolução', style: TextStyle(color: Colors.orangeAccent)),
                    ),
                  ],
                ),
                const Icon(Icons.chevron_right_rounded, color: Colors.white54),
              ],
            ),
          ),
          if (outcome == 'NON_SALE' && !isCityClosed) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _openClientDetail(client),
                  icon: const Icon(Icons.attach_money_rounded, size: 16, color: Color(0xFF00E676)),
                  label: const Text('Registrar venda agora', style: TextStyle(color: Color(0xFF00E676), fontWeight: FontWeight.bold, fontSize: 12)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF00E676)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
