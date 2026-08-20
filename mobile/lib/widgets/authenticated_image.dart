import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../servicos/servico_api.dart';

/// Widget central para exibição segura de mídias e imagens privadas (comprovantes, fotos, assinaturas).
/// 
/// Características:
/// - Resolve URLs relativas e absolutas através de [ApiService.resolveMediaUrl].
/// - Envia automaticamente cabeçalhos de autenticação (`Authorization: Bearer <token>`).
/// - Em modo release, bloqueia o envio de token para hosts não autorizados fora de [AppConfig.officialHost].
/// - Suporta URLs 'data:image/...;base64,...' diretamente com decodificação em memória.
/// - Trata graciosamente erros 401, 403, 404 ou falhas de conexão exibindo widget de fallback.
class AuthenticatedImage extends StatelessWidget {
  final String? url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final BorderRadius? borderRadius;
  final Widget? placeholder;
  final Widget? errorWidget;
  final Map<String, String>? customHeaders;

  const AuthenticatedImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.borderRadius,
    this.placeholder,
    this.errorWidget,
    this.customHeaders,
  });

  /// Retorna os headers de autenticação seguros para a URL especificada
  static Map<String, String> getSafeHeadersForUrl(String url, {Map<String, String>? extraHeaders}) {
    final headers = <String, String>{};
    if (extraHeaders != null) {
      headers.addAll(extraHeaders);
    }

    if (url.startsWith('data:')) {
      return headers;
    }

    // Em modo release, só envia token se o host corresponder ao oficial
    if (kReleaseMode) {
      final uri = Uri.tryParse(url);
      if (uri != null && uri.host.isNotEmpty && uri.host != AppConfig.authorizedProductionHost) {
        return headers; // Não envia token para domínios de terceiros
      }
    }

    final apiAuth = ApiService().currentAuthHeaders;
    headers.addAll(apiAuth);
    return headers;
  }

  /// Retorna um ImageProvider autenticado para uso em CircleAvatar, DecorationImage, etc.
  static ImageProvider? provider(String? rawUrl, {Map<String, String>? customHeaders}) {
    if (rawUrl == null || rawUrl.trim().isEmpty) return null;
    final trimmed = rawUrl.trim();

    if (trimmed.startsWith('data:image')) {
      try {
        final commaIndex = trimmed.indexOf(',');
        if (commaIndex != -1) {
          final bytes = base64Decode(trimmed.substring(commaIndex + 1));
          return MemoryImage(bytes);
        }
      } catch (e) {
        return null;
      }
    }

    final resolved = ApiService.resolveMediaUrl(trimmed);
    if (resolved.isEmpty) return null;

    final headers = getSafeHeadersForUrl(resolved, extraHeaders: customHeaders);
    return NetworkImage(resolved, headers: headers.isNotEmpty ? headers : null);
  }

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.trim().isEmpty) {
      return _buildError(context);
    }

    final trimmed = url!.trim();

    // 1. Suporte a Data URL em Base64
    if (trimmed.startsWith('data:image')) {
      try {
        final commaIndex = trimmed.indexOf(',');
        if (commaIndex != -1) {
          final bytes = base64Decode(trimmed.substring(commaIndex + 1));
          Widget imageWidget = Image.memory(
            bytes,
            width: width,
            height: height,
            fit: fit,
            errorBuilder: (_, __, ___) => _buildError(context),
          );
          if (borderRadius != null) {
            imageWidget = ClipRRect(borderRadius: borderRadius!, child: imageWidget);
          }
          return imageWidget;
        }
      } catch (e) {
        return _buildError(context);
      }
    }

    final resolvedUrl = ApiService.resolveMediaUrl(trimmed);
    if (resolvedUrl.isEmpty) {
      return _buildError(context);
    }

    final headers = getSafeHeadersForUrl(resolvedUrl, extraHeaders: customHeaders);

    Widget image = Image.network(
      resolvedUrl,
      headers: headers.isNotEmpty ? headers : null,
      width: width,
      height: height,
      fit: fit,
      loadingBuilder: (context, child, loadingProgress) {
        if (loadingProgress == null) return child;
        return placeholder ??
            SizedBox(
              width: width,
              height: height,
              child: Center(
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  value: loadingProgress.expectedTotalBytes != null
                      ? loadingProgress.cumulativeBytesLoaded / loadingProgress.expectedTotalBytes!
                      : null,
                ),
              ),
            );
      },
      errorBuilder: (context, error, stackTrace) {
        return _buildError(context);
      },
    );

    if (borderRadius != null) {
      image = ClipRRect(borderRadius: borderRadius!, child: image);
    }

    return image;
  }

  Widget _buildError(BuildContext context) {
    if (errorWidget != null) return errorWidget!;
    return Container(
      width: width,
      height: height,
      color: Colors.white10,
      alignment: Alignment.center,
      child: const Icon(Icons.broken_image, color: Colors.white38, size: 24),
    );
  }
}
