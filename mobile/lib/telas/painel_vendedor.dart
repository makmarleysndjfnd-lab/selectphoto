import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'tela_configuracoes.dart';
import 'tela_detalhes_cliente_vendedor.dart';
import 'tela_login.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'tela_cadastro_custos.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../servicos/servico_api.dart';

// ── Mock clients data ────────────────────────────────────────────────────────
final List<Map<String, dynamic>> _mockClients = [
  {
    'id': 'c001',
    'sequenceNumber': 'CF-EQP1-0001',
    'name': 'Maria Silva',
    'phone1': '11999990001',
    'street': 'Rua das Flores',
    'number': '123',
    'neighborhood': 'Centro',
    'city': 'São Paulo',
    'houseColor': 'Color(0xfff44336)',
    'visitTime': '14:30',
    'profession': 'Professora',
    'children': [
      {'name': 'Lucas', 'age': '5'},
      {'name': 'Ana', 'age': '2'},
    ],
  },
  {
    'id': 'c002',
    'sequenceNumber': 'CF-EQP1-0002',
    'name': 'João Costa',
    'phone1': '11999990002',
    'street': 'Av. Brasil',
    'number': '456',
    'neighborhood': 'Jardim América',
    'city': 'Campinas',
    'houseColor': 'Color(0xff2196f3)',
    'visitTime': '09:00',
    'profession': 'Engenheiro',
  },
  {
    'id': 'c003',
    'sequenceNumber': 'CF-EQP2-0001',
    'name': 'Ana Ferreira',
    'phone1': '11999990003',
    'street': 'Rua do Comércio',
    'number': '789',
    'neighborhood': 'Vila Nova',
    'city': 'Ribeirão Preto',
  },
  {
    'id': 'c004',
    'sequenceNumber': 'CF-EQP2-0002',
    'name': 'Carlos Mendes',
    'phone1': '11999990004',
    'street': 'Alameda Santos',
    'number': '321',
    'neighborhood': 'Bela Vista',
    'city': 'São Paulo',
  },
  {
    'id': 'c005',
    'sequenceNumber': 'CF-EQP1-0003',
    'name': 'Lucia Barbosa',
    'phone1': '11999990005',
    'street': 'Rua XV de Novembro',
    'number': '55',
    'neighborhood': 'Centro',
    'city': 'Sorocaba',
  },
];

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
  
  // Variáveis para Distribuição de Equipe e Trocas
  String? _selectedSellerForTransfer;
  final List<String> _teamSellers = ['João (Vendedor 1)', 'Maria (Vendedora 2)', 'Carlos (Vendedor 3)'];
  final Set<String> _selectedClientIds = {};
  
  Map<String, dynamic>? _foundClient;
  late AnimationController _animController;
  late Animation<double> _fadeAnim;
  DateTime _selectedDate = DateTime.now();

  int _unreadNotifs = 0;

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
  }

  Future<void> _checkManagerRole() async {
    final prefs = await SharedPreferences.getInstance();
    final role = prefs.getString('user_role');
    if (role == 'SELLER_MANAGER' && mounted) {
      setState(() {
        _isManager = true;
      });
    }
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

    final found = _mockClients.firstWhere(
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
    if (_searchQuery.isEmpty) return _mockClients;
    final q = _searchQuery.toLowerCase();
    return _mockClients.where((c) {
      return (c['name'] as String).toLowerCase().contains(q) ||
          (c['sequenceNumber'] as String).toLowerCase().contains(q) ||
          (c['city'] as String).toLowerCase().contains(q);
    }).toList();
  }

  void _showFechamentoCidadeDialog() {
    showDialog(
      context: context,
      builder: (context) {
        String _selectedSeller = 'João Vendedor';
        final List<String> _sellers = ['João Vendedor', 'Maria Vendedora', 'Carlos Vendedor'];
        return StatefulBuilder(
          builder: (context, setState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              title: const Text('Fechamento de Cidade', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Estatísticas do dia:', style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 12),
                  const Text('Total de Vendas: 0', style: TextStyle(color: Colors.white)),
                  const Text('Total Recebido (R\$): 0.00', style: TextStyle(color: Colors.white)),
                  const SizedBox(height: 16),
                  const Text('Vendedor Responsável:', style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 4),
                  DropdownButtonFormField<String>(
                    value: _selectedSeller,
                    dropdownColor: const Color(0xFF1A2535),
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: Colors.white.withOpacity(0.05),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                    ),
                    items: _sellers.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedSeller = val);
                    },
                  ),
                  const SizedBox(height: 16),
                  const Text('Atenção: Ao confirmar o fechamento, as fichas desta cidade serão bloqueadas e o relatório será enviado ao Admin.',
                      style: TextStyle(color: Colors.redAccent, fontSize: 12)),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white70)),
                ),
                ElevatedButton(
                  onPressed: () {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Fechamento enviado ao admin por $_selectedSeller.')));
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF4FC3F7)),
                  child: const Text('Confirmar Fechamento'),
                ),
              ],
            );
          }
        );
      },
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
                            title: Text('$senderName \u2794 Você', style: const TextStyle(color: Colors.white, fontSize: 14)),
                            subtitle: Text(notif['message'] ?? 'Notificação', style: const TextStyle(color: Colors.white70)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
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

  void _showTransferStockDialog(String itemType) async {
    final qtyController = TextEditingController();
    String? selectedRecipient;
    List<dynamic> recipients = [];
    bool isLoading = true;

    // Fetch users immediately
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return const Center(child: CircularProgressIndicator(color: Colors.orangeAccent));
      }
    );

    try {
      final api = ApiService();
      final users = await api.getCompanyUsers();
      recipients = users;
    } catch (e) {
      if (mounted) {
        Navigator.pop(context); // close loading
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar usuários: $e')));
      }
      return;
    }

    if (!mounted) return;
    Navigator.pop(context); // close loading

    final titleItem = itemType == 'COVER' ? 'Capas' : 'Books';

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setStateDialog) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              title: Text('Transferir $titleItem', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Selecione o destinatário e a quantidade para transferir:', style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: selectedRecipient,
                    hint: const Text('Destinatário', style: TextStyle(color: Colors.white54)),
                    dropdownColor: const Color(0xFF1A1A2E),
                    items: recipients.map((r) => DropdownMenuItem<String>(value: r['id'], child: Text(r['name'], style: const TextStyle(color: Colors.white)))).toList(),
                    onChanged: (val) {
                      setStateDialog(() {
                        selectedRecipient = val;
                      });
                    },
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: Colors.white.withOpacity(0.05),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white12)),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: qtyController,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'Quantidade',
                      labelStyle: const TextStyle(color: Colors.white54),
                      filled: true,
                      fillColor: Colors.white.withOpacity(0.05),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white70)),
                ),
                ElevatedButton(
                  onPressed: selectedRecipient == null ? null : () async {
                    final qty = int.tryParse(qtyController.text) ?? 0;
                    if (qty <= 0) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Quantidade inválida.')));
                      return;
                    }
                    Navigator.pop(context);
                    
                    try {
                      await ApiService().requestStockTransfer(selectedRecipient!, itemType, qty);
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Solicitação de transferência enviada!')));
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                      }
                    }
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.orangeAccent),
                  child: const Text('Confirmar', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
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
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Row(
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
              const SizedBox(width: 14),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Painel do Vendedor',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.bold)),
                    Text('Selecione um cliente para atender',
                        style: TextStyle(
                            color: Color(0xFF90CAF9), fontSize: 12)),
                  ],
                ),
              ),

              IconButton(
                onPressed: () {
                  _showNotificacoesVendedorDialog();
                },
                icon: _unreadNotifs > 0 
                  ? Badge(
                      label: Text(_unreadNotifs.toString()),
                      child: const Icon(Icons.notifications_active_rounded, color: Colors.orangeAccent),
                    )
                  : const Icon(Icons.notifications_none_rounded, color: Colors.white54),
                tooltip: 'Notificações',
              ),
              IconButton(
                onPressed: () => _showTransferStockDialog('COVER'),
                icon: const Icon(Icons.assignment_return_rounded, color: Colors.orangeAccent),
                tooltip: 'Transferir Capas',
              ),
              IconButton(
                onPressed: () => _showTransferStockDialog('BOOK'),
                icon: const Icon(Icons.menu_book_rounded, color: Colors.lightGreenAccent),
                tooltip: 'Transferir Books',
              ),
              IconButton(
                onPressed: () {
                  Navigator.push(context, MaterialPageRoute(
                    builder: (_) => const CostEntryScreen(),
                  ));
                },
                icon: const Icon(Icons.receipt_long_rounded, color: Color(0xFFCE93D8)),
                tooltip: 'Lançar Despesa',
              ),
              IconButton(
                icon: const Icon(Icons.settings, color: Colors.white70),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => const SettingsScreen(isFotografo: false),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Distribuição de Equipe', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
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
          DropdownButtonFormField<String>(
            value: _selectedSellerForTransfer,
            hint: const Text('Selecione o vendedor', style: TextStyle(color: Colors.white54)),
            dropdownColor: const Color(0xFF1A1A2E),
            items: _teamSellers.map((seller) {
              return DropdownMenuItem(
                value: seller,
                child: Text(seller, style: const TextStyle(color: Colors.white)),
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
          ElevatedButton.icon(
            onPressed: _selectedSellerForTransfer == null ? null : () {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Abrindo scanner para transferir para $_selectedSellerForTransfer...')));
              // Em produção, reutilizaria o MobileScanner para ler e atribuir ao vendedor
            },
            icon: const Icon(Icons.qr_code_scanner, color: Colors.white),
            label: const Text('Escanear e Repassar Book', style: TextStyle(color: Colors.white)),
            style: ElevatedButton.styleFrom(
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
              const Row(children: [
                Icon(Icons.qr_code_scanner_rounded,
                    color: Color(0xFF4FC3F7), size: 20),
                SizedBox(width: 8),
                Text('Buscar por código da ficha',
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 14)),
              ]),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Clientes do Dia',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold)),
            Text('${_filteredClients.length} fichas',
                style: const TextStyle(
                    color: Color(0xFF90CAF9), fontSize: 12)),
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
            hintText: 'Filtrar por nome ou ficha',
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
        const SizedBox(height: 16),
        ..._filteredClients.map((client) => _buildClientCard(client)),
        const SizedBox(height: 24),
        ElevatedButton.icon(
          onPressed: () {
            _showFechamentoCidadeDialog();
          },
          icon: const Icon(Icons.check_circle_outline, color: Colors.white),
          label: const Text('Fechamento de Cidade', style: TextStyle(color: Colors.white)),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFFCE93D8),
            minimumSize: const Size(double.infinity, 45),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ],
    );
  }

  Widget _buildAppointmentsSummaryCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF283593), Color(0xFF1976D2)],
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF1976D2).withOpacity(0.3),
            blurRadius: 10,
            spreadRadius: 1,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.event_note_rounded, color: Colors.white),
              const SizedBox(width: 8),
              const Text('Agendamentos de Hoje', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text('3', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text('10:00 - Ficha 4589 (João Silva)', style: TextStyle(color: Colors.white70, fontSize: 13)),
          const SizedBox(height: 4),
          const Text('14:30 - Ficha 4590 (Maria Sousa)', style: TextStyle(color: Colors.white70, fontSize: 13)),
          const SizedBox(height: 4),
          const Text('16:00 - Ficha 4595 (Carlos Maia)', style: TextStyle(color: Colors.white70, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildClientCard(Map<String, dynamic> client) {
    final initials = client['name'].toString().substring(0, 1).toUpperCase();
    final clientId = client['id'] as String;
    final isSelected = _selectedClientIds.contains(clientId);

    return Card(
      color: isSelected ? const Color(0xFFCE93D8).withOpacity(0.1) : Colors.white.withOpacity(0.05),
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: isSelected ? const BorderSide(color: Color(0xFFCE93D8)) : BorderSide.none,
      ),
      child: ListTile(
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
        title: Text(client['name'], style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        subtitle: Text('Ficha ${client['sequenceNumber']}', style: TextStyle(color: Colors.white.withOpacity(0.7))),
        trailing: const Icon(Icons.chevron_right_rounded, color: Colors.white54),
      ),
    );
  }
}
