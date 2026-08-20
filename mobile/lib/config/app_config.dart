import 'package:flutter/foundation.dart';

class AppConfig {
  /// URL do servidor injetada em tempo de compilação via --dart-define=SERVER_URL=...
  /// Exemplo de uso: --dart-define=SERVER_URL=https://selectphoto.onrender.com/api
  static const String _definedServerUrl = String.fromEnvironment('SERVER_URL');

  /// Host autorizado para ambiente de produção
  static const String authorizedProductionHost = 'selectphoto.onrender.com';

  /// Retorna se a SERVER_URL foi definida em tempo de compilação.
  static bool get hasServerUrl => _definedServerUrl.trim().isNotEmpty;

  /// Retorna a SERVER_URL configurada. Lança [StateError] explícito se não foi fornecida,
  /// impedindo categoricamente qualquer fallback silencioso para produção ou hosts não autorizados.
  static String get serverUrl {
    if (!hasServerUrl) {
      if (kReleaseMode) {
        throw StateError(
          '🛑 ERRO CRÍTICO DE CONFIGURAÇÃO (RELEASE): SERVER_URL não foi definida em tempo de compilação.\n'
          'Você DEVE fornecer explicitamente: --dart-define=SERVER_URL=https://selectphoto.onrender.com/api',
        );
      }
      throw StateError(
        '🛑 ERRO CRÍTICO DE CONFIGURAÇÃO: SERVER_URL não foi definida em tempo de compilação.\n'
        'Você DEVE fornecer explicitamente: --dart-define=SERVER_URL=<URL_DO_BACKEND>',
      );
    }

    final url = _definedServerUrl.trim();

    // Em modo release, validação estrita de segurança: apenas HTTPS e host autorizado
    if (kReleaseMode) {
      if (!url.startsWith('https://')) {
        throw StateError('🛑 SEGURANÇA: Em modo release, apenas conexões HTTPS são autorizadas.');
      }
      final uri = Uri.tryParse(url);
      if (uri == null || (uri.host != authorizedProductionHost && !uri.host.endsWith('.onrender.com'))) {
        throw StateError('🛑 SEGURANÇA: Em modo release, o host "$url" não é autorizado.');
      }
    }

    return url;
  }

  /// Retorna a URL inicial segura para inicialização de provedores e serviços.
  static String resolveUrl({String? customUrl}) {
    if (!kReleaseMode && customUrl != null && customUrl.trim().isNotEmpty) {
      return customUrl.trim();
    }
    return serverUrl;
  }
}
