import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../servicos/servico_api.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';

class VisaoFechamentoAdmin extends StatefulWidget {
  const VisaoFechamentoAdmin({super.key});

  @override
  State<VisaoFechamentoAdmin> createState() => _VisaoFechamentoAdminState();
}

class _VisaoFechamentoAdminState extends State<VisaoFechamentoAdmin> {
  final _sellers = [
    {'id': '1', 'name': 'Vendedor 1'},
    {'id': '2', 'name': 'Vendedor 2'}
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
            _buildFechamentoMesCard(),
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
            items: _sellers.map((s) => DropdownMenuItem(value: s['id'], child: Text(s['name']!))).toList(),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
         const Text('Resumo Financeiro', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
         const SizedBox(height: 8),
         _infoRow('Dinheiro (Cash)', 'R\$ 0.00'),
         _infoRow('Pix', 'R\$ 0.00'),
         _infoRow('Crédito', 'R\$ 0.00'),
         _infoRow('Débito', 'R\$ 0.00'),
         const Divider(color: Colors.white24, height: 24),
         _infoRow('Total de Vendas', 'R\$ 0.00'),
         _infoRow('Comissão (20% / 25%)', 'R\$ 0.00'),
         const Divider(color: Colors.white24, height: 24),
         _infoRow('Dívida Acumulada (Repasse)', 'R\$ 0.00', color: Colors.redAccent),
         const SizedBox(height: 16),
         ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Registrar Pagamento de Repasse')
         ),
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
            items: _sellers.map((s) => DropdownMenuItem(value: s['id'], child: Text(s['name']!))).toList(),
            onChanged: (val) => setState(() => _selectedSellerCidade = val),
          ),
          const SizedBox(height: 16),
          if (_selectedSellerCidade != null) ...[
            const Text('São Paulo', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            _infoRow('Total de Fichas', '15'),
            _infoRow('Vendas vs Não Vendas', '10 / 5'),
            _infoRow('Ticket Médio', 'R\$ 250.00'),
            const SizedBox(height: 16),
            const Divider(color: Colors.white12),
            const SizedBox(height: 16),
            const Text('Campinas', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            _infoRow('Total de Fichas', '8'),
            _infoRow('Vendas vs Não Vendas', '6 / 2'),
            _infoRow('Ticket Médio', 'R\$ 300.00'),
            const SizedBox(height: 16),
            const Divider(color: Colors.white12),
            const SizedBox(height: 12),
            const Text('Média de Avaliações (Atendimento)', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 14, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _buildAverageRatingRow('Vendedor', 4.5), // Mocks for now
            _buildAverageRatingRow('Fotógrafo', 4.8),
            _buildAverageRatingRow('O Contato', 4.0),
          ] else ...[
            const Text('Selecione um vendedor para ver as métricas por cidade.', style: TextStyle(color: Colors.white54, fontStyle: FontStyle.italic)),
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

  Widget _buildFechamentoMesCard() {
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
          const Text('Fechamento Mês', style: TextStyle(color: Color(0xFFCE93D8), fontSize: 18, fontWeight: FontWeight.bold)),
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
                    _showMultiSelectDialog('Selecionar Vendedores', _sellers.map((e) => e['name']!).toList(), _selectedSellersMes, (selected) {
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
             const Text('Resumo Financeiro Consolidado', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
             const SizedBox(height: 8),
             _infoRow('Dinheiro (Cash)', 'R\$ 1.200,00'),
             _infoRow('Pix', 'R\$ 3.450,00'),
             _infoRow('Crédito', 'R\$ 2.100,00'),
             _infoRow('Débito', 'R\$ 800,00'),
             const Divider(color: Colors.white24, height: 24),
             _infoRow('Total de Vendas', 'R\$ 7.550,00'),
             _infoRow('Comissão Total', 'R\$ 1.510,00'),
             const Divider(color: Colors.white24, height: 24),
             
             // List of debtors as requested by user
             // REGRA DE NEGÓCIO: Dívida do vendedor é referente APENAS a vendas em Dinheiro vivo que ficaram em mãos. 
             // Valores de PIX caem direto na conta da empresa e entram no fluxo assim como Cartão (Crédito/Débito), 
             // não gerando repasse pendente do vendedor para a empresa.
             const Text('Dívida Acumulada (Repasses Pendentes)', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
             const SizedBox(height: 8),
             if (_selectedSellersMes.contains('Vendedor 1') || _selectedSellersMes.isEmpty)
               _infoRow('  - Vendedor 1', 'R\$ 300,00', color: Colors.redAccent),
             if (_selectedSellersMes.contains('Vendedor 2') || _selectedSellersMes.isEmpty)
               _infoRow('  - Vendedor 2', 'R\$ 150,00', color: Colors.redAccent),
             const SizedBox(height: 8),
             _infoRow('Total Pendente', 'R\$ 450,00', color: Colors.redAccent),
          ] else ...[
             const Text('Selecione ao menos um mês e um vendedor para ver o consolidado.', style: TextStyle(color: Colors.white54, fontStyle: FontStyle.italic)),
          ],
        ],
      )
    );
  }

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
