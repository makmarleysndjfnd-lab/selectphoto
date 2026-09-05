import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import '../servicos/servico_sincronizacao.dart';
import 'package:intl/intl.dart';
import '../utils/pdf_generator.dart';
import 'solicitar_correcao_ficha.dart';
import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'tela_detalhes_cliente_vendedor.dart' as import_tela_detalhes;
import '../widgets/led_card.dart';

class ListaFichasFotografo extends StatefulWidget {
  const ListaFichasFotografo({super.key});

  @override
  State<ListaFichasFotografo> createState() => _ListaFichasFotografoState();
}

class _ListaFichasFotografoState extends State<ListaFichasFotografo> {
  bool _isLoading = true;
  List<dynamic> _fichas = [];
  final Set<String> _sendingIds = {};

  Map<String, dynamic> _getStatusDisplay(Map<String, dynamic> ficha) {
    if (ficha['isOfflinePending'] == true) {
      return {'label': '⚠️ Pendente de sincronização', 'color': Colors.amberAccent};
    }
    final status = (ficha['bookStatus'] ?? 'CREATED').toString();
    switch (status) {
      case 'CREATED':
        return {'label': '📷 Produção do fotógrafo (Na Câmera)', 'color': Colors.orangeAccent};
      case 'AWAITING_RELEASE':
        return {'label': '⏳ Aguardando liberação (Admin)', 'color': const Color(0xFF64B5F6)};
      case 'IN_STOCK':
        return {'label': '📦 Em Estoque', 'color': const Color(0xFF81C784)};
      case 'DISTRIBUTED':
        return {'label': '🚗 Distribuída (Vendedor)', 'color': const Color(0xFF4DB6AC)};
      case 'SOLD':
        return {'label': '✅ Vendida', 'color': Colors.greenAccent};
      case 'AWAITING_RETURN':
        return {'label': '↩️ Aguardando devolução', 'color': const Color(0xFFBA68C8)};
      case 'IN_STOCK_REBOLO':
        return {'label': '🔄 Rebolo (Disponível)', 'color': const Color(0xFFFF8A65)};
      case 'DISTRIBUTED_REBOLO':
        return {'label': '🔄 Rebolo (Com vendedor)', 'color': const Color(0xFFFFB74D)};
      case 'REBOLO_SOLD':
        return {'label': '💰 Rebolo (Vendido)', 'color': Colors.greenAccent};
      case 'DISCARDED':
        return {'label': '🗑️ Descarte defeituoso', 'color': Colors.redAccent};
      default:
        return {'label': status, 'color': Colors.white70};
    }
  }

  @override
  void initState() {
    super.initState();
    _carregarFichas();
  }

  Future<void> _carregarFichas() async {
    setState(() => _isLoading = true);
    try {
      final syncService = Provider.of<SyncService>(context, listen: false);
      List<dynamic> serverFichas = [];
      try {
        final fichas = await ApiService().getClientsByPhotographer();
        serverFichas = (fichas as List).toList();
      } catch (e) {
        debugPrint('Erro ao buscar fichas online do fotógrafo: $e');
      }

      // Buscar fichas offline pendentes na fila do SyncService
      final offlineRequests = syncService.pendingRequests
          .where((req) => req.type == 'REGISTER_CLIENT' || req.type == 'CREATE_CLIENT' || req.type == 'SYNC_CLIENTS')
          .toList();

      final offlineFichas = <Map<String, dynamic>>[];
      for (final req in offlineRequests) {
        final payload = Map<String, dynamic>.from(req.payload);
        if (payload.containsKey('clients') && payload['clients'] is List) {
          for (final item in (payload['clients'] as List)) {
            if (item is Map) {
              final clientItem = Map<String, dynamic>.from(item);
              clientItem['isOfflinePending'] = true;
              clientItem['bookStatus'] ??= 'CREATED';
              clientItem['name'] ??= clientItem['clientName'] ?? 'Ficha Offline Pendente';
              offlineFichas.add(clientItem);
            }
          }
        } else {
          payload['isOfflinePending'] = true;
          payload['bookStatus'] ??= 'CREATED';
          payload['name'] ??= payload['clientName'] ?? 'Ficha Offline Pendente';
          offlineFichas.add(payload);
        }
      }

      // Mesclar sem duplicidade de sequenceNumber ou id
      final Map<String, dynamic> mergedMap = {};
      for (final sf in serverFichas) {
        final key = sf['id']?.toString() ?? sf['sequenceNumber']?.toString() ?? UniqueKey().toString();
        mergedMap[key] = sf;
      }
      for (final of in offlineFichas) {
        final key = of['id']?.toString() ?? of['sequenceNumber']?.toString() ?? UniqueKey().toString();
        if (!mergedMap.containsKey(key)) {
          mergedMap[key] = of;
        }
      }

      final allFichas = mergedMap.values.toList();

      if (mounted) {
        setState(() {
          _fichas = allFichas;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao carregar fichas: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F1923),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2A0D2E),
        title: const Text('Fichas Produzidas', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.print, color: Colors.orangeAccent),
            tooltip: 'Imprimir Lote em PDF',
            onPressed: () async {
              if (_fichas.isEmpty) return;
              ScaffoldMessenger.of(context).clearSnackBars();
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preparando PDF do lote...')));
              final clients = _fichas.map((f) => Map<String, dynamic>.from(f as Map)).toList();
              await PdfGenerator.printBatch(clients, 'Fotografo');
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
          : _fichas.isEmpty
              ? const Center(child: Text('Nenhuma ficha encontrada.', style: TextStyle(color: Colors.white54)))
              : RefreshIndicator(
                  onRefresh: _carregarFichas,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _fichas.length,
                    itemBuilder: (context, index) {
                      final ficha = _fichas[index];
                      final eventDate = ficha['eventDate'] != null ? DateTime.tryParse(ficha['eventDate']) : null;
                      final isOffline = ficha['isOfflinePending'] == true;

                      return LedCard(
                        color: Colors.black26,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: isOffline ? Colors.amberAccent : Colors.white24, width: 1),
                        ),
                        margin: const EdgeInsets.only(bottom: 12),
                        child: ListTile(
                          title: Text(
                            ficha['name'] ?? ficha['mainContact'] ?? 'Sem Nome',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${ficha['city'] ?? ''} - ${ficha['neighborhood'] ?? ''}',
                                style: const TextStyle(color: Colors.white70),
                              ),
                              if (eventDate != null)
                                Text(
                                  'Data: ${DateFormat('dd/MM/yyyy').format(eventDate)}',
                                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                                ),
                              const SizedBox(height: 4),
                              Builder(
                                builder: (context) {
                                  final statusInfo = _getStatusDisplay(Map<String, dynamic>.from(ficha as Map));
                                  return Text(
                                    statusInfo['label'] as String,
                                    style: TextStyle(
                                      color: statusInfo['color'] as Color,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  );
                                },
                              ),
                            ],
                          ),

                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.print, color: Colors.blueAccent),
                                tooltip: 'Imprimir Ficha',
                                onPressed: () async {
                                  ScaffoldMessenger.of(context).clearSnackBars();
                                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preparando PDF...')));
                                  await PdfGenerator.printFicha(Map<String, dynamic>.from(ficha as Map));
                                },
                              ),
                              IconButton(
                                icon: const Icon(Icons.receipt_long, color: Colors.orangeAccent),
                                tooltip: 'Imprimir Ticket (Bluetooth)',
                                onPressed: () => _printUnidadeBluetooth(Map<String, dynamic>.from(ficha as Map)),
                              ),
                              if (!isOffline && (ficha['bookStatus'] == 'CREATED'))
                                Builder(
                                  builder: (context) {
                                    final fichaId = ficha['id']?.toString();
                                    final isSending = fichaId != null && _sendingIds.contains(fichaId);

                                    if (isSending) {
                                      return const Padding(
                                        padding: EdgeInsets.all(12.0),
                                        child: SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.greenAccent),
                                        ),
                                      );
                                    }

                                    return IconButton(
                                      icon: const Icon(Icons.send_and_archive, color: Colors.greenAccent),
                                      tooltip: 'Forçar Envio ao Admin',
                                      onPressed: isSending
                                          ? null
                                          : () async {
                                              final confirm = await showDialog<bool>(
                                                context: context,
                                                builder: (_) => AlertDialog(
                                                  backgroundColor: const Color(0xFF1A1A2E),
                                                  title: const Text('Forçar Envio?', style: TextStyle(color: Colors.white)),
                                                  content: const Text(
                                                    'Isso enviará esta ficha avulsa para a tela de liberação do Admin. Deseja continuar?',
                                                    style: TextStyle(color: Colors.white70),
                                                  ),
                                                  actions: [
                                                    TextButton(
                                                      onPressed: () => Navigator.pop(context, false),
                                                      child: const Text('Cancelar'),
                                                    ),
                                                    TextButton(
                                                      onPressed: () => Navigator.pop(context, true),
                                                      child: const Text('Enviar', style: TextStyle(color: Colors.greenAccent)),
                                                    ),
                                                  ],
                                                ),
                                              );
                                              if (confirm == true && fichaId != null) {
                                                setState(() => _sendingIds.add(fichaId));
                                                if (!mounted) return;
                                                ScaffoldMessenger.of(context).clearSnackBars();
                                                ScaffoldMessenger.of(context).showSnackBar(
                                                  const SnackBar(content: Text('Enviando ficha ao Admin...'), duration: Duration(seconds: 1)),
                                                );
                                                try {
                                                  await ApiService().forceSendClient(fichaId);
                                                  if (mounted) {
                                                    setState(() {
                                                      ficha['bookStatus'] = 'AWAITING_RELEASE';
                                                      _sendingIds.remove(fichaId);
                                                    });
                                                    ScaffoldMessenger.of(context).clearSnackBars();
                                                    ScaffoldMessenger.of(context).showSnackBar(
                                                      const SnackBar(
                                                        content: Text('Ficha enviada com sucesso! Aguardando liberação do Admin.'),
                                                        backgroundColor: Colors.green,
                                                        duration: Duration(seconds: 2),
                                                      ),
                                                    );
                                                  }
                                                  _carregarFichas();
                                                } catch (e) {
                                                  if (mounted) {
                                                    setState(() => _sendingIds.remove(fichaId));
                                                    ScaffoldMessenger.of(context).clearSnackBars();
                                                    ScaffoldMessenger.of(context).showSnackBar(
                                                      SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
                                                    );
                                                  }
                                                }
                                              }
                                            },
                                    );
                                  },
                                ),
                              IconButton(
                                icon: const Icon(Icons.edit_note, color: Color(0xFFCE93D8)),
                                onPressed: () {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => SolicitarCorrecaoFicha(ficha: ficha),
                                    ),
                                  ).then((_) => _carregarFichas());
                                },
                                tooltip: 'Solicitar Correção',
                              ),
                            ],
                          ),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => import_tela_detalhes.SellerClientDetailScreen(clientData: Map<String, dynamic>.from(ficha as Map), isFotografo: true),
                              ),
                            );
                          },
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  void _printUnidadeBluetooth(Map<String, dynamic> ficha) async {
    final bluetooth = BlueThermalPrinter.instance;
    bool? isConnected = await bluetooth.isConnected;
    if (isConnected != true) {
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nenhuma impressora conectada! Vá nas configurações.', style: TextStyle(color: Colors.white)), backgroundColor: Colors.red));
      }
      return;
    }

    final seq = ficha['sequenceNumber'] ?? 'S/N';
    final city = ficha['city'] ?? 'Sem Cidade';
    final eventName = ficha['eventName'] ?? 'Evento Desconhecido';
    
    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FICHA UNICA", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Ficha: $seq", 2, 1);
    bluetooth.printCustom("Evento: $eventName", 1, 1);
    bluetooth.printCustom("Cidade: $city", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Nome: ${ficha['childName'] ?? '-'}", 1, 0);
    bluetooth.printCustom("Idade: ${ficha['childAge'] ?? '-'}", 1, 0);
    bluetooth.printCustom("Pai/Mae: ${ficha['parentName'] ?? '-'}", 1, 0);
    bluetooth.printCustom("Tel: ${ficha['phone'] ?? '-'}", 1, 0);
    bluetooth.printNewLine();
    bluetooth.printCustom("_________________________________", 0, 1);
    bluetooth.printCustom("Obrigado!", 1, 1);
    bluetooth.printNewLine();
    bluetooth.printNewLine();
    bluetooth.printNewLine();

    if (mounted) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Imprimindo ticket...', style: TextStyle(color: Colors.white)), backgroundColor: Colors.green));
    }
  }
}

