import 'package:flutter/material.dart';
import 'tela_detalhes_cliente_vendedor.dart';
import 'tela_login.dart';
import 'tela_checklist_frota.dart';
import 'tela_cadastro_custos.dart';

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
  String _searchQuery = '';
  bool _searched = false;
  Map<String, dynamic>? _foundClient;
  late AnimationController _animController;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim =
        CurvedAnimation(parent: _animController, curve: Curves.easeOut);
    _animController.forward();
  }

  @override
  void dispose() {
    _codeController.dispose();
    _animController.dispose();
    super.dispose();
  }

  void _searchClient() {
    final code = _codeController.text.trim().toUpperCase();
    if (code.isEmpty) return;

    final found = _mockClients.firstWhere(
      (c) => (c['sequenceNumber'] as String).toUpperCase() == code,
      orElse: () => {},
    );

    setState(() {
      _searched = true;
      _foundClient = found.isEmpty ? null : found;
    });

    if (found.isNotEmpty) {
      _openClientDetail(found);
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
                    _buildSearchCard(),
                    const SizedBox(height: 28),
                    _buildClientList(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
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
                  Navigator.push(context, MaterialPageRoute(
                    builder: (_) => const FleetChecklistScreen(carId: 'car_123', plate: 'ABC-1234'),
                  ));
                },
                icon: const Icon(Icons.directions_car_rounded, color: Color(0xFF4FC3F7)),
                tooltip: 'Checklist do Veículo',
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
                onPressed: () => Navigator.of(context).pushReplacement(
                  MaterialPageRoute(
                      builder: (_) => const LoginScreen()),
                ),
                icon: const Icon(Icons.logout_rounded,
                    color: Color(0xFF90CAF9)),
                tooltip: 'Sair',
              ),
            ],
          ),
        ),
      ),
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
                    fontSize: 16,
                    fontWeight: FontWeight.bold)),
            Text('${_filteredClients.length} clientes',
                style: const TextStyle(
                    color: Color(0xFF90CAF9), fontSize: 12)),
          ],
        ),
        const SizedBox(height: 12),
        // Filtro
        TextField(
          onChanged: (v) => setState(() => _searchQuery = v),
          style: const TextStyle(color: Colors.white, fontSize: 13),
          decoration: InputDecoration(
            hintText: 'Filtrar por nome, cidade ou código...',
            hintStyle:
                TextStyle(color: Colors.white.withOpacity(0.3), fontSize: 13),
            prefixIcon: const Icon(Icons.filter_list_rounded,
                color: Color(0xFF4FC3F7), size: 18),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide:
                  BorderSide(color: Colors.white.withOpacity(0.1)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(
                  color: Color(0xFF4FC3F7), width: 1),
            ),
            filled: true,
            fillColor: const Color(0xFF1A2535),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
        ),
        const SizedBox(height: 12),
        ..._filteredClients.map((client) => _buildClientCard(client)),
      ],
    );
  }

  Widget _buildClientCard(Map<String, dynamic> client) {
    final initials = (client['name'] as String)
        .split(' ')
        .take(2)
        .map((w) => w[0])
        .join()
        .toUpperCase();

    return GestureDetector(
      onTap: () => _openClientDetail(client),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1A2535),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.06)),
        ),
        child: Row(
          children: [
            // Avatar
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                    colors: [Color(0xFF0288D1), Color(0xFF4FC3F7)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Center(
                child: Text(initials,
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 16)),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(client['name'],
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                          fontSize: 14)),
                  const SizedBox(height: 3),
                  Row(children: [
                    const Icon(Icons.tag_rounded,
                        color: Color(0xFF4FC3F7), size: 12),
                    const SizedBox(width: 4),
                    Text(client['sequenceNumber'],
                        style: const TextStyle(
                            color: Color(0xFF4FC3F7),
                            fontSize: 12,
                            fontFamily: 'monospace')),
                  ]),
                  const SizedBox(height: 2),
                  Row(children: [
                    const Icon(Icons.location_on_outlined,
                        color: Color(0xFF90CAF9), size: 12),
                    const SizedBox(width: 4),
                    Text(client['city'],
                        style: const TextStyle(
                            color: Color(0xFF90CAF9), fontSize: 12)),
                  ]),
                ],
              ),
            ),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF0288D1).withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                    color: const Color(0xFF4FC3F7).withOpacity(0.3)),
              ),
              child: const Text('Ver Ficha',
                  style: TextStyle(
                      color: Color(0xFF4FC3F7),
                      fontSize: 12,
                      fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }
}
