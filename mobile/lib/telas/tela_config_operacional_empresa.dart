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

  static const _defaultCreditTpl =
      'Olá, {cliente}! Aqui é da equipe {empresa}. Passando para lembrar da parcela no valor de {valor}, com vencimento em {vencimento}. Para pagamento via Pix, utilize a chave: {pix}. Qualquer dúvida estamos à disposição!';
  static const _defaultAdvanceTpl =
      'Olá, {cliente}! Segue a atualização da sua conta corrente de vales/pendências com a {empresa}. Saldo atual em aberto: {valor} (referência: {vencimento}). Caso precise acertar via Pix, utilize a chave: {pix}.';
  static const _defaultPostSaleTpl =
      'Olá, {cliente}! Obrigado pela sua compra de {valor} com a {empresa}! Caso precise de atendimento ou segunda via, estamos à disposição.';

  late final ApiService _api = widget.apiService ?? ApiService();

  bool _loading = true;
  bool _saving = false;
  bool _uploadingLogo = false;
  String? _error;

  // Bloco 1: Comissões da Equipe (Matriz Virgem 20/25% · Rebolo 40/50% · Parcela 10%)
  final TextEditingController _virginCompanyCtrl =
      TextEditingController(text: '20');
  final TextEditingController _virginOwnCtrl =
      TextEditingController(text: '25');
  final TextEditingController _reboloCompanyCtrl =
      TextEditingController(text: '40');
  final TextEditingController _reboloOwnCtrl =
      TextEditingController(text: '50');
  final TextEditingController _creditCtrl = TextEditingController(text: '10');
  String _photographerCommType = 'FIXED_PER_BOOK';
  final TextEditingController _photographerCommValCtrl =
      TextEditingController(text: '0');

  // Bloco 2: Preço, Desconto e Crediário
  final TextEditingController _defaultBookPriceCtrl = TextEditingController();
  final TextEditingController _maxDiscountCtrl =
      TextEditingController(text: '15');
  String _discountPolicyMode = 'SILENT_AUDIT_ALERT';
  final TextEditingController _creditMinDownCtrl =
      TextEditingController(text: '20');
  final TextEditingController _creditMaxInstCtrl =
      TextEditingController(text: '6');
  final TextEditingController _creditInterestCtrl =
      TextEditingController(text: '2');
  final TextEditingController _creditFineCtrl =
      TextEditingController(text: '2');
  final TextEditingController _creditCollectionDaysCtrl =
      TextEditingController(text: '5');
  final TextEditingController _creditSerasaDaysCtrl =
      TextEditingController(text: '30');

  // Bloco 3: Lotes e Devolução
  final TextEditingController _maxBatchReturnDaysCtrl =
      TextEditingController(text: '15');
  final TextEditingController _maxSimultaneousBooksCtrl =
      TextEditingController();

  // Bloco 4: Modelos de WhatsApp
  final TextEditingController _waCreditCtrl = TextEditingController();
  final TextEditingController _waAdvanceCtrl = TextEditingController();
  final TextEditingController _waPostSaleCtrl = TextEditingController();
  String _defaultWaCreditTpl = _defaultCreditTpl;
  String _defaultWaAdvanceTpl = _defaultAdvanceTpl;
  String _defaultWaPostSaleTpl = _defaultPostSaleTpl;

  // Bloco 5 & 6: Identidade, Logo, SAC e QR Code
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
    _virginCompanyCtrl.dispose();
    _virginOwnCtrl.dispose();
    _reboloCompanyCtrl.dispose();
    _reboloOwnCtrl.dispose();
    _creditCtrl.dispose();
    _photographerCommValCtrl.dispose();
    _defaultBookPriceCtrl.dispose();
    _maxDiscountCtrl.dispose();
    _creditMinDownCtrl.dispose();
    _creditMaxInstCtrl.dispose();
    _creditInterestCtrl.dispose();
    _creditFineCtrl.dispose();
    _creditCollectionDaysCtrl.dispose();
    _creditSerasaDaysCtrl.dispose();
    _maxBatchReturnDaysCtrl.dispose();
    _maxSimultaneousBooksCtrl.dispose();
    _waCreditCtrl.dispose();
    _waAdvanceCtrl.dispose();
    _waPostSaleCtrl.dispose();
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

  String _formatNum(dynamic raw, String fallback) {
    final val = double.tryParse(raw?.toString() ?? '');
    if (val == null) return fallback;
    if (val == val.roundToDouble()) return val.toStringAsFixed(0);
    return val.toStringAsFixed(2);
  }

  void _applyDto(Map<String, dynamic> data) {
    final defaults = data['defaultTemplates'] is Map
        ? Map<String, dynamic>.from(data['defaultTemplates'] as Map)
        : <String, dynamic>{};
    _defaultWaCreditTpl =
        defaults['creditCollection']?.toString() ?? _defaultCreditTpl;
    _defaultWaAdvanceTpl =
        defaults['advanceNotice']?.toString() ?? _defaultAdvanceTpl;
    _defaultWaPostSaleTpl =
        defaults['postSale']?.toString() ?? _defaultPostSaleTpl;

    _virginCompanyCtrl.text = _formatNum(
        data['virginCompanyCarCommissionPercent'] ??
            data['virginBookCommissionPercent'],
        '20');
    _virginOwnCtrl.text = _formatNum(
        data['virginOwnCarCommissionPercent'] ??
            data['virginBookCommissionPercent'],
        '25');
    _reboloCompanyCtrl.text = _formatNum(
        data['reboloCompanyCarCommissionPercent'] ??
            data['reboloBookCommissionPercent'],
        '40');
    _reboloOwnCtrl.text = _formatNum(
        data['reboloOwnCarCommissionPercent'] ??
            data['reboloBookCommissionPercent'],
        '50');
    _creditCtrl.text =
        _formatNum(data['creditInstallmentCommissionPercent'], '10');
    _photographerCommValCtrl.text =
        _formatNum(data['photographerCommissionValue'], '0');

    final defaultPriceCents =
        int.tryParse((data['defaultBookPriceCents'] ?? '').toString());
    _defaultBookPriceCtrl.text =
        defaultPriceCents != null && defaultPriceCents > 0
            ? (defaultPriceCents / 100.0).toStringAsFixed(2)
            : '';
    _maxDiscountCtrl.text =
        _formatNum(data['maxSellerDiscountPercent'], '15');

    _creditMinDownCtrl.text =
        _formatNum(data['creditMinDownPaymentPercent'], '20');
    _creditMaxInstCtrl.text =
        (data['creditMaxInstallments'] ?? '6').toString();
    _creditInterestCtrl.text =
        _formatNum(data['creditLateInterestMonthlyPercent'], '2');
    _creditFineCtrl.text =
        _formatNum(data['creditLateFinePercent'], '2');
    _creditCollectionDaysCtrl.text =
        (data['creditDaysToCollectionQueue'] ?? '5').toString();
    _creditSerasaDaysCtrl.text =
        (data['creditDaysToSerasaEligible'] ?? '30').toString();

    _maxBatchReturnDaysCtrl.text =
        (data['maxBatchReturnDays'] ?? '15').toString();
    final maxSim =
        int.tryParse((data['maxSimultaneousBooksPerSeller'] ?? '').toString());
    _maxSimultaneousBooksCtrl.text =
        (maxSim != null && maxSim > 0) ? maxSim.toString() : '';

    _waCreditCtrl.text =
        (data['whatsappCreditCollectionTemplate'] ?? '').toString();
    _waAdvanceCtrl.text =
        (data['whatsappAdvanceNoticeTemplate'] ?? '').toString();
    _waPostSaleCtrl.text =
        (data['whatsappPostSaleTemplate'] ?? '').toString();

    _sacPhoneCtrl.text = (data['sacPhone'] ?? '').toString();
    _sacWhatsappCtrl.text = (data['sacWhatsapp'] ?? '').toString();
    _footerTextCtrl.text = (data['qrReceiptFooterText'] ?? '').toString();

    if (!mounted) return;
    setState(() {
      _photographerCommType =
          (data['photographerCommissionType'] ?? 'FIXED_PER_BOOK')
              .toString()
              .toUpperCase();
      if (_photographerCommType != 'PERCENT_OF_SALE') {
        _photographerCommType = 'FIXED_PER_BOOK';
      }
      _discountPolicyMode =
          (data['discountPolicyMode'] ?? 'SILENT_AUDIT_ALERT')
              .toString()
              .toUpperCase();
      if (_discountPolicyMode != 'HARD_BLOCK') {
        _discountPolicyMode = 'SILENT_AUDIT_ALERT';
      }
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
        _showMsg('Logo enviada e persistida com sucesso!', isError: false);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _uploadingLogo = false);
        _showMsg(e.toString().replaceFirst('Exception: ', ''), isError: true);
      }
    }
  }

  Future<void> _save() async {
    final virginCompany =
        double.tryParse(_virginCompanyCtrl.text.trim().replaceAll(',', '.'));
    final virginOwn =
        double.tryParse(_virginOwnCtrl.text.trim().replaceAll(',', '.'));
    final reboloCompany =
        double.tryParse(_reboloCompanyCtrl.text.trim().replaceAll(',', '.'));
    final reboloOwn =
        double.tryParse(_reboloOwnCtrl.text.trim().replaceAll(',', '.'));
    final credit =
        double.tryParse(_creditCtrl.text.trim().replaceAll(',', '.'));
    final photoVal = double.tryParse(
            _photographerCommValCtrl.text.trim().replaceAll(',', '.')) ??
        0;
    final maxDiscount =
        double.tryParse(_maxDiscountCtrl.text.trim().replaceAll(',', '.'));
    final minDown =
        double.tryParse(_creditMinDownCtrl.text.trim().replaceAll(',', '.'));
    final maxInst = int.tryParse(_creditMaxInstCtrl.text.trim());
    final interestPct =
        double.tryParse(_creditInterestCtrl.text.trim().replaceAll(',', '.'));
    final finePct =
        double.tryParse(_creditFineCtrl.text.trim().replaceAll(',', '.'));
    final colDays = int.tryParse(_creditCollectionDaysCtrl.text.trim());
    final serasaDays = int.tryParse(_creditSerasaDaysCtrl.text.trim());
    final batchDays = int.tryParse(_maxBatchReturnDaysCtrl.text.trim());

    if (virginCompany == null ||
        virginCompany < 0 ||
        virginCompany > 100 ||
        virginOwn == null ||
        virginOwn < 0 ||
        virginOwn > 100) {
      _showMsg('Comissões Book Virgem devem estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (reboloCompany == null ||
        reboloCompany < 0 ||
        reboloCompany > 100 ||
        reboloOwn == null ||
        reboloOwn < 0 ||
        reboloOwn > 100) {
      _showMsg('Comissões Book Rebolo devem estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (credit == null || credit < 0 || credit > 100) {
      _showMsg('Comissão Parcela Crediário deve estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (photoVal < 0 ||
        (_photographerCommType == 'PERCENT_OF_SALE' && photoVal > 100)) {
      _showMsg('Valor de comissão do fotógrafo inválido.', isError: true);
      return;
    }

    int? defaultBookPriceCents;
    final rawPriceText = _defaultBookPriceCtrl.text.trim().replaceAll(',', '.');
    if (rawPriceText.isNotEmpty) {
      final parsedBrl = double.tryParse(rawPriceText);
      if (parsedBrl == null || parsedBrl <= 0) {
        _showMsg('Preço padrão do book deve ser maior que R\$ 0,00.',
            isError: true);
        return;
      }
      defaultBookPriceCents = (parsedBrl * 100).round();
    }

    if (maxDiscount == null || maxDiscount < 0 || maxDiscount > 100) {
      _showMsg('Desconto máximo deve estar entre 0% e 100%.', isError: true);
      return;
    }
    if (minDown == null || minDown < 0 || minDown > 100) {
      _showMsg('Entrada mínima do crediário deve estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (maxInst == null || maxInst < 1 || maxInst > 48) {
      _showMsg('Máximo de parcelas deve ser entre 1 e 48.', isError: true);
      return;
    }
    if (interestPct == null ||
        interestPct < 0 ||
        interestPct > 100 ||
        finePct == null ||
        finePct < 0 ||
        finePct > 100) {
      _showMsg('Juros mensal e multa devem estar entre 0% e 100%.',
          isError: true);
      return;
    }
    if (colDays == null ||
        colDays < 1 ||
        colDays > 365 ||
        serasaDays == null ||
        serasaDays < 1 ||
        serasaDays > 365 ||
        batchDays == null ||
        batchDays < 1 ||
        batchDays > 365) {
      _showMsg('Prazos em dias devem estar entre 1 e 365.', isError: true);
      return;
    }

    int? maxSimultaneous;
    final rawSim = _maxSimultaneousBooksCtrl.text.trim();
    if (rawSim.isNotEmpty) {
      maxSimultaneous = int.tryParse(rawSim);
      if (maxSimultaneous == null ||
          maxSimultaneous < 1 ||
          maxSimultaneous > 1000) {
        _showMsg('Limite simultâneo de books deve estar entre 1 e 1000.',
            isError: true);
        return;
      }
    }

    setState(() => _saving = true);
    try {
      final payload = {
        'virginCompanyCarCommissionPercent': virginCompany,
        'virginOwnCarCommissionPercent': virginOwn,
        'reboloCompanyCarCommissionPercent': reboloCompany,
        'reboloOwnCarCommissionPercent': reboloOwn,
        'virginBookCommissionPercent': virginCompany,
        'reboloBookCommissionPercent': reboloCompany,
        'creditInstallmentCommissionPercent': credit,
        'photographerCommissionType': _photographerCommType,
        'photographerCommissionValue': photoVal,
        'defaultBookPriceCents': defaultBookPriceCents,
        'maxSellerDiscountPercent': maxDiscount,
        'discountPolicyMode': _discountPolicyMode,
        'creditMinDownPaymentPercent': minDown,
        'creditMaxInstallments': maxInst,
        'creditLateInterestMonthlyPercent': interestPct,
        'creditLateFinePercent': finePct,
        'creditDaysToCollectionQueue': colDays,
        'creditDaysToSerasaEligible': serasaDays,
        'maxBatchReturnDays': batchDays,
        'maxSimultaneousBooksPerSeller': maxSimultaneous,
        'whatsappCreditCollectionTemplate': _waCreditCtrl.text.trim(),
        'whatsappAdvanceNoticeTemplate': _waAdvanceCtrl.text.trim(),
        'whatsappPostSaleTemplate': _waPostSaleCtrl.text.trim(),
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
          'Configurações gerais da empresa salvas com sucesso!',
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

  Future<void> _openSellerOverridesModal() async {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: _cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _SellerOverridesSheet(
        api: _api,
        companyId: _isSuperAdminMode ? widget.companyId : null,
      ),
    );
  }

  void _insertVarInto(TextEditingController ctrl, String token) {
    final text = ctrl.text;
    final sel = ctrl.selection;
    if (sel.isValid && sel.start >= 0 && sel.end <= text.length) {
      final next = text.replaceRange(sel.start, sel.end, token);
      ctrl.value = TextEditingValue(
        text: next,
        selection: TextSelection.collapsed(offset: sel.start + token.length),
      );
    } else {
      final sep = text.isEmpty || text.endsWith(' ') ? '' : ' ';
      ctrl.text = '$text$sep$token';
    }
    setState(() {});
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

  Widget _darkField({
    required TextEditingController controller,
    required String label,
    String? hint,
    String? suffixText,
    TextInputType keyboardType = TextInputType.text,
    int minLines = 1,
    int maxLines = 1,
    ValueChanged<String>? onChanged,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      minLines: minLines,
      maxLines: maxLines,
      onChanged: onChanged,
      style: const TextStyle(color: Colors.white, fontSize: 13),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.white38, fontSize: 12),
        labelStyle: const TextStyle(color: Colors.white70, fontSize: 12),
        suffixText: suffixText,
        suffixStyle: const TextStyle(color: _accentSoft),
        filled: true,
        fillColor: _bg,
        border: const OutlineInputBorder(),
        enabledBorder: OutlineInputBorder(
          borderSide: BorderSide(color: _accent.withOpacity(0.28)),
        ),
        focusedBorder: const OutlineInputBorder(
          borderSide: BorderSide(color: _accent),
        ),
      ),
    );
  }

  Widget _collapsibleSection({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget child,
    bool initiallyExpanded = false,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _accent.withOpacity(0.4)),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          iconColor: _accentSoft,
          collapsedIconColor: _accentSoft,
          tilePadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: Icon(icon, color: _accent, size: 22),
          title: Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 14.5,
              fontWeight: FontWeight.bold,
            ),
          ),
          subtitle: Text(
            subtitle,
            style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
          ),
          children: [child],
        ),
      ),
    );
  }

  Widget _whatsappEditor({
    required String title,
    required TextEditingController controller,
    required String defaultTemplate,
    required String sampleCliente,
    required String sampleValor,
    required String sampleVencimento,
  }) {
    final companyLabel =
        (widget.companyName != null && widget.companyName!.trim().isNotEmpty)
            ? widget.companyName!.trim()
            : 'Sua Empresa';
    final effectivePreview = ApiService.renderWhatsAppTemplate(
      controller.text,
      cliente: sampleCliente,
      valor: sampleValor,
      vencimento: sampleVencimento,
      pix: 'pix@empresa.com.br',
      empresa: companyLabel,
      fallback: defaultTemplate,
    );

    const vars = ['{cliente}', '{valor}', '{vencimento}', '{pix}', '{empresa}'];

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: _accent.withOpacity(0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              TextButton.icon(
                onPressed: () {
                  setState(() {
                    controller.text = defaultTemplate;
                  });
                },
                icon: const Icon(Icons.restore_rounded,
                    size: 14, color: _accentSoft),
                label: const Text(
                  'Restaurar texto padrão',
                  style: TextStyle(color: _accentSoft, fontSize: 11),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: vars
                .map(
                  (v) => ActionChip(
                    backgroundColor: _cardBg,
                    side: BorderSide(color: _accent.withOpacity(0.5)),
                    label: Text(
                      v,
                      style: const TextStyle(
                        color: _accentSoft,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    onPressed: () => _insertVarInto(controller, v),
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 8),
          _darkField(
            controller: controller,
            label: 'Texto do Modelo (vazio = usar padrão da plataforma)',
            hint: defaultTemplate,
            minLines: 3,
            maxLines: 6,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF064E3B).withOpacity(0.25),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _green.withOpacity(0.45)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Prévia ao vivo no WhatsApp:',
                  style: TextStyle(
                    color: _green,
                    fontSize: 10.5,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  effectivePreview,
                  style: const TextStyle(color: Colors.white70, fontSize: 11.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _qrToggle(String label, bool value, ValueChanged<bool> onChanged) {
    return SwitchListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      activeColor: _accent,
      title: Text(label,
          style: const TextStyle(color: Colors.white, fontSize: 13)),
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
              'Configurações Gerais da Empresa',
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
                    // 1. Comissões da Equipe + Fotógrafo + Exceções por Vendedor
                    _collapsibleSection(
                      initiallyExpanded: true,
                      icon: Icons.percent_rounded,
                      title: 'Comissões da Equipe',
                      subtitle:
                          'Matriz Virgem/Rebolo por veículo, boleto pago, fotógrafo e exceções.',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(10),
                            margin: const EdgeInsets.only(bottom: 12),
                            decoration: BoxDecoration(
                              color: _bg,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                  color: _accent.withOpacity(0.4)),
                            ),
                            child: const Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(Icons.info_outline_rounded,
                                    color: _accentSoft, size: 16),
                                SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    'Comissão incide somente sobre valores efetivamente pagos (à vista, entrada ou boleto/parcela paga). Nunca incide sobre saldo financiado em aberto.',
                                    style: TextStyle(
                                        color: Colors.white70, fontSize: 11.5),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          _darkField(
                            controller: _virginCompanyCtrl,
                            label: 'Book Virgem · Carro da Empresa (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _virginOwnCtrl,
                            label: 'Book Virgem · Carro Próprio (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _reboloCompanyCtrl,
                            label: 'Book Rebolo · Carro da Empresa (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _reboloOwnCtrl,
                            label: 'Book Rebolo · Carro Próprio (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _creditCtrl,
                            label: 'Parcela / Boleto Pago no Crediário (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const Divider(color: Colors.white12, height: 24),
                          const Text(
                            'Comissão do Fotógrafo',
                            style: TextStyle(
                              color: _accentSoft,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                          DropdownButtonFormField<String>(
                            value: _photographerCommType,
                            dropdownColor: _cardBg,
                            style: const TextStyle(
                                color: Colors.white, fontSize: 13),
                            decoration: InputDecoration(
                              labelText: 'Regra de Comissão do Fotógrafo',
                              labelStyle: const TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: const OutlineInputBorder(),
                              enabledBorder: OutlineInputBorder(
                                borderSide:
                                    BorderSide(color: _accent.withOpacity(0.28)),
                              ),
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'FIXED_PER_BOOK',
                                child: Text('Valor Fixo por Book (R\$)'),
                              ),
                              DropdownMenuItem(
                                value: 'PERCENT_OF_SALE',
                                child: Text('Percentual sobre a Venda (%)'),
                              ),
                            ],
                            onChanged: (val) {
                              if (val != null) {
                                setState(() => _photographerCommType = val);
                              }
                            },
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _photographerCommValCtrl,
                            label: _photographerCommType == 'PERCENT_OF_SALE'
                                ? 'Percentual do Fotógrafo (%)'
                                : 'Valor por Book do Fotógrafo (R\$)',
                            suffixText: _photographerCommType == 'PERCENT_OF_SALE'
                                ? '%'
                                : 'R\$',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 14),
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: _accent),
                              foregroundColor: _accentSoft,
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            onPressed: _openSellerOverridesModal,
                            icon: const Icon(Icons.manage_accounts_rounded,
                                size: 18),
                            label: const Text('Exceções por Vendedor'),
                          ),
                        ],
                      ),
                    ),

                    // 2. Preço, Desconto e Crediário
                    _collapsibleSection(
                      icon: Icons.price_change_rounded,
                      title: 'Preço, Desconto e Crediário',
                      subtitle:
                          'Preço base, teto de desconto, parcelas, juros, multa e prazos Serasa.',
                      child: Column(
                        children: [
                          _darkField(
                            controller: _defaultBookPriceCtrl,
                            label:
                                'Preço padrão do Book em R\$ (opcional, vazio = sem teto)',
                            suffixText: 'R\$',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _maxDiscountCtrl,
                            label: 'Desconto máximo permitido ao vendedor (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<String>(
                            value: _discountPolicyMode,
                            dropdownColor: _cardBg,
                            style: const TextStyle(
                                color: Colors.white, fontSize: 13),
                            decoration: InputDecoration(
                              labelText:
                                  'Ao exceder desconto máximo',
                              labelStyle: const TextStyle(
                                  color: Colors.white70, fontSize: 12),
                              filled: true,
                              fillColor: _bg,
                              border: const OutlineInputBorder(),
                              enabledBorder: OutlineInputBorder(
                                borderSide:
                                    BorderSide(color: _accent.withOpacity(0.28)),
                              ),
                            ),
                            items: const [
                              DropdownMenuItem(
                                value: 'SILENT_AUDIT_ALERT',
                                child: Text('Alerta silencioso no Admin'),
                              ),
                              DropdownMenuItem(
                                value: 'HARD_BLOCK',
                                child: Text('Bloquear venda na rua'),
                              ),
                            ],
                            onChanged: (val) {
                              if (val != null) {
                                setState(() => _discountPolicyMode = val);
                              }
                            },
                          ),
                          const Divider(color: Colors.white12, height: 24),
                          _darkField(
                            controller: _creditMinDownCtrl,
                            label: 'Entrada mínima no Crediário (%)',
                            suffixText: '%',
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _creditMaxInstCtrl,
                            label: 'Máximo de parcelas permitidas',
                            keyboardType: TextInputType.number,
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: _darkField(
                                  controller: _creditInterestCtrl,
                                  label: 'Juros mensal (%)',
                                  suffixText: '%',
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                          decimal: true),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: _darkField(
                                  controller: _creditFineCtrl,
                                  label: 'Multa atraso (%)',
                                  suffixText: '%',
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                          decimal: true),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: _darkField(
                                  controller: _creditCollectionDaysCtrl,
                                  label: 'Dias p/ fila cobrança',
                                  keyboardType: TextInputType.number,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: _darkField(
                                  controller: _creditSerasaDaysCtrl,
                                  label: 'Dias p/ Serasa',
                                  keyboardType: TextInputType.number,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // 3. Lotes e Devolução
                    _collapsibleSection(
                      icon: Icons.inventory_2_rounded,
                      title: 'Lotes e Devolução',
                      subtitle:
                          'Prazo de retorno (alerta vermelho) e limite de books com vendedor.',
                      child: Column(
                        children: [
                          _darkField(
                            controller: _maxBatchReturnDaysCtrl,
                            label:
                                'Prazo máximo em dias para alerta vermelho no lote',
                            suffixText: 'dias',
                            keyboardType: TextInputType.number,
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _maxSimultaneousBooksCtrl,
                            label:
                                'Limite simultâneo de books por vendedor (vazio = sem limite)',
                            keyboardType: TextInputType.number,
                          ),
                        ],
                      ),
                    ),

                    // 4. Modelos de WhatsApp
                    _collapsibleSection(
                      icon: Icons.chat_rounded,
                      title: 'Modelos de WhatsApp',
                      subtitle:
                          'Cobrança Crediário, Vales/Pendências e Pós-Venda com variáveis ao vivo.',
                      child: Column(
                        children: [
                          _whatsappEditor(
                            title: '1. Cobrança de Crediário',
                            controller: _waCreditCtrl,
                            defaultTemplate: _defaultWaCreditTpl,
                            sampleCliente: 'Maria Souza',
                            sampleValor: 'R\$ 180,00',
                            sampleVencimento: '15/12/2026',
                          ),
                          _whatsappEditor(
                            title: '2. Vales / Pendências',
                            controller: _waAdvanceCtrl,
                            defaultTemplate: _defaultWaAdvanceTpl,
                            sampleCliente: 'João Vendedor',
                            sampleValor: 'R\$ 320,00',
                            sampleVencimento: 'Fechamento Semanal',
                          ),
                          _whatsappEditor(
                            title: '3. Pós-Venda',
                            controller: _waPostSaleCtrl,
                            defaultTemplate: _defaultWaPostSaleTpl,
                            sampleCliente: 'Carlos Lima',
                            sampleValor: 'R\$ 450,00',
                            sampleVencimento: 'À vista',
                          ),
                        ],
                      ),
                    ),

                    // 5. Identidade, Logo e SAC (Etapa 31 preservado)
                    _collapsibleSection(
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
                          _darkField(
                            controller: _sacPhoneCtrl,
                            label: 'Telefone do SAC',
                            keyboardType: TextInputType.phone,
                            onChanged: (_) => setState(() {}),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _sacWhatsappCtrl,
                            label: 'WhatsApp do SAC',
                            keyboardType: TextInputType.phone,
                            onChanged: (_) => setState(() {}),
                          ),
                          const SizedBox(height: 12),
                          _darkField(
                            controller: _footerTextCtrl,
                            label:
                                'Texto de Garantia / Rodapé do Comprovante',
                            minLines: 2,
                            maxLines: 4,
                            onChanged: (_) => setState(() {}),
                          ),
                        ],
                      ),
                    ),

                    // 6. O que aparece no QR Code da Venda (Etapa 31 preservado)
                    _collapsibleSection(
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
                              (v) =>
                                  setState(() => _qrShowPhotographerName = v)),
                          _qrToggle(
                              'Exibir Forma de pagamento',
                              _qrShowPaymentMethod,
                              (v) => setState(() => _qrShowPaymentMethod = v)),
                          _qrToggle('Exibir Valor da venda', _qrShowSaleValue,
                              (v) => setState(() => _qrShowSaleValue = v)),
                          _qrToggle(
                              'Exibir Resumo do parcelamento',
                              _qrShowInstallmentSummary,
                              (v) => setState(
                                  () => _qrShowInstallmentSummary = v)),
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

                    const SizedBox(height: 6),
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
                          : 'Salvar Configurações Gerais'),
                    ),
                    const SizedBox(height: 28),
                  ],
                ),
    );
  }
}

class _SellerOverridesSheet extends StatefulWidget {
  final ApiService api;
  final String? companyId;

  const _SellerOverridesSheet({
    required this.api,
    this.companyId,
  });

  @override
  State<_SellerOverridesSheet> createState() => _SellerOverridesSheetState();
}

class _SellerOverridesSheetState extends State<_SellerOverridesSheet> {
  static const _bg = Color(0xFF0D0714);
  static const _cardBg = Color(0xFF160D24);
  static const _accent = Color(0xFFA855F7);
  static const _accentSoft = Color(0xFFD8B4FE);

  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _sellers = [];
  Map<String, dynamic> _defaults = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await widget.api
          .getSellerCommissionOverrides(companyId: widget.companyId);
      if (!mounted) return;
      setState(() {
        _defaults = res['companyDefaults'] is Map
            ? Map<String, dynamic>.from(res['companyDefaults'] as Map)
            : {};
        _sellers = (res['sellers'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _editSeller(Map<String, dynamic> seller) async {
    final virginCtrl = TextEditingController(
      text: seller['customVirginCommissionPercent'] != null
          ? seller['customVirginCommissionPercent'].toString()
          : '',
    );
    final reboloCtrl = TextEditingController(
      text: seller['customReboloCommissionPercent'] != null
          ? seller['customReboloCommissionPercent'].toString()
          : '',
    );
    final creditCtrl = TextEditingController(
      text: seller['customCreditInstallmentCommissionPercent'] != null
          ? seller['customCreditInstallmentCommissionPercent'].toString()
          : '',
    );
    bool saving = false;

    final updated = await showDialog<bool>(
      context: context,
      builder: (dCtx) => StatefulBuilder(
        builder: (dCtx, setDialogState) => AlertDialog(
          backgroundColor: _cardBg,
          title: Text(
            'Exceção: ${seller['name'] ?? 'Vendedor'}',
            style: const TextStyle(color: Colors.white, fontSize: 15),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Deixe em branco para herdar a matriz da empresa '
                '(Virgem Emp ${_defaults['virginCompanyCarCommissionPercent'] ?? 20}% / '
                'Próp ${_defaults['virginOwnCarCommissionPercent'] ?? 25}% • '
                'Rebolo Emp ${_defaults['reboloCompanyCarCommissionPercent'] ?? 40}% / '
                'Próp ${_defaults['reboloOwnCarCommissionPercent'] ?? 50}% • '
                'Boleto Pago ${_defaults['creditInstallmentCommissionPercent'] ?? 10}%).',
                style: const TextStyle(color: Colors.white60, fontSize: 11.5),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: virginCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Virgem individual (%)',
                  labelStyle: TextStyle(color: Colors.white70, fontSize: 12),
                  filled: true,
                  fillColor: _bg,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: reboloCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Rebolo individual (%)',
                  labelStyle: TextStyle(color: Colors.white70, fontSize: 12),
                  filled: true,
                  fillColor: _bg,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: creditCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Parcela Crediário individual (%)',
                  labelStyle: TextStyle(color: Colors.white70, fontSize: 12),
                  filled: true,
                  fillColor: _bg,
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: saving
                  ? null
                  : () async {
                      setDialogState(() => saving = true);
                      try {
                        await widget.api.saveSellerCommissionOverride(
                          sellerId: seller['id'].toString(),
                          clear: true,
                          companyId: widget.companyId,
                        );
                        if (dCtx.mounted) Navigator.pop(dCtx, true);
                      } catch (_) {
                        setDialogState(() => saving = false);
                      }
                    },
              child: const Text('Limpar Exceção',
                  style: TextStyle(color: Colors.orangeAccent)),
            ),
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dCtx, false),
              child: const Text('Cancelar',
                  style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: _accent),
              onPressed: saving
                  ? null
                  : () async {
                      double? parseOpt(String txt) {
                        final t = txt.trim().replaceAll(',', '.');
                        if (t.isEmpty) return null;
                        return double.tryParse(t);
                      }

                      setDialogState(() => saving = true);
                      try {
                        await widget.api.saveSellerCommissionOverride(
                          sellerId: seller['id'].toString(),
                          customVirginCommissionPercent:
                              parseOpt(virginCtrl.text),
                          customReboloCommissionPercent:
                              parseOpt(reboloCtrl.text),
                          customCreditInstallmentCommissionPercent:
                              parseOpt(creditCtrl.text),
                          companyId: widget.companyId,
                        );
                        if (dCtx.mounted) Navigator.pop(dCtx, true);
                      } catch (e) {
                        setDialogState(() => saving = false);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                  e.toString().replaceFirst('Exception: ', '')),
                              backgroundColor: Colors.redAccent,
                            ),
                          );
                        }
                      }
                    },
              child: Text(saving ? 'Salvando...' : 'Salvar',
                  style: const TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );

    virginCtrl.dispose();
    reboloCtrl.dispose();
    creditCtrl.dispose();

    if (updated == true) {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.72,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.manage_accounts_rounded, color: _accent),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'Exceções Individuais por Vendedor',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white54),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Padrão da empresa: Virgem Emp ${_defaults['virginCompanyCarCommissionPercent'] ?? 20}% / '
                'Próp ${_defaults['virginOwnCarCommissionPercent'] ?? 25}% • '
                'Rebolo Emp ${_defaults['reboloCompanyCarCommissionPercent'] ?? 40}% / '
                'Próp ${_defaults['reboloOwnCarCommissionPercent'] ?? 50}% • '
                'Boleto Pago ${_defaults['creditInstallmentCommissionPercent'] ?? 10}%',
                style: const TextStyle(color: _accentSoft, fontSize: 11.5),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: _loading
                    ? const Center(
                        child: CircularProgressIndicator(color: _accent))
                    : _error != null
                        ? Center(
                            child: Text(_error!,
                                style: const TextStyle(color: Colors.redAccent)))
                        : _sellers.isEmpty
                            ? const Center(
                                child: Text(
                                  'Nenhum vendedor cadastrado na empresa.',
                                  style: TextStyle(color: Colors.white54),
                                ),
                              )
                            : ListView.separated(
                                itemCount: _sellers.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: 8),
                                itemBuilder: (_, i) {
                                  final s = _sellers[i];
                                  final hasCustom =
                                      s['hasCustomOverride'] == true;
                                  return Container(
                                    decoration: BoxDecoration(
                                      color: _bg,
                                      borderRadius: BorderRadius.circular(10),
                                      border: Border.all(
                                        color: hasCustom
                                            ? _accent
                                            : Colors.white12,
                                      ),
                                    ),
                                    child: ListTile(
                                      title: Text(
                                        (s['name'] ?? 'Vendedor').toString(),
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 13.5,
                                        ),
                                      ),
                                      subtitle: Text(
                                        'Virgem: ${s['effectiveVirginCommissionPercent']}% · '
                                        'Rebolo: ${s['effectiveReboloCommissionPercent']}% · '
                                        'Parcelas: ${s['effectiveCreditInstallmentCommissionPercent']}%'
                                        '${hasCustom ? ' (Exceção ativa)' : ' (Padrão)'}',
                                        style: TextStyle(
                                          color: hasCustom
                                              ? _accentSoft
                                              : Colors.white54,
                                          fontSize: 11.5,
                                        ),
                                      ),
                                      trailing: IconButton(
                                        icon: const Icon(Icons.edit_rounded,
                                            color: _accentSoft),
                                        onPressed: () => _editSeller(s),
                                      ),
                                      onTap: () => _editSeller(s),
                                    ),
                                  );
                                },
                              ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
