import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';

class MyProspectsScreen extends StatefulWidget {
  const MyProspectsScreen({super.key});

  @override
  State<MyProspectsScreen> createState() => _MyProspectsScreenState();
}

class _MyProspectsScreenState extends State<MyProspectsScreen> {
  List<dynamic> _prospects = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProspects();
  }

  Future<void> _loadProspects() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = Provider.of<ApiService>(context, listen: false);
      final data = await api.getProspects();
      setState(() {
        _prospects = data;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _editProspect(Map<String, dynamic> prospect) async {
    final TextEditingController obsController = TextEditingController(text: prospect['observations'] ?? '');
    final TextEditingController valueController = TextEditingController(text: (prospect['expectedRevenue']?.toString() ?? '0'));

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: Text('Editar: ${prospect['name']}', style: const TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: valueController,
                style: const TextStyle(color: Colors.white),
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Receita Prevista (R\$)',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: obsController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Observações',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                ),
                maxLines: 2,
              )
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Salvar'),
            ),
          ],
        );
      }
    );

    if (result == true) {
      try {
        final api = Provider.of<ApiService>(context, listen: false);
        await api.updateProspect(prospect['id'], {
          'observations': obsController.text,
          'expectedRevenue': double.tryParse(valueController.text.replaceAll(',', '.')) ?? 0.0,
        });
        _loadProspects();
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Prospecto atualizado com sucesso!'), backgroundColor: Colors.green));
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao atualizar: $e'), backgroundColor: Colors.red));
      }
    }
  }

  Future<void> _deleteProspect(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2C),
        title: const Text('Confirmar Exclusão', style: TextStyle(color: Colors.white)),
        content: const Text('Deseja realmente remover este prospecto da sua lista e do fluxo futuro?', style: TextStyle(color: Colors.white70)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            child: const Text('Remover', style: TextStyle(color: Colors.white)),
          ),
        ],
      )
    );

    if (confirm == true) {
      try {
        final api = Provider.of<ApiService>(context, listen: false);
        await api.deleteProspect(id);
        _loadProspects();
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Prospecto removido.'), backgroundColor: Colors.amber));
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao excluir: $e'), backgroundColor: Colors.red));
      }
    }
  }

  Future<void> _buyEvent(Map<String, dynamic> prospect) async {
    final TextEditingController costController = TextEditingController();
    final TextEditingController photographerController = TextEditingController();

    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2C),
          title: Text('Comprar Evento: ${prospect['name']}', style: const TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Isso gerará uma despesa no Fluxo de Caixa.', style: TextStyle(color: Colors.white70, fontSize: 13)),
              const SizedBox(height: 16),
              TextField(
                controller: costController,
                style: const TextStyle(color: Colors.white),
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Custo de Aquisição (R\$)',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: photographerController,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Nome do Fotógrafo Responsável',
                  labelStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF4CAF50)),
              child: const Text('Confirmar Compra', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      }
    );

    if (result == true) {
      try {
        final api = Provider.of<ApiService>(context, listen: false);
        // Em um app real, chamaria api.buyEvent
        await Future.delayed(const Duration(milliseconds: 800)); // Mock
        _loadProspects();
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Evento comprado com sucesso! Despesa gerada.'), backgroundColor: Colors.green));
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red));
      }
    }
  }

  Widget _buildEventDetailRow(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        children: [
          Icon(icon, color: Colors.white70, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 15))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0030),
        title: const Text('Meus Prospectos & Favoritos', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFCE93D8)))
        : _error != null
          ? Center(child: Text('Erro: $_error', style: const TextStyle(color: Colors.red)))
          : _prospects.isEmpty
            ? const Center(child: Text('Nenhum prospecto salvo.', style: TextStyle(color: Colors.white54)))
            : ListView.builder(
                padding: const EdgeInsets.all(24),
                itemCount: _prospects.length,
                itemBuilder: (context, index) {
                  final p = _prospects[index];
                  return Card(
                    color: const Color(0xFF1A1A2E),
                    margin: const EdgeInsets.only(bottom: 24),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('${p['name'] ?? ''} - ${p['city'] ?? ''}', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                                    const SizedBox(height: 8),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(color: const Color(0xFFCE93D8).withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                                      child: Text(p['category'] ?? 'OTHER', style: const TextStyle(color: Color(0xFFCE93D8), fontSize: 12, fontWeight: FontWeight.bold)),
                                    )
                                  ],
                                ),
                              ),
                              Row(
                                children: [
                                  IconButton(
                                    icon: const Icon(Icons.edit, color: Colors.blueAccent),
                                    tooltip: 'Editar Valores e Obs',
                                    onPressed: () => _editProspect(p),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete, color: Colors.redAccent),
                                    tooltip: 'Excluir Prospecto',
                                    onPressed: () => _deleteProspect(p['id']),
                                  ),
                                ],
                              )
                            ],
                          ),
                          const Divider(color: Colors.white12, height: 32),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _buildEventDetailRow(Icons.calendar_month, 'Data: ${p['startDate'] != null ? p['startDate'].toString().split('T')[0] : 'N/A'}'),
                                    _buildEventDetailRow(Icons.groups, 'Público Esperado: ${p['audience'] ?? 'N/A'}'),
                                    _buildEventDetailRow(Icons.monetization_on, 'Receita Prevista (Fluxo Futuro): R\$ ${p['expectedRevenue']?.toString() ?? '0.0'}'),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _buildEventDetailRow(Icons.contact_phone, 'Contatos/Redes: ${p['organizerContact'] ?? 'N/A'}'),
                                    if (p['socialMedia'] != null && p['socialMedia'].toString().isNotEmpty)
                                      _buildEventDetailRow(Icons.link, 'Mídia: ${p['socialMedia']}'),
                                    _buildEventDetailRow(Icons.notes, 'Suas Observações: ${p['observations'] ?? 'Nenhuma'}'),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(color: Colors.blueAccent.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.lightbulb, color: Colors.blueAccent, size: 20),
                                const SizedBox(width: 12),
                                Expanded(child: Text('Análise da IA Original: ${p['notes'] ?? ''}', style: const TextStyle(color: Colors.blueAccent, fontStyle: FontStyle.italic, fontSize: 15))),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E1E2C),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFCE93D8).withOpacity(0.3)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Dados da Cidade (Salvos na Busca)', style: TextStyle(color: Color(0xFFCE93D8), fontWeight: FontWeight.bold)),
                                const SizedBox(height: 8),
                                _buildEventDetailRow(Icons.monetization_on, 'Renda Média: ${p['cityIncome'] ?? 'N/A'}'),
                                _buildEventDetailRow(Icons.attach_money, 'Renda Per Capita: ${p['cityPerCapita'] ?? 'N/A'}'),
                                _buildEventDetailRow(Icons.history, 'Idade: ${p['cityAge'] ?? 'N/A'}'),
                                _buildEventDetailRow(Icons.factory, 'Economia: ${p['cityEconomy'] ?? 'N/A'}'),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () => _buyEvent(p),
                              icon: const Icon(Icons.shopping_cart_checkout, color: Colors.white),
                              label: const Text('COMPRAR EVENTO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF4CAF50),
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              )
    );
  }
}
