import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
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
    return {'label': '📷 Em produção', 'color': Colors.orangeAccent};
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
      final prefs = await SharedPreferences.getInstance();
      List<dynamic> serverFichas = [];

      try {
        final fichas = await ApiService().getClientsByPhotographer();
        serverFichas = (fichas as List).toList();
        // Atualiza a cópia local de consulta, expurgando automaticamente qualquer registro desautorizado
        await prefs.setString('cached_photographer_fichas', jsonEncode(serverFichas));
      } catch (e) {
        debugPrint('Erro ao buscar fichas online do fotógrafo: $e');
        // Se falhou por rede/offline, utiliza a cópia local autorizada salva anteriormente
        final cachedStr = prefs.getString('cached_photographer_fichas');
        if (cachedStr != null && cachedStr.isNotEmpty) {
          try {
            serverFichas = jsonDecode(cachedStr) as List<dynamic>;
          } catch (_) {}
        }
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

      // Mesclar sem duplicidade priorizando chave UUID permanente
      String getFichaKey(Map f) {
        final u = f['uuid']?.toString();
        if (u != null && u.isNotEmpty) return 'u:$u';
        final id = f['id']?.toString();
        if (id != null && id.isNotEmpty) return 'id:$id';
        final seq = f['sequenceNumber']?.toString();
        if (seq != null && seq.isNotEmpty) return 'seq:$seq';
        final lid = f['localId']?.toString();
        if (lid != null && lid.isNotEmpty) return 'lid:$lid';
        return UniqueKey().toString();
      }

      final Map<String, dynamic> mergedMap = {};
      for (final sf in serverFichas) {
        if (sf is Map) {
          final key = getFichaKey(sf);
          mergedMap[key] = sf;
        }
      }
      for (final of in offlineFichas) {
        final key = getFichaKey(of);
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

  Future<void> _finalizarLoteProducao() async {
    final syncService = Provider.of<SyncService>(context, listen: false);

    // 1. Exigir confirmação de sincronização de todas as fichas daquele conjunto
    final hasPendingOffline = syncService.pendingRequests.any((req) =>
        req.type == 'REGISTER_CLIENT' ||
        req.type == 'CREATE_CLIENT' ||
        req.type == 'SYNC_CLIENTS') ||
        _fichas.any((f) => f['isOfflinePending'] == true);

    if (hasPendingOffline) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Existem fichas locais aguardando sincronização no servidor. Sincronize todas as fichas antes de finalizar a produção.'),
          backgroundColor: Colors.orange,
          duration: Duration(seconds: 4),
        ),
      );
      return;
    }

    final onlineFichas = _fichas
        .where((f) => f['isOfflinePending'] != true && (f['bookStatus'] == 'CREATED' || f['bookStatus'] == null))
        .toList();

    if (onlineFichas.isEmpty) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Nenhuma ficha em produção para finalizar.'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Finalizar Produção do Lote?', style: TextStyle(color: Colors.white)),
        content: Text(
          'Deseja finalizar a produção de ${onlineFichas.length} ficha(s)?\n\n'
          'Elas serão transferidas para "Aguardando liberação" do Administrador e sairão da sua lista de produção.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.greenAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Finalizar e Enviar', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isLoading = true);

    try {
      final clientIds = onlineFichas
          .map((f) => f['id']?.toString() ?? f['sequenceNumber']?.toString())
          .whereType<String>()
          .toList();

      final firstFicha = Map<String, dynamic>.from(onlineFichas.first as Map);
      final eventName = firstFicha['event']?.toString() ?? firstFicha['eventName']?.toString() ?? 'Evento';
      final city = firstFicha['city']?.toString();

      final res = await ApiService().createBookBatch(
        eventName,
        city: city,
        clientIds: clientIds,
      );

      // Atualizar cache local removendo as fichas finalizadas
      final prefs = await SharedPreferences.getInstance();
      final finishedSet = clientIds.toSet();
      final updatedLocalList = _fichas.where((f) {
        final id = f['id']?.toString();
        final seq = f['sequenceNumber']?.toString();
        return (id != null && !finishedSet.contains(id)) && (seq != null && !finishedSet.contains(seq));
      }).toList();

      await prefs.setString('cached_photographer_fichas', jsonEncode(updatedLocalList));

      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['message']?.toString() ?? 'Lote finalizado com sucesso! Fichas transferidas para liberação do Admin.'),
            backgroundColor: Colors.green,
            duration: const Duration(seconds: 3),
          ),
        );
      }
      await _carregarFichas();
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao finalizar lote: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _confirmAndForceSend(dynamic ficha, String? fichaId) async {
    if (fichaId == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Enviar Ficha Avulsa?', style: TextStyle(color: Colors.white)),
        content: const Text(
          'Esta ficha será entregue ao Administrador (Aguardando Liberação) e sairá da sua lista de produção. Deseja continuar?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Enviar', style: TextStyle(color: Colors.greenAccent)),
          ),
        ],
      ),
    );

    if (confirm == true) {
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
            _fichas.removeWhere((f) => f['id']?.toString() == fichaId || (f is Map && f['uuid'] != null && f['uuid'].toString() == ficha['uuid']?.toString()));
            _sendingIds.remove(fichaId);
          });
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('cached_photographer_fichas', jsonEncode(_fichas.where((f) => f['isOfflinePending'] != true).toList()));
          ScaffoldMessenger.of(context).clearSnackBars();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Ficha enviada com sucesso! Transferida para liberação do Admin.'),
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
  }

  Widget _buildCodeBadge(Map<String, dynamic> ficha) {
    final visibleCode = ficha['visibleCode']?.toString();
    final isOffline = ficha['isOfflinePending'] == true;
    final uuid = ficha['uuid']?.toString();
    final seq = ficha['sequenceNumber']?.toString();

    if (visibleCode != null && visibleCode.isNotEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFF1E293B),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color(0xFF4FC3F7)),
        ),
        child: Text(
          visibleCode,
          style: const TextStyle(
            color: Color(0xFF4FC3F7),
            fontWeight: FontWeight.bold,
            fontSize: 12,
            fontFamily: 'monospace',
          ),
        ),
      );
    }

    if (isOffline) {
      if (uuid != null && uuid.isNotEmpty) {
        final prov = 'PROV-${uuid.substring(0, uuid.length >= 8 ? 8 : uuid.length).toUpperCase()}';
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.orange.withOpacity(0.15),
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: Colors.orangeAccent),
          ),
          child: Text(
            prov,
            style: const TextStyle(
              color: Colors.orangeAccent,
              fontWeight: FontWeight.bold,
              fontSize: 11,
              fontFamily: 'monospace',
            ),
          ),
        );
      }
    }

    final fallbackCode = (seq != null && seq.isNotEmpty)
        ? seq
        : (ficha['id'] != null ? '#${ficha['id']}' : 'S/N');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white10,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        fallbackCode,
        style: const TextStyle(
          color: Colors.white70,
          fontSize: 11,
          fontFamily: 'monospace',
        ),
      ),
    );
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
          if (_fichas.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 8.0),
              child: TextButton.icon(
                icon: const Icon(Icons.send_and_archive, color: Colors.greenAccent, size: 18),
                label: const Text('Finalizar', style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold, fontSize: 13)),
                onPressed: _finalizarLoteProducao,
              ),
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
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => import_tela_detalhes.SellerClientDetailScreen(
                                  clientData: Map<String, dynamic>.from(ficha as Map),
                                  isFotografo: true,
                                ),
                              ),
                            );
                          },
                          child: Padding(
                            padding: const EdgeInsets.all(14.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Linha 1: Nome do cliente (largura total sem quebrar letra por letra) e Badge do Código
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        ficha['name'] ?? ficha['mainContact'] ?? 'Sem Nome',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 16,
                                        ),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    _buildCodeBadge(Map<String, dynamic>.from(ficha as Map)),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                // Linha 2: Localização e Data
                                Row(
                                  children: [
                                    const Icon(Icons.location_on, size: 14, color: Colors.white54),
                                    const SizedBox(width: 4),
                                    Expanded(
                                      child: Text(
                                        '${ficha['city'] ?? ''}${ficha['neighborhood'] != null && ficha['neighborhood'].toString().isNotEmpty ? ' - ${ficha['neighborhood']}' : ''}',
                                        style: const TextStyle(color: Colors.white70, fontSize: 13),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    if (eventDate != null) ...[
                                      const SizedBox(width: 8),
                                      Text(
                                        DateFormat('dd/MM/yyyy').format(eventDate),
                                        style: const TextStyle(color: Colors.white54, fontSize: 12),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 8),
                                // Linha 3: Situação / Status Badge
                                Row(
                                  children: [
                                    Builder(
                                      builder: (context) {
                                        final statusInfo = _getStatusDisplay(Map<String, dynamic>.from(ficha as Map));
                                        return Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                          decoration: BoxDecoration(
                                            color: (statusInfo['color'] as Color).withOpacity(0.12),
                                            borderRadius: BorderRadius.circular(6),
                                            border: Border.all(color: (statusInfo['color'] as Color).withOpacity(0.5)),
                                          ),
                                          child: Text(
                                            statusInfo['label'] as String,
                                            style: TextStyle(
                                              color: statusInfo['color'] as Color,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 11,
                                            ),
                                          ),
                                        );
                                      },
                                    ),
                                    if (isOffline) ...[
                                      const SizedBox(width: 8),
                                      const Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(Icons.sync_problem, size: 13, color: Colors.orangeAccent),
                                          SizedBox(width: 4),
                                          Text(
                                            'Aguardando sincronização',
                                            style: TextStyle(
                                              color: Colors.orangeAccent,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 11,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 10),
                                const Divider(color: Colors.white12, height: 1),
                                const SizedBox(height: 6),
                                // Linha 4: Barra de Ações dedicada (não concorre com o nome)
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    IconButton(
                                      icon: const Icon(Icons.print, color: Colors.blueAccent, size: 22),
                                      tooltip: 'Imprimir PDF',
                                      visualDensity: VisualDensity.compact,
                                      onPressed: () async {
                                        ScaffoldMessenger.of(context).clearSnackBars();
                                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Preparando PDF...')));
                                        await PdfGenerator.printFicha(Map<String, dynamic>.from(ficha as Map));
                                      },
                                    ),
                                    IconButton(
                                      icon: const Icon(Icons.receipt_long, color: Colors.orangeAccent, size: 22),
                                      tooltip: 'Ticket Bluetooth',
                                      visualDensity: VisualDensity.compact,
                                      onPressed: () => _printUnidadeBluetooth(Map<String, dynamic>.from(ficha as Map)),
                                    ),
                                    if (!isOffline && (ficha['bookStatus'] == 'CREATED' || ficha['bookStatus'] == null))
                                      Builder(
                                        builder: (context) {
                                          final fichaId = ficha['id']?.toString();
                                          final isSending = fichaId != null && _sendingIds.contains(fichaId);
                                          if (isSending) {
                                            return const Padding(
                                              padding: EdgeInsets.symmetric(horizontal: 12.0),
                                              child: SizedBox(
                                                width: 18,
                                                height: 18,
                                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.greenAccent),
                                              ),
                                            );
                                          }
                                          return IconButton(
                                            icon: const Icon(Icons.send_and_archive, color: Colors.greenAccent, size: 22),
                                            tooltip: 'Forçar Envio ao Admin',
                                            visualDensity: VisualDensity.compact,
                                            onPressed: isSending ? null : () => _confirmAndForceSend(ficha, fichaId),
                                          );
                                        },
                                      ),
                                    IconButton(
                                      icon: const Icon(Icons.edit_note, color: Color(0xFFCE93D8), size: 24),
                                      tooltip: 'Solicitar Correção',
                                      visualDensity: VisualDensity.compact,
                                      onPressed: () {
                                        Navigator.push(
                                          context,
                                          MaterialPageRoute(
                                            builder: (_) => SolicitarCorrecaoFicha(ficha: ficha),
                                          ),
                                        ).then((_) => _carregarFichas());
                                      },
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
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

    final seq = (ficha['sequenceNumber'] ?? 'S/N').toString();
    final isOffline = ficha['isOfflinePending'] == true;
    final visibleCode = (ficha['visibleCode'] != null && ficha['visibleCode'].toString().isNotEmpty)
        ? ficha['visibleCode'].toString()
        : (isOffline && ficha['uuid'] != null && ficha['uuid'].toString().isNotEmpty
            ? 'PROV-${ficha['uuid'].toString().substring(0, ficha['uuid'].toString().length >= 8 ? 8 : ficha['uuid'].toString().length).toUpperCase()}'
            : seq);
    final city = ficha['city'] ?? 'Sem Cidade';
    final eventName = ficha['eventName'] ?? 'Evento Desconhecido';
    
    bluetooth.printNewLine();
    bluetooth.printCustom("LUMORA - FICHA UNICA", 2, 1);
    bluetooth.printNewLine();
    bluetooth.printCustom("Ficha: $visibleCode", 2, 1);
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

