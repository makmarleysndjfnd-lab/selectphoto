import 'dart:typed_data';
import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:http/http.dart' as http;

class PdfGenerator {
  
  static Future<pw.MemoryImage?> _fetchSignature(String? urlStr) async {
    if (urlStr == null) return null;
    try {
      String url = urlStr;
      if (url.startsWith('/')) {
          url = 'http://192.168.1.6:3000' + url;
      }
      final response = await http.get(Uri.parse(url));
      if (response.statusCode == 200) {
        return pw.MemoryImage(response.bodyBytes);
      }
    } catch (e) {
      print('Erro ao carregar assinatura: $e');
    }
    return null;
  }

  static pw.Widget _buildFichaContent(Map<String, dynamic> client, pw.MemoryImage? signatureImage) {
    return pw.Container(
      padding: const pw.EdgeInsets.all(24),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Center(
            child: pw.Text('FICHA DO CLIENTE', style: pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold)),
          ),
          pw.SizedBox(height: 20),
          
          _buildSectionTitle('DADOS DO CLIENTE'),
          _buildRow('Nome:', client['name'] ?? 'N/A'),
          _buildRow('CPF:', client['cpf'] ?? 'N/A'),
          _buildRow('RG:', client['rg'] ?? 'N/A'),
          _buildRow('Endereço:', client['address'] ?? 'N/A'),
          _buildRow('Telefone 1:', client['phone1'] ?? 'N/A'),
          _buildRow('Telefone 2:', client['phone2'] ?? 'N/A'),
          _buildRow('Email:', client['email'] ?? 'N/A'),
          _buildRow('Profissão:', client['profession'] ?? 'N/A'),
          
          pw.SizedBox(height: 16),
          _buildSectionTitle('INFORMAÇÕES DA VENDA'),
          _buildRow('Plano Escolhido:', client['selectedPlan'] ?? 'N/A'),
          _buildRow('Valor Negociado:', 'R\$ ${client['negotiatedValue'] ?? '0.00'}'),
          _buildRow('Forma de Pagamento:', client['paymentMethod'] ?? 'N/A'),
          if (client['installments'] != null) _buildRow('Parcelas:', client['installments'].toString()),
          _buildRow('Data de Vencimento:', client['dueDate'] != null ? client['dueDate'].toString().split('T')[0] : 'N/A'),
          
          pw.SizedBox(height: 16),
          _buildSectionTitle('DADOS DA CRIANÇA'),
          _buildRow('Nome da Criança:', client['childName'] ?? 'N/A'),
          _buildRow('Idade da Criança:', client['childAge']?.toString() ?? 'N/A'),
          
          pw.SizedBox(height: 16),
          _buildSectionTitle('OBSERVAÇÕES'),
          pw.Text(client['observations'] ?? 'Nenhuma', style: const pw.TextStyle(fontSize: 12)),
          
          pw.Spacer(),
          pw.Divider(),
          pw.SizedBox(height: 10),
          pw.Center(
            child: pw.Text('Assinatura do Cliente:', style: pw.TextStyle(fontWeight: pw.FontWeight.bold)),
          ),
          pw.SizedBox(height: 10),
          pw.Center(
            child: signatureImage != null 
              ? pw.Image(signatureImage, height: 80) 
              : pw.Container(height: 80, width: 200, decoration: pw.BoxDecoration(border: pw.Border.all())),
          ),
          pw.SizedBox(height: 10),
          pw.Center(
            child: pw.Text(client['name'] ?? 'Cliente', style: const pw.TextStyle(fontSize: 12)),
          )
        ],
      )
    );
  }

  static Future<void> printFicha(Map<String, dynamic> client) async {
    final pdf = pw.Document();
    final signatureImage = await _fetchSignature(client['signatureUrl']);
    
    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (pw.Context context) => _buildFichaContent(client, signatureImage),
      ),
    );

    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdf.save(),
      name: 'Ficha_${client['name'] ?? 'Cliente'}.pdf'
    );
  }

  static Future<void> printBatch(List<Map<String, dynamic>> clients, String batchName) async {
    final pdf = pw.Document();
    for (var client in clients) {
      final signatureImage = await _fetchSignature(client['signatureUrl']);
      pdf.addPage(
        pw.Page(
          pageFormat: PdfPageFormat.a4,
          build: (pw.Context context) => _buildFichaContent(client, signatureImage),
        ),
      );
    }
    
    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdf.save(),
      name: 'Lote_${batchName}.pdf'
    );
  }
  static pw.Widget _buildSectionTitle(String title) {
    return pw.Container(
      margin: const pw.EdgeInsets.only(bottom: 8, top: 8),
      padding: const pw.EdgeInsets.all(4),
      decoration: pw.BoxDecoration(color: PdfColors.grey300),
      child: pw.Text(title, style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
    );
  }

  static pw.Widget _buildRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 2),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(label, style: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 12)),
          pw.SizedBox(width: 8),
          pw.Expanded(child: pw.Text(value, style: const pw.TextStyle(fontSize: 12))),
        ]
      )
    );
  }
}
