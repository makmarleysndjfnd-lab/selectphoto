import 'dart:io';
import 'dart:convert';
import '../utils/ui_helpers.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:table_calendar/table_calendar.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import 'package:provider/provider.dart';
import 'package:path_provider/path_provider.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import '../servicos/servico_midia.dart';
import 'tela_sincronizacao.dart' as tela_sincronizacao;
import '../widgets/authenticated_image.dart';
import '../widgets/led_button.dart';

class SellerClientDetailScreen extends StatefulWidget {
  final Map<String, dynamic> clientData;
  final bool isFotografo;
  const SellerClientDetailScreen(
      {super.key, required this.clientData, this.isFotografo = false});

  @override
  // ignore: library_private_types_in_public_api
  State<SellerClientDetailScreen> createState() =>
      _SellerClientDetailScreenState();
}

class _SellerClientDetailScreenState extends State<SellerClientDetailScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isDetailsCollapsed = false;

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
    _tabController.addListener(() {
      if (_tabController.indexIsChanging && !_isDetailsCollapsed) {
        setState(() => _isDetailsCollapsed = true);
      }
    });
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
          const Icon(Icons.check_circle_rounded, color: Colors.white, size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(msg)),
        ]),
        backgroundColor: const Color(0xFF43A047),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final client = widget.clientData;
    final keyboardHeight = MediaQuery.of(context).viewInsets.bottom;
    final isKeyboardOpen = keyboardHeight > 100;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      backgroundColor: const Color(0xFF0F1923),
      body: Column(
        children: [
          // Quando teclado está aberto, exibe barra compacta em vez do cabeçalho completo
          if (isKeyboardOpen)
            _buildCompactHeader(client)
          else
            _buildHeader(client),
          if (!isKeyboardOpen && !widget.isFotografo) _buildClientInfo(client),
          if (!isKeyboardOpen && widget.isFotografo)
            Expanded(
              child: SingleChildScrollView(
                child: _buildClientInfo(client),
              ),
            ),
          if (!widget.isFotografo) _buildTabBar(),
          if (!widget.isFotografo) Expanded(child: _buildTabView(client)),
        ],
      ),
    );
  }

  /// Barra compacta exibida quando o teclado está aberto
  Widget _buildCompactHeader(Map<String, dynamic> client) {
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
          padding: const EdgeInsets.fromLTRB(8, 6, 16, 6),
          child: Row(
            children: [
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.arrow_back_ios_rounded,
                    color: Color(0xFF4FC3F7)),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      client['name'] ?? 'Cliente',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.bold),
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (client['visibleCode'] != null || client['sequenceNumber'] != null)
                      Text(
                        (client['visibleCode'] ?? client['sequenceNumber']).toString(),
                        style: const TextStyle(
                            color: Color(0xFF4FC3F7),
                            fontSize: 11,
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
                      (client['visibleCode'] ?? client['sequenceNumber'] ?? '').toString(),
                      style: const TextStyle(
                          color: Color(0xFF4FC3F7),
                          fontSize: 12,
                          fontFamily: 'monospace'),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: () {
                  Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) =>
                              const tela_sincronizacao.SyncScreen()));
                },
                icon: Consumer<SyncService>(builder: (context, sync, child) {
                  return Stack(
                    alignment: Alignment.center,
                    children: [
                      const Icon(Icons.cloud_sync, color: Color(0xFF4FC3F7)),
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
                            constraints: const BoxConstraints(
                                minWidth: 12, minHeight: 12),
                            child: Text(
                              '${sync.pendingRequests.length}',
                              style: const TextStyle(
                                  color: Colors.white, fontSize: 8),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ),
                    ],
                  );
                }),
                tooltip: 'Envios Pendentes',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildClientInfo(Map<String, dynamic> client) {
    Color? parseColor(dynamic colorValue) {
      if (colorValue == null) return null;
      String colorStr = colorValue.toString().trim();
      if (colorStr.isEmpty || colorStr == 'NO_GATE') return null;
      if (colorStr.contains(';')) {
        colorStr = colorStr.split(';')[0].trim();
      }
      if (colorStr.isEmpty) return null;
      if (colorStr.startsWith('Color(')) {
        final val = colorStr.split('(0x')[1].split(')')[0];
        return Color(int.parse(val, radix: 16));
      }
      final intVal = int.tryParse(colorStr);
      if (intVal != null) return Color(intVal);
      return null;
    }

    Color? parsedHouseColor = parseColor(client['houseColor']);
    Color? parsedGateColor = parseColor(client['gateColor']);

    String? houseFinish = client['houseFinish']?.toString();
    if (houseFinish == null || houseFinish.isEmpty) {
      final rawHouseColor = client['houseColor']?.toString() ?? '';
      if (rawHouseColor.contains('NO_REBOCO')) {
        houseFinish = 'NO_REBOCO';
      } else if (rawHouseColor.contains('SEM_REBOCO')) {
        houseFinish = 'SEM_REBOCO';
      }
    }

    final bool hasNoGate = client['hasNoGate'] == true ||
        client['hasGate'] == false ||
        client['gateColor']?.toString() == 'NO_GATE';

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 16,
        vertical: _isDetailsCollapsed ? 8 : 12,
      ),
      decoration:
          UIHelpers.getLedDecoration(client['bookStatus']?.toString()).copyWith(
        border:
            Border(bottom: BorderSide(color: Colors.white.withOpacity(0.08))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Resumo sempre visível com dados essenciais e botão de recolher / expandir (>= 48px target)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Telefone Principal com WhatsApp
                    if (client['phone1'] != null &&
                        client['phone1'].toString().isNotEmpty)
                      GestureDetector(
                        onTap: () async {
                          final num = client['phone1']
                              .toString()
                              .replaceAll(RegExp(r'\D'), '');
                          final fullNum = num.startsWith('55') ? num : '55$num';
                          final uri = Uri.parse('https://wa.me/$fullNum');
                          if (await canLaunchUrl(uri)) {
                            await launchUrl(uri,
                                mode: LaunchMode.externalApplication);
                          } else {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                      content: Text(
                                          'Não foi possível abrir o WhatsApp'),
                                      backgroundColor: Colors.red));
                            }
                          }
                        },
                        child: Container(
                          color: Colors.transparent,
                          padding: const EdgeInsets.only(bottom: 2),
                          child: _infoRow(FontAwesomeIcons.whatsapp,
                              client['phone1'].toString()),
                        ),
                      ),
                    // Telefone Secundário com WhatsApp (quando existir)
                    if (client['phone2'] != null &&
                        client['phone2'].toString().isNotEmpty)
                      GestureDetector(
                        onTap: () async {
                          final num = client['phone2']
                              .toString()
                              .replaceAll(RegExp(r'\D'), '');
                          final fullNum =
                              num.startsWith('55') ? num : '55$num';
                          final uri = Uri.parse('https://wa.me/$fullNum');
                          if (await canLaunchUrl(uri)) {
                            await launchUrl(uri,
                                mode: LaunchMode.externalApplication);
                          } else {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                      content: Text(
                                          'Não foi possível abrir o WhatsApp'),
                                      backgroundColor: Colors.red));
                            }
                          }
                        },
                        child: Container(
                          color: Colors.transparent,
                          padding: const EdgeInsets.only(bottom: 2),
                          child: _infoRow(FontAwesomeIcons.whatsapp,
                              client['phone2'].toString()),
                        ),
                      ),
                    // Endereço com Google Maps
                    GestureDetector(
                      onTap: () async {
                        final street = client['street']?.toString() ?? '';
                        final number = client['number']?.toString() ?? '';
                        final neighborhood =
                            client['neighborhood']?.toString() ?? '';
                        final city = client['city']?.toString() ?? '';
                        final state = client['state']?.toString() ?? '';
                        final parts = [
                          if (street.isNotEmpty) street,
                          if (number.isNotEmpty) number,
                          if (neighborhood.isNotEmpty) neighborhood,
                          if (city.isNotEmpty) city,
                          if (state.isNotEmpty) state,
                          'Brasil',
                        ];
                        final q = parts.join(', ');
                        final url = Uri.parse(
                            'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(q)}');
                        if (await canLaunchUrl(url)) {
                          await launchUrl(url,
                              mode: LaunchMode.externalApplication);
                        }
                      },
                      child: Container(
                        color: Colors.transparent,
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Builder(builder: (context) {
                          final condoParts = [
                            if (client['condo'] != null &&
                                client['condo'].toString().isNotEmpty)
                              client['condo'].toString(),
                            if (client['block'] != null &&
                                client['block'].toString().isNotEmpty)
                              'Bl ${client['block']}',
                            if (client['apartment'] != null &&
                                client['apartment'].toString().isNotEmpty)
                              'Ap ${client['apartment']}',
                            if (client['complement'] != null &&
                                client['complement'].toString().isNotEmpty)
                              client['complement'].toString(),
                          ];
                          final condoStr = condoParts.isNotEmpty
                              ? ' (${condoParts.join(', ')})'
                              : '';
                          return _infoRow(Icons.location_on_rounded,
                              "${client['street'] ?? ''}, ${client['number'] ?? ''}$condoStr — ${client['city'] ?? ''}");
                        }),
                      ),
                    ),
                    // Ponto de Referência (quando existir)
                    if (client['referencePoint'] != null &&
                        client['referencePoint'].toString().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: _infoRow(
                            Icons.place, "Ref: ${client['referencePoint']}"),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              // Botão para alternar recolhimento com área de toque mínima de 48px
              InkWell(
                key: const ValueKey('toggle_client_details_button'),
                borderRadius: BorderRadius.circular(8),
                onTap: () {
                  setState(() => _isDetailsCollapsed = !_isDetailsCollapsed);
                },
                child: Container(
                  constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.06),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _isDetailsCollapsed ? 'Ver detalhes' : 'Ocultar',
                        style: const TextStyle(
                          color: Color(0xFF4FC3F7),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Icon(
                        _isDetailsCollapsed
                            ? Icons.keyboard_arrow_down_rounded
                            : Icons.keyboard_arrow_up_rounded,
                        color: const Color(0xFF4FC3F7),
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // Detalhes estendidos recolhíveis com animação suave
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
            alignment: Alignment.topCenter,
            child: _isDetailsCollapsed
                ? const SizedBox.shrink()
                : Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (parsedHouseColor != null ||
                            houseFinish != null ||
                            hasNoGate ||
                            parsedGateColor != null ||
                            client['visitTime'] != null ||
                            client['profession'] != null ||
                            (client['children'] != null &&
                                client['children'] is List &&
                                (client['children'] as List).isNotEmpty)) ...[
                          const SizedBox(height: 6),
                          const Divider(color: Colors.white12),
                          if (parsedHouseColor != null ||
                              houseFinish != null ||
                              hasNoGate ||
                              parsedGateColor != null) ...[
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 16,
                              runSpacing: 6,
                              crossAxisAlignment: WrapCrossAlignment.start,
                              children: [
                                if (parsedHouseColor != null || houseFinish != null)
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      const Text('Casa',
                                          style: TextStyle(
                                              color: Colors.white54,
                                              fontSize: 10)),
                                      const SizedBox(height: 4),
                                      Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (parsedHouseColor != null)
                                            Container(
                                              width: 22,
                                              height: 22,
                                              margin: const EdgeInsets.only(right: 6),
                                              decoration: BoxDecoration(
                                                color: parsedHouseColor,
                                                shape: BoxShape.circle,
                                                border:
                                                    Border.all(color: Colors.white30),
                                              ),
                                            ),
                                          if (houseFinish != null)
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                  horizontal: 6, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFFCE93D8).withOpacity(0.2),
                                                borderRadius: BorderRadius.circular(6),
                                                border: Border.all(
                                                    color: const Color(0xFFCE93D8).withOpacity(0.5)),
                                              ),
                                              child: Text(
                                                houseFinish == 'NO_REBOCO'
                                                    ? 'No reboco'
                                                    : 'Sem reboco',
                                                style: const TextStyle(
                                                    color: Color(0xFFCE93D8),
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.bold),
                                              ),
                                            ),
                                        ],
                                      )
                                    ],
                                  ),
                                if (hasNoGate)
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      const Text('Portão',
                                          style: TextStyle(
                                              color: Colors.white54,
                                              fontSize: 10)),
                                      const SizedBox(height: 4),
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: Colors.orange.withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(6),
                                          border: Border.all(
                                              color: Colors.orange.withOpacity(0.4)),
                                        ),
                                        child: const Text(
                                          'Sem portão',
                                          style: TextStyle(
                                              color: Colors.orangeAccent,
                                              fontSize: 10,
                                              fontWeight: FontWeight.bold),
                                        ),
                                      ),
                                    ],
                                  )
                                else if (parsedGateColor != null)
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      const Text('Cor do Portão',
                                          style: TextStyle(
                                              color: Colors.white54,
                                              fontSize: 10)),
                                      const SizedBox(height: 4),
                                      Container(
                                        width: 22,
                                        height: 22,
                                        decoration: BoxDecoration(
                                          color: parsedGateColor,
                                          shape: BoxShape.circle,
                                          border:
                                              Border.all(color: Colors.white30),
                                        ),
                                      )
                                    ],
                                  ),
                              ],
                            ),
                          ],
                          if (client['profession'] != null &&
                              client['profession'].toString().isNotEmpty) ...[
                            const SizedBox(height: 6),
                            _infoRow(
                                Icons.work, client['profession'].toString()),
                          ],
                          if (client['visitTime'] != null) ...[
                            const SizedBox(height: 4),
                            _infoRow(Icons.access_time,
                                "Visita: ${client['visitTime']}"),
                          ],
                          if (client['children'] != null &&
                              client['children'] is List &&
                              (client['children'] as List).isNotEmpty) ...[
                            const SizedBox(height: 6),
                            _infoRow(
                              Icons.child_care,
                              (client['children'] as List).length == 1
                                  ? "Criança: ${UIHelpers.formatChildren(client['children'])}"
                                  : "Crianças: ${UIHelpers.formatChildren(client['children'])}",
                            ),
                          ],
                        ],
                        if (client['signatureUrl'] != null &&
                            client['signatureUrl']
                                .toString()
                                .trim()
                                .isNotEmpty) ...[
                          const SizedBox(height: 8),
                          const Divider(color: Colors.white12),
                          const SizedBox(height: 6),
                          const Text('Assinatura do Cliente (Ficha)',
                              style: TextStyle(
                                  color: Colors.white54, fontSize: 10)),
                          const SizedBox(height: 4),
                          Container(
                            height: 70,
                            width: double.infinity,
                            padding: const EdgeInsets.all(4),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: AuthenticatedImage(
                              url: client['signatureUrl'].toString(),
                              fit: BoxFit.contain,
                            ),
                          ),
                        ],
                        if (!widget.isFotografo &&
                            client['nonSales'] != null &&
                            client['nonSales'] is List &&
                            (client['nonSales'] as List).isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                  color: Colors.redAccent.withOpacity(0.4)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: const [
                                    Icon(Icons.report_problem_rounded,
                                        color: Colors.redAccent, size: 16),
                                    SizedBox(width: 8),
                                    Text('Histórico de Não-Venda (Rebolo)',
                                        style: TextStyle(
                                            color: Colors.redAccent,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 12)),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                ...(client['nonSales'] as List).map((ns) {
                                  final reason = ns['reason'] ??
                                      'Motivo não especificado';
                                  final sellerName = ns['seller']?['name'] ??
                                      ns['sellerName'] ??
                                      'Vendedor';
                                  final dateStr = ns['date'] != null
                                      ? ns['date'].toString().split('T')[0]
                                      : '';
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 4),
                                    child: Text(
                                        '• Motivo: "$reason" | Vendedor: $sellerName ($dateStr)',
                                        style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w500)),
                                  );
                                }).toList(),
                              ],
                            ),
                          ),
                        ],
                        if (client['cityClosedAt'] != null) ...[
                          const SizedBox(height: 8),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: Colors.amber.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                  color: Colors.amberAccent.withOpacity(0.6)),
                            ),
                            child: Row(
                              children: const [
                                Icon(Icons.lock_rounded,
                                    color: Colors.amberAccent, size: 18),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    'Cidade Encerrada: Bloqueado para novas vendas e não-vendas.',
                                    style: TextStyle(
                                        color: Colors.amberAccent,
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
          ),
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
              style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 12),
              overflow: TextOverflow.ellipsis)),
    ]);
  }

  Widget _buildTabBar() {
    return Container(
      color: const Color(0xFF1A2535),
      child: TabBar(
        controller: _tabController,
        onTap: (index) {
          if (!_isDetailsCollapsed) {
            setState(() => _isDetailsCollapsed = true);
          }
        },
        tabs: _tabs,
        labelColor: const Color(0xFF4FC3F7),
        unselectedLabelColor: const Color(0xFF546E7A),
        labelStyle: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
        indicatorColor: const Color(0xFF4FC3F7),
        indicatorWeight: 2,
        dividerColor: Colors.transparent,
      ),
    );
  }

  Widget _buildTabView(Map<String, dynamic> client) {
    return TabBarView(
      physics: const NeverScrollableScrollPhysics(),
      controller: _tabController,
      children: [
        _SaleTab(client: client, onSuccess: _showSuccess),
        _NonSaleTab(client: client, onSuccess: _showSuccess),
        _ScheduleTab(client: client, onSuccess: _showSuccess),
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
      borderSide: BorderSide(color: Colors.white.withOpacity(0.15), width: 1),
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
        itemBuilder: (context, _) =>
            const Icon(Icons.star_rounded, color: Colors.amber),
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
    child: LedButton(
      onPressed: isLoading ? null : onPressed,
      style: LedButton.styleFrom(
        backgroundColor: Colors.transparent,
        shadowColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
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
  final Map<String, dynamic> client;
  final void Function(String) onSuccess;
  const _SaleTab({
    required this.client,
    required this.onSuccess,
  });

  @override
  State<_SaleTab> createState() => _SaleTabState();
}

class _SaleTabState extends State<_SaleTab> {
  final _valorVendaController = TextEditingController();
  final _numeroFichaController = TextEditingController();
  final _reportNotesController = TextEditingController();
  bool _isLoading = false;

  // Crediário / Parcelado
  bool _isCrediario = false;
  int _installmentsCount = 4;
  String _periodicity = 'MONTHLY';
  DateTime _firstDueDate = DateTime.now().add(const Duration(days: 30));

  late final TextEditingController _buyerNameController;
  late final TextEditingController _buyerCpfController;
  late final TextEditingController _cepController;
  late final TextEditingController _streetController;
  late final TextEditingController _numberController;
  late final TextEditingController _neighborhoodController;
  late final TextEditingController _cityController;
  late final TextEditingController _stateController;
  late final TextEditingController _complementController;

  late final SignatureController _signatureController;

  // Formas de pagamento divididas (Dinheiro, Pix, Cartão Crédito, Cartão Débito)
  final Map<String, bool> _selectedPaymentMethods = {
    'CASH': true,
    'PIX': false,
    'CREDIT': false,
    'DEBIT': false,
  };
  final Map<String, TextEditingController> _paymentAmountControllers = {
    'CASH': TextEditingController(),
    'PIX': TextEditingController(),
    'CREDIT': TextEditingController(),
    'DEBIT': TextEditingController(),
  };

  String _product = 'Book completo capa +Book+mídias';
  bool _hasCover = true;
  double _sellerRating = 0;
  double _photoRating = 0;
  double _contactRating = 0;

  File? _receiptPhoto;

  @override
  void initState() {
    super.initState();
    final client = widget.client;
    _buyerNameController = TextEditingController(
        text: client['name']?.toString() ?? client['mainContact']?.toString() ?? '');
    _buyerCpfController = TextEditingController(text: client['cpf']?.toString() ?? '');
    _cepController = TextEditingController(
        text: client['cep']?.toString() ?? client['postalCode']?.toString() ?? '');
    _streetController = TextEditingController(text: client['street']?.toString() ?? '');
    _numberController = TextEditingController(text: client['number']?.toString() ?? '');
    _neighborhoodController =
        TextEditingController(text: client['neighborhood']?.toString() ?? '');
    _cityController = TextEditingController(text: client['city']?.toString() ?? '');
    _stateController = TextEditingController(text: client['state']?.toString() ?? 'PR');
    _complementController =
        TextEditingController(text: client['complement']?.toString() ?? '');

    _signatureController = SignatureController(
      penStrokeWidth: 3,
      penColor: Colors.black,
      exportBackgroundColor: Colors.white,
    );
  }

  @override
  void dispose() {
    _valorVendaController.dispose();
    _numeroFichaController.dispose();
    _reportNotesController.dispose();
    _buyerNameController.dispose();
    _buyerCpfController.dispose();
    _cepController.dispose();
    _streetController.dispose();
    _numberController.dispose();
    _neighborhoodController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _complementController.dispose();
    _signatureController.dispose();
    for (final ctrl in _paymentAmountControllers.values) {
      ctrl.dispose();
    }
    super.dispose();
  }

  bool _validateCpf(String cpf) {
    final clean = cpf.replaceAll(RegExp(r'\D'), '');
    if (clean.length != 11) return false;
    if (RegExp(r'^(\d)\1{10}$').hasMatch(clean)) return false;

    int sum1 = 0;
    for (int i = 0; i < 9; i++) {
      sum1 += int.parse(clean[i]) * (10 - i);
    }
    int rest1 = (sum1 * 10) % 11;
    if (rest1 == 10) rest1 = 0;
    if (rest1 != int.parse(clean[9])) return false;

    int sum2 = 0;
    for (int i = 0; i < 10; i++) {
      sum2 += int.parse(clean[i]) * (11 - i);
    }
    int rest2 = (sum2 * 10) % 11;
    if (rest2 == 10) rest2 = 0;
    if (rest2 != int.parse(clean[10])) return false;

    return true;
  }

  List<Map<String, dynamic>> _calculateSchedule(
      int financedCents, int count, String periodicity, DateTime firstDate) {
    if (count <= 0 || financedCents <= 0) return [];
    final baseAmount = financedCents ~/ count;
    final remainder = financedCents % count;

    final List<Map<String, dynamic>> schedule = [];
    for (int i = 0; i < count; i++) {
      DateTime due;
      if (periodicity == 'BIWEEKLY') {
        due = firstDate.add(Duration(days: i * 14));
      } else {
        due = DateTime(firstDate.year, firstDate.month + i, firstDate.day);
      }
      final amountCents = (i == count - 1) ? (baseAmount + remainder) : baseAmount;
      schedule.add({
        'number': i + 1,
        'dueDate': due,
        'amountCents': amountCents,
        'amount': amountCents / 100.0,
      });
    }
    return schedule;
  }

  double _parseMonetary(String text) {
    final clean = text.replaceAll(RegExp(r'[^0-9,]'), '').replaceAll(',', '.');
    return double.tryParse(clean) ?? 0.0;
  }

  void _submit() async {
    if (_isLoading) return;
    final double valor = _parseMonetary(_valorVendaController.text);
    if (_valorVendaController.text.isEmpty || valor <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Informe um valor de venda válido.'),
          backgroundColor: Colors.red));
      return;
    }

    final totalCents = (valor * 100).round();
    final List<Map<String, dynamic>> paymentsList = [];
    int sumCents = 0;

    for (final entry in _selectedPaymentMethods.entries) {
      if (entry.value) {
        final ctrl = _paymentAmountControllers[entry.key]!;
        final val = _parseMonetary(ctrl.text);
        if (val <= 0) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('Informe um valor maior que zero para a forma selecionada (${_getMethodLabel(entry.key)}).'),
              backgroundColor: Colors.red));
          return;
        }
        final pCents = (val * 100).round();
        sumCents += pCents;
        paymentsList.add({
          'method': entry.key,
          'amount': (pCents / 100.0),
        });
      }
    }

    if (paymentsList.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Selecione pelo menos uma forma de pagamento.'),
          backgroundColor: Colors.red));
      return;
    }

    Map<String, dynamic>? creditPayload;
    if (_isCrediario) {
      if (sumCents < 15000) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Toda nova venda com crediário exige entrada de pelo menos R\$ 150,00.'),
            backgroundColor: Colors.red));
        return;
      }
      if (sumCents >= totalCents) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('A entrada não pode ser igual ou superior ao valor total. Se o pagamento for total, desative o crediário.'),
            backgroundColor: Colors.red));
        return;
      }
      final buyerName = _buyerNameController.text.trim();
      if (buyerName.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Informe o nome do titular/responsável financeiro.'),
            backgroundColor: Colors.red));
        return;
      }
      final buyerCpf = _buyerCpfController.text.trim();
      if (!_validateCpf(buyerCpf)) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('CPF do titular financeiro inválido ou com dígitos verificadores incorretos.'),
            backgroundColor: Colors.red));
        return;
      }
      final street = _streetController.text.trim();
      final number = _numberController.text.trim();
      final neighborhood = _neighborhoodController.text.trim();
      final city = _cityController.text.trim();
      final state = _stateController.text.trim();
      final cep = _cepController.text.trim();
      if (street.isEmpty || number.isEmpty || neighborhood.isEmpty || city.isEmpty || state.isEmpty || cep.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Informe o endereço completo (CEP, rua, número, bairro, cidade e UF) para o contrato.'),
            backgroundColor: Colors.red));
        return;
      }
      if (_signatureController.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('A assinatura digital do comprador no termo de parcelamento é obrigatória.'),
            backgroundColor: Colors.red));
        return;
      }

      final sigBytes = await _signatureController.toPngBytes();
      final sigBase64 = sigBytes != null ? 'data:image/png;base64,${base64Encode(sigBytes)}' : null;

      creditPayload = {
        'buyerName': buyerName,
        'buyerCpf': buyerCpf.replaceAll(RegExp(r'\D'), ''),
        'buyerPhone': widget.client['phone'] ?? widget.client['phone2'] ?? '',
        'postalCode': cep,
        'street': street,
        'number': number,
        'neighborhood': neighborhood,
        'city': city,
        'state': state,
        'complement': _complementController.text.trim(),
        'installmentsCount': _installmentsCount,
        'periodicity': _periodicity,
        'firstDueDate': _firstDueDate.toIso8601String(),
        'signedAgreementUrl': sigBase64,
        'notes': _reportNotesController.text.trim(),
      };
    } else {
      if (sumCents != totalCents) {
        final diff = ((sumCents - totalCents) / 100.0);
        final diffStr = diff > 0 ? 'excede em R\$ ${diff.toStringAsFixed(2)}' : 'falta R\$ ${(-diff).toStringAsFixed(2)}';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('A soma das parcelas (R\$ ${(sumCents / 100.0).toStringAsFixed(2)}) não bate com a venda (R\$ ${valor.toStringAsFixed(2)}). Valor $diffStr.'),
            backgroundColor: Colors.red));
        return;
      }
    }

    if (_receiptPhoto == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content:
              Text('Tire a foto do comprovante antes de confirmar a venda.'),
          backgroundColor: Colors.orange));
      return;
    }
    setState(() => _isLoading = true);

    try {
      final apiService = Provider.of<ApiService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);

      final payload = {
        'clientId': widget.client['id'],
        'city': widget.client['city'] ?? '',
        'value': valor,
        'product': _product,
        'status': 'PRONTO',
        'paymentStatus': _isCrediario ? 'PARTIALLY_PAID' : 'PAID',
        'fichaNumber': _numeroFichaController.text,
        'paymentMethod': paymentsList.length > 1 ? 'SPLIT' : paymentsList.first['method'],
        'payments': paymentsList,
        'reportNotes': _reportNotesController.text,
        'sellerRating': _sellerRating,
        'photoRating': _photoRating,
        'contactRating': _contactRating,
        if (creditPayload != null) 'credit': creditPayload,
      };

      try {
        await apiService.registerSaleWithReceipt(payload, _receiptPhoto!.path);
      } on ApiRequestException catch (e) {
        if (!e.retryable) rethrow;
        final storageDir = await getApplicationSupportDirectory();
        final pendingDir = Directory(
            '${storageDir.path}${Platform.pathSeparator}pending_receipts');
        await pendingDir.create(recursive: true);
        final persistedReceipt = await _receiptPhoto!.copy(
          '${pendingDir.path}${Platform.pathSeparator}${widget.client['id']}_receipt_${SyncService.generateUuid()}.jpg',
        );
        final queued = await syncService.addPendingRequest('REGISTER_SALE', {
          ...payload,
          'pendingReceiptPath': persistedReceipt.path,
        });
        if (queued) {
          if (mounted) {
            setState(() {
              _isLoading = false;
              _receiptPhoto = null;
            });
            _valorVendaController.clear();
            _numeroFichaController.clear();
            _reportNotesController.clear();
            Navigator.of(context).pop({
              'saleSuccess': true,
              'message': 'Sem confirmação do servidor. Venda salva offline aguardando sincronização.',
            });
          }
        } else {
          try {
            if (await persistedReceipt.exists()) {
              await persistedReceipt.delete();
            }
          } catch (_) {}
          if (mounted) {
            setState(() => _isLoading = false);
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text(
                  'Falha ao enfileirar venda offline. Tente novamente com conexão.'),
              backgroundColor: Colors.red,
            ));
          }
        }
        return;
      }

      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _receiptPhoto = null;
      });
      _valorVendaController.clear();
      _numeroFichaController.clear();
      _reportNotesController.clear();
      Navigator.of(context).pop({
        'saleSuccess': true,
        'message': 'Venda registrada com sucesso',
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro ao registrar venda: $e'),
              backgroundColor: Colors.red),
        );
      }
    }
  }

  void _takeReceiptPhoto({String? targetSaleId}) async {
    final result = await MediaPickerService().pickSaleEvidencePhoto(context);
    if (result != null) {
      setState(() => _receiptPhoto = result.file);
      if (targetSaleId != null) {
        _sendReceiptForExistingSale(targetSaleId);
      }
    }
  }

  void _sendReceiptForExistingSale(String targetSaleId) async {
    if (_receiptPhoto == null) return;
    setState(() => _isLoading = true);
    try {
      final apiService = Provider.of<ApiService>(context, listen: false);
      await apiService.uploadSaleReceipt(targetSaleId, _receiptPhoto!.path);
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _receiptPhoto = null;
      });
      widget.onSuccess('Comprovante anexado com sucesso!');
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro ao anexar comprovante: $e'),
              backgroundColor: Colors.red),
        );
      }
    }
  }



  @override
  Widget build(BuildContext context) {
    final client = widget.client;
    final isSold = client['outcomeStatus'] == 'SOLD';
    final isCityClosed = client['cityClosedAt'] != null;
    final List sales =
        (client['sales'] is List) ? (client['sales'] as List) : [];
    final completedSales = sales
        .where((sale) =>
            sale is Map &&
            sale['receiptUrl'] != null &&
            sale['receiptUrl'].toString().trim().isNotEmpty)
        .toList();
    final Map<String, dynamic>? activeSale = completedSales.isNotEmpty
        ? Map<String, dynamic>.from(completedSales.first as Map)
        : null;

    final keyboardPadding = MediaQuery.of(context).viewInsets.bottom;

    if (isSold && activeSale != null) {
      final receiptUrl = activeSale['receiptUrl']?.toString();
      final hasReceipt = receiptUrl != null && receiptUrl.trim().isNotEmpty;
      final saleVal =
          activeSale['value'] != null ? activeSale['value'].toString() : '---';
      final saleProd = activeSale['product']?.toString() ?? 'Book';
      final saleDate = activeSale['date'] != null
          ? activeSale['date'].toString().split('T')[0]
          : '';
      final salePay = activeSale['paymentMethod']?.toString() ?? '';

      return SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF1B2E24),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF00E676).withOpacity(0.4)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: const [
                  Icon(Icons.check_circle_rounded,
                      color: Color(0xFF00E676), size: 28),
                  SizedBox(width: 10),
                  Text('Venda Já Registrada',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 16),
              const Divider(color: Colors.white12),
              const SizedBox(height: 12),
              _buildDetailRow('Valor da Venda', 'R\$ $saleVal',
                  highlight: true),
              const SizedBox(height: 8),
              _buildDetailRow('Produto', saleProd),
              const SizedBox(height: 8),
              _buildDetailRow('Data', saleDate),
              const SizedBox(height: 8),
              _buildDetailRow('Forma de Pagamento', salePay),
              const SizedBox(height: 16),
              const Divider(color: Colors.white12),
              const SizedBox(height: 12),
              if (activeSale['sheetPhotoUrl'] != null &&
                  activeSale['sheetPhotoUrl'].toString().trim().isNotEmpty) ...[
                const Text('Foto da Folha / Ficha:',
                    style: TextStyle(
                        color: Colors.white70,
                        fontSize: 13,
                        fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Container(
                  height: 180,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.white24),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: AuthenticatedImage(
                        url: activeSale['sheetPhotoUrl'].toString(),
                        fit: BoxFit.cover),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              const Text('Comprovante de Pagamento:',
                  style: TextStyle(
                      color: Colors.white70,
                      fontSize: 13,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (hasReceipt) ...[
                Container(
                  height: 180,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.white24),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child:
                        AuthenticatedImage(url: receiptUrl, fit: BoxFit.cover),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _isLoading
                      ? null
                      : () => _takeReceiptPhoto(targetSaleId: activeSale['id']),
                  icon: const Icon(Icons.refresh,
                      color: Color(0xFF4FC3F7), size: 18),
                  label: const Text('Substituir Comprovante',
                      style: TextStyle(color: Color(0xFF4FC3F7))),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF4FC3F7)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ] else ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                    border:
                        Border.all(color: Colors.orangeAccent.withOpacity(0.4)),
                  ),
                  child: Row(
                    children: const [
                      Icon(Icons.warning_amber_rounded,
                          color: Colors.orangeAccent, size: 20),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text('Nenhum comprovante anexado a esta venda.',
                            style: TextStyle(
                                color: Colors.orangeAccent, fontSize: 12)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _isLoading
                      ? null
                      : () => _takeReceiptPhoto(targetSaleId: activeSale['id']),
                  icon: const Icon(Icons.camera_alt, color: Color(0xFF4FC3F7)),
                  label: const Text('Anexar Comprovante Agora',
                      style: TextStyle(color: Color(0xFF4FC3F7))),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF4FC3F7)),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ],
            ],
          ),
        ),
      );
    }

    if (isCityClosed) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.amber.withOpacity(0.4)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: const [
              Icon(Icons.lock_outline_rounded,
                  color: Colors.amberAccent, size: 48),
              SizedBox(height: 12),
              Text('Cidade Encerrada',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text(
                'Esta cidade foi encerrada no Fechamento de Cidade. O registro de novas vendas está bloqueado para estas fichas.',
                style: TextStyle(color: Colors.white70, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + keyboardPadding),
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
          Text(
              'Cliente: ${widget.client['name'] ?? widget.client['id']} · Cidade: ${widget.client['city'] ?? ''}',
              style: const TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
          const SizedBox(height: 20),
          ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: TextField(
              controller: _valorVendaController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                CurrencyTextInputFormatter.currency(
                    locale: 'pt_BR', symbol: r'R$')
              ],
              style: const TextStyle(color: Colors.white, fontSize: 18),
              decoration: _fieldDecoration(
                  r'Valor da Venda (R$)', Icons.attach_money_rounded),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _numeroFichaController,
            style: const TextStyle(color: Colors.white),
            decoration: _fieldDecoration('Observações', Icons.notes_rounded),
          ),
          const SizedBox(height: 16),
          _buildDropdown('Produto', _product, [
            'Book completo capa +Book+mídias',
            'Book sem mídias',
            'Book sem capa',
            'Book com defeito'
          ], (v) {
            setState(() {
              _product = v!;
              if (_product == 'Book sem capa') {
                _hasCover = false;
              } else if (_product == 'Book completo capa +Book+mídias' ||
                  _product == 'Book sem mídias') {
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
                title: const Text('O book tinha capa?',
                    style: TextStyle(color: Colors.white)),
                subtitle: const Text('Marque se a capa precisou ser usada.',
                    style: TextStyle(color: Colors.white54, fontSize: 12)),
                value: _hasCover,
                activeColor: const Color(0xFF4FC3F7),
                checkColor: Colors.black,
                tileColor: Colors.white.withOpacity(0.05),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
                onChanged: (val) => setState(() => _hasCover = val ?? false),
              ),
            ),
            const SizedBox(height: 16),
          ],
          _buildCrediarioToggle(),
          const SizedBox(height: 16),
          _buildSplitPaymentSection(),
          if (_isCrediario) ...[
            const SizedBox(height: 16),
            _buildCrediarioDetailsSection(),
          ],
          const SizedBox(height: 24),
          const Text('Avaliação do Atendimento',
              style: TextStyle(
                  color: Color(0xFF90CAF9),
                  fontWeight: FontWeight.bold,
                  fontSize: 14)),
          const SizedBox(height: 12),
          _buildRatingField(
              'Vendedor', (r) => setState(() => _sellerRating = r)),
          const SizedBox(height: 12),
          _buildRatingField(
              'Fotógrafo', (r) => setState(() => _photoRating = r)),
          const SizedBox(height: 12),
          _buildRatingField(
              'O Contato', (r) => setState(() => _contactRating = r)),
          const SizedBox(height: 20),
          TextField(
            controller: _reportNotesController,
            maxLines: 2,
            style: const TextStyle(color: Colors.white),
            decoration: _fieldDecoration('Anotações do Relatório de Vendas',
                Icons.rate_review_outlined),
          ),

          const SizedBox(height: 24),
          const Text('Comprovante de pagamento (obrigatório)',
              style: TextStyle(
                  color: Color(0xFF90CAF9),
                  fontWeight: FontWeight.bold,
                  fontSize: 14)),
          const SizedBox(height: 12),
          if (_receiptPhoto != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.file(_receiptPhoto!,
                  height: 140, width: double.infinity, fit: BoxFit.cover),
            ),
            TextButton.icon(
              onPressed: _takeReceiptPhoto,
              icon: const Icon(Icons.camera_alt, color: Color(0xFF4FC3F7)),
              label: const Text('Tirar outra foto',
                  style: TextStyle(color: Color(0xFF4FC3F7))),
            ),
          ] else ...[
            OutlinedButton.icon(
              onPressed: _takeReceiptPhoto,
              icon: const Icon(Icons.camera_alt, color: Color(0xFF4FC3F7)),
              label: const Text('Tirar foto do comprovante',
                  style: TextStyle(color: Color(0xFF4FC3F7))),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 56),
                side: const BorderSide(color: Color(0xFF4FC3F7)),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
          const SizedBox(height: 16),
          _confirmButton(
            isLoading: _isLoading,
            onPressed: _submit,
            label: 'Confirmar Venda com Comprovante',
            colors: const [Color(0xFF2E7D32), Color(0xFF66BB6A)],
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {bool highlight = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white70, fontSize: 13)),
        Text(
          value,
          style: TextStyle(
            color: highlight ? const Color(0xFF00E676) : Colors.white,
            fontSize: highlight ? 16 : 13,
            fontWeight: highlight ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }

  String _getMethodLabel(String key) {
    switch (key) {
      case 'CASH':
        return 'Dinheiro';
      case 'PIX':
        return 'Pix';
      case 'CREDIT':
        return 'Cartão de Crédito';
      case 'DEBIT':
        return 'Cartão de Débito';
      default:
        return key;
    }
  }

  IconData _getMethodIcon(String key) {
    switch (key) {
      case 'CASH':
        return Icons.attach_money;
      case 'PIX':
        return Icons.qr_code_scanner;
      case 'CREDIT':
        return Icons.credit_card;
      case 'DEBIT':
        return Icons.credit_score;
      default:
        return Icons.payment;
    }
  }

  Widget _buildCrediarioToggle() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF111C2D),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: _isCrediario
              ? const Color(0xFF0EA5E9)
              : Colors.white.withOpacity(0.1),
        ),
      ),
      child: SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text(
          'Venda com Crediário / Parcelado',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
        subtitle: Text(
          _isCrediario
              ? 'Exige entrada mínima de R\$ 150,00 e termo assinado.'
              : 'Pagamento integral à vista no momento da venda.',
          style: TextStyle(
            color: _isCrediario ? const Color(0xFF38BDF8) : Colors.white54,
            fontSize: 12,
          ),
        ),
        value: _isCrediario,
        activeColor: const Color(0xFF38BDF8),
        activeTrackColor: const Color(0xFF0EA5E9).withOpacity(0.5),
        onChanged: (val) {
          setState(() {
            _isCrediario = val;
            if (_isCrediario && _buyerNameController.text.trim().isEmpty) {
              _buyerNameController.text = (widget.client['nome'] ?? '').toString().trim();
            }
          });
        },
      ),
    );
  }

  Widget _buildSplitPaymentSection() {
    final double valorVenda = _parseMonetary(_valorVendaController.text);
    final totalCents = (valorVenda * 100).round();

    int sumCents = 0;
    for (final entry in _selectedPaymentMethods.entries) {
      if (entry.value) {
        final ctrl = _paymentAmountControllers[entry.key]!;
        final val = _parseMonetary(ctrl.text);
        sumCents += (val * 100).round();
      }
    }

    final double somaInformada = sumCents / 100.0;
    final int diffCents = sumCents - totalCents;
    final double diffValor = (diffCents.abs()) / 100.0;
    final bool isExact = totalCents > 0 && diffCents == 0;

    final bool isDownPaymentValid =
        _isCrediario && sumCents >= 15000 && sumCents < totalCents;
    final int remainingTo150 = 15000 - sumCents;

    final bool showSuccessBorder = _isCrediario ? isDownPaymentValid : isExact;
    final bool showAlertBorder = _isCrediario
        ? (totalCents > 0 && !isDownPaymentValid)
        : (totalCents > 0 && diffCents != 0);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.04),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: showSuccessBorder
              ? const Color(0xFF00E676).withOpacity(0.5)
              : (showAlertBorder
                  ? Colors.orange.withOpacity(0.5)
                  : Colors.white12),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  _isCrediario
                      ? 'Formas de Pagamento da Entrada'
                      : 'Formas de Pagamento',
                  style: const TextStyle(
                    color: Color(0xFF90CAF9),
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (totalCents > 0)
                Flexible(
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: showSuccessBorder
                          ? const Color(0xFF00E676).withOpacity(0.15)
                          : Colors.orange.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: showSuccessBorder
                            ? const Color(0xFF00E676)
                            : Colors.orange,
                      ),
                    ),
                    child: Text(
                      _isCrediario
                          ? (isDownPaymentValid
                              ? '✓ Entrada R\$ ${somaInformada.toStringAsFixed(2)}'
                              : (sumCents < 15000
                                  ? 'Falta R\$ ${(remainingTo150 / 100.0).toStringAsFixed(2)} (Mín. R\$ 150)'
                                  : 'Entrada total (desative crediário)'))
                          : (isExact
                              ? '✓ Soma exata'
                              : (diffCents > 0
                                  ? 'Excede R\$ ${diffValor.toStringAsFixed(2)}'
                                  : 'Falta R\$ ${diffValor.toStringAsFixed(2)}')),
                      style: TextStyle(
                        color: showSuccessBorder
                            ? const Color(0xFF00E676)
                            : Colors.orange,
                        fontWeight: FontWeight.bold,
                        fontSize: 11,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            _isCrediario
                ? 'A entrada (mínimo R\$ 150,00) pode combinar dinheiro, Pix e cartões:'
                : 'Selecione uma ou mais formas (ex: Dinheiro + Pix ou Cartão):',
            style: TextStyle(
                color: Colors.white.withOpacity(0.6), fontSize: 12),
          ),
          const SizedBox(height: 12),
          ..._selectedPaymentMethods.keys.map((methodKey) {
            final isSelected = _selectedPaymentMethods[methodKey] ?? false;
            final label = _getMethodLabel(methodKey);
            final icon = _getMethodIcon(methodKey);
            final controller = _paymentAmountControllers[methodKey]!;

            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: isSelected
                    ? Colors.white.withOpacity(0.06)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: isSelected
                      ? const Color(0xFF4FC3F7).withOpacity(0.4)
                      : Colors.white10,
                ),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      Checkbox(
                        value: isSelected,
                        activeColor: const Color(0xFF4FC3F7),
                        checkColor: Colors.black,
                        onChanged: (val) {
                          setState(() {
                            final checked = val ?? false;
                            _selectedPaymentMethods[methodKey] = checked;
                            if (checked && controller.text.trim().isEmpty) {
                              if (_isCrediario) {
                                if (sumCents == 0) {
                                  controller.text = '150.00';
                                }
                              } else {
                                if (diffCents < 0) {
                                  controller.text =
                                      (diffCents.abs() / 100.0).toStringAsFixed(2);
                                } else if (valorVenda > 0 &&
                                    somaInformada == 0) {
                                  controller.text = valorVenda.toStringAsFixed(2);
                                }
                              }
                            }
                          });
                        },
                      ),
                      Icon(icon,
                          color: isSelected
                              ? const Color(0xFF4FC3F7)
                              : Colors.white54,
                          size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          label,
                          style: TextStyle(
                            color: isSelected ? Colors.white : Colors.white70,
                            fontWeight: isSelected
                                ? FontWeight.bold
                                : FontWeight.normal,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (isSelected) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(40, 0, 10, 8),
                      child: TextField(
                        controller: controller,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14),
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: 'Valor pago em $label',
                          labelStyle: const TextStyle(
                              color: Color(0xFF90CAF9), fontSize: 12),
                          prefixText: 'R\$ ',
                          prefixStyle: const TextStyle(
                              color: Color(0xFF00E676),
                              fontWeight: FontWeight.bold),
                          filled: true,
                          fillColor: Colors.white.withOpacity(0.05),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 10),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: Colors.white24),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(
                                color: Color(0xFF4FC3F7), width: 1.5),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            );
          }),
          const Divider(color: Colors.white12, height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  _isCrediario ? 'Entrada Informada:' : 'Total Informado:',
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.7), fontSize: 13),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'R\$ ${somaInformada.toStringAsFixed(2)}',
                style: TextStyle(
                  color: showSuccessBorder
                      ? const Color(0xFF00E676)
                      : Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
            ],
          ),
          if (_isCrediario) ...[
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    'Saldo a Financiar:',
                    style: TextStyle(
                        color: Colors.white.withOpacity(0.7), fontSize: 13),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'R\$ ${((totalCents > sumCents ? totalCents - sumCents : 0) / 100.0).toStringAsFixed(2)}',
                  style: const TextStyle(
                      color: Color(0xFF38BDF8),
                      fontWeight: FontWeight.bold,
                      fontSize: 14),
                ),
              ],
            ),
          ],
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  'Valor Total da Venda:',
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.7), fontSize: 13),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'R\$ ${valorVenda.toStringAsFixed(2)}',
                style: const TextStyle(
                    color: Color(0xFF90CAF9),
                    fontWeight: FontWeight.bold,
                    fontSize: 14),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCrediarioDetailsSection() {
    final double valorVenda = _parseMonetary(_valorVendaController.text);
    final totalCents = (valorVenda * 100).round();
    int sumCents = 0;
    for (final entry in _selectedPaymentMethods.entries) {
      if (entry.value) {
        final ctrl = _paymentAmountControllers[entry.key]!;
        sumCents += (_parseMonetary(ctrl.text) * 100).round();
      }
    }
    final financedCents = (totalCents > sumCents) ? (totalCents - sumCents) : 0;
    final schedule = _calculateSchedule(
        financedCents, _installmentsCount, _periodicity, _firstDueDate);
    final bool isCpfValid = _validateCpf(_buyerCpfController.text);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF111C2D),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF0EA5E9).withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.handshake_rounded, color: Color(0xFF38BDF8), size: 20),
              SizedBox(width: 8),
              Text(
                'Condições do Crediário & Blindagem Jurídica',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.3),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.white10),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Entrada Recebida',
                        style: TextStyle(color: Colors.white54, fontSize: 11)),
                    Text('R\$ ${(sumCents / 100.0).toStringAsFixed(2)}',
                        style: const TextStyle(
                            color: Color(0xFF00E676),
                            fontWeight: FontWeight.bold,
                            fontSize: 13)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Saldo Financiado',
                        style: TextStyle(color: Colors.white54, fontSize: 11)),
                    Text('R\$ ${(financedCents / 100.0).toStringAsFixed(2)}',
                        style: const TextStyle(
                            color: Color(0xFF38BDF8),
                            fontWeight: FontWeight.bold,
                            fontSize: 14)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                flex: 5,
                child: DropdownButtonFormField<int>(
                  value: _installmentsCount,
                  dropdownColor: const Color(0xFF111C2D),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration:
                      _fieldDecoration('Parcelas', Icons.calendar_view_day),
                  items: List.generate(24, (i) => i + 1)
                      .map((n) => DropdownMenuItem(
                          value: n, child: Text('$n parcelas')))
                      .toList(),
                  onChanged: (val) {
                    if (val != null) setState(() => _installmentsCount = val);
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 5,
                child: DropdownButtonFormField<String>(
                  value: _periodicity,
                  dropdownColor: const Color(0xFF111C2D),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: _fieldDecoration('Periodicidade', Icons.repeat),
                  items: const [
                    DropdownMenuItem(value: 'MONTHLY', child: Text('Mensal')),
                    DropdownMenuItem(
                        value: 'BIWEEKLY', child: Text('Quinzenal')),
                  ],
                  onChanged: (val) {
                    if (val != null) {
                      setState(() {
                        _periodicity = val;
                        _firstDueDate = DateTime.now().add(Duration(
                            days: _periodicity == 'BIWEEKLY' ? 15 : 30));
                      });
                    }
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          InkWell(
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _firstDueDate,
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) {
                setState(() => _firstDueDate = picked);
              }
            },
            child: InputDecorator(
              decoration: _fieldDecoration(
                  'Primeiro Vencimento', Icons.calendar_today_rounded),
              child: Text(
                '${_firstDueDate.day.toString().padLeft(2, '0')}/${_firstDueDate.month.toString().padLeft(2, '0')}/${_firstDueDate.year}',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold),
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Cronograma Prévio de Vencimentos:',
            style: TextStyle(
                color: Color(0xFF90CAF9),
                fontWeight: FontWeight.bold,
                fontSize: 12),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.03),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.white12),
            ),
            child: schedule.isEmpty
                ? const Text(
                    'Informe o valor da venda e a entrada para calcular as parcelas.',
                    style: TextStyle(color: Colors.white54, fontSize: 11))
                : Column(
                    children: schedule.map((item) {
                      final due = item['dueDate'] as DateTime;
                      final dStr =
                          '${due.day.toString().padLeft(2, '0')}/${due.month.toString().padLeft(2, '0')}/${due.year}';
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                                'Parcela ${item['number']}/$_installmentsCount',
                                style: const TextStyle(
                                    color: Colors.white70, fontSize: 12)),
                            Text('Vence em $dStr',
                                style: TextStyle(
                                    color: Colors.white.withOpacity(0.5),
                                    fontSize: 11)),
                            Text(
                                'R\$ ${(item['amount'] as double).toStringAsFixed(2)}',
                                style: const TextStyle(
                                    color: Color(0xFF38BDF8),
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12)),
                          ],
                        ),
                      );
                    }).toList(),
                  ),
          ),
          const SizedBox(height: 20),
          const Text(
            'Dados do Comprador / Titular Financeiro:',
            style: TextStyle(
                color: Color(0xFF90CAF9),
                fontWeight: FontWeight.bold,
                fontSize: 12),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _buyerNameController,
            style: const TextStyle(color: Colors.white),
            decoration: _fieldDecoration(
                'Nome Completo do Titular *', Icons.person_rounded),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _buyerCpfController,
            keyboardType: TextInputType.number,
            style: const TextStyle(color: Colors.white),
            onChanged: (val) {
              setState(() {});
            },
            decoration: InputDecoration(
              labelText: 'CPF do Titular *',
              labelStyle: const TextStyle(color: Color(0xFF90CAF9)),
              prefixIcon: const Icon(Icons.badge_rounded,
                  color: Color(0xFF4FC3F7), size: 18),
              suffixIcon: _buyerCpfController.text.trim().isNotEmpty
                  ? (isCpfValid
                      ? const Icon(Icons.check_circle_rounded,
                          color: Color(0xFF00E676), size: 20)
                      : const Icon(Icons.cancel_rounded,
                          color: Colors.redAccent, size: 20))
                  : null,
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(
                  color: _buyerCpfController.text.trim().isNotEmpty
                      ? (isCpfValid
                          ? const Color(0xFF00E676)
                          : Colors.redAccent)
                      : Colors.white.withOpacity(0.15),
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide:
                    const BorderSide(color: Color(0xFF4FC3F7), width: 1.5),
              ),
              filled: true,
              fillColor: Colors.white.withOpacity(0.05),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 4,
                child: TextField(
                  controller: _cepController,
                  keyboardType: TextInputType.number,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: _fieldDecoration(
                      'CEP *', Icons.local_post_office_outlined),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 6,
                child: TextField(
                  controller: _streetController,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration:
                      _fieldDecoration('Rua / Logradouro *', Icons.home_rounded),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 3,
                child: TextField(
                  controller: _numberController,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration:
                      _fieldDecoration('Nº *', Icons.pin_drop_outlined),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 7,
                child: TextField(
                  controller: _neighborhoodController,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: _fieldDecoration(
                      'Bairro *', Icons.location_city_rounded),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 6,
                child: TextField(
                  controller: _cityController,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration:
                      _fieldDecoration('Cidade *', Icons.location_on_outlined),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 4,
                child: TextField(
                  controller: _stateController,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: _fieldDecoration('UF *', Icons.map_outlined),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _complementController,
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: _fieldDecoration(
                'Complemento (opcional)', Icons.apartment_rounded),
          ),
          const SizedBox(height: 20),
          _buildConfissaoDividaCard(totalCents, sumCents, financedCents),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Assinatura Digital do Comprador *',
                style: TextStyle(
                    color: Color(0xFF90CAF9),
                    fontWeight: FontWeight.bold,
                    fontSize: 12),
              ),
              TextButton.icon(
                icon: const Icon(Icons.clear_rounded,
                    size: 14, color: Colors.orangeAccent),
                label: const Text('Limpar',
                    style: TextStyle(
                        color: Colors.orangeAccent, fontSize: 12)),
                onPressed: () => _signatureController.clear(),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF38BDF8), width: 1.5),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Signature(
                controller: _signatureController,
                height: 130,
                backgroundColor: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 6),
          const Center(
            child: Text(
              'O titular deve assinar dentro do quadro branco acima para validação.',
              style: TextStyle(color: Colors.white38, fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConfissaoDividaCard(
      int totalCents, int downPaymentCents, int financedCents) {
    final buyerName = _buyerNameController.text.trim().isEmpty
        ? '[NOME DO TITULAR]'
        : _buyerNameController.text.trim();
    final buyerCpf = _buyerCpfController.text.trim().isEmpty
        ? '[CPF]'
        : _buyerCpfController.text.trim();
    final street = _streetController.text.trim();
    final number = _numberController.text.trim();
    final city = _cityController.text.trim();
    final address = (street.isNotEmpty && number.isNotEmpty)
        ? '$street, $number - $city'
        : '[ENDEREÇO COMPLETO]';

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.35),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.gavel_rounded, color: Color(0xFF38BDF8), size: 16),
              SizedBox(width: 6),
              Text(
                'TERMO DE PARCELAMENTO E CONFISSÃO DE DÍVIDA',
                style: TextStyle(
                    color: Color(0xFF38BDF8),
                    fontWeight: FontWeight.bold,
                    fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Pelo presente instrumento particular, o(a) DEVEDOR(A) $buyerName, portador(a) do CPF nº $buyerCpf, residente em $address, confessa e reconhece dever à CREDORA (Select Photos / Central Fotográfica) a quantia líquida e certa de R\$ ${(financedCents / 100.0).toStringAsFixed(2)}, decorrente do fornecimento de material fotográfico com valor total de R\$ ${(totalCents / 100.0).toStringAsFixed(2)}, abatida a entrada paga de R\$ ${(downPaymentCents / 100.0).toStringAsFixed(2)}.\n\nO saldo financiado será pago em $_installmentsCount parcelas com periodicidade ${_periodicity == "BIWEEKLY" ? "quinzenal" : "mensal"}, com primeiro vencimento em ${_firstDueDate.day.toString().padLeft(2, '0')}/${_firstDueDate.month.toString().padLeft(2, '0')}/${_firstDueDate.year}, assumindo o devedor integral responsabilidade pelo adimplemento pontual das obrigações.',
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 10,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDropdown(
    String label,
    String value,
    List<String> items,
    ValueChanged<String?> onChanged,
  ) {
    return DropdownButtonFormField<String>(
      isExpanded: true,
      value: value,
      dropdownColor: const Color(0xFF1A1A2E),
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF90CAF9)),
        filled: true,
        fillColor: Colors.white.withOpacity(0.05),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide:
                BorderSide(color: Colors.white.withOpacity(0.15), width: 1)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF4FC3F7), width: 1.5)),
      ),
      items: items
          .map((i) => DropdownMenuItem(
              value: i, child: Text(i, overflow: TextOverflow.ellipsis)))
          .toList(),
      onChanged: onChanged,
    );
  }
}

// ── ABA NÃO VENDA ─────────────────────────────────────────────────────────────
class _NonSaleTab extends StatefulWidget {
  final Map<String, dynamic> client;
  final void Function(String) onSuccess;
  const _NonSaleTab({required this.client, required this.onSuccess});

  @override
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

    final reasonToSubmit = _selectedReason!;
    setState(() => _isLoading = true);

    try {
      final apiService = Provider.of<ApiService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);

      final signatureBytes = await _sigController.toPngBytes();
      if (signatureBytes == null || signatureBytes.isEmpty) {
        setState(() => _isLoading = false);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('A assinatura é obrigatória.'),
              behavior: SnackBarBehavior.floating));
        }
        return;
      }
      final base64Signature = base64Encode(signatureBytes);

      final payload = {
        'clientId': widget.client['id'],
        'reason': reasonToSubmit,
        'signatureBase64': base64Signature,
        'sellerRating': _sellerRating,
        'photoRating': _photoRating,
        'contactRating': _contactRating,
      };

      try {
        await apiService.registerNonSale(payload);
        widget.onSuccess('Não-venda registrada com sucesso!');
      } catch (e) {
        await syncService.addPendingRequest('REGISTER_NONSALE', payload);
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Não-venda salva no aparelho e aguardando envio.'),
              backgroundColor: Colors.orange));
        widget.onSuccess('Não-venda aguardando confirmação do servidor.');
      }

      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _selectedReason = null;
      });
      _sigController.clear();
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro interno ao registrar não-venda: $e'),
              backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final client = widget.client;
    final isSold = client['outcomeStatus'] == 'SOLD' ||
        (client['sales'] != null && (client['sales'] as List).isNotEmpty);
    final isCityClosed = client['cityClosedAt'] != null;

    if (isSold) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF00E676).withOpacity(0.3)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: const [
              Icon(Icons.check_circle_outline_rounded,
                  color: Color(0xFF00E676), size: 48),
              SizedBox(height: 12),
              Text('Ficha Já Vendida',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text(
                'Esta ficha já possui venda confirmada. Não é possível registrar não-venda.',
                style: TextStyle(color: Colors.white70, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    if (isCityClosed) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.amber.withOpacity(0.4)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: const [
              Icon(Icons.lock_outline_rounded,
                  color: Colors.amberAccent, size: 48),
              SizedBox(height: 12),
              Text('Cidade Encerrada',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text(
                'Esta cidade foi encerrada no Fechamento de Cidade. O registro de não-venda está bloqueado.',
                style: TextStyle(color: Colors.white70, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 4),
          const Text('Registrar Recusa (Não Venda)',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          DropdownButtonFormField<String>(
            isExpanded: true,
            value: _selectedReason,
            dropdownColor: const Color(0xFF1A1A2E),
            style: const TextStyle(color: Colors.white),
            decoration: _fieldDecoration(
                'Motivo da Recusa', Icons.report_problem_rounded),
            items: _reasons
                .map((r) => DropdownMenuItem(
                    value: r, child: Text(r, overflow: TextOverflow.ellipsis)))
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
              border:
                  Border.all(color: const Color(0xFF4FC3F7).withOpacity(0.4)),
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
          const Text('Avaliação do Atendimento',
              style: TextStyle(
                  color: Color(0xFF90CAF9),
                  fontWeight: FontWeight.bold,
                  fontSize: 14)),
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
  final Map<String, dynamic> client;
  final void Function(String) onSuccess;
  const _ScheduleTab({required this.client, required this.onSuccess});

  @override
  State<_ScheduleTab> createState() => _ScheduleTabState();
}

class _ScheduleTabState extends State<_ScheduleTab> {
  DateTime _focusedDay = DateTime.now();
  DateTime? _selectedDay;
  CalendarFormat _calendarFormat = CalendarFormat.week;
  String? _selectedTime;
  final TextEditingController _obsController = TextEditingController();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _selectedDay = _focusedDay;
  }

  void _submit() async {
    if (_selectedDay == null || _selectedTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Selecione data e hora.'),
          behavior: SnackBarBehavior.floating));
      return;
    }
    setState(() => _isLoading = true);

    try {
      final apiService = Provider.of<ApiService>(context, listen: false);
      final syncService = Provider.of<SyncService>(context, listen: false);

      final dateIso = _selectedDay!.toIso8601String();
      final timeToSubmit = _selectedTime!;

      final payload = {
        'clientId': widget.client['id'],
        'date': dateIso,
        'time': timeToSubmit,
        'observation': _obsController.text,
      };

      try {
        await apiService.registerAppointment(payload);
        widget.onSuccess('Agendamento salvo com sucesso!');
      } catch (e) {
        await syncService.addPendingRequest('REGISTER_APPOINTMENT', payload);
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content:
                  Text('Agendamento salvo no aparelho e aguardando envio.'),
              backgroundColor: Colors.orange));
        widget.onSuccess('Agendamento aguardando confirmação do servidor.');
      }

      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _selectedDay = DateTime.now();
        _selectedTime = null;
      });
      _obsController.clear();
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro interno ao registrar agendamento: $e'),
              backgroundColor: Colors.red),
        );
      }
    }
  }

  Widget _buildTimeSlot(String time) {
    bool isSelected = _selectedTime == time;

    int hour = int.parse(time.split(':')[0]);
    int currentHour = DateTime.now().hour;
    int diff = (hour - currentHour).abs();

    Color neonColor = const Color(0xFF00E676);
    if (diff > 5) neonColor = const Color(0xFF00B0FF);
    if (diff > 10) neonColor = const Color(0xFFD500F9);

    double glowOpacity =
        isSelected ? 0.8 : (1.0 - (diff * 0.1)).clamp(0.1, 0.4);

    return GestureDetector(
      onTap: () => setState(() => _selectedTime = time),
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: const Color(0xFF1E2A3A),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? neonColor : neonColor.withOpacity(0.3),
            width: isSelected ? 2 : 1,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: neonColor.withOpacity(0.6),
                blurRadius: 12,
                spreadRadius: 2,
              )
            else
              BoxShadow(
                color: neonColor.withOpacity(glowOpacity),
                blurRadius: 6,
                spreadRadius: 0,
              ),
          ],
        ),
        child: Row(
          children: [
            Text(
              time,
              style: TextStyle(
                color: isSelected ? Colors.white : Colors.white70,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(width: 16),
            Container(
              width: 2,
              height: 24,
              color: neonColor.withOpacity(0.5),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: isSelected
                  ? Text(
                      '${widget.client['name']} (Ficha: ${widget.client['visibleCode'] ?? widget.client['sequenceNumber']})',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                      ),
                    )
                  : Text(
                      'Horário Livre',
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.4),
                        fontSize: 14,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    List<String> hours = [
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00'
    ];

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            runSpacing: 8,
            children: [
              const Text('Agendamento',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF00E676).withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                      color: const Color(0xFF00E676).withOpacity(0.5)),
                ),
                child: const Text('Neon Calendar',
                    style: TextStyle(
                        color: Color(0xFF00E676),
                        fontSize: 10,
                        fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFF1E2A3A),
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 8,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: LayoutBuilder(builder: (context, constraints) {
                return TableCalendar(
                  firstDay: DateTime.utc(2020, 10, 16),
                  lastDay: DateTime.utc(2030, 3, 14),
                  focusedDay: _focusedDay,
                  calendarFormat: _calendarFormat,
                  selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
                  onDaySelected: (selectedDay, focusedDay) {
                    setState(() {
                      _selectedDay = selectedDay;
                      _focusedDay = focusedDay;
                    });
                  },
                  onFormatChanged: (format) {
                    if (_calendarFormat != format) {
                      setState(() => _calendarFormat = format);
                    }
                  },
                  onPageChanged: (focusedDay) => _focusedDay = focusedDay,
                  calendarStyle: CalendarStyle(
                    defaultTextStyle: const TextStyle(color: Colors.white),
                    weekendTextStyle:
                        const TextStyle(color: Color(0xFFFF8A65)),
                    outsideTextStyle:
                        TextStyle(color: Colors.white.withOpacity(0.3)),
                    selectedDecoration: const BoxDecoration(
                      color: Color(0xFF00E676),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(color: Color(0xFF00E676), blurRadius: 10)
                      ],
                    ),
                    todayDecoration: BoxDecoration(
                      color: Colors.transparent,
                      shape: BoxShape.circle,
                      border:
                          Border.all(color: const Color(0xFF00B0FF), width: 2),
                    ),
                  ),
                  headerStyle: const HeaderStyle(
                    formatButtonVisible: false,
                    titleCentered: true,
                    titleTextStyle: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold),
                    leftChevronIcon:
                        Icon(Icons.chevron_left, color: Colors.white),
                    rightChevronIcon:
                        Icon(Icons.chevron_right, color: Colors.white),
                  ),
                  daysOfWeekStyle: const DaysOfWeekStyle(
                    weekdayStyle: TextStyle(color: Colors.white70),
                    weekendStyle: TextStyle(color: Color(0xFFFF8A65)),
                  ),
                );
              }),
            ),
          ),
          const SizedBox(height: 24),
          const Text('Planilha de Horários',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          ...hours.map((time) => _buildTimeSlot(time)),
          const SizedBox(height: 16),
          TextField(
            controller: _obsController,
            style: const TextStyle(color: Colors.white),
            maxLines: 3,
            decoration:
                _fieldDecoration('Observações (opcional)', Icons.notes_rounded),
          ),
          const SizedBox(height: 20),
          _confirmButton(
            isLoading: _isLoading,
            onPressed: _selectedTime != null ? _submit : null,
            label: 'Confirmar Agendamento',
            colors: _selectedTime != null
                ? const [Color(0xFF00E676), Color(0xFF00C853)]
                : const [Colors.grey, Colors.grey],
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
  File? _photoFile;
  bool _isUploading = false;

  void _capturePhoto() async {
    final result = await MediaPickerService().pickSaleEvidencePhoto(context);
    if (result != null) {
      setState(() => _photoFile = result.file);
    }
  }

  void _upload() async {
    if (_photoFile == null) return;
    setState(() => _isUploading = true);

    try {
      final bytes = await _photoFile!.readAsBytes();
      final base64String = base64Encode(bytes);

      final apiService = Provider.of<ApiService>(context, listen: false);
      await apiService.uploadPhoto({
        'clientId': widget.clientId,
        'photoBase64': base64String,
      });

      if (!mounted) return;
      setState(() {
        _isUploading = false;
        _photoFile = null;
      });
      widget
          .onSuccess('Foto enviada! Será deletada automaticamente em 10 dias.');
    } catch (e) {
      setState(() => _isUploading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro ao enviar foto: $e'),
              backgroundColor: Colors.red),
        );
      }
    }
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
                      style: TextStyle(color: Color(0xFF90CAF9), fontSize: 12)),
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
                  child: _photoFile != null
                      ? Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.image_rounded,
                                color: Color(0xFF4FC3F7), size: 60),
                            const SizedBox(height: 12),
                            Text(_photoFile!.path.split('/').last,
                                style: const TextStyle(
                                    color: Color(0xFF90CAF9), fontSize: 13)),
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
                                    color: Color(0xFF546E7A), fontSize: 13)),
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
                    onPressed: _isUploading ? null : _capturePhoto,
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
                    onPressed: _photoFile != null ? _upload : null,
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
