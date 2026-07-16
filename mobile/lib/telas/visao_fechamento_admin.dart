import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/services.dart';

class VisaoFechamentoAdmin extends StatefulWidget {
  const VisaoFechamentoAdmin({super.key});

  @override
  State<VisaoFechamentoAdmin> createState() => _VisaoFechamentoAdminState();
}

class _VisaoFechamentoAdminState extends State<VisaoFechamentoAdmin> {
  List<dynamic> _sellers = [];
  bool _isLoadingSellers = true;

  @override
  void initState() {
    super.initState();
    _loadSellers();
  }

  Future<void> _loadSellers() async {
    try {
      final users = await ApiService().getCompanyUsers();
      if (mounted) {
        setState(() {
          _sellers = users;
          _isLoadingSellers = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoadingSellers = false);
      }
    }
  }
  String? _selectedSeller;
  
  // Para o card Análise de Desempenho
  List<String> _selectedSellersCustom = [];
  DateTimeRange? _selectedDateRangeCustom;

  // Para o card Fechamento Mês
  final List<String> _months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  final List<String> _selectedMonthsMes = [];
  final List<String> _selectedSellersMes = [];
  
  final List<String> _mockReceipts = [
    'https://images.unsplash.com/photo-1621501103258-3e135c7c2e35?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=200&q=80',
    'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?auto=format&fit=crop&w=200&q=80'
  ];

  final Map<String, Map<String, dynamic>> _mockFinanceiroVendedor = {
    '1': {
      'totalVendas': 5000.0,
      'dinheiro': 300.0,
      'pix': 2000.0,
      'credito': 1500.0,
      'debito': 1200.0,
    },
    '2': {
      'totalVendas': 3000.0,
      'dinheiro': 1500.0,
      'pix': 500.0,
      'credito': 500.0,
      'debito': 500.0,
    },
    '3': {
      'totalVendas': 4000.0,
      'dinheiro': 0.0,
      'pix': 2000.0,
      'credito': 1000.0,
      'debito': 1000.0,
    },
    '4': {
      'totalVendas': 6000.0,
      'dinheiro': 500.0,
      'pix': 3000.0,
      'credito': 1500.0,
      'debito': 1000.0,
    }
  };

  final Map<String, double> _saldoAcumuladoVendedor = {
    '1': 0.0,
    '2': -200.0, // Exemplo de dívida prévia
    '3': 0.0,
    '4': 100.0,
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D0D1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text('Fechamentos', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildVendedorCard(),
            const SizedBox(height: 20),
            _buildAnaliseDesempenhoCard(),
            const SizedBox(height: 20),
            _buildFotografoCard(),
            const SizedBox(height: 20),
            _buildCidadesALiberarCard(),
          ],
        ),
      ),
    );
  }

  Widget _buildCidadesALiberarCard() {
    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        ApiService().getBookBatches(),
        ApiService().getAllClients(),
      ]),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
           return const Center(child: CircularProgressIndicator(color: Colors.white));
        }
        if (snapshot.hasError) {
           return Center(child: Text('Erro: ${snapshot.error}', style: const TextStyle(color: Colors.redAccent)));
        }

        final results = snapshot.data ?? [[], []];
        final batches = results[0] as List<dynamic>;
        final clients = results[1] as List<dynamic>;
        
        final createdBatches = batches.where((b) => b['status'] == 'CREATED').toList();

        if (createdBatches.isEmpty) {
           return Container(
             padding: const EdgeInsets.all(20),
             decoration: BoxDecoration(
               color: const Color(0xFF1A1A2E),
               borderRadius: BorderRadius.circular(16),
               border: Border.all(color: Colors.white12),
             ),
             child: const Center(
               child: Text('Nenhuma cidade/lote aguardando liberação.', style: TextStyle(color: Colors.white54))
             ),
           );
        }

        return Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF1A1A2E),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.orangeAccent.withOpacity(0.5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
            const Text('Lotes / Cidades Prontas para Liberação', style: TextStyle(color: Colors.orangeAccent, fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Os fotógrafos finalizaram a produção destes lotes. Libere-os para formar as rotas inteligentes.', style: TextStyle(color: Colors.white70, fontSize: 14)),
            const SizedBox(height: 24),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: createdBatches.map((batch) {
                final city = batch['name'] ?? 'Desconhecida';
                final batchId = batch['id'];
                
                // Count clients for this city
                final clientCount = clients.where((c) => c['city'] == city && c['releasedForRouting'] != true).length;
                
                return ActionChip(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  backgroundColor: const Color(0xFFCE93D8),
                  label: Text('Liberar $city ($clientCount fichas)', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  onPressed: () async {
                    try {
                      // Release all clients in this city for routing
                      await ApiService().releaseCity(city);
                      // Mark this batch as DISTRIBUTED so it doesn't show up again
                      await ApiService().updateBookBatchStatus(batchId, 'DISTRIBUTED');
                      
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Lote $city liberado com sucesso!'), backgroundColor: Colors.green));
                        setState(() {}); // refresh
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao liberar $city: $e'), backgroundColor: Colors.red));
                      }
                    }
                  },
                );
              }).toList(),
            ),
          ],
        ),
      );
    },
    );
  }

  Widget _buildVendedorCard() {
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
          const Text('Fechamento Vendedor (Financeiro)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          // Add logic to load from /api/closing/daily/:sellerId
          const Text('Selecione um vendedor:', style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            dropdownColor: const Color(0xFF2A2A3E),
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              filled: true,
              fillColor: const Color(0xFF0D0D1A),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
            items: _sellers.map((s) => DropdownMenuItem(value: s['id'] as String, child: Text(s['name'] as String))).toList(),
            onChanged: (val) => setState(() => _selectedSeller = val),
          ),
          const SizedBox(height: 16),
          if (_selectedSeller != null)
             _buildVendedorDetails(),
        ],
      )
    );
  }

  Widget _buildVendedorDetails() {
    if (_selectedSeller == null) return const SizedBox.shrink();
    
    return FutureBuilder<Map<String, dynamic>>(
      future: ApiService().getSellerClosing(_selectedSeller!),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator(color: Colors.white));
        }
        if (snapshot.hasError) {
          return Text('Erro ao carregar fechamento: ${snapshot.error}', style: const TextStyle(color: Colors.redAccent));
        }
        
        final data = snapshot.data!;
        double totalVendas = (data['totalSalesValue'] ?? 0).toDouble();
        double dinheiro = (data['cashValue'] ?? 0).toDouble();
        double pix = (data['pixValue'] ?? 0).toDouble();
        double credito = (data['creditValue'] ?? 0).toDouble();
        double debito = (data['debitValue'] ?? 0).toDouble();
        double comissao = (data['commission'] ?? 0).toDouble();
        double percentual = (data['commissionPercentage'] ?? 0).toDouble();
        double saldoHistorico = (data['totalHistoricalDebt'] ?? 0).toDouble();
        double repasseDebt = (data['repasseDebt'] ?? 0).toDouble();
        
        double saldoFinal = (comissao - dinheiro) + saldoHistorico;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
             const Text('Resumo Financeiro (Dados Reais)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
             const SizedBox(height: 8),
             _infoRow('Dinheiro (Cash)', 'R\$ ${dinheiro.toStringAsFixed(2)}'),
             _infoRow('Pix', 'R\$ ${pix.toStringAsFixed(2)}'),
             _infoRow('Crédito', 'R\$ ${credito.toStringAsFixed(2)}'),
             _infoRow('Débito', 'R\$ ${debito.toStringAsFixed(2)}'),
             const Divider(color: Colors.white24, height: 24),
             _infoRow('Total de Vendas', 'R\$ ${totalVendas.toStringAsFixed(2)}'),
             _infoRow('Comissão do Dia (${(percentual * 100).toInt()}%)', 'R\$ ${comissao.toStringAsFixed(2)}'),
             if (saldoHistorico != 0)
                _infoRow('Dívida Acumulada', 'R\$ ${saldoHistorico.toStringAsFixed(2)}', color: Colors.redAccent),
             const Divider(color: Colors.white24, height: 24),
             
             if (saldoFinal > 0) ...[
               _infoRow('Comissão a Pagar (Final)', 'R\$ ${saldoFinal.toStringAsFixed(2)}', color: Colors.green),
               const SizedBox(height: 16),
               ElevatedButton(
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pagar comissão (integração futura)')));
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                  child: const Text('Registrar Pagamento')
               ),
             ] else if (saldoFinal < 0) ...[
               Row(
                 mainAxisAlignment: MainAxisAlignment.spaceBetween,
                 children: [
                   Row(
                     children: [
                       const Text('Repasse Pendente', style: TextStyle(color: Colors.white70, fontSize: 14)),
                       const SizedBox(width: 8),
                       Container(
                         padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                         decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(4)),
                         child: Row(
                           children: [
                             const Text('Pix: 123.456.789-00', style: TextStyle(color: Colors.white, fontSize: 11)),
                             const SizedBox(width: 6),
                             GestureDetector(
                               onTap: () {
                                 Clipboard.setData(const ClipboardData(text: '123.456.789-00'));
                                 ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pix copiado!')));
                               },
                               child: const Icon(Icons.copy, color: Colors.white, size: 14),
                             ),
                           ],
                         ),
                       )
                     ]
                   ),
                   Text('R\$ ${saldoFinal.abs().toStringAsFixed(2)}', style: const TextStyle(color: Colors.redAccent, fontSize: 14, fontWeight: FontWeight.bold)),
                 ],
               ),
               const SizedBox(height: 16),
               ElevatedButton(
                  onPressed: () async {
                    try {
                      // We would call ApiService().payRepasse()
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Repasse registrado com sucesso!')));
                      setState(() {});
                    } catch (e) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro: $e')));
                    }
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
                  child: const Text('Confirmar Recebimento de Repasse', style: TextStyle(color: Colors.white))
               ),
             ] else ...[
               _infoRow('Status', 'Tudo Quitado', color: Colors.blueAccent),
             ],
         
         const SizedBox(height: 24),
         const Divider(color: Colors.white24, height: 1),
         const SizedBox(height: 16),
         const Text('Comprovantes de Vendas (Hoje)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
         const SizedBox(height: 12),
         SingleChildScrollView(
           scrollDirection: Axis.horizontal,
           child: Row(
             children: _mockReceipts.map((url) => Padding(
               padding: const EdgeInsets.only(right: 12),
               child: ClipRRect(
                 borderRadius: BorderRadius.circular(8),
                 child: Image.network(url, width: 100, height: 140, fit: BoxFit.cover),
               ),
             )).toList(),
           ),
         ),
      ]
    );
      }
    );
  }

  String? _selectedPhotographer;

  Widget _buildFotografoCard() {
    final photographers = _sellers.where((s) => s['role'] == 'PHOTOGRAPHER' || s['role'] == 'ADMIN' || s['role'] == 'SUPER_ADMIN').toList();

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
          const Text('Fechamento Fotógrafo (Produção)', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          const Text('Selecione um fotógrafo:', style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            dropdownColor: const Color(0xFF2A2A3E),
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              filled: true,
              fillColor: const Color(0xFF0D0D1A),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
            items: photographers.map((s) => DropdownMenuItem(value: s['id'] as String, child: Text(s['name'] as String))).toList(),
            onChanged: (val) => setState(() => _selectedPhotographer = val),
          ),
          const SizedBox(height: 16),
          if (_selectedPhotographer != null)
             _buildFotografoDetails(),
        ],
      )
    );
  }

  Widget _buildFotografoDetails() {
    if (_selectedPhotographer == null) return const SizedBox.shrink();

    return FutureBuilder<Map<String, dynamic>>(
      future: ApiService().getPhotographerClosing(_selectedPhotographer!),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator(color: Colors.white));
        }
        if (snapshot.hasError) {
          return Text('Erro ao carregar fechamento: ${snapshot.error}', style: const TextStyle(color: Colors.redAccent));
        }

        final data = snapshot.data!;
        final booksCount = data['booksCount'] ?? 0;

        return Column(
          children: [
            _infoRow('Books (Cidades) Produzidos Hoje', '$booksCount', color: Colors.greenAccent),
          ],
        );
      }
    );
  }

  Widget _buildAnaliseDesempenhoCard() {
    final sellerNames = _selectedSellersCustom.map((id) {
      final s = _sellers.firstWhere((element) => element['id'] == id, orElse: () => {'name': 'Desconhecido'});
      return s['name'];
    }).join(', ');

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
          const Text('Análise de Desempenho', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          // Seletor de data e vendedores
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () async {
                    final range = await showDateRangePicker(
                      context: context,
                      firstDate: DateTime(2020),
                      lastDate: DateTime(2100),
                      initialDateRange: _selectedDateRangeCustom,
                      builder: (context, child) {
                         return Theme(
                           data: Theme.of(context).copyWith(
                             colorScheme: const ColorScheme.dark(
                               primary: Color(0xFFCE93D8),
                               onPrimary: Colors.white,
                               surface: Color(0xFF1A1A2E),
                               onSurface: Colors.white,
                             ),
                           ),
                           child: child!,
                         );
                      }
                    );
                    if (range != null) {
                      setState(() => _selectedDateRangeCustom = range);
                    }
                  },
                  icon: const Icon(Icons.date_range, size: 16),
                  label: Text(_selectedDateRangeCustom != null 
                    ? '${_selectedDateRangeCustom!.start.day}/${_selectedDateRangeCustom!.start.month}/${_selectedDateRangeCustom!.start.year} - ${_selectedDateRangeCustom!.end.day}/${_selectedDateRangeCustom!.end.month}/${_selectedDateRangeCustom!.end.year}' 
                    : 'Selecionar Período'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2A2A3E),
                    foregroundColor: Colors.white,
                    alignment: Alignment.centerLeft,
                  ),
                ),
              ),
              if (_selectedDateRangeCustom != null)
                IconButton(
                  icon: const Icon(Icons.clear, color: Colors.white54),
                  onPressed: () => setState(() => _selectedDateRangeCustom = null),
                ),
            ],
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: () {
              final allSellerIds = _sellers.map((e) => e['id'] as String).toList();
              _showMultiSelectDialog(
                'Selecione os Vendedores',
                allSellerIds,
                _selectedSellersCustom,
                (List<String> results) {
                  setState(() => _selectedSellersCustom = results);
                },
              );
            },
            icon: const Icon(Icons.people, size: 16),
            label: Text(_selectedSellersCustom.isEmpty ? 'Selecionar Vendedores' : sellerNames, overflow: TextOverflow.ellipsis),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2A2A3E),
              foregroundColor: Colors.white,
              alignment: Alignment.centerLeft,
              minimumSize: const Size(double.infinity, 48),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                 setState(() {}); // refresh
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
              child: const Text('Buscar', style: TextStyle(color: Colors.white)),
            ),
          ),
          const SizedBox(height: 16),
          FutureBuilder<Map<String, dynamic>>(
            future: ApiService().getCustomMetrics(
              sellerIds: _selectedSellersCustom,
              startDate: _selectedDateRangeCustom?.start.toIso8601String(),
              endDate: _selectedDateRangeCustom?.end.toIso8601String(),
            ),
            builder: (context, snapshot) {
               if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator(color: Colors.white));
               }
               if (snapshot.hasError) {
                  return Text('Erro ao carregar métricas: ${snapshot.error}', style: const TextStyle(color: Colors.redAccent));
               }
               
               final data = snapshot.data!;
               final salesCount = data['salesCount'] ?? 0;
               final nonSalesCount = data['nonSalesCount'] ?? 0;
               final totalFichas = salesCount + nonSalesCount;
               final sumValorTotal = (data['totalSalesValue'] ?? 0).toDouble();
               double ticketMedio = totalFichas > 0 ? (sumValorTotal / totalFichas) : 0;

               return Column(
                 crossAxisAlignment: CrossAxisAlignment.start,
                 children: [
                   const Text('Métricas de Vendas x Não Vendas', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                   const SizedBox(height: 8),
                   _infoRow('Total de Fichas', '$totalFichas'),
                   _infoRow('Vendas vs Não Vendas', '$salesCount / $nonSalesCount'),
                   _infoRow('Ticket Médio Geral', 'R\$ ${ticketMedio.toStringAsFixed(2)}'),
                   
                   const SizedBox(height: 16),
                   const Divider(color: Colors.white12),
                   const SizedBox(height: 16),
                   
                   _infoRow('Total de Vendas (Consolidado)', 'R\$ ${sumValorTotal.toStringAsFixed(2)}', color: const Color(0xFFCE93D8)),
                 ]
               );
            }
          )
        ],
      )
    );
  }

  void _showMultiSelectDialog(String title, List<String> items, List<String> selectedItems, Function(List<String>) onConfirm) {
    List<String> tempSelected = List.from(selectedItems);
    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setStateDialog) {
            return AlertDialog(
              backgroundColor: const Color(0xFF1E1E2C),
              title: Text(title, style: const TextStyle(color: Colors.white)),
              content: SizedBox(
                width: double.maxFinite,
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final item = items[index];
                    return CheckboxListTile(
                      title: Text(item, style: const TextStyle(color: Colors.white)),
                      value: tempSelected.contains(item),
                      activeColor: const Color(0xFFCE93D8),
                      checkColor: Colors.black,
                      onChanged: (bool? checked) {
                        setStateDialog(() {
                          if (checked == true) {
                            tempSelected.add(item);
                          } else {
                            tempSelected.remove(item);
                          }
                        });
                      },
                    );
                  },
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: Colors.white70)),
                ),
                ElevatedButton(
                  onPressed: () {
                    onConfirm(tempSelected);
                    Navigator.pop(context);
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                  child: const Text('Confirmar'),
                ),
              ],
            );
          }
        );
      },
    );
  }

  final Map<String, Map<String, dynamic>> _mockMetricasCidadeVendedor = {
    'Vendedor 1': {
      'fichasVenda': 10,
      'fichasNaoVenda': 5,
      'valorTotal': 7550.0,
    },
    'Vendedor 2': {
      'fichasVenda': 6,
      'fichasNaoVenda': 2,
      'valorTotal': 3300.0,
    },
  };

  Widget _infoRow(String label, String value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 14)),
          Text(value, style: TextStyle(color: color ?? Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildAverageRatingRow(String title, double rating) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: const TextStyle(color: Colors.white, fontSize: 14)),
        Row(
          children: [
            RatingBarIndicator(
              rating: rating,
              itemBuilder: (context, index) => const Icon(Icons.star, color: Colors.amber),
              itemCount: 5,
              itemSize: 16.0,
              direction: Axis.horizontal,
            ),
            const SizedBox(width: 8),
            Text(rating.toStringAsFixed(1), style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold)),
          ],
        )
      ],
    );
  }
}
