import 'package:flutter/material.dart';
import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'package:provider/provider.dart';
import 'tela_configuracoes.dart';
import 'package:http/http.dart' as http;
import 'package:fl_chart/fl_chart.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'tela_login.dart';
import 'tela_sincronizacao.dart' as tela_sincronizacao;
import 'visao_frota_admin.dart';
import 'visao_fluxo_caixa_admin.dart';
import 'tela_cadastro_custos.dart';
import 'tela_gerenciamento_funcionarios.dart';
import 'tela_gerenciamento_equipes.dart';
import 'visao_prospectos_ia.dart';
import 'visao_fechamento_admin.dart';
import 'visao_estoque_admin.dart';
import '../utils/pdf_generator.dart';

import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import '../servicos/ajudante_bd.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

// ── Constantes visuais ────────────────────────────────────────────────────────
const _chartGreen = Color(0xFF43A047);
const _accentPurple = Color(0xFF9C27B0);

// ── Mock: Métricas de vendas ──────────────────────────────────────────────────
final _months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'];

final _teamData = [
  {
    'team': 'Equipe 1 — SP',
    'code': 'EQP1',
    'color': const Color(0xFFAB47BC),
    'sellers': [
      {
        'name': 'Carlos Lima',
        'sales': 42, 'avg': 380.0, 'nonSales': 8,
        'monthlySales': [8, 10, 13, 16, 20, 17],
      },
      {
        'name': 'Fernanda Reis',
        'sales': 37, 'avg': 410.0, 'nonSales': 5,
        'monthlySales': [10, 12, 15, 19, 22, 21],
      },
    ],
    'monthlySales': [18, 22, 28, 35, 42, 38],
    'monthlyNonSales': [4, 5, 7, 6, 8, 5],
  },
  {
    'team': 'Equipe 2 — Campinas',
    'code': 'EQP2',
    'color': const Color(0xFF7E57C2),
    'sellers': [
      {
        'name': 'Bruno Alves',
        'sales': 31, 'avg': 355.0, 'nonSales': 11,
        'monthlySales': [5, 8, 10, 13, 18, 20],
      },
      {
        'name': 'Marina Souza',
        'sales': 45, 'avg': 425.0, 'nonSales': 4,
        'monthlySales': [7, 10, 14, 17, 20, 25],
      },
    ],
    'monthlySales': [12, 18, 24, 30, 38, 45],
    'monthlyNonSales': [6, 8, 9, 7, 5, 4],
  },
  {
    'team': 'Equipe 3 — Ribeirão',
    'code': 'EQP3',
    'color': const Color(0xFF5C6BC0),
    'sellers': [
      {
        'name': 'Patrícia Nunes',
        'sales': 28, 'avg': 370.0, 'nonSales': 9,
        'monthlySales': [8, 12, 16, 22, 25, 28],
      },
    ],
    'monthlySales': [8, 12, 16, 22, 25, 28],
    'monthlyNonSales': [5, 7, 8, 6, 10, 9],
  },
];


// ── Mock: Estoque não-vendas ──────────────────────────────────────────────────


// ── AdminDashboard ────────────────────────────────────────────────────────────
class AdminDashboard extends StatefulWidget {
  const AdminDashboard({super.key});

  @override
  State<AdminDashboard> createState() => _AdminDashboardState();
}

class _AdminDashboardState extends State<AdminDashboard>
    with TickerProviderStateMixin {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  int _navIndex = 7; // Fechamentos is default agora
  // métricas
  int _selectedMonth = 5;
  int _selectedTeam = 0;
  List<Map<String, dynamic>> _allClients = [];
  List<dynamic> _upcomingEvents = [];
  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  // Mock Rotas Inteligentes -> Nova Estrutura
  List<Map<String, dynamic>> _rotasManuais = [];
  List<Map<String, dynamic>> _booksNaoAtribuidos = [];
  Set<String> _pendingReleaseCities = {};

  final Map<String, List<Map<String, dynamic>>> _booksDistribuidos = {};
  
  List<Map<String, dynamic>> _realPhotoEvents = [];

  List<Map<String, dynamic>> _rotasRebolo = [];
  List<Map<String, dynamic>> _rebolosNaoAtribuidos = [];
  List<Map<String, dynamic>> _pendingReleaseBatches = [];

  final Map<String, List<Map<String, dynamic>>> _rebolosDistribuidos = {};

  List<String> get _todosVendedores {
    List<String> list = [];
    for (var team in _teamData) {
      for (var seller in team['sellers'] as List) {
        list.add(seller['name']);
      }
    }
    return list;
  }

  int _unreadNotifs = 0;

  Future<void> _loadClients() async {
    try {
      final api = ApiService();
      
      // Fetch rebolos first
      final rebolos = await api.getRebolos();
      final Set<String> reboloIds = rebolos.map((r) => r['id'].toString()).toSet();
      
      final clients = await api.getAllClients();
      if(mounted) setState(() => _allClients = List<Map<String, dynamic>>.from(clients));

      final pendingBatches = await api.getPendingBookBatches();
      if(mounted) setState(() => _pendingReleaseBatches = List<Map<String, dynamic>>.from(pendingBatches));
      
      final Map<String, List<Map<String, dynamic>>> cityGroups = {};
      final List<Map<String, dynamic>> unassigned = [];
      final Set<String> unreleased = {};
      
      // Map photographerId -> List of books
      final Map<String, List<Map<String, dynamic>>> photographerBooks = {};
      final Map<String, List<Map<String, dynamic>>> distributedBooks = {};

      for (var client in clients) {
        if (reboloIds.contains(client['id'].toString())) continue;

        final b = {
          'id': client['id'], 
          'ficha': client['sequenceNumber'] ?? 'S/N', 
          'lote': 'N/A', 
          'qr': client['sequenceNumber'] ?? 'S/N', 
          'cliente': client['name'] ?? 'Cliente',
          'city': client['city'],
          'photographerId': client['photographerId'],
          'rawClientData': client,
        };

        final assignedSeller = client['assignedSeller']?['name'];
        if (assignedSeller != null) {
          if (!distributedBooks.containsKey(assignedSeller)) {
            distributedBooks[assignedSeller] = [];
          }
          distributedBooks[assignedSeller]!.add(b);
        } else {
          final pId = client['photographer']?['name'] ?? 'Equipe Desconhecida';
        if (!photographerBooks.containsKey(pId)) {
          photographerBooks[pId] = [];
        }
        photographerBooks[pId]!.add(b);
        
        final city = client['city'];
        final isReleased = client['releasedForRouting'] == true;

        if (city == null || city.toString().trim().isEmpty) {
          if (isReleased) {
            unassigned.add(b);
          }
        } else {
          if (!isReleased) {
            unreleased.add(city);
            continue; // do not add to routing yet
          }
          if (!cityGroups.containsKey(city)) {
            cityGroups[city] = [];
          }
          cityGroups[city]!.add(b);
        }
        }
      }
      
      final List<Map<String, dynamic>> routes = [];
      for (var entry in cityGroups.entries) {
        if (entry.value.length >= 5) {
          routes.add({
            'id': 'r_${entry.key}',
            'title': entry.key,
            'books': entry.value,
          });
        } else {
          unassigned.addAll(entry.value);
        }
      }
      
      final List<Map<String, dynamic>> realEvents = [];
      int colorIndex = 0;
      final colors = [const Color(0xFFAB47BC), const Color(0xFF7E57C2), const Color(0xFF5C6BC0), const Color(0xFF4FC3F7)];
      
      for (var entry in photographerBooks.entries) {
        final teamColor = colors[colorIndex % colors.length];
        
        // Group books by event/city for this photographer
        final Map<String, int> eventCounts = {};
        for (var b in entry.value) {
          final city = b['city'] ?? 'Sem Cidade';
          eventCounts[city] = (eventCounts[city] ?? 0) + 1;
        }
        
        final List<Map<String, dynamic>> events = [];
        for (var ev in eventCounts.entries) {
          events.add({
            'event': 'Produção em ${ev.key}',
            'city': ev.key,
            'photos': ev.value,
          });
        }
        
        realEvents.add({
          'team': entry.key,
          'code': entry.key.substring(0, entry.key.length > 3 ? 3 : entry.key.length).toUpperCase(),
          'color': teamColor,
          'events': events,
        });
        
        colorIndex++;
      }

      final List<Map<String, dynamic>> rebolosUnassigned = [];
      final Map<String, List<Map<String, dynamic>>> rebolosCityGroups = {};
      final Map<String, List<Map<String, dynamic>>> rebolosDistributed = {};

      for (var client in rebolos) {
        final b = {
          'id': client['id'], 
          'ficha': client['sequenceNumber'] ?? 'S/N', 
          'lote': 'N/A', 
          'qr': client['sequenceNumber'] ?? 'S/N', 
          'cliente': client['name'] ?? 'Cliente',
          'city': client['city'],
          'photographerId': client['photographerId'],
          'rawClientData': client,
        };

        final assignedSeller = client['assignedSeller']?['name'];
        if (assignedSeller != null) {
          if (!rebolosDistributed.containsKey(assignedSeller)) {
            rebolosDistributed[assignedSeller] = [];
          }
          rebolosDistributed[assignedSeller]!.add(b);
        } else {
          final city = client['city'];
          if (city == null || city.toString().trim().isEmpty) {
            rebolosUnassigned.add(b);
          } else {
            if (!rebolosCityGroups.containsKey(city)) {
              rebolosCityGroups[city] = [];
            }
            rebolosCityGroups[city]!.add(b);
          }
        }
      }

      final List<Map<String, dynamic>> rRoutes = [];
      for (var entry in rebolosCityGroups.entries) {
        rRoutes.add({
          'id': 'rr_${entry.key}',
          'title': '${entry.key} (Revisitas)',
          'books': entry.value,
        });
      }

      if (mounted) {
        setState(() {
          _booksNaoAtribuidos = unassigned;
          _rotasManuais = routes;
          _pendingReleaseCities = unreleased;
          _realPhotoEvents = realEvents;
          
          _booksDistribuidos.clear();
          _booksDistribuidos.addAll(distributedBooks);
          
          _rebolosDistribuidos.clear();
          _rebolosDistribuidos.addAll(rebolosDistributed);
          
          _rotasRebolo = rRoutes;
          _rebolosNaoAtribuidos = rebolosUnassigned;
        });
      }
    } catch (e) {
      debugPrint('Erro ao carregar clientes: $e');
    }
  }

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _fadeAnim =
        CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
    _loadUpcomingEvents();
    _fetchUnreadNotifications();
    _loadClients();
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

  Future<void> _loadUpcomingEvents() async {
    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final events = await api.getUpcomingEvents();
      if (mounted) setState(() => _upcomingEvents = events);
    } catch (e) {
      print('Erro ao carregar alertas de eventos: $e');
    }
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _currentTeam => _teamData[_selectedTeam];
  double get _totalSales => (_currentTeam['sellers'] as List)
      .fold(0.0, (s, v) => s + (v['sales'] as int) * (v['avg'] as double));
  double get _avgTicket {
    final sellers = _currentTeam['sellers'] as List;
    return sellers.fold(0.0, (s, v) => s + (v['avg'] as double)) /
        sellers.length;
  }
  int get _totalSalesCount => (_currentTeam['sellers'] as List)
      .fold(0, (s, v) => s + (v['sales'] as int));

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth > 800;
        
        return Scaffold(
          key: _scaffoldKey,
          drawer: !isDesktop ? Drawer(child: _buildSideMenu()) : null,
          backgroundColor: const Color(0xFF0D0D1A),
          body: Row(
            children: [
              if (isDesktop) _buildSideMenu(),
              Expanded(
                child: FadeTransition(
                  opacity: _fadeAnim,
                  child: Column(
                    children: [
                      _buildHeader(isDesktop: isDesktop),
                      Expanded(child: _buildBody()),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      }
    );
  }

  Widget _buildSideMenu() {
    return Container(
      width: 250,
      color: const Color(0xFF1A0030),
      child: Column(
        children: [
          const SizedBox(height: 40),
          const Icon(Icons.admin_panel_settings_rounded, color: Color(0xFFCE93D8), size: 48),
          const SizedBox(height: 16),
          const Text('Central Fotográfica', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          const Text('Admin Web', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 14)),
          const SizedBox(height: 20),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    title: const Text('OPERAÇÕES E PRODUTOS', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12, fontWeight: FontWeight.bold)),
                    initiallyExpanded: true,
                    iconColor: const Color(0xFF90CAF9),
                    collapsedIconColor: const Color(0xFF90CAF9),
                    children: [
                      _sideMenuItem(7, Icons.account_balance_wallet_rounded, 'Fechamentos'),
                      _sideMenuItem(0, Icons.auto_awesome, 'Eventos IA'),
                      _sideMenuItem(1, Icons.menu_book_rounded, 'Books'),
                      _sideMenuItem(2, Icons.inventory_2_rounded, 'rebolo'),
                      _sideMenuItem(8, Icons.layers_rounded, 'Capas'),
                    ],
                  ),
                ),
                
                const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Divider(color: Colors.white12, height: 1)),
                
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    title: const Text('FINANCEIRO E SAÚDE', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12, fontWeight: FontWeight.bold)),
                    iconColor: const Color(0xFF90CAF9),
                    collapsedIconColor: const Color(0xFF90CAF9),
                    children: [
                      _sideMenuItem(4, Icons.attach_money_rounded, 'Financeiro e Saúde'),
                      ListTile(
                        leading: const Icon(Icons.money_off, color: Color(0xFFE57373)),
                        title: const Text('Despesas', style: TextStyle(color: Color(0xFFE57373))),
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CostEntryScreen())),
                      ),
                    ],
                  ),
                ),

                const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Divider(color: Colors.white12, height: 1)),

                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    title: const Text('RH E LOGÍSTICA', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12, fontWeight: FontWeight.bold)),
                    iconColor: const Color(0xFF90CAF9),
                    collapsedIconColor: const Color(0xFF90CAF9),
                    children: [
                      _sideMenuItem(5, Icons.people_alt_rounded, 'Funcionários'),
                      _sideMenuItem(3, Icons.directions_car_rounded, 'Frota'),
                                            ListTile(
                          leading: const Icon(Icons.group_work_rounded, color: Color(0xFFCE93D8)),
                          title: const Text('Equipes', style: TextStyle(color: Color(0xFFCE93D8))),
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TelaGerenciamentoEquipes())),
                        ),
],
                  ),
                ),
              ],
            ),
          ),
          const Divider(color: Colors.white12, height: 1),
          ListTile(
            leading: const Icon(Icons.logout_rounded, color: Color(0xFFCE93D8)),
            title: const Text('Sair', style: TextStyle(color: Color(0xFFCE93D8))),
            onTap: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen())),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  void _showNotificacoesDialog() {
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
                            title: Text('$senderName \u2794 Admin', style: const TextStyle(color: Colors.white, fontSize: 14)),
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
      }
    );
  }

  
  void _printUnidadeBluetooth(Map<String, dynamic> ficha) async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhuma impressora conectada! Vá nas configurações.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
      return;
    }

    final seq = ficha['ficha'] ?? 'S/N';
    final city = ficha['city'] ?? 'Sem Cidade';
    final eventName = ficha['cliente'] ?? 'Evento Desconhecido';
    
    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FICHA UNICA", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Ficha: $seq", 2, 1);
    bluetooth.printCustom("Evento: $eventName", 1, 1);
    bluetooth.printCustom("Cidade: $city", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("_________________________________", 0, 1);
    bluetooth.printCustom("Obrigado!", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printNewLine();
    bluetooth.printNewLine();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Imprimindo ticket...', style: TextStyle(color: Colors.white)), backgroundColor: Colors.green));
    }
  }

  void _showReceiveReturnDialog() {
    final _codeCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Receber Devolução de Book', style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('O book será re-cadastrado no estoque para Rebolo.', style: TextStyle(color: Colors.white70)),
            const SizedBox(height: 16),
            TextField(
              controller: _codeCtrl,
              style: const TextStyle(color: Colors.white),
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'Código da Ficha',
                labelStyle: TextStyle(color: Colors.white54),
                enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            onPressed: () async {
              final code = _codeCtrl.text.trim();
              if (code.isEmpty) return;
              Navigator.pop(ctx);
              try {
                await ApiService().receiveReturnedBook(code);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Devolução registrada. Book no estoque!'), backgroundColor: Colors.green));
                  _loadClients();
                }
              } catch(e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: ' + e.toString()), backgroundColor: Colors.red));
                }
              }
            },
            child: const Text('Confirmar'),
          )
        ],
      )
    );
  }

    Widget _sideMenuItem(int index, IconData icon, String label) {
    final selected = _navIndex == index;
    return ListTile(
      leading: Icon(icon, color: selected ? const Color(0xFFCE93D8) : const Color(0xFF546E7A)),
      title: Text(label, style: TextStyle(color: selected ? Colors.white : const Color(0xFF546E7A), fontWeight: selected ? FontWeight.bold : FontWeight.normal)),
      selected: selected,
      selectedTileColor: const Color(0xFFCE93D8).withOpacity(0.1),
      onTap: () {
        setState(() => _navIndex = index);
        if (_scaffoldKey.currentState?.isDrawerOpen == true) {
          Navigator.pop(context);
        }
      },
    );
  }
  

  // ── Header ─────────────────────────────────────────────────────────────────
  Widget _buildHeader({bool isDesktop = false}) {
    const tabs = ['Eventos IA', 'Books', 'rebolo', 'Frota', 'Caixa', 'Funcionários', 'Saúde', 'Fechamentos', 'Capas'];
    const icons = [
      Icons.auto_awesome,
      Icons.menu_book_rounded,
      Icons.inventory_2_rounded,
      Icons.directions_car_rounded,
      Icons.attach_money_rounded,
      Icons.people_alt_rounded,
      Icons.bar_chart_rounded,
      Icons.account_balance_wallet_rounded,
      Icons.layers_rounded
    ];
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1A0030), Color(0xFF3A0068), Color(0xFF1A0030)],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  if (!isDesktop)
                    IconButton(
                      icon: const Icon(Icons.menu, color: Colors.white),
                      onPressed: () => _scaffoldKey.currentState?.openDrawer(),
                    ),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [Color(0xFFCE93D8), Color(0xFF9C27B0)]),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [
                        BoxShadow(
                            color: _accentPurple.withOpacity(0.5),
                            blurRadius: 14,
                            offset: const Offset(0, 4)),
                      ],
                    ),
                    child: const Icon(Icons.admin_panel_settings_rounded,
                        color: Colors.white, size: 22),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Painel Administrativo',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 17,
                                fontWeight: FontWeight.bold)),
                        Text('Visão completa das equipes',
                            style: TextStyle(
                                color: Color(0xFFCE93D8), fontSize: 12)),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const tela_sincronizacao.SyncScreen()));
                    },
                    icon: Consumer<SyncService>(
                      builder: (context, sync, child) {
                        return Stack(
                          alignment: Alignment.center,
                          children: [
                            const Icon(Icons.cloud_sync, color: Color(0xFFCE93D8)),
                            if (sync.pendingRequests.isNotEmpty)
                              Positioned(
                                right: 0,
                                top: 0,
                                child: Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: const BoxDecoration(
                                    color: Colors.red,
                                    shape: BoxShape.circle,
                                  ),
                                  constraints: const BoxConstraints(minWidth: 12, minHeight: 12),
                                  child: Text(
                                    '${sync.pendingRequests.length}',
                                    style: const TextStyle(color: Colors.white, fontSize: 8),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              ),
                          ],
                        );
                      }
                    ),
                    tooltip: 'Backups Offline',
                  ),
                  IconButton(
                    onPressed: () {
                      _showNotificacoesDialog();
                    },
                    icon: _unreadNotifs > 0 
                      ? Badge(
                          label: Text(_unreadNotifs.toString()),
                          child: const Icon(Icons.notifications_active_rounded, color: Colors.orangeAccent),
                        )
                      : const Icon(Icons.notifications_none_rounded, color: Colors.white54),
                    tooltip: 'Notificações',
                  ),
                  if (!isDesktop) // Hide logout button in header on desktop, since it's in the side menu
                    IconButton(
                      onPressed: () => Navigator.of(context).pushReplacement(
                          MaterialPageRoute(
                              builder: (_) => const LoginScreen())),
                      icon: const Icon(Icons.logout_rounded,
                          color: Color(0xFFCE93D8)),
                      tooltip: 'Sair',
                    ),
                ],
              ),
            ),
            // Removed sub-tabs as per user request to 'tirar a parte que fica rolando'
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_navIndex) {
      case 0:
        return const StateProspectsView();
      case 1:
        return _buildPhotosTab();
      case 2:
        return _buildStockTab();
      case 3:
        return const FleetAdminView();
      case 4:
        return const CashFlowAdminView();
      case 5:
        return const EmployeeManagementScreen();
      case 7:
        return const VisaoFechamentoAdmin();
      case 8:
        return const VisaoEstoqueAdmin();
      default:
        return const VisaoFechamentoAdmin();
    }
  }



  // ══════════════════════════════════════════════════════════════════════════
  // ABA 1 — MÉTRICAS
  // ══════════════════════════════════════════════════════════════════════════
  Widget _buildMetricsTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_upcomingEvents.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(bottom: 20),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.redAccent.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.redAccent),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 30),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Atenção: Eventos Favoritos Próximos!', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold, fontSize: 16)),
                        const SizedBox(height: 4),
                        Text('Você possui ${_upcomingEvents.length} evento(s) que ocorrerão nos próximos 5 dias.', style: const TextStyle(color: Colors.white70)),
                      ],
                    ),
                  ),
                  ElevatedButton(
                    onPressed: () => setState(() => _navIndex = 0), // Go to IA Events
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
                    child: const Text('Ver', style: TextStyle(color: Colors.white)),
                  )
                ],
              ),
            ),
          _buildTeamSelector(),
          const SizedBox(height: 20),
          _buildSummaryCards(),
          const SizedBox(height: 24),
          _buildChart(),
          const SizedBox(height: 24),
          _buildSellersTable(),
          const SizedBox(height: 24),
          _buildSalesVsNonSales(),
          const SizedBox(height: 20),
          _buildRotasInteligentes(),
          const SizedBox(height: 20),

        ],
      ),
    );
  }

  Widget _buildTeamSelector() {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _teamData.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final t = _teamData[i];
          final selected = _selectedTeam == i;
          final color = t['color'] as Color;
          return GestureDetector(
            onTap: () => setState(() => _selectedTeam = i),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding:
                  const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
              decoration: BoxDecoration(
                gradient: selected
                    ? LinearGradient(
                        colors: [color.withOpacity(0.8), color])
                    : null,
                color: selected ? null : const Color(0xFF1A1A2E),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                    color: selected
                        ? color
                        : Colors.white.withOpacity(0.1)),
                boxShadow: selected
                    ? [
                        BoxShadow(
                            color: color.withOpacity(0.4),
                            blurRadius: 10,
                            offset: const Offset(0, 4))
                      ]
                    : null,
              ),
              child: Text(
                t['code'] as String,
                style: TextStyle(
                  color: selected
                      ? Colors.white
                      : const Color(0xFF90CAF9),
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSummaryCards() {
    final color = _currentTeam['color'] as Color;
    return Row(children: [
      Expanded(
          child: _miniCard(
              'Total Vendas',
              'R\$ ${_totalSales.toStringAsFixed(0)}',
              Icons.attach_money_rounded,
              color)),
      const SizedBox(width: 10),
      Expanded(
          child: _miniCard(
              'Ticket Médio',
              'R\$ ${_avgTicket.toStringAsFixed(0)}',
              Icons.receipt_long_rounded,
              const Color(0xFF7E57C2))),
      const SizedBox(width: 10),
      Expanded(
          child: _miniCard('Qtd. Vendas', '$_totalSalesCount',
              Icons.trending_up_rounded, const Color(0xFF66BB6A))),
    ]);
  }

  Widget _miniCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(height: 8),
          Text(value,
              style: TextStyle(
                  color: color,
                  fontSize: 16,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(
                  color: Color(0xFF90CAF9), fontSize: 10)),
        ],
      ),
    );
  }

  Widget _buildChart() {
    final team = _currentTeam;
    final sales = team['monthlySales'] as List<int>;
    final nonSales = team['monthlyNonSales'] as List<int>;
    const color = _chartGreen;
    final maxVal = sales.reduce((a, b) => a > b ? a : b).toDouble();

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Vendas por Mês — ${team['team']}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                  const SizedBox(height: 4),
                  Row(children: [
                    _legendDot(color, 'Vendas'),
                    const SizedBox(width: 12),
                    _legendDot(const Color(0xFFEF5350), 'Não-Vendas'),
                  ]),
                ],
              ),
              DropdownButton<int>(
                value: _selectedMonth,
                dropdownColor: const Color(0xFF1A1A2E),
                style: const TextStyle(
                    color: Color(0xFFCE93D8), fontSize: 12),
                underline: const SizedBox(),
                items: List.generate(
                    _months.length,
                    (i) => DropdownMenuItem(
                        value: i, child: Text(_months[i]))),
                onChanged: (v) =>
                    setState(() => _selectedMonth = v ?? 5),
              ),
            ],
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 200,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(_months.length, (i) {
                final isSelected = i == _selectedMonth;
                final barHeight =
                    maxVal > 0 ? (sales[i] / maxVal) * 120 : 0.0;
                final nsHeight =
                    maxVal > 0 ? (nonSales[i] / maxVal) * 120 : 0.0;
                return GestureDetector(
                  onTap: () => setState(() => _selectedMonth = i),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (isSelected)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: color,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text('${sales[i]}',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold)),
                        ),
                      const SizedBox(height: 4),
                      Stack(
                        alignment: Alignment.bottomCenter,
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 400),
                            curve: Curves.easeOut,
                            width: 26,
                            height: barHeight + nsHeight,
                            decoration: BoxDecoration(
                              color: const Color(0xFFEF5350)
                                  .withOpacity(0.5),
                              borderRadius: BorderRadius.circular(6),
                            ),
                          ),
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 400),
                            curve: Curves.easeOut,
                            width: 26,
                            height: barHeight,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.bottomCenter,
                                end: Alignment.topCenter,
                                colors: isSelected
                                    ? [color, color.withOpacity(0.7)]
                                    : [
                                        color.withOpacity(0.5),
                                        color.withOpacity(0.3)
                                      ],
                              ),
                              borderRadius: BorderRadius.circular(6),
                              boxShadow: isSelected
                                  ? [
                                      BoxShadow(
                                          color: color.withOpacity(0.5),
                                          blurRadius: 8)
                                    ]
                                  : null,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(_months[i],
                          style: TextStyle(
                              color: isSelected
                                  ? color
                                  : const Color(0xFF546E7A),
                              fontSize: 10,
                              fontWeight: isSelected
                                  ? FontWeight.bold
                                  : FontWeight.normal)),
                    ],
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(children: [
      Container(
          width: 8,
          height: 8,
          decoration:
              BoxDecoration(color: color, shape: BoxShape.circle)),
      const SizedBox(width: 4),
      Text(label,
          style: const TextStyle(
              color: Color(0xFF90CAF9), fontSize: 11)),
    ]);
  }

  Widget _buildSellersTable() {
    final sellers = _currentTeam['sellers'] as List;
    final color = _currentTeam['color'] as Color;
    final monthLabel = _months[_selectedMonth];

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Desempenho por Vendedor — ${_currentTeam['team']}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 13)),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: _chartGreen.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: _chartGreen.withOpacity(0.4)),
                ),
                child: Text(monthLabel,
                    style: const TextStyle(
                        color: _chartGreen,
                        fontSize: 11,
                        fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Table(
            columnWidths: const {
              0: FlexColumnWidth(2.2),
              1: FlexColumnWidth(1.0),
              2: FlexColumnWidth(1.4),
              3: FlexColumnWidth(1.6),
              4: FlexColumnWidth(1.0),
            },
            children: [
              TableRow(
                decoration: BoxDecoration(
                  border: Border(
                      bottom: BorderSide(
                          color: Colors.white.withOpacity(0.1))),
                ),
                children: [
                  _tableHeader('Vendedor'),
                  _tableHeader('Vendas'),
                  _tableHeader('Ticket Médio'),
                  _tableHeader('Total Mês'),
                  _tableHeader('Recusas'),
                ],
              ),
              ...sellers.map((s) {
                final monthSales =
                    (s['monthlySales'] as List<int>)[_selectedMonth];
                final avg = s['avg'] as double;
                final totalMes = monthSales * avg;
                return TableRow(children: [
                  _tableCell(s['name'], isName: true),
                  _tableCell('$monthSales',
                      color: const Color(0xFF66BB6A)),
                  _tableCell('R\$ ${avg.toStringAsFixed(0)}',
                      color: color),
                  _tableCell(
                      'R\$ ${totalMes.toStringAsFixed(0)}',
                      color: _chartGreen),
                  _tableCell('${s['nonSales']}',
                      color: const Color(0xFFEF5350)),
                ]);
              }),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tableHeader(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(text,
          style: const TextStyle(
              color: Color(0xFF90CAF9),
              fontSize: 11,
              fontWeight: FontWeight.bold)),
    );
  }

  Widget _tableCell(String text,
      {Color? color, bool isName = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Text(text,
          style: TextStyle(
              color: color ?? Colors.white,
              fontSize: isName ? 12 : 13,
              fontWeight:
                  isName ? FontWeight.normal : FontWeight.bold)),
    );
  }

  Widget _buildSalesVsNonSales() {
    final month = _months[_selectedMonth];
    final sales =
        (_currentTeam['monthlySales'] as List<int>)[_selectedMonth];
    final nonSales =
        (_currentTeam['monthlyNonSales'] as List<int>)[_selectedMonth];
    final total = sales + nonSales;
    final color = _currentTeam['color'] as Color;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Vendas × Não-Vendas — $month',
              style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 13)),
          const SizedBox(height: 6),
          Text('Equipe: ${_currentTeam['team']}',
              style: const TextStyle(
                  color: Color(0xFF90CAF9), fontSize: 11)),
          const SizedBox(height: 20),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Row(children: [
              Flexible(
                flex: sales,
                child: Container(height: 14, color: color),
              ),
              Flexible(
                flex: nonSales == 0 ? 1 : nonSales,
                child: Container(
                    height: 14,
                    color:
                        const Color(0xFFEF5350).withOpacity(0.7)),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                  child: _numberStat('Vendas', '$sales', color)),
              Expanded(
                  child: _numberStat('Não-Vendas', '$nonSales',
                      const Color(0xFFEF5350))),
              Expanded(
                  child: _numberStat('Total Atend.', '$total',
                      const Color(0xFF90CAF9))),
              Expanded(
                  child: _numberStat(
                      'Conv. %',
                      total > 0
                          ? '${(sales / total * 100).toStringAsFixed(0)}%'
                          : '0%',
                      const Color(0xFF66BB6A))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _numberStat(String label, String value, Color color) {
    return Column(children: [
      Text(value,
          style: TextStyle(
              color: color,
              fontSize: 20,
              fontWeight: FontWeight.bold)),
      const SizedBox(height: 2),
      Text(label,
          style: const TextStyle(
              color: Color(0xFF90CAF9), fontSize: 11),
          textAlign: TextAlign.center),
    ]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ABA 2 — books POR EQUIPE
  // ══════════════════════════════════════════════════════════════════════════
  
  int get _totalBooksProduced => _allClients.length;
  int get _booksAguardando => _allClients.where((c) => c['releasedForRouting'] != true).length;
  int get _booksLiberados => _allClients.where((c) => c['releasedForRouting'] == true).length;

  Widget _buildResumoGeralProducao() {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Resumo de Produção (Geral)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _infoBoxProducao('Total Produzido', '$_totalBooksProduced', Colors.blueAccent),
              _infoBoxProducao('Aguardando Rota', '$_booksAguardando', Colors.orangeAccent),
              _infoBoxProducao('Liberado p/ Rota', '$_booksLiberados', Colors.greenAccent),
            ],
          )
        ],
      )
    );
  }

  Widget _infoBoxProducao(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ],
    );
  }

  Widget _buildListaTodosBooks() {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Todos os Books Produzidos', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_allClients.isEmpty)
            const Text('Nenhum book foi produzido ainda.', style: TextStyle(color: Colors.white54)),
          ..._allClients.map((c) {
            final name = c['name'] ?? 'Sem Nome';
            final city = c['city'] ?? 'Sem Cidade';
            final seq = c['sequenceNumber'] ?? 'S/N';
            final isReleased = c['releasedForRouting'] == true;

            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.menu_book, color: Colors.white),
                ),
                title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Ficha: $seq | Cidade: $city', style: const TextStyle(color: Colors.white70)),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: isReleased ? Colors.green.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    isReleased ? 'Liberado' : 'Aguardando',
                    style: TextStyle(
                      color: isReleased ? Colors.greenAccent : Colors.orangeAccent,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  
  Widget _buildFechamentoFotografosLive() {
    // Agrupa todos os clientes por fotografo
    final Map<String, String> photographerNames = {};
    final Map<String, int> liveCounts = {};
    final Map<String, int> closedCounts = {};

    for (var c in _allClients) {
      if (c['photographerId'] == null) continue;
      final pid = c['photographerId'];
      final name = c['photographer'] != null ? (c['photographer']['name'] ?? 'Sem Nome') : 'Sem Nome';
      final status = c['bookStatus'];

      photographerNames[pid] = name;
      
      if (status == 'CREATED') {
        liveCounts[pid] = (liveCounts[pid] ?? 0) + 1;
      } else if (status == 'AWAITING_RELEASE') {
        closedCounts[pid] = (closedCounts[pid] ?? 0) + 1;
      }
    }

    final pids = photographerNames.keys.toList();

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Produção ao Vivo (Fotógrafos)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (pids.isEmpty)
            const Text('Nenhuma produção recente registrada.', style: TextStyle(color: Colors.white54)),
          ...pids.map((pid) {
            final name = photographerNames[pid]!;
            final live = liveCounts[pid] ?? 0;
            final closed = closedCounts[pid] ?? 0;
            
            if (live == 0 && closed == 0) return const SizedBox.shrink();

            return Card(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.camera_alt_outlined, color: Colors.white),
                ),
                title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (live > 0)
                      Text('$live fichas', style: const TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold)),
                    if (closed > 0)
                      Text('Total: $closed fichas (Finalizado)', style: const TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildPhotosTab() {
    int totalGeral = 0;
    for (final team in _realPhotoEvents) {
      for (final e in team['events'] as List) {
        totalGeral += e['photos'] as int;
      }
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          
            if (_pendingReleaseBatches.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.orangeAccent),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.hourglass_top_rounded, color: Colors.orangeAccent, size: 24),
                        const SizedBox(width: 8),
                        const Text('Lotes Aguardando Liberação', style: TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold, fontSize: 16)),
                      ],
                    ),
                    const SizedBox(height: 12),
                    ..._pendingReleaseBatches.map((batch) {
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('Lote Fotógrafo: ' + (batch['photographer'] ? batch['photographer']['name'] : 'N/A'), style: const TextStyle(color: Colors.white)),
                        subtitle: Text('Status: ' + batch['status'] + ' | Fechado', style: const TextStyle(color: Colors.white70)),
                        trailing: ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                          onPressed: () async {
                            try {
                              await ApiService().releaseBatchToStock(batch['id']);
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Lote liberado para estoque!'), backgroundColor: Colors.green));
                              _loadClients();
                            } catch(e) {
                              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: ' + e.toString()), backgroundColor: Colors.red));
                            }
                          },
                          child: const Text('Liberar para Estoque'),
                        ),
                      );
                    }).toList(),
                  ],
                ),
              ),

            // Resumo geral
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1A0030), Color(0xFF3A0068)],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                  color: _accentPurple.withOpacity(0.3)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _accentPurple.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(Icons.photo_library_rounded,
                      color: Color(0xFFCE93D8), size: 26),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Total de books Criadas',
                        style: TextStyle(
                            color: Color(0xFF90CAF9), fontSize: 12)),
                    Text('$totalGeral books',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.bold)),
                    Text('${_realPhotoEvents.length} equipes ativas',
                        style: const TextStyle(
                            color: Color(0xFFCE93D8), fontSize: 12)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Cards por equipe
          ..._realPhotoEvents.map((team) {
            final color = team['color'] as Color;
            final events = team['events'] as List;
            final teamTotal = events.fold<int>(
                0, (s, e) => s + (e['photos'] as int));

            return Container(
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A2E),
                borderRadius: BorderRadius.circular(20),
                border:
                    Border.all(color: color.withOpacity(0.25)),
              ),
              child: Column(
                children: [
                  // Header da equipe
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          color.withOpacity(0.15),
                          Colors.transparent
                        ],
                      ),
                      borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(20)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: color.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                                color: color.withOpacity(0.5)),
                          ),
                          child: Text(team['code'] as String,
                              style: TextStyle(
                                  color: color,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 11)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(team['team'] as String,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14)),
                        ),
                        Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.end,
                          children: [
                            Text('$teamTotal',
                                style: TextStyle(
                                    color: color,
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold)),
                            const Text('books totais',
                                style: TextStyle(
                                    color: Color(0xFF90CAF9),
                                    fontSize: 10)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  // Eventos
                  ...events.asMap().entries.map((entry) {
                    final i = entry.key;
                    final e = entry.value as Map;
                    final isLast = i == events.length - 1;
                    return Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 12),
                      decoration: BoxDecoration(
                        border: isLast
                            ? null
                            : Border(
                                bottom: BorderSide(
                                    color: Colors.white
                                        .withOpacity(0.06))),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              color: color.withOpacity(0.1),
                              borderRadius:
                                  BorderRadius.circular(10),
                            ),
                            child: Icon(
                                Icons.camera_alt_rounded,
                                color: color,
                                size: 18),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                Text(e['event'] as String,
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                        fontWeight:
                                            FontWeight.w600)),
                                const SizedBox(height: 2),
                                Row(children: [
                                  const Icon(
                                      Icons
                                          .location_on_outlined,
                                      color: Color(0xFF90CAF9),
                                      size: 12),
                                  const SizedBox(width: 3),
                                  Text(e['city'] as String,
                                      style: const TextStyle(
                                          color:
                                              Color(0xFF90CAF9),
                                          fontSize: 11)),
                                ]),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment:
                                CrossAxisAlignment.end,
                            children: [
                              Text('${e['photos']}',
                                  style: TextStyle(
                                      color: color,
                                      fontSize: 18,
                                      fontWeight:
                                          FontWeight.bold)),
                              const Text('books',
                                  style: TextStyle(
                                      color: Color(0xFF90CAF9),
                                      fontSize: 10)),
                            ],
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            );
          }),
          const SizedBox(height: 24),
          _buildRotasInteligentes(),
          const SizedBox(height: 20),

        ],
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ABA 3 — ESTOQUE NÃO-VENDAS
  // ══════════════════════════════════════════════════════════════════════════
  Widget _buildStockTab() {
    final totalFichas = _rotasRebolo.fold<int>(0, (s, r) => s + (r['books'] as List).length) +
        _rebolosNaoAtribuidos.length +
        _rebolosDistribuidos.values.fold<int>(0, (s, list) => s + list.length);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Resumo total
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1A0A00), Color(0xFF3A1000)],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                  color: const Color(0xFFEF5350).withOpacity(0.3)),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF5350).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Icon(Icons.inventory_2_rounded,
                      color: Color(0xFFEF9A9A), size: 26),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Estoque de Não-Vendas',
                        style: TextStyle(
                            color: Color(0xFF90CAF9), fontSize: 12)),
                    Text('$totalFichas fichas',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.bold)),
                    Text('${_rotasRebolo.length} cidades',
                        style: const TextStyle(
                            color: Color(0xFFEF9A9A), fontSize: 12)),
                  ],
                ),
                const Spacer(),
                const Text('Toque para\nver detalhes',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: Color(0xFF90CAF9), fontSize: 10)),
              ],
            ),
          ),
          const SizedBox(height: 20),

          const Text('Por Cidade',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 24),
          _buildRotasInteligentes(isRebolo: true),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildCityStockCard(Map<String, dynamic> cityData) {
    final total = cityData['total'] as int;
    final city = cityData['city'] as String;
    final fichas = cityData['fichas'] as List;
    // barra de proporção (max 50 para referência)
    const maxRef = 50;
    final barPct = (total / maxRef).clamp(0.0, 1.0);

    Color urgencyColor;
    if (total >= 20) {
      urgencyColor = const Color(0xFFEF5350);
    } else if (total >= 10) {
      urgencyColor = const Color(0xFFFFA726);
    } else {
      urgencyColor = const Color(0xFF66BB6A);
    }

    return GestureDetector(
      onTap: () => _showStockBottomSheet(city, fichas),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
              color: urgencyColor.withOpacity(0.25), width: 1),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: urgencyColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.location_city_rounded,
                      color: urgencyColor, size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(city,
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 15)),
                      const SizedBox(height: 2),
                      Text(
                          '${fichas.length} fichas detalhadas disponíveis',
                          style: const TextStyle(
                              color: Color(0xFF90CAF9),
                              fontSize: 11)),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('$total',
                        style: TextStyle(
                            color: urgencyColor,
                            fontSize: 26,
                            fontWeight: FontWeight.bold)),
                    const Text('não-vendas',
                        style: TextStyle(
                            color: Color(0xFF90CAF9),
                            fontSize: 10)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 12),
            // Barra de volume
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Stack(
                      children: [
                        Container(
                            height: 6,
                            color: Colors.white.withOpacity(0.08)),
                        FractionallySizedBox(
                          widthFactor: barPct,
                          child: Container(
                              height: 6, color: urgencyColor),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                const Icon(Icons.chevron_right_rounded,
                    color: Color(0xFF90CAF9), size: 18),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _showStockBottomSheet(
      String city, List fichas) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _StockBottomSheet(city: city, fichas: fichas),
    );
  }
  void _scanAndDistributeBooks({bool isRebolo = false}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A1A2E),
      builder: (context) {
        return SizedBox(
          height: MediaQuery.of(context).size.height * 0.8,
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Leitura de Saída (QR Code)', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
              ),
              Expanded(
                child: MobileScanner(
                  onDetect: (capture) {
                    final List<Barcode> barcodes = capture.barcodes;
                    if (barcodes.isNotEmpty) {
                      final code = barcodes.first.rawValue;
                      if (code != null) {
                        Navigator.pop(context);
                        _assignBookToSellerDialog(code, isRebolo);
                      }
                    }
                  },
                ),
              ),
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Aponte a câmera para o QR Code impresso no book', style: TextStyle(color: Colors.white70)),
              )
            ],
          ),
        );
      }
    );
  }

  void _assignBookToSellerDialog(String qrCode, bool isRebolo) {
    String? selectedSeller;
    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: const Text('Atribuir via QR Code', style: TextStyle(color: Colors.white)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Ficha/Book: $qrCode', style: const TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  const Text('Selecione o Vendedor:', style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(8)),
                    child: DropdownButton<String>(
                      value: selectedSeller,
                      items: _todosVendedores.map((v) => DropdownMenuItem(value: v, child: Text(v, style: const TextStyle(color: Colors.white)))).toList(),
                      onChanged: (v) { setDialogState(() => selectedSeller = v); },
                      dropdownColor: const Color(0xFF1E1E2C),
                      isExpanded: true,
                      underline: const SizedBox(),
                      hint: const Text('Selecionar', style: TextStyle(color: Colors.white54)),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
                ElevatedButton(
                  onPressed: selectedSeller == null ? null : () {
                    Navigator.pop(context);
                    _distribuirBookPorQR(qrCode, selectedSeller!, isRebolo);
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Confirmar', style: TextStyle(color: Colors.white)),
                ),
              ],
            );
          }
        );
      }
    );
  }

  Future<void> _distribuirBookPorQR(String qr, String seller, bool isRebolo) async {
    String? sellerId;
    for (var team in _teamData) {
      if (team['sellers'] != null) {
        for (var s in team['sellers'] as List) {
          if (s['name'] == seller) {
            sellerId = s['id'];
            break;
          }
        }
      }
    }
    
    if (sellerId == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Vendedor não encontrado no sistema.'), backgroundColor: Colors.red));
      return;
    }
    
    try {
      await ApiService().assignSeller(qr, sellerId);
      await _loadClients(); // Atualiza a tela com o novo status
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Book distribuído com sucesso!'), backgroundColor: Colors.green));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao atribuir: $e'), backgroundColor: Colors.red));
    }
  }



  void _printBatch(String seller, bool isRebolo) async {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Preparando lote de ${isRebolo ? "rebolos" : "books"} de $seller...')));
    final books = isRebolo ? _rebolosDistribuidos[seller] : _booksDistribuidos[seller];
    if (books != null && books.isNotEmpty) {
      final clients = books.map((b) => b['rawClientData'] as Map<String, dynamic>).where((c) => c != null).toList();
      if (clients.isNotEmpty) {
        await PdfGenerator.printBatch(clients, seller);
      }
    }
  }

  void _printItem(Map<String, dynamic> book, bool isRebolo) async {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Imprimindo unidade: ${book['ficha']}...")));
    if (book['rawClientData'] != null) {
      await PdfGenerator.printFicha(book['rawClientData']);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Dados do cliente incompletos para impressão.")));
    }
  }

  Widget _loteCard(String title, String subtitle, Color color, {Widget? trailing}) {
     return Container(
       padding: const EdgeInsets.all(12),
       decoration: BoxDecoration(
         color: color.withOpacity(0.2),
         borderRadius: BorderRadius.circular(12),
         border: Border.all(color: color.withOpacity(0.5)),
       ),
       child: Row(
         mainAxisAlignment: MainAxisAlignment.spaceBetween,
         children: [
           Column(
             crossAxisAlignment: CrossAxisAlignment.start,
             children: [
               Text(title, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
               Text(subtitle, style: const TextStyle(color: Colors.white)),
             ],
           ),
           if (trailing != null) trailing,
         ],
       ),
     );
  }

  Widget _buildRotasInteligentes({bool isRebolo = false}) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(isRebolo ? 'Rotas de Rebolo (Revisita)' : 'Rotas Inteligentes (Manual)', style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              ElevatedButton.icon(
                onPressed: () => _showNovaRotaDialog(isRebolo),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Nova Rota'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blueAccent),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(isRebolo ? 'Organize os rebolos em rotas manuais para revisitas.' : 'Organize os books prontos em rotas manuais.', style: const TextStyle(color: Colors.white54, fontSize: 12)),
          const SizedBox(height: 16),
          
          
          if ((isRebolo ? _rebolosNaoAtribuidos : _booksNaoAtribuidos).isNotEmpty)
            _buildNaoAtribuidosSection(isRebolo),
            
          const SizedBox(height: 8),
          ...(isRebolo ? _rotasRebolo : _rotasManuais).map((rota) => _buildRotaCard(rota, isRebolo)),
          
          const SizedBox(height: 24),
          const Divider(color: Colors.white24),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(isRebolo ? 'Malotes de Revisita (Saída)' : 'Malotes dos Vendedores (Saída)', style: const TextStyle(color: Colors.greenAccent, fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              ElevatedButton.icon(
                onPressed: () => _scanAndDistributeBooks(isRebolo: isRebolo),
                icon: const Icon(Icons.qr_code_scanner, size: 16, color: Colors.white),
                label: const Text('Escanear QR', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF9C27B0)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if ((isRebolo ? _rebolosDistribuidos : _booksDistribuidos).isEmpty)
            Text(isRebolo ? 'Nenhum rebolo distribuído ainda.' : 'Nenhum book distribuído ainda.', style: const TextStyle(color: Colors.white54)),
          ...(isRebolo ? _rebolosDistribuidos : _booksDistribuidos).entries.map((e) => _buildMaloteCard(e.key, e.value, isRebolo)),
        ],
      )
    );
  }



  Widget _buildNaoAtribuidosSection(bool isRebolo) {
    final list = isRebolo ? _rebolosNaoAtribuidos : _booksNaoAtribuidos;
    final count = list.length;
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.orangeAccent.withOpacity(0.5)),
        borderRadius: BorderRadius.circular(12),
        color: Colors.orangeAccent.withOpacity(0.05),
      ),
      child: ExpansionTile(
        title: Text('${isRebolo ? "Rebolos" : "Books"} Não Atribuídos ($count)', style: const TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold)),
        iconColor: Colors.orangeAccent,
        collapsedIconColor: Colors.orangeAccent,
        children: list.map((b) => _buildBookTile(b, null, isRebolo)).toList(),
      ),
    );
  }

  Widget _buildRotaCard(Map<String, dynamic> rota, bool isRebolo) {
    final List books = rota['books'] as List;
    return Card(
      color: Colors.white.withOpacity(0.05),
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ExpansionTile(
        title: Row(
          children: [
            const Icon(Icons.map_rounded, color: Colors.blueAccent, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text('${rota['title']} (${books.length} Books)', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        iconColor: Colors.white,
        collapsedIconColor: Colors.white70,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            color: Colors.black12,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: () => _showRenomearRotaDialog(rota, isRebolo),
                  icon: const Icon(Icons.edit, color: Colors.white70, size: 16),
                  label: const Text('Renomear', style: TextStyle(color: Colors.white70)),
                ),
                TextButton.icon(
                  onPressed: () => _atribuirRotaInteiraDialog(rota, isRebolo),
                  icon: const Icon(Icons.local_shipping, color: Colors.greenAccent, size: 16),
                  label: const Text('Atribuir Rota', style: TextStyle(color: Colors.greenAccent)),
                ),
                TextButton.icon(
                  onPressed: () => _excluirRota(rota, isRebolo),
                  icon: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 16),
                  label: const Text('Excluir Rota', style: TextStyle(color: Colors.redAccent)),
                ),
              ],
            ),
          ),
          ...books.map((b) => _buildBookTile(b, rota['id'], isRebolo)).toList(),
        ],
      ),
    );
  }

  Widget _buildBookTile(Map<String, dynamic> book, String? rotaId, bool isRebolo) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      title: Text(book['cliente'] as String, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 8.0),
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            _chip('Ficha: ${book['ficha']}'),
            _chip('Lote: ${book['lote']}'),
            _chip('QR: ${book['qr']}'),
          ],
        ),
      ),
      trailing: PopupMenuButton<String>(
        icon: const Icon(Icons.more_vert, color: Colors.white70),
        color: const Color(0xFF1E1E2C),
        onSelected: (val) {
          if (val == 'atribuir_vendedor') {
            _atribuirBookDialog(book, rotaId, isRebolo);
          } else if (val == 'desatribuir') {
            _moverBook(book, rotaId, null, isRebolo);
          } else {
            _moverBook(book, rotaId, val, isRebolo); // val is the new rotaId
          }
        },
        itemBuilder: (context) {
          List<PopupMenuEntry<String>> items = [];
          
          items.add(const PopupMenuItem(value: 'atribuir_vendedor', child: Text('Atribuir a Vendedor', style: TextStyle(color: Colors.greenAccent))));
          items.add(const PopupMenuDivider());
          
          if (rotaId != null) {
            items.add(const PopupMenuItem(value: 'desatribuir', child: Text('Mover para Não Atribuídos', style: TextStyle(color: Colors.orangeAccent))));
          }
          for (var r in (isRebolo ? _rotasRebolo : _rotasManuais)) {
            if (r['id'] != rotaId) {
              items.add(PopupMenuItem(value: r['id'], child: Text('Mover para ${r['title']}', style: const TextStyle(color: Colors.white))));
            }
          }
          return items;
        },
      ),
    );
  }

  Widget _chip(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(4)),
      child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 10)),
    );
  }

  void _showNovaRotaDialog(bool isRebolo) {
    final ctrl = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2C),
        title: const Text('Nova Rota', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: ctrl,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(hintText: 'Nome da Rota', hintStyle: TextStyle(color: Colors.white54)),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            onPressed: () {
              if (ctrl.text.isNotEmpty) {
                setState(() {
                  (isRebolo ? _rotasRebolo : _rotasManuais).add({
                    'id': 'r_${DateTime.now().millisecondsSinceEpoch}',
                    'title': ctrl.text,
                    'books': [],
                  });
                });
                Navigator.pop(context);
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
            child: const Text('Criar', style: TextStyle(color: Colors.white)),
          )
        ],
      )
    );
  }

  void _showRenomearRotaDialog(Map<String, dynamic> rota, bool isRebolo) {
    final ctrl = TextEditingController(text: rota['title']);
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2C),
        title: const Text('Renomear Rota', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: ctrl,
          style: const TextStyle(color: Colors.white),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            onPressed: () {
              if (ctrl.text.isNotEmpty) {
                setState(() {
                  rota['title'] = ctrl.text;
                });
                Navigator.pop(context);
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
            child: const Text('Salvar', style: TextStyle(color: Colors.white)),
          )
        ],
      )
    );
  }

  void _excluirRota(Map<String, dynamic> rota, bool isRebolo) {
    setState(() {
      if (isRebolo) {
        _rebolosNaoAtribuidos.addAll(List.from(rota['books']));
        _rotasRebolo.removeWhere((r) => r['id'] == rota['id']);
      } else {
        _booksNaoAtribuidos.addAll(List.from(rota['books']));
        _rotasManuais.removeWhere((r) => r['id'] == rota['id']);
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Rota excluída. ${isRebolo ? "Rebolos" : "Books"} movidos para Não Atribuídos.')));
  }

  Widget _buildMaloteCard(String seller, List<Map<String, dynamic>> books, bool isRebolo) {
    return Card(
      color: Colors.greenAccent.withOpacity(0.05),
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: Colors.greenAccent.withOpacity(0.3))),
      child: ExpansionTile(
        title: Row(
          children: [
            const Icon(Icons.person, color: Colors.greenAccent, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text('${seller} (${books.length} ${isRebolo ? "Rebolos" : "Books"})', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
            IconButton(
              icon: const Icon(Icons.print, color: Colors.white70, size: 20),
              tooltip: 'Imprimir Lote',
              onPressed: () => _printBatch(seller, isRebolo),
            ),
          ],
        ),
        iconColor: Colors.white,
        collapsedIconColor: Colors.white70,
        children: books.map((b) => ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 0),
          title: Text(b['cliente'] as String, style: const TextStyle(color: Colors.white, fontSize: 13)),
          subtitle: Text('Ficha: ${b['ficha']} | Lote: ${b['lote']}', style: const TextStyle(color: Colors.white54, fontSize: 11)),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                icon: const Icon(Icons.print, color: Colors.blueAccent, size: 18),
                tooltip: 'Imprimir Ficha',
                onPressed: () => _printItem(b, isRebolo),
              ),
              IconButton(
                icon: const Icon(Icons.remove_circle_outline, color: Colors.redAccent, size: 18),
                tooltip: 'Desatribuir',
                onPressed: () {
                  setState(() {
                    books.remove(b);
                    if (books.isEmpty) {
                      if (isRebolo) {
                        _rebolosDistribuidos.remove(seller);
                      } else {
                        _booksDistribuidos.remove(seller);
                      }
                    }
                    if (isRebolo) {
                      _rebolosNaoAtribuidos.add(b);
                    } else {
                      _booksNaoAtribuidos.add(b);
                    }
                  });
                },
              ),
            ],
          ),
        )).toList(),
      ),
    );
  }

  void _atribuirRotaInteiraDialog(Map<String, dynamic> rota, bool isRebolo) {
    String? selectedSeller;
    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: const Text('Atribuir Rota Inteira', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Rota: ${rota['title']} (${(rota['books'] as List).length} ${isRebolo ? "rebolos" : "books"})', style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 16),
              DropdownButton<String>(
                value: selectedSeller,
                isExpanded: true,
                dropdownColor: const Color(0xFF1E1E2C),
                hint: const Text('Selecione o Vendedor', style: TextStyle(color: Colors.white54)),
                items: _todosVendedores.map((v) => DropdownMenuItem(value: v, child: Text(v, style: const TextStyle(color: Colors.white)))).toList(),
                onChanged: (v) => setDialogState(() => selectedSeller = v),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              onPressed: selectedSeller == null ? null : () {
                setState(() {
                  if (isRebolo) {
                    _rebolosDistribuidos.putIfAbsent(selectedSeller!, () => []).addAll(List.from(rota['books']));
                    _rotasRebolo.removeWhere((r) => r['id'] == rota['id']);
                  } else {
                    _booksDistribuidos.putIfAbsent(selectedSeller!, () => []).addAll(List.from(rota['books']));
                    _rotasManuais.removeWhere((r) => r['id'] == rota['id']);
                  }
                });
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Rota atribuída para $selectedSeller!'), backgroundColor: Colors.green));
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.greenAccent),
              child: const Text('Atribuir', style: TextStyle(color: Colors.black)),
            )
          ],
        )
      )
    );
  }

  void _atribuirBookDialog(Map<String, dynamic> book, String? rotaId, bool isRebolo) {
    String? selectedSeller;
    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: const Text('Atribuir Book Individual', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Ficha: ${book['ficha']} (${book['cliente']})', style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 16),
              DropdownButton<String>(
                value: selectedSeller,
                isExpanded: true,
                dropdownColor: const Color(0xFF1E1E2C),
                hint: const Text('Selecione o Vendedor', style: TextStyle(color: Colors.white54)),
                items: _todosVendedores.map((v) => DropdownMenuItem(value: v, child: Text(v, style: const TextStyle(color: Colors.white)))).toList(),
                onChanged: (v) => setDialogState(() => selectedSeller = v),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
            ElevatedButton(
              onPressed: selectedSeller == null ? null : () {
                setState(() {
                  if (rotaId == null) {
                    if (isRebolo) {
                      _rebolosNaoAtribuidos.removeWhere((b) => b['id'] == book['id']);
                    } else {
                      _booksNaoAtribuidos.removeWhere((b) => b['id'] == book['id']);
                    }
                  } else {
                    final rota = isRebolo 
                      ? _rotasRebolo.firstWhere((r) => r['id'] == rotaId)
                      : _rotasManuais.firstWhere((r) => r['id'] == rotaId);
                    (rota['books'] as List).removeWhere((b) => b['id'] == book['id']);
                  }
                  if (isRebolo) {
                    _rebolosDistribuidos.putIfAbsent(selectedSeller!, () => []).add(book);
                  } else {
                    _booksDistribuidos.putIfAbsent(selectedSeller!, () => []).add(book);
                  }
                });
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${isRebolo ? "Rebolo" : "Book"} atribuído para $selectedSeller!'), backgroundColor: Colors.green));
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.greenAccent),
              child: const Text('Atribuir', style: TextStyle(color: Colors.black)),
            )
          ],
        )
      )
    );
  }

  void _moverBook(Map<String, dynamic> book, String? fromRotaId, String? toRotaId, bool isRebolo) {
    setState(() {
      // Remover de onde estava
      if (fromRotaId == null) {
        _booksNaoAtribuidos.removeWhere((b) => b['id'] == book['id']);
      } else {
        final rota = _rotasManuais.firstWhere((r) => r['id'] == fromRotaId);
        (rota['books'] as List).removeWhere((b) => b['id'] == book['id']);
      }
      
      // Adicionar para onde vai
      if (toRotaId == null) {
        _booksNaoAtribuidos.add(book);
      } else {
        final rota = _rotasManuais.firstWhere((r) => r['id'] == toRotaId);
        (rota['books'] as List).add(book);
      }
    });
  }
}

// ── Bottom Sheet de Fichas por Cidade ─────────────────────────────────────────
class _StockBottomSheet extends StatelessWidget {
  final String city;
  final List fichas;
  const _StockBottomSheet({required this.city, required this.fichas});

  Color _reasonColor(String reason) {
    switch (reason) {
      case 'Sem interesse':
        return const Color(0xFFEF5350);
      case 'Sem condições':
        return const Color(0xFFFFA726);
      case 'Book trocado':
        return const Color(0xFF7E57C2);
      case 'Dados incorretos':
        return const Color(0xFF29B6F6);
      case 'Sem qualidade':
        return const Color(0xFF66BB6A);
      default:
        return const Color(0xFF90CAF9);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.75),
      decoration: const BoxDecoration(
        color: Color(0xFF12122A),
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
            child: Row(
              children: [
                const Icon(Icons.location_city_rounded,
                    color: Color(0xFFEF9A9A), size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(city,
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 16)),
                      Text('${fichas.length} fichas não-vendidas',
                          style: const TextStyle(
                              color: Color(0xFF90CAF9),
                              fontSize: 12)),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded,
                      color: Color(0xFF90CAF9)),
                ),
              ],
            ),
          ),
          const Divider(color: Color(0xFF2A2A4A), height: 1),
          // Lista de fichas
          Flexible(
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: fichas.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                final f = fichas[i] as Map;
                final reason = f['reason'] as String;
                final rColor = _reasonColor(reason);
                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A2E),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                        color: rColor.withOpacity(0.2)),
                  ),
                  child: Row(
                    children: [
                      // Número sequencial
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: rColor.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Center(
                          child: Text('${i + 1}',
                              style: TextStyle(
                                  color: rColor,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13)),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children: [
                            // Nome + ficha
                            Row(children: [
                              Expanded(
                                child: Text(f['client'] as String,
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w600,
                                        fontSize: 13)),
                              ),
                            ]),
                            const SizedBox(height: 4),
                            Row(children: [
                              // Nº da ficha
                              const Icon(Icons.tag_rounded,
                                  color: Color(0xFF4FC3F7),
                                  size: 12),
                              const SizedBox(width: 3),
                              Text(f['seq'] as String,
                                  style: const TextStyle(
                                      color: Color(0xFF4FC3F7),
                                      fontSize: 11,
                                      fontFamily: 'monospace')),
                              const SizedBox(width: 12),
                              // Lote
                              const Icon(Icons.inventory_rounded,
                                  color: Color(0xFF90CAF9),
                                  size: 12),
                              const SizedBox(width: 3),
                              Text(f['lote'] as String,
                                  style: const TextStyle(
                                      color: Color(0xFF90CAF9),
                                      fontSize: 11)),
                            ]),
                          ],
                        ),
                      ),
                      // Motivo
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: rColor.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                              color: rColor.withOpacity(0.35)),
                        ),
                        child: Text(
                          reason
                              .split(' ')
                              .take(2)
                              .join('\n'),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: rColor,
                              fontSize: 9,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
