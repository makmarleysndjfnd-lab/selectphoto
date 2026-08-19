class AppConfig {
  /// URL do servidor injetada em tempo de compilação via --dart-define=SERVER_URL=...
  /// Exemplo de uso: --dart-define=SERVER_URL=http://127.0.0.1:3001/api
  static const String _definedServerUrl = String.fromEnvironment('SERVER_URL');

  /// Retorna se a SERVER_URL foi definida em tempo de compilação.
  static bool get hasServerUrl => _definedServerUrl.trim().isNotEmpty;

  /// Retorna a SERVER_URL configurada. Lança [StateError] explícito se não foi fornecida,
  /// impedindo categoricamente qualquer fallback silencioso para produção ou hosts não autorizados.
  static String get serverUrl {
    if (!hasServerUrl) {
      throw StateError(
        '🛑 ERRO CRÍTICO DE CONFIGURAÇÃO: SERVER_URL não foi definida em tempo de compilação.\n'
        'Você DEVE fornecer explicitamente: --dart-define=SERVER_URL=<URL_DO_BACKEND>\n'
        'Fallback silencioso para produção foi desativado por segurança.',
      );
    }
    return _definedServerUrl.trim();
  }

  /// Retorna a URL inicial segura para inicialização de provedores e serviços.
  /// Se [customUrl] for fornecida e válida, utiliza-a; caso contrário, exige [serverUrl].
  static String resolveUrl({String? customUrl}) {
    if (customUrl != null && customUrl.trim().isNotEmpty) {
      return customUrl.trim();
    }
    return serverUrl;
  }
}
