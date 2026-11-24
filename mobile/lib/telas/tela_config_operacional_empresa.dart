import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../servicos/servico_api.dart';

class TelaConfigOperacionalEmpresa extends StatefulWidget {
  final String? companyId;
  final String? companyName;
  final ApiService? apiService;

  const TelaConfigOperacionalEmpresa({
    super.key,
    this.companyId,
    this.companyName,
    this.apiService,
  });

  @override
  State<TelaConfigOperacionalEmpresa> createState() =>
      _TelaConfigOperacionalEmpresaState();
}

class _TelaConfigOperacionalEmpresaState
    extends State<TelaConfigOperacionalEmpresa> {
  static const _bg = Color(0xFF0D0714);
  static const _cardBg = Color(0xFF160D24);
  static const _accent = Color(0xFFA855F7);
  static const _accentSoft = Color(0xFFD8B4FE);
  static const _green = Color(0xFF10B981);
  static const _red = Color(0xFFEF4444);

  late final ApiService _api = widget.apiService ?? ApiService();

  bool _loading = true;
  bool _saving = false;
  bool _uploadingLogo = false;
  String? _error;

  final TextEditingController _virginCtrl = TextEditingController(text: '25');
  final TextEditingController _reboloCtrl = TextEditingController(text: '20');
  final TextEditingController _creditCtrl = TextEditingController(text: '10');
  final TextEditingController _sacPhoneCtrl = TextEditingController();
  final TextEditingController _sacWhatsappCtrl = TextEditingController();
  final TextEditingController _footerTextCtrl = TextEditingController();

  String? _companyLogoUrl;

  bool _qrShowLogo = true;
  bool _qrShowTradeName = true;
  bool _qrShowSacContact = true;
  bool _qrShowSellerName = true;
  bool _qrShowPhotographerName = true;
  bool _qrShowPaymentMethod = true;
  bool _qrShowSaleValue = true;
  bool _qrShowInstallmentSummary = true;
  bool _qrShowBatchAndBookCode = true;
  bool _qrShowRatingForm = true;
  bool _qrShowFooterText = true;

  bool get _isSuperAdminMode =>
      widget.companyId != null && widget.companyId!.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _virginCtrl.dispose();
    _reboloCtrl.dispose();
    _creditCtrl.dispose();
    _sacPhoneCtrl.dispose();
    _sacWhatsappCtrl.dispose();
    _footerTextCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = _isSuperAdminMode
          ? await _api.getSuperAdminOperationalConfig(widget.companyId!)
          : await _api.getCompanyOperationalConfig();
      _applyDto(data);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _loading = false;
        });
      }
    }
  }

  String _formatPct(dynamic raw, String fallback) {
    final val = double.tryParse(raw?.toString() ?? '');
    if (val == null) return fallback;
    if (val == val.roundToDouble()) return val.toStringAsFixed(0);
    return val.toStringAsFixed(2);
  }

  void _applyDto(Map<String, dynamic> data) {
    _virginCtrl.text = _formatPct(data['virginBookCommissionPercent'], '25');
    _reboloCtrl.text = _formatPct(data['reboloBookCommissionPercent'], '20');
    _creditCtrl.text =
        _formatPct(data['creditInstallmentCommissionPercent'], '10');
    _sacPhoneCtrl.text = (data['sacPhone'] ?? '').toString();
    _sacWhatsappCtrl.text = (data['sacWhatsapp'] ?? '').toString();
    _footerTextCtrl.text = (data['qrReceiptFooterText'] ?? '').toString();

    if (!mounted) return;
    setState(() {
      _companyLogoUrl = data['companyLogoUrl']?.toString();
      _qrShowLogo = data['qrShowLogo'] != false;
      _qrShowTradeName = data['qrShowTradeName'] != false;
      _qrShowSacContact = data['qrShowSacContact'] != false;
      _qrShowSellerName = data['qrShowSellerName'] != false;
      _qrShowPhotographerName = data['qrShowPhotographerName'] != false;
      _qrShowPaymentMethod = data['qrShowPaymentMethod'] != false;
      _qrShowSaleValue = data['qrShowSaleValue'] != false;
      _qrShowInstallmentSummary = data['qrShowInstallmentSummary'] != false;
      _qrShowBatchAndBookCode = data['qrShowBatchAndBookCode'] != false;
      _qrShowRatingForm = data['qrShowRatingForm'] != false;
      _qrShowFooterText = data['qrShowFooterText'] != false;
      _loading = false;
    });
  }

  String? _resolvePreviewLogoUrl(String? rawUrl) {
    if (rawUrl == null || rawUrl.trim().isEmpty) return null;
    final trimmed = rawUrl.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    final base = _api.baseUrl.replaceFirst(RegExp(r'/api/?$'), '');
    if (trimmed.startsWith('/')) return '$base$trimmed';
    return '$base/$trimmed';
  }

  Future<void> _pickAndUploadLogo() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1200,
        imageQuality: 85,
      );
      if (picked == null) return;

      setState(() => _uploadingLogo = true);
      final res = _isSuperAdminMode
          ? await _api.uploadSuperAdminOperationalLogo(
              widget.companyId!, picked.path)
          : await _api.uploadCompanyOperationalLogo(picked.path);

      if (mounted) {
        setState(() {
          _companyLogoUrl = res['logoUrl']?.toString();
          _uploadingLogo = false;
        });
        _showMsg('Logo enviada e vinculada com sucesso!', isError: false);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _uploadingLogo = false);
        _showMsg(e.toString().replaceFirst('Exception: ', ''), isError: true);
      }
    }
  }

  Future<void> _save() async {
    final virgin =
        double.tryParse(_virginCtrl.text.trim().replaceAll(',', '.'));
    final rebolo =
        double.tryParse(_reboloCtrl.text.trim().replaceAll(',', '.'));
    final credit =
        double.tryParse(_creditCtrl.text.trim().replaceAll(',', '.'));

    if (virgin == null || virgin < 0 || virgin > 100) {
      _showMsg('Comissão Book Virgem deve estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (rebolo == null || rebolo < 0 || rebolo > 100) {
      _showMsg('Comissão Book Rebolo deve estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (credit == null || credit < 0 || credit > 100) {
      _showMsg('Comissão Parcela Crediário deve estar entre 0% e 100%.',
          isError: true);
      return;
    }

    setState(() => _saving = true);
    try {
      final payload = {
        'virginBookCommissionPercent': virgin,
        'reboloBookCommissionPercent': rebolo,
        'creditInstallmentCommissionPercent': credit,
        'companyLogoUrl': _companyLogoUrl,
        'sacPhone': _sacPhoneCtrl.text.trim(),
        'sacWhatsapp': _sacWhatsappCtrl.text.trim(),
        'qrReceiptFooterText': _footerTextCtrl.text.trim(),
        'qrShowLogo': _qrShowLogo,
        'qrShowTradeName': _qrShowTradeName,
        'qrShowSacContact': _qrShowSacContact,
        'qrShowSellerName': _qrShowSellerName,
        'qrShowPhotographerName': _qrShowPhotographerName,
        'qrShowPaymentMethod': _qrShowPaymentMethod,
        'qrShowSaleValue': _qrShowSaleValue,
        'qrShowInstallmentSummary': _qrShowInstallmentSummary,
        'qrShowBatchAndBookCode': _qrShowBatchAndBookCode,
        'qrShowRatingForm': _qrShowRatingForm,
        'qrShowFooterText': _qrShowFooterText,
      };

      final saved = _isSuperAdminMode
          ? await _api.saveSuperAdminOperationalConfig(
              widget.companyId!, payload)
          : await _api.saveCompanyOperationalConfig(payload);
      _applyDto(saved);
      if (mounted) {
        setState(() => _saving = false);
        _showMsg(
          'Comissões e personalização do QR Code salvas com sucesso!',
          isError: false,
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        _showMsg(e.toString().replaceFirst('Exception: ', ''), isError: true);
      }
    }
  }

  void _showMsg(String message, {required bool isError}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? _red : _green,
      ),
    );
  }

  Widget _sectionCard({
    required IconData icon,
    required String title,
    String? subtitle,
    required Widget child,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _accent.withOpacity(0.42)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: _accent, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 11,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  Widget _qrToggle(String label, bool value, ValueChanged<bool> onChanged) {
    return SwitchListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      activeColor: _accent,
      title: Text(label, style: const TextStyle(color: Colors.white, fontSize: 13)),
      value: value,
      onChanged: onChanged,
    );
  }

  Widget _buildReceiptPreviewCard() {
    final logoPreviewUrl = _resolvePreviewLogoUrl(_companyLogoUrl);
    final displayCompany =
        (widget.companyName != null && widget.companyName!.trim().isNotEmpty)
            ? widget.companyName!.trim()
            : 'Sua Empresa Fotográfica';

    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _accent.withOpacity(0.65), width: 1.2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.qr_code_2_rounded, color: _accentSoft, size: 18),
              SizedBox(width: 6),
              Text(
                'Prévia do Comprovante Público',
                style: TextStyle(
                  color: _accentSoft,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const Divider(color: Colors.white12, height: 16),
          if (_qrShowLogo && logoPreviewUrl != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.network(
                  logoPreviewUrl,
                  height: 44,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const Icon(
                    Icons.business_rounded,
                    color: _accentSoft,
                    size: 32,
                  ),
                ),
              ),
            ),
          if (_qrShowTradeName)
            Text(
              displayCompany,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.bold,
              ),
            ),
          if (_qrShowBatchAndBookCode)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text(
                'Ficha: #1042 • Lote: Goiânia-Centro',
                style: TextStyle(color: Colors.white70, fontSize: 11),
              ),
            ),
          if (_qrShowSellerName)
            const Text(
              'Vendedor(a): Lucas Silva',
              style: TextStyle(color: Colors.white70, fontSize: 11),
            ),
          if (_qrShowPhotographerName)
            const Text(
              'Fotógrafo(a): Ana Paula',
              style: TextStyle(color: Colors.white70, fontSize: 11),
            ),
          if (_qrShowSaleValue)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Valor da Compra: R\$ 1.200,00 (Entrada R\$ 200,00)',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w600),
              ),
            ),
          if (_qrShowPaymentMethod)
            const Text(
              'Pagamento: Crediário / Pix',
              style: TextStyle(color: Colors.white70, fontSize: 11),
            ),
          if (_qrShowInstallmentSummary)
            const Text(
              'Parcelamento: 10x de R\$ 100,00',
              style: TextStyle(color: Colors.white70, fontSize: 11),
            ),
          if (_qrShowSacContact &&
              (_sacPhoneCtrl.text.trim().isNotEmpty ||
                  _sacWhatsappCtrl.text.trim().isNotEmpty))
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'SAC: ${_sacPhoneCtrl.text.trim().isNotEmpty ? _sacPhoneCtrl.text.trim() : ''}${_sacPhoneCtrl.text.trim().isNotEmpty && _sacWhatsappCtrl.text.trim().isNotEmpty ? ' • WhatsApp: ' : _sacWhatsappCtrl.text.trim().isNotEmpty ? 'WhatsApp: ' : ''}${_sacWhatsappCtrl.text.trim()}',
                style: const TextStyle(color: _accentSoft, fontSize: 11),
              ),
            ),
          if (_qrShowRatingForm)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                '★★★★★ Avaliação do atendimento visível ao cliente',
                style: TextStyle(color: Color(0xFFFBBF24), fontSize: 11),
              ),
            ),
          if (_qrShowFooterText)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                _footerTextCtrl.text.trim().isNotEmpty
                    ? _footerTextCtrl.text.trim()
                    : 'Registro operacional de conferência entre cliente e empresa. Sem valor fiscal.',
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final logoPreviewUrl = _resolvePreviewLogoUrl(_companyLogoUrl);

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _cardBg,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Comissões & QR da Venda',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (_isSuperAdminMode &&
                (widget.companyName ?? '').trim().isNotEmpty)
              Text(
                'Empresa: ${widget.companyName}',
                style: const TextStyle(color: _accentSoft, fontSize: 11),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Recarregar',
            onPressed: (_loading || _saving) ? null : _load,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _accent))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline,
                            color: _red, size: 42),
                        const SizedBox(height: 12),
                        Text(_error!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white70)),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          style:
                              ElevatedButton.styleFrom(backgroundColor: _accent),
                          onPressed: _load,
                          child: const Text('Tentar Novamente',
                              style: TextStyle(color: Colors.white)),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _sectionCard(
                      icon: Icons.percent_rounded,
                      title: 'Comissões da Equipe',
                      subtitle:
                          'Novas vendas gravam a alíquota em snapshot; vendas antigas permanecem inalteradas.',
                      child: Column(
                        children: [
                          TextField(
                            controller: _virginCtrl,
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Book Virgem / Ciclo Normal (%)',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              suffixText: '%',
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _reboloCtrl,
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Book Rebolo (%)',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              suffixText: '%',
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _creditCtrl,
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                            style: const TextStyle(color: Colors.white),
                            decoration: const InputDecoration(
                              labelText: 'Parcela Crediário Paga (%)',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              suffixText: '%',
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _sectionCard(
                      icon: Icons.storefront_rounded,
                      title: 'Identidade, Logo e SAC',
                      subtitle:
                          'Logo oficial armazenada no B2, telefone de SAC e garantia no comprovante QR.',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 64,
                                height: 64,
                                decoration: BoxDecoration(
                                  color: _bg,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                      color: _accent.withOpacity(0.45)),
                                ),
                                child: logoPreviewUrl != null
                                    ? ClipRRect(
                                        borderRadius: BorderRadius.circular(9),
                                        child: Image.network(
                                          logoPreviewUrl,
                                          fit: BoxFit.contain,
                                          errorBuilder: (_, __, ___) =>
                                              const Icon(Icons.image_rounded,
                                                  color: Colors.white38),
                                        ),
                                      )
                                    : const Icon(Icons.image_outlined,
                                        color: Colors.white38, size: 28),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    ElevatedButton.icon(
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: _accent,
                                        foregroundColor: Colors.white,
                                      ),
                                      onPressed: _uploadingLogo
                                          ? null
                                          : _pickAndUploadLogo,
                                      icon: _uploadingLogo
                                          ? const SizedBox(
                                              width: 14,
                                              height: 14,
                                              child: CircularProgressIndicator(
                                                  strokeWidth: 2,
                                                  color: Colors.white),
                                            )
                                          : const Icon(Icons.upload_rounded,
                                              size: 16),
                                      label: Text(
                                        _uploadingLogo
                                            ? 'Enviando...'
                                            : (logoPreviewUrl != null
                                                ? 'Trocar Logo'
                                                : 'Enviar Logo'),
                                        style: const TextStyle(fontSize: 12),
                                      ),
                                    ),
                                    if (logoPreviewUrl != null)
                                      TextButton(
                                        onPressed: () => setState(
                                            () => _companyLogoUrl = null),
                                        child: const Text('Remover Logo',
                                            style: TextStyle(
                                                color: Colors.redAccent,
                                                fontSize: 11)),
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _sacPhoneCtrl,
                            keyboardType: TextInputType.phone,
                            style: const TextStyle(color: Colors.white),
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                              labelText: 'Telefone do SAC',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _sacWhatsappCtrl,
                            keyboardType: TextInputType.phone,
                            style: const TextStyle(color: Colors.white),
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                              labelText: 'WhatsApp do SAC',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _footerTextCtrl,
                            minLines: 2,
                            maxLines: 4,
                            style: const TextStyle(color: Colors.white),
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                              labelText:
                                  'Texto de Garantia / Rodapé do Comprovante',
                              labelStyle: TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _sectionCard(
                      icon: Icons.qr_code_scanner_rounded,
                      title: 'O que aparece no QR Code da Venda',
                      subtitle:
                          'Campos desmarcados serão omitidos da rota pública e do comprovante do comprador.',
                      child: Column(
                        children: [
                          _qrToggle('Exibir Logo da empresa', _qrShowLogo,
                              (v) => setState(() => _qrShowLogo = v)),
                          _qrToggle('Exibir Nome da empresa', _qrShowTradeName,
                              (v) => setState(() => _qrShowTradeName = v)),
                          _qrToggle('Exibir Contato SAC', _qrShowSacContact,
                              (v) => setState(() => _qrShowSacContact = v)),
                          _qrToggle('Exibir Nome do vendedor', _qrShowSellerName,
                              (v) => setState(() => _qrShowSellerName = v)),
                          _qrToggle(
                              'Exibir Nome do fotógrafo',
                              _qrShowPhotographerName,
                              (v) => setState(() => _qrShowPhotographerName = v)),
                          _qrToggle(
                              'Exibir Forma de pagamento',
                              _qrShowPaymentMethod,
                              (v) => setState(() => _qrShowPaymentMethod = v)),
                          _qrToggle('Exibir Valor da venda', _qrShowSaleValue,
                              (v) => setState(() => _qrShowSaleValue = v)),
                          _qrToggle(
                              'Exibir Resumo do parcelamento',
                              _qrShowInstallmentSummary,
                              (v) =>
                                  setState(() => _qrShowInstallmentSummary = v)),
                          _qrToggle(
                              'Exibir Código da ficha e lote',
                              _qrShowBatchAndBookCode,
                              (v) =>
                                  setState(() => _qrShowBatchAndBookCode = v)),
                          _qrToggle(
                              'Exibir Formulário de avaliação (estrelas)',
                              _qrShowRatingForm,
                              (v) => setState(() => _qrShowRatingForm = v)),
                          _qrToggle(
                              'Exibir Texto de garantia / rodapé',
                              _qrShowFooterText,
                              (v) => setState(() => _qrShowFooterText = v)),
                          _buildReceiptPreviewCard(),
                        ],
                      ),
                    ),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _accent,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 15),
                      ),
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.save_rounded),
                      label: Text(_saving
                          ? 'Salvando...'
                          : 'Salvar Configurações Operacionais'),
                    ),
                    const SizedBox(height: 28),
                  ],
                ),
    );
  }
}
