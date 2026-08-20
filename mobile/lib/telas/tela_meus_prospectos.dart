import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import '../provedores/provedor_configuracoes.dart';
import '../widgets/led_button.dart';
import '../widgets/led_card.dart';



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
            LedButton(
              onPressed: () => Navigator.pop(context, true),
              style: LedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Salvar'),
            ),
          ],
        );
      }
    );

    final api = Provider.of<ApiService>(context, listen: false);

    if (result == true) {
      if (!mounted) return;
      try {
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
    final api = Provider.of<ApiService>(context, listen: false);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2C),
        title: const Text('Confirmar Exclusão', style: TextStyle(color: Colors.white)),
        content: const Text('Deseja realmente remover este prospecto da sua lista e do fluxo futuro?', style: TextStyle(color: Colors.white70)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar', style: TextStyle(color: Colors.white54))),
          LedButton(
            onPressed: () => Navigator.pop(context, true),
            style: LedButton.styleFrom(backgroundColor: Colors.redAccent),
            child: const Text('Remover', style: TextStyle(color: Colors.white)),
          ),
        ],
      )
    );

    if (confirm == true) {
      if (!mounted) return;
      try {
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
            LedButton(
              onPressed: () => Navigator.pop(context, true),
              style: LedButton.styleFrom(backgroundColor: const Color(0xFF4CAF50)),
              child: const Text('Confirmar Compra', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      }
    );

    if (result == true) {
      try {
        // Mock compra de evento
        await Future.delayed(const Duration(milliseconds: 800));
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
                  return LedCard(
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
                            child: LedButton.icon(
                              onPressed: () => _buyEvent(p),
                              icon: const Icon(Icons.shopping_cart_checkout, color: Colors.white),
                              label: const Text('COMPRAR EVENTO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                              style: LedButton.styleFrom(
                                backgroundColor: const Color(0xFF4CAF50),
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                              ),
                            ),
                          ),
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Expanded(
                                child: LedButton.icon(
                                  onPressed: () => _showRoiDialog(p),
                                  icon: const Icon(Icons.calculate, size: 20, color: Colors.white),
                                  label: Text(
                                    p['roiApproved'] == true ? '✅ ROI Aprovado (Ver Detalhes)' : '📊 Calculadora de ROI da Viagem',
                                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                                  ),
                                  style: LedButton.styleFrom(
                                    backgroundColor: p['roiApproved'] == true ? Colors.blueAccent : const Color(0xFFCE93D8),
                                    padding: const EdgeInsets.symmetric(vertical: 14),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
    );
  }

  void _showRoiDialog(Map<String, dynamic> prospect) {
    final settings = Provider.of<SettingsProvider>(context, listen: false);

    final int durationDays = prospect['durationDays'] != null ? (int.tryParse(prospect['durationDays'].toString()) ?? 10) : 10;
    
    final TextEditingController fichasDiaCtrl = TextEditingController(text: (prospect['estimatedFichasPerDay'] ?? settings.defaultFichasPerDay).toString());
    final TextEditingController ticketCtrl = TextEditingController(text: (prospect['estimatedTicketValue'] ?? settings.defaultTicket).toString());
    final TextEditingController espacoCtrl = TextEditingController(text: (prospect['estimatedSpaceCost'] ?? 1000.0).toString());
    final TextEditingController pessoasCtrl = TextEditingController(text: (prospect['estimatedTeamSize'] ?? 2).toString());
    final TextEditingController distanciaCtrl = TextEditingController(text: (prospect['distanceFromBaseKm'] ?? 200.0).toString());

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final int fichasDia = int.tryParse(fichasDiaCtrl.text) ?? settings.defaultFichasPerDay;
            final double ticketMedio = double.tryParse(ticketCtrl.text.replaceAll(',', '.')) ?? settings.defaultTicket;
            final double custoEspaco = double.tryParse(espacoCtrl.text.replaceAll(',', '.')) ?? 1000.0;
            final int pessoas = int.tryParse(pessoasCtrl.text) ?? 2;
            final double distanciaKm = double.tryParse(distanciaCtrl.text.replaceAll(',', '.')) ?? 200.0;

            final double receitaTotal = durationDays * fichasDia * ticketMedio;
            final double custoProduto = durationDays * fichasDia * settings.productCost;
            final double custoHotel = durationDays * pessoas * settings.hotelCostPerPersonDay;
            final double custoAlimentacao = durationDays * pessoas * settings.foodCostPerPersonDay;
            final double custoCombustivel = (distanciaKm / 2.0) * settings.fuelCostPerKm;
            final double custoTotal = custoProduto + custoHotel + custoAlimentacao + custoCombustivel + custoEspaco;
            final double lucroEstimado = receitaTotal - custoTotal;
            final bool isApproved = prospect['roiApproved'] == true;

            return AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: Text('Calculadora de ROI — ${prospect['name']}', style: const TextStyle(color: Colors.white, fontSize: 18)),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: Colors.purple.withOpacity(0.15), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFCE93D8))),
                      child: Text('📍 ${prospect['city'] ?? 'Cidade'} · Permanência: $durationDays dias', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: fichasDiaCtrl,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Fichas Produzidas / Dia', labelStyle: TextStyle(color: Colors.white54), filled: true, fillColor: Colors.white10),
                      onChanged: (_) => setModalState(() {}),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: ticketCtrl,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Ticket Médio de Venda (R\$)', labelStyle: TextStyle(color: Colors.white54), filled: true, fillColor: Colors.white10),
                      onChanged: (_) => setModalState(() {}),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: espacoCtrl,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(labelText: 'Custo do Espaço (R\$ 500 a R\$ 3.000)', labelStyle: TextStyle(color: Colors.white54), filled: true, fillColor: Colors.white10),
                      onChanged: (_) => setModalState(() {}),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: pessoasCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Nº Pessoas Equipe', labelStyle: TextStyle(color: Colors.white54), filled: true, fillColor: Colors.white10),
                            onChanged: (_) => setModalState(() {}),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            controller: distanciaCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(labelText: 'Distância Goiânia (km)', labelStyle: TextStyle(color: Colors.white54), filled: true, fillColor: Colors.white10),
                            onChanged: (_) => setModalState(() {}),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    const Divider(color: Colors.white24),
                    const Text('Resumo Financeiro da Viagem:', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Text('📈 Receita Estimada: R\$ ${receitaTotal.toStringAsFixed(2)}', style: const TextStyle(color: Colors.greenAccent, fontSize: 14)),
                    Text('📦 Custo do Produto (Livro+Capa): R\$ ${custoProduto.toStringAsFixed(2)} (R\$ ${settings.productCost.toStringAsFixed(2)}/un)', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    Text('🏨 Hospedagem ($pessoas p × $durationDays d @ R\$ ${settings.hotelCostPerPersonDay.toStringAsFixed(0)}/dia): R\$ ${custoHotel.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    Text('🍽️ Alimentação ($pessoas p × $durationDays d @ R\$ ${settings.foodCostPerPersonDay.toStringAsFixed(0)}/dia): R\$ ${custoAlimentacao.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    Text('⛽ Combustível (@ R\$ ${settings.fuelCostPerKm.toStringAsFixed(2)}/km): R\$ ${custoCombustivel.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    Text('🎪 Espaço: R\$ ${custoEspaco.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: lucroEstimado >= 0 ? Colors.green.withOpacity(0.2) : Colors.red.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: lucroEstimado >= 0 ? Colors.greenAccent : Colors.redAccent),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('💸 Custo Total da Viagem: R\$ ${custoTotal.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                          const SizedBox(height: 4),
                          Text(
                            '💰 LUCRO LÍQUIDO (ROI): R\$ ${lucroEstimado.toStringAsFixed(2)}',
                            style: TextStyle(color: lucroEstimado >= 0 ? Colors.greenAccent : Colors.redAccent, fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Fechar', style: TextStyle(color: Colors.white54)),
                ),
                if (!isApproved)
                  LedButton(
                    onPressed: () async {
                      try {
                        final api = Provider.of<ApiService>(context, listen: false);
                        await api.approveEventRoi(prospect['id'], totalCost: custoTotal, expectedRevenue: receitaTotal);
                        Navigator.pop(ctx);
                        _loadProspects();
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Viagem Aprovada! Despesa enviada ao Fluxo de Caixa como PREVISTO.'), backgroundColor: Colors.green),
                          );
                        }
                      } catch (e) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao aprovar ROI: $e'), backgroundColor: Colors.red));
                        }
                      }
                    },
                    style: LedButton.styleFrom(backgroundColor: Colors.green),
                    child: const Text('Aprovar Viagem → Fluxo de Caixa', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ),
              ],
            );
          },
        );
      },
    );
  }
}
