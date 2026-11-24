import 'package:flutter/material.dart';

class ApiUsageBarCard extends StatelessWidget {
  final Map<String, dynamic>? usageData;
  final bool readOnly;
  final bool isLoading;
  final VoidCallback? onEditLimits;
  final VoidCallback? onRefresh;

  const ApiUsageBarCard({
    super.key,
    required this.usageData,
    this.readOnly = true,
    this.isLoading = false,
    this.onEditLimits,
    this.onRefresh,
  });

  static const _bgSurface = Color(0xFF0D0714);
  static const _cardBg = Color(0xFF160D24);
  static const _purple = Color(0xFFA855F7);
  static const _emerald = Color(0xFF10B981);
  static const _amber = Color(0xFFF59E0B);
  static const _red = Color(0xFFEF4444);

  Color _colorForPercent(double pct) {
    if (pct >= 90) return _red;
    if (pct >= 70) return _amber;
    return _emerald;
  }

  int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  double _asDouble(dynamic v) {
    if (v is double) return v;
    if (v is num) return v.toDouble();
    return double.tryParse(v?.toString() ?? '') ?? 0.0;
  }

  String _formatDateTime(dynamic raw) {
    if (raw == null) return 'Sem chamadas no mês';
    final parsed = DateTime.tryParse(raw.toString())?.toLocal();
    if (parsed == null) return 'Sem chamadas no mês';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(parsed.day)}/${two(parsed.month)} ${two(parsed.hour)}:${two(parsed.minute)}';
  }

  String _formatTokens(int tokens) {
    if (tokens >= 1000000) {
      return '${(tokens / 1000000).toStringAsFixed(2)}M tokens';
    }
    if (tokens >= 1000) {
      return '${(tokens / 1000).toStringAsFixed(1)}k tokens';
    }
    return '$tokens tokens';
  }

  @override
  Widget build(BuildContext context) {
    if (isLoading && usageData == null) {
      return Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _cardBg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _purple.withOpacity(0.45)),
        ),
        child: const Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2, color: _purple),
            ),
            SizedBox(width: 12),
            Text(
              'Carregando consumo mensal das APIs...',
              style: TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ],
        ),
      );
    }

    if (usageData == null) {
      return const SizedBox.shrink();
    }

    final providersMap = usageData!['providers'] is Map
        ? Map<String, dynamic>.from(usageData!['providers'] as Map)
        : <String, dynamic>{};

    final geminiMap = providersMap['GEMINI'] is Map
        ? Map<String, dynamic>.from(providersMap['GEMINI'] as Map)
        : (usageData!['gemini'] is Map
            ? Map<String, dynamic>.from(usageData!['gemini'] as Map)
            : <String, dynamic>{});

    final asaasMap = providersMap['ASAAS'] is Map
        ? Map<String, dynamic>.from(providersMap['ASAAS'] as Map)
        : (usageData!['asaas'] is Map
            ? Map<String, dynamic>.from(usageData!['asaas'] as Map)
            : <String, dynamic>{});

    final yearMonth = (usageData!['yearMonth'] ?? '').toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _purple.withOpacity(0.55)),
        boxShadow: [
          BoxShadow(
            color: _purple.withOpacity(0.08),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.bar_chart_rounded, color: _purple, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Consumo Real das APIs',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Text(
                      yearMonth.isNotEmpty
                          ? 'Competência $yearMonth • Medição direta no servidor'
                          : 'Medição direta no servidor',
                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                    ),
                  ],
                ),
              ),
              if (onRefresh != null)
                IconButton(
                  icon: const Icon(Icons.refresh_rounded, color: Colors.white60, size: 18),
                  tooltip: 'Atualizar consumo',
                  visualDensity: VisualDensity.compact,
                  onPressed: onRefresh,
                ),
              if (!readOnly && onEditLimits != null)
                OutlinedButton.icon(
                  onPressed: onEditLimits,
                  icon: const Icon(Icons.tune_rounded, size: 14, color: _purple),
                  label: const Text(
                    'Editar Metas',
                    style: TextStyle(color: _purple, fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: _purple.withOpacity(0.6)),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          _buildProviderProgress(
            title: 'Google Gemini (Eventos IA & Testes)',
            icon: Icons.auto_awesome_rounded,
            data: geminiMap,
            showTokens: true,
          ),
          const SizedBox(height: 12),
          _buildProviderProgress(
            title: 'Asaas / Serasa (Cobranças & Consultas)',
            icon: Icons.account_balance_rounded,
            data: asaasMap,
            showTokens: false,
          ),
        ],
      ),
    );
  }

  Widget _buildProviderProgress({
    required String title,
    required IconData icon,
    required Map<String, dynamic> data,
    required bool showTokens,
  }) {
    final used = _asInt(data['usedCalls']);
    final limit = _asInt(data['limitCalls']);
    final pct = _asDouble(data['usagePercent']);
    final clampedProgress = (pct / 100.0).clamp(0.0, 1.0);
    final barColor = _colorForPercent(pct);

    final successCalls = _asInt(data['successCalls']);
    final errorCalls = _asInt(data['errorCalls']);
    final rateLimitedCalls = _asInt(data['rateLimitedCalls']);
    final totalTokens = _asInt(data['totalTokens']);
    final lastUsedText = _formatDateTime(data['lastUsedAt']);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _bgSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: _purple),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: barColor.withOpacity(0.16),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: barColor.withOpacity(0.55)),
                ),
                child: Text(
                  '$used / ${limit > 0 ? limit : "∞"} (${pct.toStringAsFixed(1)}%)',
                  style: TextStyle(
                    color: barColor,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: clampedProgress,
              minHeight: 8,
              backgroundColor: Colors.white12,
              valueColor: AlwaysStoppedAnimation<Color>(barColor),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              _statChip('Sucesso', '$successCalls', _emerald),
              _statChip('Erro', '$errorCalls', errorCalls > 0 ? _red : Colors.white54),
              _statChip('429', '$rateLimitedCalls', rateLimitedCalls > 0 ? _amber : Colors.white54),
              if (showTokens)
                _statChip('Tokens', _formatTokens(totalTokens), _purple),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Última chamada: $lastUsedText',
            style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
          ),
        ],
      ),
    );
  }

  Widget _statChip(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.32)),
      ),
      child: Text(
        '$label: $value',
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w600),
      ),
    );
  }
}
