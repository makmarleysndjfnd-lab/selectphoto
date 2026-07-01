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
            _buildFotografoCard(),
            const SizedBox(height: 20),
            _buildCidadeCard(),
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
          _infoRow('Total de Fichas', '0'),
          _infoRow('Vendas vs Não Vendas', '0 / 0'),
          _infoRow('Ticket Médio', 'R\$ 0.00'),
          const SizedBox(height: 16),
          const Divider(color: Colors.white12),
          const SizedBox(height: 12),
          const Text('Média de Avaliações (Atendimento)', style: TextStyle(color: Color(0xFF90CAF9), fontSize: 14, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          _buildAverageRatingRow('Vendedor', 4.5), // Mocks for now
          _buildAverageRatingRow('Fotógrafo', 4.8),
          _buildAverageRatingRow('O Contato', 4.0),
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
