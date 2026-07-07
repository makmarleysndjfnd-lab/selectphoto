import 'package:flutter/material.dart';
import 'tela_detalhes_cliente_vendedor.dart';
import 'tela_login.dart';
import 'tela_checklist_frota.dart';
import 'tela_cadastro_custos.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

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
  DateTime _selectedDate = DateTime.now();

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

  void _showDevolverCapasDialog() {
    final qtyController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          title: const Text('Devolver Capas ao Admin', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Informe a quantidade de capas para devolução em auditoria:', style: TextStyle(color: Colors.white70)),
              const SizedBox(height: 16),
              TextField(
                controller: qtyController,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Qtd de Capas',
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
              onPressed: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${qtyController.text} capas devolvidas ao admin!')));
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.orangeAccent),
              child: const Text('Confirmar Devolução', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
            ),
          ],
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
                onPressed: _showDevolverCapasDialog,
                icon: const Icon(Icons.assignment_return_rounded, color: Colors.orangeAccent),
                tooltip: 'Devolver Capas',
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
            const Text('Booking Calendar',
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
        _buildWeekCalendar(),
        const SizedBox(height: 24),
        // Filtro ocultado para focar no calendário, mas mantido caso precise
        // TextField(...)
        const SizedBox(height: 12),
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

  Widget _buildWeekCalendar() {
    final today = DateTime.now();
    final firstDayOfWeek = today.subtract(Duration(days: today.weekday % 7));
    final List<DateTime> weekDays = List.generate(7, (index) => firstDayOfWeek.add(Duration(days: index)));

    final List<String> dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: weekDays.map((date) {
          final isSelected = date.day == _selectedDate.day && date.month == _selectedDate.month && date.year == _selectedDate.year;
          final hasEvents = date.day == today.day || isSelected;

          return GestureDetector(
            onTap: () => setState(() => _selectedDate = date),
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 8),
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
              decoration: isSelected
                  ? BoxDecoration(
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFFD54F).withOpacity(0.3),
                          blurRadius: 15,
                          spreadRadius: 2,
                        ),
                      ],
                      border: Border.all(color: const Color(0xFFFFD54F), width: 1.5),
                    )
                  : const BoxDecoration(shape: BoxShape.circle),
              child: Column(
                children: [
                  Text(
                    dayNames[date.weekday % 7],
                    style: TextStyle(
                      color: isSelected ? Colors.white : Colors.white54,
                      fontSize: 13,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${date.day}',
                    style: TextStyle(
                      color: isSelected ? const Color(0xFFFFD54F) : Colors.white70,
                      fontSize: 16,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  const SizedBox(height: 6),
                  if (hasEvents)
                    Container(
                      width: 4,
                      height: 4,
                      decoration: const BoxDecoration(
                        color: Color(0xFFFFD54F),
                        shape: BoxShape.circle,
                      ),
                    )
                  else
                    const SizedBox(height: 4),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildClientCard(Map<String, dynamic> client) {
    final seq = client['sequenceNumber'] as String;
    final colorVal = seq.hashCode;
    final borderColors = [
      const Color(0xFFFFD54F), // Amber/Gold
      const Color(0xFFB39DDB), // Light Purple
      const Color(0xFF81C784), // Light Green
      const Color(0xFF4FC3F7), // Light Blue
    ];
    final borderColor = borderColors[colorVal.abs() % borderColors.length];
    final time = client['visitTime'] ?? '08:00';

    return GestureDetector(
      onTap: () => _openClientDetail(client),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF1E2A3A),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.05)),
        ),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Glowing left border indicator
              Container(
                width: 6,
                decoration: BoxDecoration(
                  color: borderColor,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(16),
                    bottomLeft: Radius.circular(16),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: borderColor.withOpacity(0.5),
                      blurRadius: 8,
                      offset: const Offset(2, 0),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            client['name'],
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Icon(Icons.chevron_right_rounded, color: Colors.white.withOpacity(0.3), size: 20),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '$time - ${client['sequenceNumber']}',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.7),
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
