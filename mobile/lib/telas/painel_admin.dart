import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import 'tela_login.dart';
import 'visao_frota_admin.dart';
import 'visao_fluxo_caixa_admin.dart';
import 'tela_cadastro_custos.dart';
import 'painel_saude.dart';
import 'tela_gerenciamento_funcionarios.dart';
import 'visao_prospectos_ia.dart';
import 'visao_fechamento_admin.dart';
import 'visao_estoque_admin.dart';
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

// ── Mock: books por equipe ────────────────────────────────────────────────────
final _photoEvents = [
  {
    'team': 'Equipe 1 — SP',
    'code': 'EQP1',
    'color': const Color(0xFFAB47BC),
    'events': [
      {'event': 'Formatura Colégio Alpha', 'city': 'São Paulo', 'photos': 312},
      {'event': 'Aniversário 15 Anos Club', 'city': 'Santo André', 'photos': 185},
      {'event': 'Casamento Silva & Costa', 'city': 'São Paulo', 'photos': 428},
    ],
  },
  {
    'team': 'Equipe 2 — Campinas',
    'code': 'EQP2',
    'color': const Color(0xFF7E57C2),
    'events': [
      {'event': 'Formatura Escola Beta', 'city': 'Campinas', 'photos': 276},
      {'event': 'Evento Corporativo TechCo', 'city': 'Campinas', 'photos': 143},
      {'event': 'Aniversário Família Rocha', 'city': 'Limeira', 'photos': 97},
    ],
  },
  {
    'team': 'Equipe 3 — Ribeirão',
    'code': 'EQP3',
    'color': const Color(0xFF5C6BC0),
    'events': [
      {'event': 'Formatura Colégio Gamma', 'city': 'Ribeirão Preto', 'photos': 341},
      {'event': 'Casamento Nunes & Lima', 'city': 'Franca', 'photos': 512},
    ],
  },
];

// ── Mock: Estoque não-vendas ──────────────────────────────────────────────────
final _stockByCity = [
  {
    'city': 'São Paulo',
    'total': 23,
    'fichas': [
      {'seq': 'CF-EQP1-0003', 'lote': 'L2024-06', 'client': 'Maria Silva',     'reason': 'Sem interesse'},
      {'seq': 'CF-EQP1-0007', 'lote': 'L2024-06', 'client': 'João Ferreira',   'reason': 'Sem condições'},
      {'seq': 'CF-EQP1-0012', 'lote': 'L2024-06', 'client': 'Ana Costa',       'reason': 'Book trocado'},
      {'seq': 'CF-EQP1-0019', 'lote': 'L2024-06', 'client': 'Pedro Santos',    'reason': 'Dados incorretos'},
      {'seq': 'CF-EQP1-0021', 'lote': 'L2024-06', 'client': 'Lucia Barbosa',   'reason': 'Sem qualidade'},
    ],
  },
  {
    'city': 'Campinas',
    'total': 17,
    'fichas': [
      {'seq': 'CF-EQP2-0005', 'lote': 'L2024-06', 'client': 'Carlos Mendes',   'reason': 'Sem interesse'},
      {'seq': 'CF-EQP2-0009', 'lote': 'L2024-06', 'client': 'Beatriz Lima',    'reason': 'Sem condições'},
      {'seq': 'CF-EQP2-0014', 'lote': 'L2024-06', 'client': 'Roberto Alves',   'reason': 'Book trocado'},
    ],
  },
  {
    'city': 'Ribeirão Preto',
    'total': 11,
    'fichas': [
      {'seq': 'CF-EQP3-0002', 'lote': 'L2024-06', 'client': 'Fernanda Neves',  'reason': 'Sem interesse'},
      {'seq': 'CF-EQP3-0008', 'lote': 'L2024-06', 'client': 'Marcos Souza',    'reason': 'Dados incorretos'},
    ],
  },
  {
    'city': 'Santo André',
    'total': 8,
    'fichas': [
      {'seq': 'CF-EQP1-0031', 'lote': 'L2024-05', 'client': 'Cláudia Reis',    'reason': 'Sem qualidade'},
      {'seq': 'CF-EQP1-0035', 'lote': 'L2024-05', 'client': 'Diego Carvalho',  'reason': 'Sem interesse'},
    ],
  },
  {
    'city': 'Sorocaba',
    'total': 5,
    'fichas': [
      {'seq': 'CF-EQP1-0044', 'lote': 'L2024-05', 'client': 'Tiago Martins',   'reason': 'Sem condições'},
    ],
  },
];

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
  List<dynamic> _upcomingEvents = [];
  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  // Mock Rotas Inteligentes
  final List<Map<String, dynamic>> _rotas = [
    {'city': 'Campinas', 'count': 42, 'lote': 'CAMPINAS01'},
    {'city': 'São Paulo', 'count': 15, 'lote': 'SP01'},
  ];

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _fadeAnim =
        CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
    _loadUpcomingEvents();
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
                      _sideMenuItem(4, Icons.attach_money_rounded, 'Custos e Caixa'),
                      _sideMenuItem(6, Icons.bar_chart_rounded, 'Métricas e Saúde'),
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
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(color: Colors.white12, height: 1),
          ListTile(
            leading: const Icon(Icons.save_alt_rounded, color: Colors.greenAccent),
            title: const Text('Backup Local (Offline)', style: TextStyle(color: Colors.greenAccent)),
            onTap: _backupLocalDatabase,
          ),
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

  Future<void> _backupLocalDatabase() async {
    try {
      final dbPath = await DbHelper.instance.getDbPath();
      final dbFile = File(dbPath);
      
      if (!await dbFile.exists()) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhum dado local encontrado para backup')));
        return;
      }

      // Requer permissão no Android
      var status = await Permission.storage.request();
      if (!status.isGranted) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Permissão de armazenamento negada. Nao foi possível salvar o backup.')));
        return;
      }

      final Directory? downloadsDir = await getExternalStorageDirectory(); // Vai para Android/data/.../files. Para pasta public: /storage/emulated/0/Download
      final String targetPath = '/storage/emulated/0/Download/selectphoto_backup_${DateTime.now().millisecondsSinceEpoch}.db';
      
      await dbFile.copy(targetPath);
      
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Backup salvo em Downloads!\n$targetPath', style: const TextStyle(color: Colors.white)), 
        backgroundColor: Colors.green
      ));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar backup: $e')));
    }
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
  void _showNotificacoesDialog() {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          title: const Text('Notificações e Transferências', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Card(
                color: Colors.white.withOpacity(0.05),
                child: ListTile(
                  leading: const Icon(Icons.layers_rounded, color: Colors.orangeAccent),
                  title: const Text('João (Vendedor 1) \u2794 Admin', style: TextStyle(color: Colors.white, fontSize: 14)),
                  subtitle: const Text('Devolução de 10 capas', style: TextStyle(color: Colors.white70)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.redAccent),
                        onPressed: () {
                          Navigator.pop(context);
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Devolução recusada.')));
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.check, color: Colors.greenAccent),
                        onPressed: () {
                          Navigator.pop(context);
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Estoque de capas atualizado!')));
                        },
                      ),
                    ],
                  ),
                ),
              )
            ],
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

  // ── Header ─────────────────────────────────────────────────────────────────
  Widget _buildHeader({bool isDesktop = false}) {
    const tabs = ['Eventos IA', 'Books e Rotas', 'rebolo', 'Frota', 'Caixa', 'Funcionários', 'Saúde', 'Fechamentos', 'Capas'];
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
                    onPressed: _showNotificacoesDialog,
                    icon: const Badge(
                      label: Text('1'),
                      child: Icon(Icons.notifications_active_rounded, color: Colors.orangeAccent),
                    ),
                    tooltip: 'Notificações (Capas)',
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
            // Sub-tabs (Only show on Mobile, on Desktop it's handled by SideMenu)
            if (!isDesktop)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: List.generate(9, (i) {
                      final selected = _navIndex == i;
                      return GestureDetector(
                        onTap: () => setState(() => _navIndex = i),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          margin: const EdgeInsets.only(right: 8),
                          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
                          decoration: BoxDecoration(
                            color: selected
                                ? Colors.white.withOpacity(0.15)
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: selected
                                    ? Colors.white.withOpacity(0.3)
                                    : Colors.transparent),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(icons[i],
                                  color: selected
                                      ? Colors.white
                                      : const Color(0xFF90CAF9),
                                  size: 16),
                              const SizedBox(width: 6),
                              Text(tabs[i],
                                  style: TextStyle(
                                      color: selected
                                          ? Colors.white
                                          : const Color(0xFF90CAF9),
                                      fontSize: 12,
                                      fontWeight: selected
                                          ? FontWeight.bold
                                          : FontWeight.normal)),
                            ],
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ),
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
      case 6:
        return const HealthDashboardView();
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
          _buildTransferencia(),
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
  Widget _buildPhotosTab() {
    int totalGeral = 0;
    for (final team in _photoEvents) {
      for (final e in team['events'] as List) {
        totalGeral += e['photos'] as int;
      }
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
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
                    Text('${_photoEvents.length} equipes ativas',
                        style: const TextStyle(
                            color: Color(0xFFCE93D8), fontSize: 12)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Cards por equipe
          ..._photoEvents.map((team) {
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
        ],
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ABA 3 — ESTOQUE NÃO-VENDAS
  // ══════════════════════════════════════════════════════════════════════════
  Widget _buildStockTab() {
    final totalFichas =
        _stockByCity.fold<int>(0, (s, c) => s + (c['total'] as int));

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
                    Text('${_stockByCity.length} cidades',
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
          const SizedBox(height: 12),

          ..._stockByCity.map((cityData) =>
              _buildCityStockCard(cityData)),
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

  void _scanAndDistributeBooks() {
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
                        _assignBookToSellerDialog(code);
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

  void _assignBookToSellerDialog(String qrCode) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: const Text('Atribuir Book a Vendedor', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Ficha/Book: $qrCode', style: const TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              const Text('Selecione o Vendedor ou Gerente:', style: TextStyle(color: Colors.white70)),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(8)),
                child: DropdownButton<String>(
                  items: const [
                    DropdownMenuItem(value: 'v1', child: Text('João (Gerente)', style: TextStyle(color: Colors.white))),
                    DropdownMenuItem(value: 'v2', child: Text('Maria', style: TextStyle(color: Colors.white))),
                  ],
                  onChanged: (v) {},
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
              onPressed: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Book distribuído com sucesso!'), backgroundColor: Colors.green));
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Confirmar Atribuição'),
            ),
          ],
        );
      }
    );
  }

  Widget _buildTransferencia() {
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
          const Text('Distribuição de Books (Saída)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _scanAndDistributeBooks,
            icon: const Icon(Icons.qr_code_scanner, color: Colors.white),
            label: const Text('Distribuir Books via QR Code', style: TextStyle(color: Colors.white)),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF9C27B0), padding: const EdgeInsets.symmetric(vertical: 14)),
          ),
          const SizedBox(height: 16),
          const Text('Aponte a câmera para os QR Codes dos books impressos para registrá-los no estoque do vendedor e na respectiva rota.', style: TextStyle(color: Colors.white70, fontSize: 13)),
        ],
      )
    );
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

  Widget _buildRotasInteligentes() {
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
          const Text('Rotas Inteligentes', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Os books recém criados pelos fotógrafos são agrupados por cidade para facilitar a impressão e logística.', style: TextStyle(color: Colors.white54, fontSize: 12)),
          const SizedBox(height: 16),
          ..._rotas.map((r) => Padding(
            padding: const EdgeInsets.only(bottom: 8.0),
            child: _loteCard(
              'Rota: ${r['city']} (Lote: ${r['lote']})', 
              '${r['count']} Books Prontos', 
              Colors.blue.shade400,
              trailing: Row(
                children: [
                  IconButton(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Editando/Transferindo Rota...')));
                    },
                    icon: const Icon(Icons.edit, color: Colors.white70, size: 20),
                    tooltip: 'Editar / Transferir Rota',
                  ),
                ],
              ),
            ),
          )),
        ],
      )
    );
  }
}
