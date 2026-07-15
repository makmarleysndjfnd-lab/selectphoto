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
  final _sellers = [
    {'id': '1', 'name': 'Vend. 1 (Book, Emp.)', 'salesType': 'BOOK', 'usesOwnCar': false},
    {'id': '2', 'name': 'Vend. 2 (Book, Próp.)', 'salesType': 'BOOK', 'usesOwnCar': true},
    {'id': '3', 'name': 'Vend. 3 (Rebolo, Emp.)', 'salesType': 'REBOLO', 'usesOwnCar': false},
    {'id': '4', 'name': 'Vend. 4 (Rebolo, Próp.)', 'salesType': 'REBOLO', 'usesOwnCar': true},
  ];
  String? _selectedSeller;
  
  // Para o card Fechamento Cidade
  String? _selectedSellerCidade;

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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
             Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Fechamentos', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                ElevatedButton.icon(
                  onPressed: () {
                     // refresh action
                  }, 
                  icon: const Icon(Icons.refresh),
                  label: const Text('Atualizar'),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFCE93D8)),
                )
              ]
            ),
            const SizedBox(height: 20),
            _buildVendedorCard(),
            const SizedBox(height: 20),
            _buildCidadeCard(),
            const SizedBox(height: 20),
            _buildFotografoCard(),
          ],
        ),
      ),
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
    double totalVendas = 0.0;
    double dinheiro = 0.0;
    double pix = 0.0;
    double credito = 0.0;
    double debito = 0.0;
    double saldoHistorico = 0.0;
    
    if (_selectedSeller != null && _mockFinanceiroVendedor.containsKey(_selectedSeller)) {
       var data = _mockFinanceiroVendedor[_selectedSeller]!;
       totalVendas = data['totalVendas'];
       dinheiro = data['dinheiro'];
       pix = data['pix'];
       credito = data['credito'];
       debito = data['debito'];
       saldoHistorico = _saldoAcumuladoVendedor[_selectedSeller] ?? 0.0;
    }

    var sellerData = _sellers.firstWhere((s) => s['id'] == _selectedSeller, orElse: () => _sellers.first);
    bool isRebolo = sellerData['salesType'] == 'REBOLO';
    bool usesOwnCar = sellerData['usesOwnCar'] == true;
    
    double percentual = 0.20;
    if (isRebolo) {
        percentual = usesOwnCar ? 0.50 : 0.40;
    } else {
        percentual = usesOwnCar ? 0.25 : 0.20;
    }

    double comissao = totalVendas * percentual;
    double saldoFinal = (comissao - dinheiro) + saldoHistorico;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
         const Text('Resumo Financeiro', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
         const SizedBox(height: 8),
         _infoRow('Dinheiro (Cash)', 'R\$ ${dinheiro.toStringAsFixed(2)}'),
         _infoRow('Pix', 'R\$ ${pix.toStringAsFixed(2)}'),
         _infoRow('Crédito', 'R\$ ${credito.toStringAsFixed(2)}'),
         _infoRow('Débito', 'R\$ ${debito.toStringAsFixed(2)}'),
         const Divider(color: Colors.white24, height: 24),
         _infoRow('Total de Vendas', 'R\$ ${totalVendas.toStringAsFixed(2)}'),
         _infoRow('Comissão do Dia (${(percentual * 100).toInt()}%)', 'R\$ ${comissao.toStringAsFixed(2)}'),
         if (saldoHistorico != 0)
            _infoRow('Saldo Anterior Acumulado', 'R\$ ${saldoHistorico.toStringAsFixed(2)}', color: saldoHistorico > 0 ? Colors.green : Colors.redAccent),
         const Divider(color: Colors.white24, height: 24),
         
         if (saldoFinal > 0) ...[
           _infoRow('Comissão a Pagar', 'R\$ ${saldoFinal.toStringAsFixed(2)}', color: Colors.green),
           const SizedBox(height: 16),
           ElevatedButton(
              onPressed: () {
                if (_selectedSeller != null) {
                  setState(() {
                     _saldoAcumuladoVendedor[_selectedSeller!] = 0.0;
                     // Also zero out current day to prevent recalculation adding it again
                     _mockFinanceiroVendedor[_selectedSeller!]!['totalVendas'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['dinheiro'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['pix'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['credito'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['debito'] = 0.0;
                  });
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Comissão Zerada/Paga!')));
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              child: const Text('Zerar / Pagar Comissão')
           ),
         ] else if (saldoFinal <= 0) ...[
           Row(
             mainAxisAlignment: MainAxisAlignment.spaceBetween,
             children: [
               Row(
                 children: [
                   const Text('Repasse', style: TextStyle(color: Colors.white70, fontSize: 14)),
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
              onPressed: () {
                if (_selectedSeller != null) {
                  setState(() {
                     _saldoAcumuladoVendedor[_selectedSeller!] = 0.0;
                     // Also zero out current day
                     _mockFinanceiroVendedor[_selectedSeller!]!['totalVendas'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['dinheiro'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['pix'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['credito'] = 0.0;
                     _mockFinanceiroVendedor[_selectedSeller!]!['debito'] = 0.0;
                  });
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Repasse Zerado/Recebido!')));
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
              child: const Text('Zerar Repasse')
           ),
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

  Widget _buildFotografoCard() {
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
          _infoRow('Books Produzidos Hoje', '0'),
        ],
      )
    );
  }

  Widget _buildCidadeCard() {
    int sumVendas = 0;
    int sumNaoVendas = 0;
    double sumValorTotal = 0;
    List<String> sellersToSum = _selectedSellersMes.isNotEmpty ? _selectedSellersMes : _sellers.map((s) => s['name'] as String).toList();
    
    List<Widget> vendasPorVendedorList = [];

    for (var s in sellersToSum) {
      if (_mockMetricasCidadeVendedor.containsKey(s)) {
        final data = _mockMetricasCidadeVendedor[s]!;
        sumVendas += data['fichasVenda'] as int;
        sumNaoVendas += data['fichasNaoVenda'] as int;
        double valor = data['valorTotal'] as double;
        sumValorTotal += valor;
        
        vendasPorVendedorList.add(_infoRow('Vendas Totais - $s', 'R\$ ${valor.toStringAsFixed(2)}'));
      }
    }
    
    int totalFichas = sumVendas + sumNaoVendas;
    double ticketMedio = totalFichas > 0 ? (sumValorTotal / totalFichas) : 0;

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
          const Text('Fechamento Cidade', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () {
                    _showMultiSelectDialog('Selecionar Meses', _months, _selectedMonthsMes, (selected) {
                      setState(() => _selectedMonthsMes
                        ..clear()
                        ..addAll(selected));
                    });
                  },
                  icon: const Icon(Icons.calendar_month, color: Colors.white),
                  label: const Text('Selecionar Mês', style: TextStyle(color: Colors.white)),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2A2A3E)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () {
                    _showMultiSelectDialog('Selecionar Vendedores', _sellers.map((e) => e['name'] as String).toList(), _selectedSellersMes, (selected) {
                      setState(() => _selectedSellersMes
                        ..clear()
                        ..addAll(selected));
                    });
                  },
                  icon: const Icon(Icons.people, color: Colors.white),
                  label: const Text('Selecionar Vendedor', style: TextStyle(color: Colors.white)),
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2A2A3E)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (_selectedMonthsMes.isNotEmpty || _selectedSellersMes.isNotEmpty) ...[
             Wrap(
               spacing: 8,
               runSpacing: 8,
               children: [
                 ..._selectedMonthsMes.map((m) => Chip(label: Text(m, style: const TextStyle(color: Colors.white, fontSize: 12)), backgroundColor: const Color(0xFF4FC3F7).withOpacity(0.3), side: BorderSide.none)),
                 ..._selectedSellersMes.map((s) => Chip(label: Text(s, style: const TextStyle(color: Colors.white, fontSize: 12)), backgroundColor: const Color(0xFFCE93D8).withOpacity(0.3), side: BorderSide.none)),
               ],
             ),
             const SizedBox(height: 16),
             const Text('Métricas de Vendas x Não Vendas', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
             const SizedBox(height: 8),
             _infoRow('Total de Fichas', '$totalFichas'),
             _infoRow('Vendas vs Não Vendas', '$sumVendas / $sumNaoVendas'),
             _infoRow('Ticket Médio Geral', 'R\$ ${ticketMedio.toStringAsFixed(2)}'),
             
             const SizedBox(height: 16),
             const Divider(color: Colors.white12),
             const SizedBox(height: 16),
             
             const Text('Vendas por Vendedor', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
             const SizedBox(height: 8),
             ...vendasPorVendedorList,
             const SizedBox(height: 8),
             _infoRow('Total de Vendas (Selecionados)', 'R\$ ${sumValorTotal.toStringAsFixed(2)}', color: const Color(0xFFCE93D8)),
             
             const SizedBox(height: 16),
             const Divider(color: Colors.white12),
             const SizedBox(height: 12),
             const Text('Média de Avaliações (Atendimento)', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 14, fontWeight: FontWeight.bold)),
             const SizedBox(height: 12),
             _buildAverageRatingRow('Vendedor', 4.5), // Mocks for now
             _buildAverageRatingRow('Fotógrafo', 4.8),
             _buildAverageRatingRow('O Contato', 4.0),
          ] else ...[
             const Text('Selecione ao menos um mês e um vendedor para ver as métricas.', style: TextStyle(color: Colors.white54, fontStyle: FontStyle.italic)),
          ],
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

  Widget _buildAverageRatingRow(String label, double rating) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          Row(
            children: [
              RatingBarIndicator(
                rating: rating,
                itemBuilder: (context, index) => const Icon(Icons.star_rounded, color: Colors.amber),
                itemCount: 5,
                itemSize: 16.0,
                direction: Axis.horizontal,
              ),
              const SizedBox(width: 8),
              Text(rating.toStringAsFixed(1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value, {Color? color}) {
     return Padding(
       padding: const EdgeInsets.symmetric(vertical: 4),
       child: Row(
         mainAxisAlignment: MainAxisAlignment.spaceBetween,
         children: [
           Text(label, style: const TextStyle(color: Colors.white70)),
           Text(value, style: TextStyle(color: color ?? Colors.white, fontWeight: FontWeight.bold)),
         ],
       ),
     );
  }
}
