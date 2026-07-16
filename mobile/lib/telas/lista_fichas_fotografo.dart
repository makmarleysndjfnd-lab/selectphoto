import 'package:flutter/material.dart';
import '../servicos/servico_api.dart';
import 'package:intl/intl.dart';
import 'solicitar_correcao_ficha.dart';

class ListaFichasFotografo extends StatefulWidget {
  const ListaFichasFotografo({super.key});

  @override
  State<ListaFichasFotografo> createState() => _ListaFichasFotografoState();
}

class _ListaFichasFotografoState extends State<ListaFichasFotografo> {
  bool _isLoading = true;
  List<dynamic> _fichas = [];

  @override
  void initState() {
    super.initState();
    _carregarFichas();
  }

  Future<void> _carregarFichas() async {
    setState(() => _isLoading = true);
    try {
      final fichas = await ApiService().getClientsByPhotographer();
      setState(() {
        _fichas = fichas;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
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
                      return Card(
                        color: Colors.black26,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: const BorderSide(color: Colors.white24, width: 1),
                        ),
                        margin: const EdgeInsets.only(bottom: 12),
                        child: ListTile(
                          title: Text(
                            ficha['mainContact'] ?? 'Sem Nome',
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
                            ],
                          ),
                          trailing: IconButton(
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
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
