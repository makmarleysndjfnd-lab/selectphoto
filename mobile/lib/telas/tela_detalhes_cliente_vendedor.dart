import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';

class SellerClientDetailScreen extends StatefulWidget {
  final Map<String, dynamic> clientData;
  const SellerClientDetailScreen({super.key, required this.clientData});

  @override
  // ignore: library_private_types_in_public_api
  State<SellerClientDetailScreen> createState() =>
      _SellerClientDetailScreenState();
}

class _SellerClientDetailScreenState extends State<SellerClientDetailScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  final _tabs = const [
    Tab(icon: Icon(Icons.attach_money_rounded), text: 'Venda'),
    Tab(icon: Icon(Icons.cancel_rounded), text: 'Não Venda'),
    Tab(icon: Icon(Icons.calendar_month_rounded), text: 'Agendar'),
    Tab(icon: Icon(Icons.camera_alt_rounded), text: 'books'),
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _showSuccess(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(children: [
          const Icon(Icons.check_circle_rounded,
              color: Colors.white, size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(msg)),
        ]),
        backgroundColor: const Color(0xFF43A047),
        behavior: SnackBarBehavior.floating,
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final client = widget.clientData;

    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      body: Column(
        children: [
          _buildHeader(client),
          _buildClientInfo(client),
          _buildTabBar(),
          Expanded(child: _buildTabView(client)),
        ],
      ),
    );
  }

  Widget _buildHeader(Map<String, dynamic> client) {
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
          padding: const EdgeInsets.fromLTRB(8, 8, 16, 12),
          child: Row(
            children: [
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.arrow_back_ios_rounded,
                    color: Color(0xFF4FC3F7)),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      client['name'] ?? 'Cliente',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.bold),
                    ),
                    Text(
                      client['sequenceNumber'] ?? '',
                      style: const TextStyle(
                          color: Color(0xFF4FC3F7),
                          fontSize: 12,
                          fontFamily: 'monospace'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildClientInfo(Map<String, dynamic> client) {
    // Parse houseColor string to Color object
    Color? parsedColor;
    if (client['houseColor'] != null && client['houseColor']!.startsWith('Color(')) {
      final valueString = client['houseColor']!.split('(0x')[1].split(')')[0];
      parsedColor = Color(int.parse(valueString, radix: 16));
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2535),
        border: Border(
            bottom: BorderSide(color: Colors.white.withOpacity(0.08))),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _infoRow(Icons.phone_rounded,
                        client['phone1'] ?? 'Sem telefone'),
                    const SizedBox(height: 4),
                    GestureDetector(
                      onTap: () async {
                        final q = "${client['street']}, ${client['number']} ${client['city']}";
                        final url = Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(q)}');
                        if (await canLaunchUrl(url)) {
                          await launchUrl(url, mode: LaunchMode.externalApplication);
                        }
                      },
                      child: Container(
                        color: Colors.transparent, // to make it tappable
                        child: _infoRow(
                            Icons.location_on_rounded,
                            "${client['street']}, ${client['number']} — ${client['city']}"),
                      ),
                    ),
                    if (client['referencePoint'] != null && client['referencePoint'].toString().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      _infoRow(Icons.place, "Ref: ${client['referencePoint']}"),
                    ],
                  ],
                ),
              ),
              // WhatsApp
              if (client['phone1'] != null)
                GestureDetector(
                  onTap: () => _showSuccess('WhatsApp aberto (mock)'),
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF25D366).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: const Color(0xFF25D366).withOpacity(0.4)),
                    ),
                    child: const Icon(Icons.chat_rounded,
                        color: Color(0xFF25D366), size: 20),
                  ),
                ),
            ],
          ),
          
          // Additional Info Row (Cor da Casa, Profissao, Horario, Criancas)
          if (parsedColor != null || client['visitTime'] != null || client['profession'] != null || (client['children'] != null && (client['children'] as List).isNotEmpty)) ...[
            const SizedBox(height: 12),
            const Divider(color: Colors.white12),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (parsedColor != null) ...[
                  Column(
                    children: [
                      const Text('Cor da Casa', style: TextStyle(color: Colors.white54, fontSize: 10)),
                      const SizedBox(height: 4),
                      Container(
                        width: 24, height: 24,
                        decoration: BoxDecoration(
                          color: parsedColor,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white30),
                        ),
                      )
                    ],
                  ),
                  const SizedBox(width: 16),
                ],
                if (client['visitTime'] != null) ...[
                  Expanded(child: _infoRow(Icons.access_time, "Visita: ${client['visitTime']}")),
                ],
                if (client['profession'] != null && client['profession'].toString().isNotEmpty) ...[
                  Expanded(child: _infoRow(Icons.work, client['profession'])),
                ],
              ],
            ),
            if (client['children'] != null && (client['children'] as List).isNotEmpty) ...[
              const SizedBox(height: 8),
              _infoRow(Icons.child_care, "Crianças: ${(client['children'] as List).map((c) => "${c['name']} (${c['age']})").join(', ')}"),
            ]
          ]
        ],
      ),
    );
  }

  Widget _infoRow(IconData icon, String text) {
    return Row(children: [
      Icon(icon, color: const Color(0xFF4FC3F7), size: 14),
      const SizedBox(width: 6),
      Expanded(
          child: Text(text,
              style: const TextStyle(
                  color: Color(0xFF90CAF9), fontSize: 12),
              overflow: TextOverflow.ellipsis)),
    ]);
  }

  Widget _buildTabBar() {
    return Container(
      color: const Color(0xFF1A2535),
      child: TabBar(
        controller: _tabController,
        tabs: _tabs,
        labelColor: const Color(0xFF4FC3F7),
        unselectedLabelColor: const Color(0xFF546E7A),
        labelStyle:
            const TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
        indicatorColor: const Color(0xFF4FC3F7),
        indicatorWeight: 2,
        dividerColor: Colors.transparent,
      ),
    );
  }

  Widget _buildTabView(Map<String, dynamic> client) {
    return TabBarView(
      controller: _tabController,
      children: [
        _SaleTab(clientId: client['id'], city: client['city'] ?? '',
            onSuccess: _showSuccess),
        _NonSaleTab(clientId: client['id'], onSuccess: _showSuccess),
        _ScheduleTab(clientId: client['id'], onSuccess: _showSuccess),
        _PhotosTab(clientId: client['id'], onSuccess: _showSuccess),
      ],
    );
  }
}

// ── Shared style helpers ──────────────────────────────────────────────────────
InputDecoration _fieldDecoration(String label, IconData icon) {
  return InputDecoration(
    labelText: label,
    labelStyle: const TextStyle(color: Color(0xFF90CAF9)),
    prefixIcon: Icon(icon, color: const Color(0xFF4FC3F7), size: 18),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide:
          BorderSide(color: Colors.white.withOpacity(0.15), width: 1),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: Color(0xFF4FC3F7), width: 1.5),
    ),
    filled: true,
    fillColor: Colors.white.withOpacity(0.05),
  );
}

Widget _buildRatingField(String label, void Function(double) onRatingUpdate) {
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
      const SizedBox(height: 4),
      RatingBar.builder(
        initialRating: 0,
        minRating: 1,
        direction: Axis.horizontal,
        allowHalfRating: false,
        itemCount: 5,
        itemSize: 30,
        unratedColor: Colors.white24,
        itemBuilder: (context, _) => const Icon(Icons.star_rounded, color: Colors.amber),
        onRatingUpdate: onRatingUpdate,
      ),
    ],
  );
}

Widget _confirmButton(
    {required bool isLoading,
    required VoidCallback? onPressed,
    required String label,
    required List<Color> colors}) {
  return Container(
    height: 50,
    decoration: BoxDecoration(
      gradient: LinearGradient(colors: colors),
      borderRadius: BorderRadius.circular(14),
      boxShadow: [
        BoxShadow(
            color: colors.last.withOpacity(0.35),
            blurRadius: 12,
            offset: const Offset(0, 5)),
      ],
    ),
    child: ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.transparent,
        shadowColor: Colors.transparent,
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      child: isLoading
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                  color: Colors.white, strokeWidth: 2))
          : Text(label,
              style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 15,
                  letterSpacing: 0.8)),
    ),
  );
}

class _SaleTab extends StatefulWidget {
  final String clientId;
  final String city;
  final void Function(String) onSuccess;
  const _SaleTab(
      {required this.clientId,
      required this.city,
      required this.onSuccess});

  @override
  State<_SaleTab> createState() => _SaleTabState();
}

class _SaleTabState extends State<_SaleTab> {
  final _valueController = TextEditingController();
  final _fichaController = TextEditingController();
  bool _isLoading = false;

  String _product = 'Book completo capa +Book+mídias';
  String _paymentMethod = 'CASH';
  bool _hasCover = true;
  double _sellerRating = 0;
  double _photoRating = 0;
  double _contactRating = 0;

  void _submit() async {
    if (_valueController.text.isEmpty) return;
    setState(() => _isLoading = true);
    
    // In a real app, this would be an API call to POST /sales
    // with body: { clientId, city, value, product, status, paymentStatus, fichaNumber, paymentMethod, hasCover }
    await Future.delayed(const Duration(milliseconds: 700));
    
    if (!mounted) return;
    setState(() => _isLoading = false);
    widget.onSuccess(
        'Venda de R\$ ${_valueController.text} registrada com sucesso!');
    _valueController.clear();
    _fichaController.clear();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 4),
          const Text('Registrar Venda',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          Text('Cliente: ${widget.clientId} · Cidade: ${widget.city}',
              style:
                  const TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
          const SizedBox(height: 20),
          
          TextField(
            controller: _valueController,
            style: const TextStyle(color: Colors.white),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: _fieldDecoration(r'Valor da Venda (R$)', Icons.attach_money_rounded),
          ),
          const SizedBox(height: 16),

          TextField(
            controller: _fichaController,
            style: const TextStyle(color: Colors.white),
            decoration: _fieldDecoration('Número da Ficha (Opcional)', Icons.tag_rounded),
          ),
          const SizedBox(height: 16),

          _buildDropdown('Produto', _product, ['Book completo capa +Book+mídias', 'Book sem mídias', 'Book sem capa', 'Book com defeito'], (v) {
            setState(() {
              _product = v!;
              if (_product == 'Book sem capa') {
                _hasCover = false;
              } else if (_product == 'Book completo capa +Book+mídias' || _product == 'Book sem mídias') {
                _hasCover = true;
              }
            });
          }),
          const SizedBox(height: 16),
          
          if (_product == 'Book com defeito') ...[
            Theme(
              data: Theme.of(context).copyWith(
                unselectedWidgetColor: Colors.white54,
              ),
              child: CheckboxListTile(
                title: const Text('O book tinha capa?', style: TextStyle(color: Colors.white)),
                subtitle: const Text('Marque se a capa precisou ser usada.', style: TextStyle(color: Colors.white54, fontSize: 12)),
                value: _hasCover,
                activeColor: const Color(0xFF4FC3F7),
                checkColor: Colors.black,
                tileColor: Colors.white.withOpacity(0.05),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                onChanged: (val) => setState(() => _hasCover = val ?? false),
              ),
            ),
            const SizedBox(height: 16),
          ],
          
          _buildDropdown('Método de Pagamento', _paymentMethod, ['CASH', 'PIX', 'DEBIT', 'CREDIT'], (v) => setState(() => _paymentMethod = v!)),
          const SizedBox(height: 24),
          
          const Text('Avaliação do Atendimento', style: TextStyle(color: Color(0xFF90CAF9), fontWeight: FontWeight.bold, fontSize: 14)),
          const SizedBox(height: 12),
          _buildRatingField('Vendedor', (r) => _sellerRating = r),
          const SizedBox(height: 12),
          _buildRatingField('Fotógrafo', (r) => _photoRating = r),
          const SizedBox(height: 12),
          _buildRatingField('O Contato', (r) => _contactRating = r),
          const SizedBox(height: 24),

          _confirmButton(
            isLoading: _isLoading,
            onPressed: _submit,
            label: 'Confirmar Venda',
            colors: const [Color(0xFF2E7D32), Color(0xFF66BB6A)],
          ),
        ],
      ),
    );
  }

  Widget _buildDropdown(String label, String value, List<String> items, void Function(String?) onChanged) {
    return DropdownButtonFormField<String>(
      value: value,
      dropdownColor: const Color(0xFF1A1A2E),
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF90CAF9)),
        filled: true,
        fillColor: Colors.white.withOpacity(0.05),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: Colors.white.withOpacity(0.15), width: 1)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF4FC3F7), width: 1.5)),
      ),
      items: items.map((i) => DropdownMenuItem(value: i, child: Text(i))).toList(),
      onChanged: onChanged,
    );
  }
}

// ── ABA NÃO VENDA ─────────────────────────────────────────────────────────────
class _NonSaleTab extends StatefulWidget {
  final String clientId;
  final void Function(String) onSuccess;
  const _NonSaleTab({required this.clientId, required this.onSuccess});

  @override
  // ignore: library_private_types_in_public_api
  State<_NonSaleTab> createState() => _NonSaleTabState();
}

class _NonSaleTabState extends State<_NonSaleTab> {
  String? _selectedReason;
  final _reasons = [
    'Sem interesse',
    'Sem condições',
    'Dados incorretos',
    'Book trocado',
    'Sem qualidade',
  ];
  final SignatureController _sigController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );
  bool _isLoading = false;
  double _sellerRating = 0;
  double _photoRating = 0;
  double _contactRating = 0;

  void _submit() async {
    if (_selectedReason == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Selecione o motivo.'),
          behavior: SnackBarBehavior.floating));
      return;
    }
    if (_sigController.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('A assinatura é obrigatória.'),
          behavior: SnackBarBehavior.floating));
      return;
    }
    setState(() => _isLoading = true);
    await Future.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      _selectedReason = null;
    });
    _sigController.clear();
    widget.onSuccess('Não-venda registrada: "$_selectedReason"');
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 4),
          const Text('Registrar Não Venda',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          DropdownButtonFormField<String>(
            value: _selectedReason,
            dropdownColor: const Color(0xFF1A2535),
            style: const TextStyle(color: Colors.white),
            decoration: _fieldDecoration('Motivo da recusa', Icons.cancel_rounded),
            items: _reasons
                .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                .toList(),
            onChanged: (v) => setState(() => _selectedReason = v),
          ),
          const SizedBox(height: 20),
          const Text('Assinatura do Cliente:',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                  fontSize: 13)),
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: const Color(0xFF4FC3F7).withOpacity(0.4)),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Signature(
                  controller: _sigController,
                  height: 280,
                  backgroundColor: Colors.white),
            ),
          ),
          TextButton.icon(
            onPressed: () => _sigController.clear(),
            icon: const Icon(Icons.refresh_rounded,
                color: Color(0xFF90CAF9), size: 16),
            label: const Text('Limpar assinatura',
                style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
          ),
          const SizedBox(height: 12),
          
          const Text('Avaliação do Atendimento', style: TextStyle(color: Color(0xFF90CAF9), fontWeight: FontWeight.bold, fontSize: 14)),
          const SizedBox(height: 12),
          _buildRatingField('Vendedor', (r) => _sellerRating = r),
          const SizedBox(height: 12),
          _buildRatingField('Fotógrafo', (r) => _photoRating = r),
          const SizedBox(height: 12),
          _buildRatingField('O Contato', (r) => _contactRating = r),
          const SizedBox(height: 24),

          _confirmButton(
            isLoading: _isLoading,
            onPressed: _submit,
            label: 'Confirmar Recusa',
            colors: const [Color(0xFFB71C1C), Color(0xFFEF5350)],
          ),
        ],
      ),
    );
  }
}

// ── ABA AGENDAMENTO ───────────────────────────────────────────────────────────
class _ScheduleTab extends StatefulWidget {
  final String clientId;
  final void Function(String) onSuccess;
  const _ScheduleTab({required this.clientId, required this.onSuccess});

  @override
  // ignore: library_private_types_in_public_api
  State<_ScheduleTab> createState() => _ScheduleTabState();
}

class _ScheduleTabState extends State<_ScheduleTab> {
  DateTime? _date;
  TimeOfDay? _time;
  final _obsController = TextEditingController();
  bool _isLoading = false;

  void _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime(2100),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: const ColorScheme.dark(
              primary: Color(0xFF4FC3F7),
              surface: Color(0xFF1A2535)),
        ),
        child: child!,
      ),
    );
    if (d != null) setState(() => _date = d);
  }

  void _pickTime() async {
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.now(),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: const ColorScheme.dark(
              primary: Color(0xFF4FC3F7),
              surface: Color(0xFF1A2535)),
        ),
        child: child!,
      ),
    );
    if (t != null) setState(() => _time = t);
  }

  void _submit() async {
    if (_date == null || _time == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Selecione data e hora.'),
          behavior: SnackBarBehavior.floating));
      return;
    }
    setState(() => _isLoading = true);
    await Future.delayed(const Duration(milliseconds: 700));
    if (!mounted) return;
    final dateStr = DateFormat('dd/MM/yyyy').format(_date!);
    final timeStr = _time!.format(context);
    setState(() {
      _isLoading = false;
      _date = null;
      _time = null;
    });
    _obsController.clear();
    widget.onSuccess('Agendamento salvo: $dateStr às $timeStr');
  }

  Widget _dateButton(
      {required IconData icon,
      required String label,
      required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withOpacity(0.15)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: const Color(0xFF4FC3F7), size: 18),
            const SizedBox(width: 8),
            Text(label,
                style: const TextStyle(
                    color: Colors.white, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 4),
          const Text('Agendar Visita',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(
              child: _dateButton(
                icon: Icons.calendar_today_rounded,
                label: _date == null
                    ? 'Selecionar data'
                    : DateFormat('dd/MM/yyyy').format(_date!),
                onTap: _pickDate,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _dateButton(
                icon: Icons.access_time_rounded,
                label:
                    _time == null ? 'Selecionar hora' : _time!.format(context),
                onTap: _pickTime,
              ),
            ),
          ]),
          const SizedBox(height: 16),
          TextField(
            controller: _obsController,
            style: const TextStyle(color: Colors.white),
            maxLines: 3,
            decoration: _fieldDecoration(
                'Observações (opcional)', Icons.notes_rounded),
          ),
          const SizedBox(height: 20),
          _confirmButton(
            isLoading: _isLoading,
            onPressed: _submit,
            label: 'Confirmar Agendamento',
            colors: const [Color(0xFF6A1B9A), Color(0xFFAB47BC)],
          ),
        ],
      ),
    );
  }
}

// ── ABA books ─────────────────────────────────────────────────────────────────
class _PhotosTab extends StatefulWidget {
  final String clientId;
  final void Function(String) onSuccess;
  const _PhotosTab({required this.clientId, required this.onSuccess});

  @override
  // ignore: library_private_types_in_public_api
  State<_PhotosTab> createState() => _PhotosTabState();
}

class _PhotosTabState extends State<_PhotosTab> {
  String? _fakeImageLabel;
  bool _isUploading = false;

  void _fakeCapture() {
    setState(() => _fakeImageLabel = 'foto_${widget.clientId}_mock.jpg');
  }

  void _upload() async {
    if (_fakeImageLabel == null) return;
    setState(() => _isUploading = true);
    await Future.delayed(const Duration(milliseconds: 900));
    if (!mounted) return;
    setState(() {
      _isUploading = false;
      _fakeImageLabel = null;
    });
    widget.onSuccess('book enviada! Será deletada automaticamente em 10 dias.');
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 20, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(height: 4),
                  Text('books do Cliente',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold)),
                  Text(
                      'books são armazenadas por 10 dias e deletadas automaticamente.',
                      style: TextStyle(
                          color: Color(0xFF90CAF9), fontSize: 12)),
                  SizedBox(height: 20),
                ],
              ),
            ),
            // Preview area — ocupa espaço restante
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A2535),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                        color: const Color(0xFF4FC3F7).withOpacity(0.2)),
                  ),
                  child: _fakeImageLabel != null
                      ? Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.image_rounded,
                                color: Color(0xFF4FC3F7), size: 60),
                            const SizedBox(height: 12),
                            Text(_fakeImageLabel!,
                                style: const TextStyle(
                                    color: Color(0xFF90CAF9),
                                    fontSize: 13)),
                            const SizedBox(height: 4),
                            const Text('Pronto para enviar',
                                style: TextStyle(
                                    color: Color(0xFF66BB6A),
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold)),
                          ],
                        )
                      : const Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.add_photo_alternate_outlined,
                                color: Color(0xFF546E7A), size: 56),
                            SizedBox(height: 12),
                            Text('Nenhuma book selecionada',
                                style: TextStyle(
                                    color: Color(0xFF546E7A),
                                    fontSize: 13)),
                          ],
                        ),
                ),
              ),
            ),
            // Botões fixos na base
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
              child: Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _isUploading ? null : _fakeCapture,
                    icon: const Icon(Icons.camera_alt_rounded,
                        color: Color(0xFF4FC3F7)),
                    label: const Text('Tirar book',
                        style: TextStyle(color: Color(0xFF4FC3F7))),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: const BorderSide(
                          color: Color(0xFF4FC3F7), width: 1.5),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _confirmButton(
                    isLoading: _isUploading,
                    onPressed: _fakeImageLabel != null ? _upload : null,
                    label: 'Enviar',
                    colors: const [Color(0xFF0288D1), Color(0xFF4FC3F7)],
                  ),
                ),
              ]),
            ),
          ],
        );
      },
    );
  }
}
