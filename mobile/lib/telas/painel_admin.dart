import 'package:flutter/material.dart';
import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import 'tela_configuracoes.dart';
import 'visao_frota_admin.dart';
import 'visao_fluxo_caixa_admin.dart';
import 'tela_cadastro_custos.dart';
import 'tela_gerenciamento_funcionarios.dart';
import 'visao_prospectos_ia.dart';
import 'visao_fechamento_admin.dart';
import 'visao_estoque_admin.dart';
import '../utils/pdf_generator.dart';
import 'tela_detalhes_cliente_vendedor.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import '../widgets/led_menu_item.dart';
import 'visao_rotas_chegada.dart';
import 'visao_roteiro_inteligente.dart';
import '../widgets/led_button.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../widgets/led_card.dart';
import '../utils/ui_helpers.dart';
import 'visao_estatisticas_admin.dart';

// ── Constantes visuais ────────────────────────────────────────────────────────
const _accentPurple = Color(0xFF9C27B0);
const _chartGreen = Color(0xFF43A047);
final _months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'];

final _teamData = [
  {
    'team': 'Equipe 1 — SP',
    'code': 'EQP1',
    'color': const Color(0xFFAB47BC),
    'sellers': [
      {
        'name': 'Carlos Lima',
        'sales': 42,
        'avg': 380.0,
        'nonSales': 8,
        'monthlySales': [8, 10, 13, 16, 20, 17],
      },
      {
        'name': 'Fernanda Reis',
        'sales': 37,
        'avg': 410.0,
        'nonSales': 5,
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
        'sales': 31,
        'avg': 355.0,
        'nonSales': 11,
        'monthlySales': [5, 8, 10, 13, 18, 20],
      },
      {
        'name': 'Marina Souza',
        'sales': 45,
        'avg': 425.0,
        'nonSales': 4,
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
        'sales': 28,
        'avg': 370.0,
        'nonSales': 9,
        'monthlySales': [8, 12, 16, 22, 25, 28],
      },
    ],
    'monthlySales': [8, 12, 16, 22, 25, 28],
    'monthlyNonSales': [5, 7, 8, 6, 10, 9],
  },
];

// ── Mock: Estoque não-vendas ──────────────────────────────────────────────────

class AdminErrorBoundary extends StatefulWidget {
  final Widget child;
  final String tabName;
  final VoidCallback onRetry;

  const AdminErrorBoundary({
    super.key,
    required this.child,
    required this.tabName,
    required this.onRetry,
  });

  @override
  State<AdminErrorBoundary> createState() => _AdminErrorBoundaryState();
}

class _AdminErrorBoundaryState extends State<AdminErrorBoundary> {
  bool _hasError = false;

  @override
  void didUpdateWidget(AdminErrorBoundary oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.tabName != widget.tabName) {
      _hasError = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_hasError) {
      return Container(
        padding: const EdgeInsets.all(24),
        margin: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFCE93D8).withOpacity(0.5)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.shield_outlined,
                color: Color(0xFFCE93D8), size: 48),
            const SizedBox(height: 16),
            const Text(
              'Aba Protegida',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Esta seção está blindada. Se houver falha de conexão ou dados pendentes, clique no botão para recarregar.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
            const SizedBox(height: 20),
            LedButton(
              onPressed: () {
                setState(() => _hasError = false);
                widget.onRetry();
              },
              style:
                  LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Atualizar Aba',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
    }

    return widget.child;
  }
}

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

  String _userName = '';
  String _greeting = 'Olá';
  String _verse = '';

  // Mock Rotas Inteligentes -> Nova Estrutura
  List<Map<String, dynamic>> _rotasManuais = [];
  List<Map<String, dynamic>> _booksNaoAtribuidos = [];
  // ignore: unused_field
  Set<String> _pendingReleaseCities = {};

  final Map<String, List<Map<String, dynamic>>> _booksDistribuidos = {};

  List<Map<String, dynamic>> _realPhotoEvents = [];

  List<Map<String, dynamic>> _rotasRebolo = [];
  List<Map<String, dynamic>> _rebolosNaoAtribuidos = [];
  List<Map<String, dynamic>> _rebolosAwaitingReturn = [];
  List<Map<String, dynamic>> _rebolosInStock = [];
  List<Map<String, dynamic>> _rebolosInRoute = [];
  List<Map<String, dynamic>> _rebolosHistory = [];
  int _selectedReboloTab = 0; // 0 = Disponíveis, 1 = Aguardando Devolução, 2 = Em Rota, 3 = Histórico
  // ignore: unused_field
  List<Map<String, dynamic>> _pendingReleaseBatches = [];
  List<Map<String, dynamic>> _companySellers = [];

  final Map<String, List<Map<String, dynamic>>> _rebolosDistribuidos = {};

  Future<void> _loadCompanySellers() async {
    try {
      final users = await ApiService().getCompanyUsers();
      final sellers = users
          .where((user) =>
              user is Map &&
              user['active'] == true &&
              ['SELLER', 'SELLER_MANAGER', 'VENDEDOR'].contains(user['role']))
          .map((user) => Map<String, dynamic>.from(user as Map))
          .toList();
      if (mounted) setState(() => _companySellers = sellers);
    } catch (e) {
      debugPrint('Erro ao carregar vendedores reais: $e');
    }
  }

  String _sellerName(String sellerId) => _companySellers
      .firstWhere((seller) => seller['id'] == sellerId,
          orElse: () => {'name': 'Vendedor'})['name']
      .toString();

  int _unreadNotifs = 0;

  Future<void> _loadClients() async {
    try {
      final api = ApiService();

      // Fetch rebolos first
      final rebolos = await api.getRebolos();
      final Set<String> reboloIds =
          rebolos.map((r) => r['id'].toString()).toSet();

      final clients = await api.getAllClients();
      if (mounted)
        setState(() => _allClients = List<Map<String, dynamic>>.from(clients));

      final pendingBatches = await api.getPendingBookBatches();
      if (mounted)
        setState(() => _pendingReleaseBatches =
            List<Map<String, dynamic>>.from(pendingBatches));

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
          final pId = client['photographer']?['name'] ??
              (client['photographerId'] != null
                  ? 'Fotógrafo #${client['photographerId'].toString().substring(0, client['photographerId'].toString().length > 8 ? 8 : client['photographerId'].toString().length)}'
                  : 'Sem Fotógrafo');
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
      final colors = [
        const Color(0xFFAB47BC),
        const Color(0xFF7E57C2),
        const Color(0xFF5C6BC0),
        const Color(0xFF4FC3F7)
      ];

      for (var entry in photographerBooks.entries) {
        final teamColor = colors[colorIndex % colors.length];

        // Group books by event/city for this photographer
        final Map<String, List<Map<String, dynamic>>> eventBooks = {};
        for (var b in entry.value) {
          final city = b['city'] ?? 'Sem Cidade';
          if (!eventBooks.containsKey(city)) {
            eventBooks[city] = [];
          }
          eventBooks[city]!.add(b);
        }

        final List<Map<String, dynamic>> events = [];
        for (var ev in eventBooks.entries) {
          events.add({
            'event': 'Produção em ${ev.key}',
            'city': ev.key,
            'photos': ev.value.length,
            'books': ev.value,
          });
        }

        realEvents.add({
          'team': entry.key,
          'code': entry.key
              .substring(0, entry.key.length > 3 ? 3 : entry.key.length)
              .toUpperCase(),
          'color': teamColor,
          'events': events,
          'allBooks': entry.value,
        });

        colorIndex++;
      }

      final List<Map<String, dynamic>> rebolosAwaitingReturn = [];
      final List<Map<String, dynamic>> rebolosInStock = [];
      final List<Map<String, dynamic>> rebolosInRoute = [];
      final List<Map<String, dynamic>> rebolosHistory = [];
      final List<Map<String, dynamic>> rebolosUnassigned = [];
      final Map<String, List<Map<String, dynamic>>> rebolosCityGroups = {};
      final Map<String, List<Map<String, dynamic>>> rebolosDistributed = {};

      for (var client in rebolos) {
        final raw = Map<String, dynamic>.from(client as Map);
        final bookStatus = raw['bookStatus']?.toString() ?? 'IN_STOCK_REBOLO';
        final rawCity = raw['city'];
        final city = (rawCity != null && rawCity.toString().trim().isNotEmpty)
            ? rawCity.toString().trim()
            : 'Sem Cidade';
        final seq = (raw['sequenceNumber'] ?? 'S/N').toString();
        final clientName = (raw['name'] ?? raw['clientName'] ?? 'Cliente').toString();
        final nonSales = (raw['nonSales'] as List?) ?? [];
        final reason = nonSales.isNotEmpty
            ? (nonSales.last['reason']?.toString() ?? 'Não-venda')
            : (raw['outcomeStatus']?.toString() ?? bookStatus);

        final b = {
          'id': raw['id']?.toString() ?? '',
          'client': clientName,
          'cliente': clientName,
          'name': clientName,
          'seq': seq,
          'ficha': seq,
          'sequenceNumber': seq,
          'lote': raw['batch']?['name'] ?? raw['batchId'] ?? 'Rebolo',
          'reason': reason,
          'city': city,
          'bookStatus': bookStatus,
          'assignedSeller': raw['assignedSeller'],
          'assignedSellerId': raw['assignedSellerId'],
          'photographerId': raw['photographerId'],
          'rawClientData': raw,
        };

        if (bookStatus == 'AWAITING_RETURN') {
          rebolosAwaitingReturn.add(b);
        } else if (bookStatus == 'DISTRIBUTED_REBOLO' || (raw['assignedSeller'] != null && bookStatus != 'IN_STOCK_REBOLO' && bookStatus != 'SOLD' && bookStatus != 'REBOLO_SOLD' && bookStatus != 'DISCARDED')) {
          rebolosInRoute.add(b);
          final sellerName = raw['assignedSeller']?['name']?.toString() ?? 'Vendedor';
          if (!rebolosDistributed.containsKey(sellerName)) {
            rebolosDistributed[sellerName] = [];
          }
          rebolosDistributed[sellerName]!.add(b);
        } else if (bookStatus == 'REBOLO_SOLD' || bookStatus == 'SOLD' || bookStatus == 'DISCARDED') {
          rebolosHistory.add(b);
        } else {
          // Disponível em estoque para redistribuição
          rebolosInStock.add(b);
          if (city == 'Sem Cidade') {
            rebolosUnassigned.add(b);
          }
          if (!rebolosCityGroups.containsKey(city)) {
            rebolosCityGroups[city] = [];
          }
          rebolosCityGroups[city]!.add(b);
        }
      }

      final List<Map<String, dynamic>> rRoutes = [];
      for (var entry in rebolosCityGroups.entries) {
        final list = entry.value;
        rRoutes.add({
          'id': 'rr_${entry.key}',
          'city': entry.key,
          'title': '${entry.key} (Revisitas)',
          'total': list.length,
          'fichas': list,
          'books': list,
        });
      }
      rRoutes.sort((a, b) => (b['total'] as int).compareTo(a['total'] as int));

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
          _rebolosAwaitingReturn = rebolosAwaitingReturn;
          _rebolosInStock = rebolosInStock;
          _rebolosInRoute = rebolosInRoute;
          _rebolosHistory = rebolosHistory;
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
    _fadeAnim = CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
    _loadUpcomingEvents();
    _fetchUnreadNotifications();
    _loadCompanySellers();
    _loadClients();
    _checkAutomaticBackup();
    _loadUserData();
  }

  Future<void> _showEditProfileDialog() async {
    final controller = TextEditingController(text: _userName);
    await showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('Alterar Nome de Exibição',
              style: TextStyle(color: Colors.white)),
          content: TextField(
            controller: controller,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              labelText: 'Seu Nome',
              labelStyle: const TextStyle(color: Colors.white70),
              filled: true,
              fillColor: Colors.white10,
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar',
                  style: TextStyle(color: Colors.white54)),
            ),
            LedButton(
              onPressed: () async {
                final newName = controller.text.trim();
                if (newName.isNotEmpty) {
                  final prefs = await SharedPreferences.getInstance();
                  await prefs.setString('user_name', newName);
                  try {
                    await ApiService().updateProfileName(newName);
                  } catch (e) {
                    print('Error saving profile name to backend: $e');
                  }
                  if (mounted) {
                    setState(() => _userName = newName);
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('Nome atualizado com sucesso!'),
                          backgroundColor: Colors.green),
                    );
                  }
                }
              },
              child: const Text('Salvar'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _loadUserData() async {
    final name = await UIHelpers.getUserName();
    final quote = await ApiService().getDailyQuote();
    if (mounted) {
      setState(() {
        _userName = name;
        _greeting = UIHelpers.getGreeting();
        _verse = quote.isNotEmpty
            ? quote
            : '"A persistência realiza o impossível." - Provérbio Chinês';
      });
    }
  }

  Future<void> _checkAutomaticBackup() async {
    if (kIsWeb) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final lastBackupStr = prefs.getString('last_auto_backup_date');
      DateTime? lastBackup;
      if (lastBackupStr != null) {
        lastBackup = DateTime.tryParse(lastBackupStr);
      }

      final now = DateTime.now();
      // Se não tem backup ou passou de 30 dias
      if (lastBackup == null || now.difference(lastBackup).inDays >= 30) {
        final jsonString = await ApiService().downloadBackup();

        final directory = await getApplicationDocumentsDirectory();
        final file =
            File('${directory.path}/backup_automatico_selectphoto.json');

        await file.writeAsString(jsonString);
        await prefs.setString('last_auto_backup_date', now.toIso8601String());

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Backup automático de 30 dias salvo no dispositivo.'),
            backgroundColor: Colors.green,
          ));
        }
      }
    } catch (e) {
      print('Erro no backup automático: $e');
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
    return LayoutBuilder(builder: (context, constraints) {
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
    });
  }

  Widget _buildSideMenu() {
    return Container(
      width: 250,
      color: const Color(0xFF1A0030),
      child: Column(
        children: [
          const SizedBox(height: 40),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.asset(
              'assets/images/logo_hiper.jpeg',
              width: 180,
              height: 100,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) => const Icon(
                  Icons.admin_panel_settings_rounded,
                  color: Color(0xFFCE93D8),
                  size: 48),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Central Fotográfica',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const Text('Admin Web',
              style: TextStyle(color: Color(0xFFCE93D8), fontSize: 14)),
          const SizedBox(height: 20),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    title: const Text('OPERAÇÕES E PRODUTOS',
                        style: TextStyle(
                            color: Color(0xFF90CAF9),
                            fontSize: 12,
                            fontWeight: FontWeight.bold)),
                    initiallyExpanded: true,
                    iconColor: const Color(0xFF90CAF9),
                    collapsedIconColor: const Color(0xFF90CAF9),
                    children: [
                      _sideMenuItem(7, Icons.account_balance_wallet_rounded,
                          'Fechamentos'),
                      _sideMenuItem(0, Icons.auto_awesome, 'Eventos IA'),
                      _sideMenuItem(1, Icons.menu_book_rounded, 'Books'),
                      _sideMenuItem(2, Icons.inventory_2_rounded, 'Rebolo'),
                      _sideMenuItem(9, Icons.bar_chart_rounded, 'Estatísticas'),
                      _sideMenuItem(8, Icons.layers_rounded, 'Capas'),
                    ],
                  ),
                ),
                const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: Divider(color: Colors.white12, height: 1)),
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    title: const Text('FINANCEIRO E SAÚDE',
                        style: TextStyle(
                            color: Color(0xFF90CAF9),
                            fontSize: 12,
                            fontWeight: FontWeight.bold)),
                    iconColor: const Color(0xFF90CAF9),
                    collapsedIconColor: const Color(0xFF90CAF9),
                    children: [
                      _sideMenuItem(
                          4, Icons.attach_money_rounded, 'Financeiro e Saúde'),
                      ListTile(
                        leading: const Icon(Icons.money_off,
                            color: Color(0xFFE57373)),
                        title: const Text('Despesas',
                            style: TextStyle(color: Color(0xFFE57373))),
                        onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => const CostEntryScreen())),
                      ),
                    ],
                  ),
                ),
                const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16),
                    child: Divider(color: Colors.white12, height: 1)),
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    title: const Text('RH E LOGÍSTICA',
                        style: TextStyle(
                            color: Color(0xFF90CAF9),
                            fontSize: 12,
                            fontWeight: FontWeight.bold)),
                    iconColor: const Color(0xFF90CAF9),
                    collapsedIconColor: const Color(0xFF90CAF9),
                    children: [
                      _sideMenuItem(
                          5, Icons.people_alt_rounded, 'Funcionários'),
                      _sideMenuItem(3, Icons.directions_car_rounded, 'Frota'),
                    ],
                  ),
                ),
              ],
            ),
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
          return StatefulBuilder(builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1A2535),
              title: const Text('Notificações e Pendências',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
              content: FutureBuilder<List<dynamic>>(
                future: ApiService().getNotifications(),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const SizedBox(
                      width: 100,
                      height: 100,
                      child: Center(
                          child: CircularProgressIndicator(
                              color: Colors.orangeAccent)),
                    );
                  }
                  if (snapshot.hasError) {
                    return const Text('Erro ao carregar notificações.',
                        style: TextStyle(color: Colors.redAccent));
                  }

                  final notifications = snapshot.data ?? [];
                  if (notifications.isEmpty) {
                    return const Text('Tudo limpo! Nenhuma pendência.',
                        style: TextStyle(color: Colors.white70));
                  }

                  return SizedBox(
                    width: double.maxFinite,
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: notifications.length,
                      itemBuilder: (context, index) {
                        final notif = notifications[index];
                        final senderName = notif['sender'] != null
                            ? notif['sender']['name']
                            : 'Sistema';

                        IconData icon;
                        switch (notif['type']) {
                          case 'COVER_TRANSFER_REQUEST':
                          case 'STOCK_TRANSFER_COVER':
                            icon = Icons.layers_rounded;
                            break;
                          case 'STOCK_TRANSFER_BOOK':
                            icon = Icons.menu_book_rounded;
                            break;
                          case 'COST_APPROVAL':
                            icon = Icons.attach_money_rounded;
                            break;
                          case 'FLEET_URGENT':
                            icon = Icons.warning_amber_rounded;
                            break;
                          default:
                            icon = Icons.notifications_active_rounded;
                        }

                        return LedCard(
                          color: Colors.white.withOpacity(0.05),
                          child: ListTile(
                            leading: Icon(icon, color: Colors.orangeAccent),
                            title: Text('$senderName \u2794 Admin',
                                style: const TextStyle(
                                    color: Colors.white, fontSize: 14)),
                            subtitle: Text(notif['message'] ?? 'Notificação',
                                style: const TextStyle(color: Colors.white70)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.close,
                                      color: Colors.redAccent),
                                  onPressed: () async {
                                    try {
                                      await ApiService().actionNotification(
                                          notif['id'], 'REJECT');
                                      setDialogState(
                                          () {}); // Refreshes FutureBuilder
                                    } catch (e) {
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(SnackBar(
                                              content: Text('Erro: $e')));
                                    }
                                  },
                                ),
                                IconButton(
                                  icon: const Icon(Icons.check,
                                      color: Colors.greenAccent),
                                  onPressed: () async {
                                    try {
                                      await ApiService().actionNotification(
                                          notif['id'], 'ACCEPT');
                                      setDialogState(() {});
                                    } catch (e) {
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(SnackBar(
                                              content: Text('Erro: $e')));
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
                  child: const Text('Fechar',
                      style: TextStyle(color: Colors.white70)),
                ),
              ],
            );
          });
        });
  }

  void _printUnidadeBluetooth(Map<String, dynamic> ficha) async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Nenhuma impressora conectada! Vá nas configurações.',
                style: TextStyle(color: Colors.white)),
            backgroundColor: Colors.red));
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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Imprimindo ticket...',
              style: TextStyle(color: Colors.white)),
          backgroundColor: Colors.green));
    }
  }

  void _showReceiveReturnDialog() {
    final codeCtrl = TextEditingController();
    showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
              backgroundColor: const Color(0xFF1A1A2E),
              title: const Text('Receber Devolução de Book',
                  style: TextStyle(color: Colors.white)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                      'O book será re-cadastrado no estoque para Rebolo.',
                      style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 16),
                  TextField(
                    controller: codeCtrl,
                    style: const TextStyle(color: Colors.white),
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Código da Ficha',
                      labelStyle: TextStyle(color: Colors.white54),
                      enabledBorder: UnderlineInputBorder(
                          borderSide: BorderSide(color: Colors.white24)),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(ctx),
                    child: const Text('Cancelar',
                        style: TextStyle(color: Colors.white54))),
                LedButton(
                  onPressed: () async {
                    final code = codeCtrl.text.trim();
                    if (code.isEmpty) return;
                    Navigator.pop(ctx);
                    try {
                      await ApiService().receiveReturnedBook(code);
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text(
                                    'Devolução registrada. Book no estoque!'),
                                backgroundColor: Colors.green));
                        _loadClients();
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                            content: Text('Erro: $e'),
                            backgroundColor: Colors.red));
                      }
                    }
                  },
                  child: const Text('Confirmar'),
                )
              ],
            ));
  }

  Widget _sideMenuItem(int index, IconData icon, String label) {
    final selected = _navIndex == index;
    return LedMenuItem(
      icon: icon,
      label: label,
      selected: selected,
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
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Esquerda: Admin badge (topo) + Menu 3 barras (baixo)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: _accentPurple.withOpacity(0.3),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                              color: _accentPurple.withOpacity(0.5),
                              width: 1.2),
                          boxShadow: [
                            BoxShadow(
                              color: _accentPurple.withOpacity(0.4),
                              blurRadius: 10,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: const Icon(Icons.admin_panel_settings_rounded,
                            color: Colors.white, size: 20),
                      ),
                      if (!isDesktop) ...[
                        const SizedBox(height: 2),
                        IconButton(
                          constraints:
                              const BoxConstraints(minWidth: 48, minHeight: 44),
                          padding: EdgeInsets.zero,
                          onPressed: () =>
                              _scaffoldKey.currentState?.openDrawer(),
                          icon: const Icon(Icons.menu,
                              color: Colors.white, size: 24),
                          tooltip: 'Abrir Menu',
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(width: 8),
                  // Centro: Boas vindas com nome ampliado + subtítulo + versículo
                  Expanded(
                    child: InkWell(
                      onTap: _showEditProfileDialog,
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            vertical: 2, horizontal: 4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '$_greeting, $_userName',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 17,
                                      fontWeight: FontWeight.bold,
                                      letterSpacing: 0.2,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 4),
                                const Icon(Icons.edit,
                                    color: Colors.white54, size: 14),
                              ],
                            ),
                            const SizedBox(height: 2),
                            const Text(
                              'Painel Administrativo',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Color(0xFF90CAF9),
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _verse,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 11,
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  // Direita: Notificação (topo) + Configuração (baixo)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        constraints:
                            const BoxConstraints(minWidth: 48, minHeight: 44),
                        padding: EdgeInsets.zero,
                        onPressed: () {
                          _showNotificacoesDialog();
                        },
                        icon: _unreadNotifs > 0
                            ? Badge(
                                label: Text(_unreadNotifs.toString()),
                                child: const Icon(
                                    Icons.notifications_active_rounded,
                                    color: Colors.orangeAccent,
                                    size: 22),
                              )
                            : const Icon(Icons.notifications_none_rounded,
                                color: Colors.white70, size: 22),
                        tooltip: 'Notificações',
                      ),
                      const SizedBox(height: 2),
                      IconButton(
                        constraints:
                            const BoxConstraints(minWidth: 48, minHeight: 44),
                        padding: EdgeInsets.zero,
                        onPressed: () {
                          Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) =>
                                  const SettingsScreen(canManageRoi: true)));
                        },
                        icon: const Icon(Icons.settings,
                            color: Color(0xFFCE93D8), size: 22),
                        tooltip: 'Configurações',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    Widget tabWidget;
    switch (_navIndex) {
      case 0:
        tabWidget = const StateProspectsView();
        break;
      case 1:
        tabWidget = _buildPhotosTab();
        break;
      case 2:
        tabWidget = _buildStockTab();
        break;
      case 3:
        tabWidget = const FleetAdminView();
        break;
      case 4:
        tabWidget = const CashFlowAdminView();
        break;
      case 5:
        tabWidget = const EmployeeManagementScreen();
        break;
      case 7:
        tabWidget = const VisaoFechamentoAdmin();
        break;
      case 8:
        tabWidget = const VisaoEstoqueAdmin();
        break;
      case 9:
        tabWidget = const VisaoEstatisticasAdmin();
        break;
      default:
        tabWidget = const VisaoFechamentoAdmin();
    }

    return AdminErrorBoundary(
      tabName: 'Aba $_navIndex',
      onRetry: () => setState(() {}),
      child: tabWidget,
    );
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
                  const Icon(Icons.warning_amber_rounded,
                      color: Colors.redAccent, size: 30),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Atenção: Eventos Favoritos Próximos!',
                            style: TextStyle(
                                color: Colors.redAccent,
                                fontWeight: FontWeight.bold,
                                fontSize: 16)),
                        const SizedBox(height: 4),
                        Text(
                            'Você possui ${_upcomingEvents.length} evento(s) que ocorrerão nos próximos 5 dias.',
                            style: const TextStyle(color: Colors.white70)),
                      ],
                    ),
                  ),
                  LedButton(
                    onPressed: () =>
                        setState(() => _navIndex = 0), // Go to IA Events
                    style:
                        LedButton.styleFrom(backgroundColor: Colors.redAccent),
                    child: const Text('Ver',
                        style: TextStyle(color: Colors.white)),
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
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
              decoration: BoxDecoration(
                gradient: selected
                    ? LinearGradient(colors: [color.withOpacity(0.8), color])
                    : null,
                color: selected ? null : const Color(0xFF1A1A2E),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                    color: selected ? color : Colors.white.withOpacity(0.1)),
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
                  color: selected ? Colors.white : const Color(0xFF90CAF9),
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
                  color: color, fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 10)),
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
                style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 12),
                underline: const SizedBox(),
                items: List.generate(_months.length,
                    (i) => DropdownMenuItem(value: i, child: Text(_months[i]))),
                onChanged: (v) => setState(() => _selectedMonth = v ?? 5),
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
                final barHeight = maxVal > 0 ? (sales[i] / maxVal) * 120 : 0.0;
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
                              color: const Color(0xFFEF5350).withOpacity(0.5),
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
                              color:
                                  isSelected ? color : const Color(0xFF546E7A),
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
          decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
      const SizedBox(width: 4),
      Text(label,
          style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 11)),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: _chartGreen.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: _chartGreen.withOpacity(0.4)),
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
                      bottom: BorderSide(color: Colors.white.withOpacity(0.1))),
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
                  _tableCell('$monthSales', color: const Color(0xFF66BB6A)),
                  _tableCell('R\$ ${avg.toStringAsFixed(0)}', color: color),
                  _tableCell('R\$ ${totalMes.toStringAsFixed(0)}',
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

  Widget _tableCell(String text, {Color? color, bool isName = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Text(text,
          style: TextStyle(
              color: color ?? Colors.white,
              fontSize: isName ? 12 : 13,
              fontWeight: isName ? FontWeight.normal : FontWeight.bold)),
    );
  }

  Widget _buildSalesVsNonSales() {
    final month = _months[_selectedMonth];
    final sales = (_currentTeam['monthlySales'] as List<int>)[_selectedMonth];
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
              style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 11)),
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
                    color: const Color(0xFFEF5350).withOpacity(0.7)),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _numberStat('Vendas', '$sales', color)),
              Expanded(
                  child: _numberStat(
                      'Não-Vendas', '$nonSales', const Color(0xFFEF5350))),
              Expanded(
                  child: _numberStat(
                      'Total Atend.', '$total', const Color(0xFF90CAF9))),
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
              color: color, fontSize: 20, fontWeight: FontWeight.bold)),
      const SizedBox(height: 2),
      Text(label,
          style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 11),
          textAlign: TextAlign.center),
    ]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ABA 2 — books POR EQUIPE
  // ══════════════════════════════════════════════════════════════════════════

  int get _totalBooksProduced => _allClients.length;
  int get _booksAguardando =>
      _allClients.where((c) => c['releasedForRouting'] != true).length;
  int get _booksLiberados =>
      _allClients.where((c) => c['releasedForRouting'] == true).length;

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
            const Text('Resumo de Produção (Geral)',
                style: TextStyle(
                    color: Color(0xFFCE93D8),
                    fontSize: 18,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _infoBoxProducao('Total Produzido', '$_totalBooksProduced',
                    Colors.blueAccent),
                _infoBoxProducao('Aguardando Rota', '$_booksAguardando',
                    Colors.orangeAccent),
                _infoBoxProducao(
                    'Liberado p/ Rota', '$_booksLiberados', Colors.greenAccent),
              ],
            )
          ],
        ));
  }

  Widget _infoBoxProducao(String label, String value, Color color) {
    return Column(
      children: [
        Text(value,
            style: TextStyle(
                color: color, fontSize: 28, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label,
            style: const TextStyle(color: Colors.white70, fontSize: 12)),
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
          const Text('Todos os Books Produzidos',
              style: TextStyle(
                  color: Color(0xFFCE93D8),
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (_allClients.isEmpty)
            const Text('Nenhum book foi produzido ainda.',
                style: TextStyle(color: Colors.white54)),
          ..._allClients.map((c) {
            final name = c['name'] ?? 'Sem Nome';
            final city = c['city'] ?? 'Sem Cidade';
            final seq = c['sequenceNumber'] ?? 'S/N';
            final isReleased = c['releasedForRouting'] == true;

            return LedCard(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => SellerClientDetailScreen(
                        clientData: c,
                        isFotografo: true,
                      ),
                    ),
                  );
                },
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.menu_book, color: Colors.white),
                ),
                title: Text(name,
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Ficha: $seq | Cidade: $city',
                    style: const TextStyle(color: Colors.white70)),
                trailing: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: isReleased
                        ? Colors.green.withOpacity(0.2)
                        : Colors.orange.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    isReleased ? 'Liberado' : 'Aguardando',
                    style: TextStyle(
                      color:
                          isReleased ? Colors.greenAccent : Colors.orangeAccent,
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
      final name = c['photographer'] != null
          ? (c['photographer']['name'] ?? 'Sem Nome')
          : 'Sem Nome';
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
          const Text('Produção ao Vivo (Fotógrafos)',
              style: TextStyle(
                  color: Color(0xFFCE93D8),
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          if (pids.isEmpty)
            const Text('Nenhuma produção recente registrada.',
                style: TextStyle(color: Colors.white54)),
          ...pids.map((pid) {
            final name = photographerNames[pid]!;
            final live = liveCounts[pid] ?? 0;
            final closed = closedCounts[pid] ?? 0;

            if (live == 0 && closed == 0) return const SizedBox.shrink();

            return LedCard(
              color: Colors.white.withOpacity(0.05),
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(
                  backgroundColor: Colors.white12,
                  child: Icon(Icons.camera_alt_outlined, color: Colors.white),
                ),
                title: Text(name,
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (live > 0)
                      Text('$live fichas',
                          style: const TextStyle(
                              color: Colors.orangeAccent,
                              fontWeight: FontWeight.bold)),
                    if (closed > 0)
                      Text('Total: $closed fichas (Finalizado)',
                          style: const TextStyle(
                              color: Colors.greenAccent,
                              fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  void _showBooksModal(String title, List<Map<String, dynamic>> books) {
    Set<String> selectedIds = {};
    String? selectedSellerId;
    List<dynamic> sellersList = [];
    bool isLoadingSellers = true;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            if (isLoadingSellers) {
              ApiService().getSellers().then((s) {
                if (ctx.mounted) {
                  setModalState(() {
                    sellersList = s;
                    isLoadingSellers = false;
                  });
                }
              });
            }

            return DraggableScrollableSheet(
              initialChildSize: 0.85,
              minChildSize: 0.4,
              maxChildSize: 0.95,
              expand: false,
              builder: (_, scrollController) {
                final allSelected =
                    books.isNotEmpty && selectedIds.length == books.length;

                return Column(
                  children: [
                    const SizedBox(height: 12),
                    Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white30,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Row(
                        children: [
                          const Icon(Icons.menu_book_rounded,
                              color: Color(0xFFCE93D8)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '$title (${books.length})',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          if (books.isNotEmpty)
                            TextButton.icon(
                              onPressed: () {
                                setModalState(() {
                                  if (allSelected) {
                                    selectedIds.clear();
                                  } else {
                                    selectedIds = books
                                        .map((b) => b['id'].toString())
                                        .toSet();
                                  }
                                });
                              },
                              icon: Icon(
                                  allSelected
                                      ? Icons.deselect
                                      : Icons.select_all,
                                  color: const Color(0xFFCE93D8),
                                  size: 18),
                              label: Text(
                                  allSelected ? 'Desmarcar' : 'Marcar Tudo',
                                  style: const TextStyle(
                                      color: Color(0xFFCE93D8), fontSize: 12)),
                            ),
                          IconButton(
                            icon:
                                const Icon(Icons.close, color: Colors.white70),
                            onPressed: () => Navigator.pop(ctx),
                          ),
                        ],
                      ),
                    ),
                    const Divider(color: Colors.white12, height: 1),
                    Expanded(
                      child: books.isEmpty
                          ? const Center(
                              child: Text(
                                'Nenhum book encontrado nesta seleção.',
                                style: TextStyle(color: Colors.white54),
                              ),
                            )
                          : ListView.builder(
                              controller: scrollController,
                              itemCount: books.length,
                              itemBuilder: (context, index) {
                                final b = books[index];
                                final bId = b['id'].toString();
                                final isSelected = selectedIds.contains(bId);

                                return Container(
                                  color: isSelected
                                      ? const Color(0xFFCE93D8).withOpacity(0.1)
                                      : null,
                                  child: Row(
                                    children: [
                                      Checkbox(
                                        value: isSelected,
                                        activeColor: const Color(0xFFCE93D8),
                                        onChanged: (val) {
                                          setModalState(() {
                                            if (val == true) {
                                              selectedIds.add(bId);
                                            } else {
                                              selectedIds.remove(bId);
                                            }
                                          });
                                        },
                                      ),
                                      Expanded(
                                          child:
                                              _buildBookTile(b, null, false)),
                                    ],
                                  ),
                                );
                              },
                            ),
                    ),
                    if (selectedIds.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF2A1A4A),
                          boxShadow: [
                            BoxShadow(
                                color: Colors.black.withOpacity(0.4),
                                blurRadius: 10,
                                offset: const Offset(0, -2))
                          ],
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: DropdownButtonFormField<String>(
                                    value: selectedSellerId,
                                    dropdownColor: const Color(0xFF1A1A2E),
                                    style: const TextStyle(color: Colors.white),
                                    decoration: InputDecoration(
                                      labelText:
                                          'Selecione o Vendedor Destinatário',
                                      labelStyle: const TextStyle(
                                          color: Colors.white70),
                                      filled: true,
                                      fillColor: Colors.white10,
                                      border: OutlineInputBorder(
                                          borderRadius:
                                              BorderRadius.circular(8),
                                          borderSide: BorderSide.none),
                                      contentPadding:
                                          const EdgeInsets.symmetric(
                                              horizontal: 12, vertical: 8),
                                    ),
                                    items: sellersList
                                        .map<DropdownMenuItem<String>>((s) {
                                      return DropdownMenuItem<String>(
                                        value: s['id'].toString(),
                                        child: Text(s['name'] ?? 'Vendedor',
                                            style: const TextStyle(
                                                color: Colors.white)),
                                      );
                                    }).toList(),
                                    onChanged: (val) {
                                      setModalState(
                                          () => selectedSellerId = val);
                                    },
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            SizedBox(
                              width: double.infinity,
                              child: LedButton.icon(
                                onPressed: selectedSellerId == null
                                    ? null
                                    : () async {
                                        try {
                                          await ApiService().batchAssignClients(
                                              selectedIds.toList(),
                                              selectedSellerId!);
                                          Navigator.pop(ctx);
                                          _loadClients();
                                          if (mounted) {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(
                                              SnackBar(
                                                  content: Text(
                                                      'Sucesso! ${selectedIds.length} fichas distribuídas.'),
                                                  backgroundColor:
                                                      Colors.green),
                                            );
                                          }
                                        } catch (e) {
                                          if (mounted) {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(
                                              SnackBar(
                                                  content: Text(
                                                      'Erro ao atribuir: $e'),
                                                  backgroundColor: Colors.red),
                                            );
                                          }
                                        }
                                      },
                                icon: const Icon(Icons.send_rounded,
                                    color: Colors.white, size: 18),
                                label: Text(
                                    'Distribuir Lote (${selectedIds.length} Fichas)',
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold)),
                                style: LedButton.styleFrom(
                                    backgroundColor: Colors.green),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                );
              },
            );
          },
        );
      },
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
          // 🚛 Card Rotas e Chegada da Gráfica no topo da Aba Books
          LedCard(
            color: const Color(0xFF1A1A2E),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.local_shipping_rounded,
                          color: Color(0xFFFFB74D), size: 22),
                      SizedBox(width: 8),
                      Text('Rotas e Chegada da Gráfica',
                          style: TextStyle(
                              color: Color(0xFFFFB74D),
                              fontWeight: FontWeight.bold,
                              fontSize: 16)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                      'Confirme a chegada dos lotes impressos por evento para o estoque e distribua aos vendedores.',
                      style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: LedButton.icon(
                      onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const VisaoRotasChegada())),
                      icon: const Icon(Icons.inventory_rounded,
                          color: Colors.black),
                      label: const Text('Abrir Chegada da Gráfica',
                          style: TextStyle(
                              color: Colors.black,
                              fontWeight: FontWeight.bold)),
                      style: LedButton.styleFrom(
                          backgroundColor: const Color(0xFFFFB74D)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Resumo geral
          InkWell(
            onTap: () {
              final allBooksList = <Map<String, dynamic>>[];
              for (final team in _realPhotoEvents) {
                final teamBooks = team['allBooks'] as List?;
                if (teamBooks != null) {
                  allBooksList.addAll(teamBooks.cast<Map<String, dynamic>>());
                }
              }
              _showBooksModal('Total de Books Criadas', allBooksList);
            },
            borderRadius: BorderRadius.circular(18),
            child: Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF1A0030), Color(0xFF3A0068)],
                ),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: _accentPurple.withOpacity(0.3)),
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
                      Text(
                          '${_realPhotoEvents.length} equipes ativas (Toque p/ ver)',
                          style: const TextStyle(
                              color: Color(0xFFCE93D8), fontSize: 12)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Cards por equipe
          ..._realPhotoEvents.map((team) {
            final color = team['color'] as Color;
            final events = team['events'] as List;
            final teamTotal =
                events.fold<int>(0, (s, e) => s + (e['photos'] as int));

            return Container(
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A2E),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: color.withOpacity(0.25)),
              ),
              child: Column(
                children: [
                  // Header da equipe
                  InkWell(
                    onTap: () {
                      final books = List<Map<String, dynamic>>.from(
                          team['allBooks'] ?? []);
                      _showBooksModal('Books - ${team['team']}', books);
                    },
                    borderRadius:
                        const BorderRadius.vertical(top: Radius.circular(20)),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [color.withOpacity(0.15), Colors.transparent],
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
                              border: Border.all(color: color.withOpacity(0.5)),
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
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text('$teamTotal',
                                  style: TextStyle(
                                      color: color,
                                      fontSize: 20,
                                      fontWeight: FontWeight.bold)),
                              const Text('books (Toque p/ abrir)',
                                  style: TextStyle(
                                      color: Color(0xFF90CAF9), fontSize: 10)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  // Eventos
                  ...events.asMap().entries.map((entry) {
                    final i = entry.key;
                    final e = entry.value as Map;
                    final isLast = i == events.length - 1;
                    final eventBooks =
                        List<Map<String, dynamic>>.from(e['books'] ?? []);

                    return InkWell(
                      onTap: () =>
                          _showBooksModal(e['event'] as String, eventBooks),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 12),
                        decoration: BoxDecoration(
                          border: isLast
                              ? null
                              : Border(
                                  bottom: BorderSide(
                                      color: Colors.white.withOpacity(0.06))),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 38,
                              height: 38,
                              decoration: BoxDecoration(
                                color: color.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(Icons.camera_alt_rounded,
                                  color: color, size: 18),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(e['event'] as String,
                                      style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 2),
                                  Row(children: [
                                    const Icon(Icons.location_on_outlined,
                                        color: Color(0xFF90CAF9), size: 12),
                                    const SizedBox(width: 3),
                                    Text(e['city'] as String,
                                        style: const TextStyle(
                                            color: Color(0xFF90CAF9),
                                            fontSize: 11)),
                                  ]),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('${e['photos']}',
                                    style: TextStyle(
                                        color: color,
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold)),
                                const Text('books',
                                    style: TextStyle(
                                        color: Color(0xFF90CAF9),
                                        fontSize: 10)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            );
          }),
          const SizedBox(height: 24),
          // 🗺️ Card Mapeamento de Rotas no final da Aba Books
          LedCard(
            color: const Color(0xFF1A1A2E),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.route_rounded,
                          color: Color(0xFF80DEEA), size: 22),
                      SizedBox(width: 8),
                      Text('Mapeamento de Rotas & Transbordo',
                          style: TextStyle(
                              color: Color(0xFF80DEEA),
                              fontWeight: FontWeight.bold,
                              fontSize: 16)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  const Text(
                      'Visualiza itinerários de 300 km para retransportar fichas perdidas entre rotas de vendedores no mesmo trajeto.',
                      style: TextStyle(color: Colors.white70, fontSize: 12)),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: LedButton.icon(
                      onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const VisaoRoteiroInteligente())),
                      icon: const Icon(Icons.alt_route_rounded,
                          color: Colors.black),
                      label: const Text('Abrir Mapeamento de Rotas',
                          style: TextStyle(
                              color: Colors.black,
                              fontWeight: FontWeight.bold)),
                      style: LedButton.styleFrom(
                          backgroundColor: const Color(0xFF80DEEA)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ABA 3 — ESTOQUE NÃO-VENDAS
  // ══════════════════════════════════════════════════════════════════════════
  // ABA 3 — ESTOQUE NÃO-VENDAS (REBOLO)
  // ══════════════════════════════════════════════════════════════════════════
  void _showReboloOverviewModal() {
    final totalGeral = _rebolosInStock.length +
        _rebolosAwaitingReturn.length +
        _rebolosInRoute.length +
        _rebolosHistory.length;

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  const Icon(Icons.analytics_rounded, color: Color(0xFFEF5350), size: 24),
                  const SizedBox(width: 10),
                  Text('Detalhamento de Rebolos ($totalGeral)',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 18)),
                ],
              ),
              const SizedBox(height: 16),
              _buildOverviewRow('Disponíveis para Redistribuição', _rebolosInStock.length, Colors.greenAccent, Icons.inventory_2_rounded),
              _buildOverviewRow('Aguardando Devolução do Vendedor', _rebolosAwaitingReturn.length, Colors.orangeAccent, Icons.assignment_return_rounded),
              _buildOverviewRow('Em Rota com Novo Vendedor', _rebolosInRoute.length, Colors.blueAccent, Icons.local_shipping_rounded),
              _buildOverviewRow('Histórico (Vendidas / Descarte)', _rebolosHistory.length, Colors.white70, Icons.history_rounded),
              const SizedBox(height: 20),
              if (_rebolosInStock.isNotEmpty)
                LedButton.icon(
                  onPressed: () {
                    Navigator.pop(ctx);
                    _showBooksModal('Rebolo - Todas Cidades', _rebolosInStock);
                  },
                  icon: const Icon(Icons.send_rounded, color: Colors.white, size: 18),
                  label: Text('Distribuir Fichas Disponíveis (${_rebolosInStock.length})',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  style: LedButton.styleFrom(backgroundColor: const Color(0xFFEF5350)),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildOverviewRow(String title, int count, Color color, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 12),
          Expanded(child: Text(title, style: const TextStyle(color: Colors.white70, fontSize: 13))),
          Text('$count', style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildStockTab() {
    final totalGeral = _rebolosInStock.length +
        _rebolosAwaitingReturn.length +
        _rebolosInRoute.length +
        _rebolosHistory.length;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Resumo total interativo
          GestureDetector(
            onTap: _showReboloOverviewModal,
            child: Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF1A0A00), Color(0xFF3A1000)],
                ),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFFEF5350).withOpacity(0.3)),
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
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Estoque de Não-Vendas (Rebolo)',
                            style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
                        Text('$totalGeral fichas',
                            style: const TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.bold)),
                        Text('${_rebolosInStock.length} disponíveis • ${_rotasRebolo.length} cidades',
                            style: const TextStyle(color: Color(0xFFEF9A9A), fontSize: 12)),
                      ],
                    ),
                  ),
                  const Column(
                    children: [
                      Icon(Icons.touch_app_rounded, color: Color(0xFF90CAF9), size: 20),
                      SizedBox(height: 2),
                      Text('Toque para\nver detalhes',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Color(0xFF90CAF9), fontSize: 10)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Seletor de Categorias
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildReboloCategoryChip('Disponíveis (${_rebolosInStock.length})', 0, Colors.greenAccent),
                const SizedBox(width: 8),
                _buildReboloCategoryChip('Aguardando Devolução (${_rebolosAwaitingReturn.length})', 1, Colors.orangeAccent),
                const SizedBox(width: 8),
                _buildReboloCategoryChip('Em Rota (${_rebolosInRoute.length})', 2, Colors.blueAccent),
                const SizedBox(width: 8),
                _buildReboloCategoryChip('Histórico (${_rebolosHistory.length})', 3, Colors.white60),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Conteúdo de acordo com a categoria selecionada
          if (_selectedReboloTab == 0) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Disponíveis por Cidade',
                    style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
                if (_rebolosInStock.isNotEmpty)
                  TextButton.icon(
                    onPressed: () => _showBooksModal('Rebolo - Todas Cidades', _rebolosInStock),
                    icon: const Icon(Icons.send_rounded, color: Color(0xFFCE93D8), size: 16),
                    label: const Text('Distribuir Lote',
                        style: TextStyle(color: Color(0xFFCE93D8), fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (_rotasRebolo.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text('Nenhuma ficha de rebolo disponível para redistribuição no momento.',
                      style: TextStyle(color: Colors.white54)),
                ),
              )
            else
              ..._rotasRebolo.map((c) => _buildCityStockCard(c)),
          ] else if (_selectedReboloTab == 1) ...[
            const Text('Fichas com Vendedores Aguardando Devolução',
                style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (_rebolosAwaitingReturn.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text('Nenhuma ficha aguardando devolução no momento.',
                      style: TextStyle(color: Colors.white54)),
                ),
              )
            else
              ..._rebolosAwaitingReturn.map((b) => _buildReboloTile(b, const Color(0xFFFFA726))),
          ] else if (_selectedReboloTab == 2) ...[
            const Text('Fichas de Rebolo Distribuídas em Rota',
                style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (_rebolosInRoute.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text('Nenhuma ficha de rebolo em rota com vendedor.',
                      style: TextStyle(color: Colors.white54)),
                ),
              )
            else
              ..._rebolosInRoute.map((b) => _buildReboloTile(b, const Color(0xFF42A5F5))),
          ] else ...[
            const Text('Histórico de Rebolos (Vendidas e Descarte)',
                style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (_rebolosHistory.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text('Nenhum registro histórico de rebolo encontrado.',
                      style: TextStyle(color: Colors.white54)),
                ),
              )
            else
              ..._rebolosHistory.map((b) => _buildReboloTile(b, const Color(0xFFAB47BC))),
          ],
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  Widget _buildReboloCategoryChip(String label, int index, Color accentColor) {
    final isSelected = _selectedReboloTab == index;
    return ChoiceChip(
      label: Text(label,
          style: TextStyle(
              color: isSelected ? Colors.white : Colors.white60,
              fontSize: 12,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
      selected: isSelected,
      selectedColor: accentColor.withOpacity(0.3),
      backgroundColor: const Color(0xFF1A1A2E),
      side: BorderSide(color: isSelected ? accentColor : Colors.white12),
      onSelected: (_) => setState(() => _selectedReboloTab = index),
    );
  }

  Widget _buildReboloTile(Map<String, dynamic> b, Color color) {
    final clientName = (b['client'] ?? b['cliente'] ?? b['name'] ?? 'Cliente').toString();
    final seq = (b['seq'] ?? b['ficha'] ?? b['sequenceNumber'] ?? '-').toString();
    final city = (b['city'] ?? 'Sem Cidade').toString();
    final sellerName = b['assignedSeller']?['name']?.toString() ?? 'Não atribuído';
    final reason = (b['reason'] ?? b['bookStatus'] ?? '').toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: color.withOpacity(0.15),
            child: Text(seq, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(clientName,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                const SizedBox(height: 2),
                Text('Cidade: $city | Vendedor: $sellerName',
                    style: const TextStyle(color: Colors.white70, fontSize: 11)),
                if (reason.isNotEmpty)
                  Text('Motivo: $reason', style: TextStyle(color: color, fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCityStockCard(Map<String, dynamic> cityData) {
    final total = (cityData['total'] ?? (cityData['fichas'] as List?)?.length ?? (cityData['books'] as List?)?.length ?? 0) as int;
    final city = (cityData['city'] ?? cityData['title'] ?? 'Sem Cidade').toString();
    final fichas = (cityData['fichas'] ?? cityData['books'] ?? []) as List;
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
          border: Border.all(color: urgencyColor.withOpacity(0.25), width: 1),
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
                      Text('${fichas.length} fichas detalhadas disponíveis',
                          style: const TextStyle(
                              color: Color(0xFF90CAF9), fontSize: 11)),
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
                        style:
                            TextStyle(color: Color(0xFF90CAF9), fontSize: 10)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Stack(
                      children: [
                        Container(
                            height: 6, color: Colors.white.withOpacity(0.08)),
                        FractionallySizedBox(
                          widthFactor: barPct,
                          child: Container(height: 6, color: urgencyColor),
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

  void _showStockBottomSheet(String city, List fichas) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _StockBottomSheet(
        city: city,
        fichas: fichas,
        onDistribute: () {
          Navigator.pop(context);
          final books = fichas.map((f) => Map<String, dynamic>.from(f as Map)).toList();
          _showBooksModal('Rebolo - $city', books);
        },
      ),
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
                  child: Text('Leitura de Saída (QR Code)',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.bold)),
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
                  child: Text('Aponte a câmera para o QR Code impresso no book',
                      style: TextStyle(color: Colors.white70)),
                )
              ],
            ),
          );
        });
  }

  void _assignBookToSellerDialog(String qrCode, bool isRebolo) {
    String? selectedSeller;
    showDialog(
        context: context,
        builder: (context) {
          return StatefulBuilder(builder: (context, setDialogState) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: const Text('Atribuir via QR Code',
                  style: TextStyle(color: Colors.white)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Ficha/Book: $qrCode',
                      style: const TextStyle(
                          color: Color(0xFFCE93D8),
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  const Text('Selecione o Vendedor:',
                      style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                        color: Colors.white10,
                        borderRadius: BorderRadius.circular(8)),
                    child: DropdownButton<String>(
                      value: selectedSeller,
                      items: _companySellers
                          .map((seller) => DropdownMenuItem<String>(
                                value: seller['id'].toString(),
                                child: Text(seller['name'].toString(),
                                    style:
                                        const TextStyle(color: Colors.white)),
                              ))
                          .toList(),
                      onChanged: (v) {
                        setDialogState(() => selectedSeller = v);
                      },
                      dropdownColor: const Color(0xFF1E1E2C),
                      isExpanded: true,
                      underline: const SizedBox(),
                      hint: const Text('Selecionar',
                          style: TextStyle(color: Colors.white54)),
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancelar',
                        style: TextStyle(color: Colors.white54))),
                LedButton(
                  onPressed: selectedSeller == null
                      ? null
                      : () {
                          Navigator.pop(context);
                          _distribuirBookPorQR(
                              qrCode, selectedSeller!, isRebolo);
                        },
                  style: LedButton.styleFrom(
                      backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Confirmar',
                      style: TextStyle(color: Colors.white)),
                ),
              ],
            );
          });
        });
  }

  Future<void> _distribuirBookPorQR(
      String qr, String sellerId, bool isRebolo) async {
    try {
      await ApiService().assignSeller(qr, sellerId);
      await _loadClients(); // Atualiza a tela com o novo status
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Book distribuído com sucesso!'),
          backgroundColor: Colors.green));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Erro ao atribuir: $e'), backgroundColor: Colors.red));
    }
  }

  void _printBatch(String seller, bool isRebolo) async {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(
            'Preparando lote de ${isRebolo ? "rebolos" : "books"} de $seller...')));
    final books =
        isRebolo ? _rebolosDistribuidos[seller] : _booksDistribuidos[seller];
    if (books != null && books.isNotEmpty) {
      final clients = books
          .map((b) => b['rawClientData'])
          .whereType<Map<String, dynamic>>()
          .toList();
      if (clients.isNotEmpty) {
        await PdfGenerator.printBatch(clients, seller);
      }
    }
  }

  void _printItem(Map<String, dynamic> book, bool isRebolo) async {
    ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Imprimindo unidade: ${book['ficha']}...")));
    if (book['rawClientData'] != null) {
      await PdfGenerator.printFicha(book['rawClientData']);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text("Dados do cliente incompletos para impressão.")));
    }
  }

  Widget _loteCard(String title, String subtitle, Color color,
      {Widget? trailing}) {
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
              Text(title,
                  style: TextStyle(color: color, fontWeight: FontWeight.bold)),
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
                  child: Text(
                      isRebolo
                          ? 'Rotas de Rebolo (Revisita)'
                          : 'Rotas Inteligentes (Manual)',
                      style: const TextStyle(
                          color: Color(0xFFCE93D8),
                          fontSize: 18,
                          fontWeight: FontWeight.bold)),
                ),
                LedButton.icon(
                  onPressed: () => _showNovaRotaDialog(isRebolo),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Nova Rota'),
                  style:
                      LedButton.styleFrom(backgroundColor: Colors.blueAccent),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
                isRebolo
                    ? 'Organize os rebolos em rotas manuais para revisitas.'
                    : 'Organize os books prontos em rotas manuais.',
                style: const TextStyle(color: Colors.white54, fontSize: 12)),
            const SizedBox(height: 16),
            if ((isRebolo ? _rebolosNaoAtribuidos : _booksNaoAtribuidos)
                .isNotEmpty)
              _buildNaoAtribuidosSection(isRebolo),
            const SizedBox(height: 8),
            ...(isRebolo ? _rotasRebolo : _rotasManuais)
                .map((rota) => _buildRotaCard(rota, isRebolo)),
            const SizedBox(height: 24),
            const Divider(color: Colors.white24),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                      isRebolo
                          ? 'Malotes de Revisita (Saída)'
                          : 'Malotes dos Vendedores (Saída)',
                      style: const TextStyle(
                          color: Colors.greenAccent,
                          fontSize: 18,
                          fontWeight: FontWeight.bold)),
                ),
                LedButton(
                  onPressed: () => _scanAndDistributeBooks(isRebolo: isRebolo),
                  icon: Icons.qr_code_scanner,
                  text: 'Escanear QR',
                ),
              ],
            ),
            const SizedBox(height: 16),
            if ((isRebolo ? _rebolosDistribuidos : _booksDistribuidos).isEmpty)
              Text(
                  isRebolo
                      ? 'Nenhum rebolo distribuído ainda.'
                      : 'Nenhum book distribuído ainda.',
                  style: const TextStyle(color: Colors.white54)),
            ...(isRebolo ? _rebolosDistribuidos : _booksDistribuidos)
                .entries
                .map((e) => _buildMaloteCard(e.key, e.value, isRebolo)),
          ],
        ));
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
        title: Text('${isRebolo ? "Rebolos" : "Books"} Não Atribuídos ($count)',
            style: const TextStyle(
                color: Colors.orangeAccent, fontWeight: FontWeight.bold)),
        iconColor: Colors.orangeAccent,
        collapsedIconColor: Colors.orangeAccent,
        children: list.map((b) => _buildBookTile(b, null, isRebolo)).toList(),
      ),
    );
  }

  Widget _buildRotaCard(Map<String, dynamic> rota, bool isRebolo) {
    final List books = rota['books'] as List;
    return LedCard(
      color: Colors.white.withOpacity(0.05),
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ExpansionTile(
        title: Row(
          children: [
            const Icon(Icons.map_rounded, color: Colors.blueAccent, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text('${rota['title']} (${books.length} Books)',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
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
                  label: const Text('Renomear',
                      style: TextStyle(color: Colors.white70)),
                ),
                TextButton.icon(
                  onPressed: () => _atribuirRotaInteiraDialog(rota, isRebolo),
                  icon: const Icon(Icons.local_shipping,
                      color: Colors.greenAccent, size: 16),
                  label: const Text('Atribuir Rota',
                      style: TextStyle(color: Colors.greenAccent)),
                ),
                TextButton.icon(
                  onPressed: () => _excluirRota(rota, isRebolo),
                  icon: const Icon(Icons.delete_outline,
                      color: Colors.redAccent, size: 16),
                  label: const Text('Excluir Rota',
                      style: TextStyle(color: Colors.redAccent)),
                ),
              ],
            ),
          ),
          ...books.map((b) => _buildBookTile(b, rota['id'], isRebolo)),
        ],
      ),
    );
  }

  Widget _buildBookTile(
      Map<String, dynamic> book, String? rotaId, bool isRebolo) {
    return ListTile(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => SellerClientDetailScreen(
              clientData: book['rawClientData'] ?? book,
              isFotografo: true,
            ),
          ),
        );
      },
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      title: Text(book['cliente'] as String,
          style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
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

          items.add(const PopupMenuItem(
              value: 'atribuir_vendedor',
              child: Text('Atribuir a Vendedor',
                  style: TextStyle(color: Colors.greenAccent))));
          items.add(const PopupMenuDivider());

          if (rotaId != null) {
            items.add(const PopupMenuItem(
                value: 'desatribuir',
                child: Text('Mover para Não Atribuídos',
                    style: TextStyle(color: Colors.orangeAccent))));
          }
          for (var r in (isRebolo ? _rotasRebolo : _rotasManuais)) {
            if (r['id'] != rotaId) {
              items.add(PopupMenuItem(
                  value: r['id'],
                  child: Text('Mover para ${r['title']}',
                      style: const TextStyle(color: Colors.white))));
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
      decoration: BoxDecoration(
          color: Colors.white12, borderRadius: BorderRadius.circular(4)),
      child: Text(text,
          style: const TextStyle(color: Colors.white70, fontSize: 10)),
    );
  }

  void _showNovaRotaDialog(bool isRebolo) {
    final ctrl = TextEditingController();
    showDialog(
        context: context,
        builder: (context) => AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: const Text('Nova Rota',
                  style: TextStyle(color: Colors.white)),
              content: TextField(
                controller: ctrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                    hintText: 'Nome da Rota',
                    hintStyle: TextStyle(color: Colors.white54)),
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancelar',
                        style: TextStyle(color: Colors.white54))),
                LedButton(
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
                  style: LedButton.styleFrom(
                      backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Criar',
                      style: TextStyle(color: Colors.white)),
                )
              ],
            ));
  }

  void _showRenomearRotaDialog(Map<String, dynamic> rota, bool isRebolo) {
    final ctrl = TextEditingController(text: rota['title']);
    showDialog(
        context: context,
        builder: (context) => AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: const Text('Renomear Rota',
                  style: TextStyle(color: Colors.white)),
              content: TextField(
                controller: ctrl,
                style: const TextStyle(color: Colors.white),
              ),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancelar',
                        style: TextStyle(color: Colors.white54))),
                LedButton(
                  onPressed: () {
                    if (ctrl.text.isNotEmpty) {
                      setState(() {
                        rota['title'] = ctrl.text;
                      });
                      Navigator.pop(context);
                    }
                  },
                  style: LedButton.styleFrom(
                      backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Salvar',
                      style: TextStyle(color: Colors.white)),
                )
              ],
            ));
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
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(
            'Rota excluída. ${isRebolo ? "Rebolos" : "Books"} movidos para Não Atribuídos.')));
  }

  Widget _buildMaloteCard(
      String seller, List<Map<String, dynamic>> books, bool isRebolo) {
    return LedCard(
      color: Colors.greenAccent.withOpacity(0.05),
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: Colors.greenAccent.withOpacity(0.3))),
      child: ExpansionTile(
        title: Row(
          children: [
            const Icon(Icons.person, color: Colors.greenAccent, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                  '$seller (${books.length} ${isRebolo ? "Rebolos" : "Books"})',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
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
        children: books
            .map((b) => ListTile(
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => SellerClientDetailScreen(
                          clientData: b['rawClientData'] ?? b,
                          isFotografo: true,
                        ),
                      ),
                    );
                  },
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 0),
                  title: Text(b['cliente'] as String,
                      style:
                          const TextStyle(color: Colors.white, fontSize: 13)),
                  subtitle: Text('Ficha: ${b['ficha']} | Lote: ${b['lote']}',
                      style:
                          const TextStyle(color: Colors.white54, fontSize: 11)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.print,
                            color: Colors.blueAccent, size: 18),
                        tooltip: 'Imprimir Ficha',
                        onPressed: () => _printItem(b, isRebolo),
                      ),
                      IconButton(
                        icon: const Icon(Icons.settings_backup_restore,
                            color: Colors.orangeAccent, size: 18),
                        tooltip: 'Forçar Resgate pro Estoque',
                        onPressed: () async {
                          final confirm = await showDialog<bool>(
                            context: context,
                            builder: (_) => AlertDialog(
                              backgroundColor: const Color(0xFF1A1A2E),
                              title: const Text('Forçar Resgate?',
                                  style: TextStyle(color: Colors.white)),
                              content: const Text(
                                  'Isso removerá a ficha deste vendedor imediatamente e a devolverá para o estoque. Deseja continuar?',
                                  style: TextStyle(color: Colors.white70)),
                              actions: [
                                TextButton(
                                    onPressed: () =>
                                        Navigator.pop(context, false),
                                    child: const Text('Cancelar')),
                                TextButton(
                                    onPressed: () =>
                                        Navigator.pop(context, true),
                                    child: const Text('Resgatar',
                                        style: TextStyle(
                                            color: Colors.orangeAccent))),
                              ],
                            ),
                          );
                          if (confirm == true) {
                            try {
                              ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                      content: Text('Resgatando ficha...')));
                              final fichaId =
                                  b['rawClientData']?['id'] ?? b['id'];
                              if (isRebolo) {
                                await ApiService()
                                    .forceReturnReboloStock(fichaId);
                              } else {
                                await ApiService().forceReturnToStock(fichaId);
                              }
                              _loadClients(); // Reload from backend
                              if (mounted)
                                ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                        content: Text(
                                            'Ficha resgatada com sucesso!'),
                                        backgroundColor: Colors.green));
                            } catch (e) {
                              if (mounted)
                                ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                        content: Text('Erro ao resgatar: $e'),
                                        backgroundColor: Colors.red));
                            }
                          }
                        },
                      ),
                    ],
                  ),
                ))
            .toList(),
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
                  title: const Text('Atribuir Rota Inteira',
                      style: TextStyle(color: Colors.white)),
                  content: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          'Rota: ${rota['title']} (${(rota['books'] as List).length} ${isRebolo ? "rebolos" : "books"})',
                          style: const TextStyle(color: Colors.white70)),
                      const SizedBox(height: 16),
                      DropdownButton<String>(
                        value: selectedSeller,
                        isExpanded: true,
                        dropdownColor: const Color(0xFF1E1E2C),
                        hint: const Text('Selecione o Vendedor',
                            style: TextStyle(color: Colors.white54)),
                        items: _companySellers
                            .map((seller) => DropdownMenuItem<String>(
                                  value: seller['id'].toString(),
                                  child: Text(seller['name'].toString(),
                                      style:
                                          const TextStyle(color: Colors.white)),
                                ))
                            .toList(),
                        onChanged: (v) =>
                            setDialogState(() => selectedSeller = v),
                      ),
                    ],
                  ),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Cancelar',
                            style: TextStyle(color: Colors.white54))),
                    LedButton(
                      onPressed: selectedSeller == null
                          ? null
                          : () async {
                              final sellerId = selectedSeller!;
                              final clientIds = (rota['books'] as List)
                                  .map((book) =>
                                      book['rawClientData']?['id'] ??
                                      book['id'])
                                  .whereType<String>()
                                  .toList();
                              try {
                                await ApiService()
                                    .batchAssignSeller(clientIds, sellerId);
                                if (!context.mounted) return;
                                Navigator.pop(context);
                                await _loadClients();
                                if (mounted)
                                  ScaffoldMessenger.of(this.context)
                                      .showSnackBar(SnackBar(
                                          content: Text(
                                              'Rota atribuída para ${_sellerName(sellerId)}!'),
                                          backgroundColor: Colors.green));
                              } catch (e) {
                                if (context.mounted)
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                          content:
                                              Text('Erro ao atribuir rota: $e'),
                                          backgroundColor: Colors.red));
                              }
                            },
                      style: LedButton.styleFrom(
                          backgroundColor: Colors.greenAccent),
                      child: const Text('Atribuir',
                          style: TextStyle(color: Colors.white)),
                    )
                  ],
                )));
  }

  void _atribuirBookDialog(
      Map<String, dynamic> book, String? rotaId, bool isRebolo) {
    String? selectedSeller;
    bool isSubmitting = false;
    showDialog(
        context: context,
        builder: (context) => StatefulBuilder(
            builder: (dialogCtx, setDialogState) => AlertDialog(
                  backgroundColor: const Color(0xFF1E1E2C),
                  title: const Text('Atribuir Book Individual',
                      style: TextStyle(color: Colors.white)),
                  content: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Ficha: ${book['ficha']} (${book['cliente']})',
                          style: const TextStyle(color: Colors.white70)),
                      const SizedBox(height: 16),
                      DropdownButton<String>(
                        value: selectedSeller,
                        isExpanded: true,
                        dropdownColor: const Color(0xFF1E1E2C),
                        hint: const Text('Selecione o Vendedor',
                            style: TextStyle(color: Colors.white54)),
                        items: _companySellers
                            .map((seller) => DropdownMenuItem<String>(
                                  value: seller['id'].toString(),
                                  child: Text(seller['name'].toString(),
                                      style:
                                          const TextStyle(color: Colors.white)),
                                ))
                            .toList(),
                        onChanged: isSubmitting
                            ? null
                            : (v) =>
                                setDialogState(() => selectedSeller = v),
                      ),
                    ],
                  ),
                  actions: [
                    TextButton(
                        onPressed: isSubmitting ? null : () => Navigator.pop(dialogCtx),
                        child: const Text('Cancelar',
                            style: TextStyle(color: Colors.white54))),
                    LedButton(
                      onPressed: (selectedSeller == null || isSubmitting)
                          ? null
                          : () async {
                              setDialogState(() => isSubmitting = true);
                              final sellerId = selectedSeller!;
                              final clientId =
                                  (book['rawClientData']?['id'] ?? book['id'])
                                      ?.toString();
                              if (clientId == null || clientId.isEmpty) {
                                setDialogState(() => isSubmitting = false);
                                return;
                              }
                              try {
                                await ApiService()
                                    .batchAssignSeller([clientId], sellerId);
                                if (!dialogCtx.mounted) return;
                                Navigator.pop(dialogCtx, true);

                                // Remover da lista local imediatamente
                                setState(() {
                                  if (rotaId != null) {
                                    final rotas = isRebolo ? _rotasRebolo : _rotasManuais;
                                    final idx = rotas.indexWhere((r) => r['id'] == rotaId);
                                    if (idx != -1 && rotas[idx]['books'] is List) {
                                      (rotas[idx]['books'] as List).removeWhere(
                                          (b) => (b['id'] == clientId || b['ficha'] == book['ficha']));
                                    }
                                  } else {
                                    (isRebolo ? _rebolosNaoAtribuidos : _booksNaoAtribuidos)
                                        .removeWhere((b) => (b['id'] == clientId || b['ficha'] == book['ficha']));
                                  }
                                });

                                await _loadClients();
                                if (mounted) {
                                  ScaffoldMessenger.of(this.context)
                                      .showSnackBar(SnackBar(
                                          content: Text(
                                              '${isRebolo ? "Rebolo" : "Book"} atribuído para ${_sellerName(sellerId)}!'),
                                          backgroundColor: Colors.green));
                                }
                              } catch (e) {
                                if (dialogCtx.mounted) {
                                  setDialogState(() => isSubmitting = false);
                                }
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                          content: Text('Erro ao atribuir: $e'),
                                          backgroundColor: Colors.red));
                                }
                              }
                            },
                      style: LedButton.styleFrom(
                          backgroundColor: Colors.greenAccent),
                      child: isSubmitting
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  color: Colors.black, strokeWidth: 2))
                          : const Text('Atribuir',
                              style: TextStyle(color: Colors.white)),
                    )
                  ],
                )));
  }

  void _moverBook(Map<String, dynamic> book, String? fromRotaId,
      String? toRotaId, bool isRebolo) {
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
  final VoidCallback? onDistribute;

  const _StockBottomSheet({
    required this.city,
    required this.fichas,
    this.onDistribute,
  });

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
      constraints:
          BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
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
                              color: Color(0xFF90CAF9), fontSize: 12)),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon:
                      const Icon(Icons.close_rounded, color: Color(0xFF90CAF9)),
                ),
              ],
            ),
          ),
          if (onDistribute != null && fichas.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: SizedBox(
                width: double.infinity,
                child: LedButton.icon(
                  onPressed: onDistribute,
                  icon: const Icon(Icons.send_rounded, color: Colors.white, size: 18),
                  label: Text('Distribuir Lote (${fichas.length} Fichas)',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  style: LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                ),
              ),
            ),
          ],
          const Divider(color: Color(0xFF2A2A4A), height: 1),
          // Lista de fichas
          Flexible(
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: fichas.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                final f = fichas[i] is Map ? fichas[i] as Map : {};
                final clientName = (f['client'] ?? f['cliente'] ?? f['name'] ?? 'Cliente').toString();
                final seq = (f['seq'] ?? f['ficha'] ?? f['sequenceNumber'] ?? '-').toString();
                final lote = (f['lote'] ?? f['batchId'] ?? 'Rebolo').toString();
                final reason = (f['reason'] ?? f['nonSaleReason'] ?? f['bookStatus'] ?? 'Não-venda').toString();
                final rColor = _reasonColor(reason);

                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A2E),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: rColor.withOpacity(0.2)),
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
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Nome + ficha
                            Row(children: [
                              Expanded(
                                child: Text(clientName,
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
                                  color: Color(0xFF4FC3F7), size: 12),
                              const SizedBox(width: 3),
                              Text(seq,
                                  style: const TextStyle(
                                      color: Color(0xFF4FC3F7),
                                      fontSize: 11,
                                      fontFamily: 'monospace')),
                              const SizedBox(width: 12),
                              // Lote
                              const Icon(Icons.inventory_rounded,
                                  color: Color(0xFF90CAF9), size: 12),
                              const SizedBox(width: 3),
                              Text(lote,
                                  style: const TextStyle(
                                      color: Color(0xFF90CAF9), fontSize: 11)),
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
                          border: Border.all(color: rColor.withOpacity(0.35)),
                        ),
                        child: Text(
                          reason.split(' ').take(2).join('\n'),
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
