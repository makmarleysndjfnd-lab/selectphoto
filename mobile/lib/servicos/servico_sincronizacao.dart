import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'servico_api.dart';
import 'ajudante_bd.dart';

class SyncRequest {
  final String id;
  final String
      type; // 'SYNC_CLIENTS', 'REGISTER_SALE', 'REGISTER_NONSALE', 'REGISTER_APPOINTMENT', 'SUBMIT_COST', etc
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  int retryCount;
  String? lastError;
  bool isSyncing = false;

  SyncRequest({
    required this.id,
    required this.type,
    required this.payload,
    required this.createdAt,
    this.retryCount = 0,
    this.lastError,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'payload': payload,
        'createdAt': createdAt.toIso8601String(),
        'retryCount': retryCount,
        'lastError': lastError,
      };

  factory SyncRequest.fromJson(Map<String, dynamic> json) => SyncRequest(
        id: json['id']?.toString() ?? SyncService.generateUuid(),
        type: json['type'] ?? '',
        payload: json['payload'] is Map<String, dynamic> ? json['payload'] : {},
        createdAt: json['createdAt'] != null
            ? DateTime.tryParse(json['createdAt']) ?? DateTime.now()
            : DateTime.now(),
        retryCount: json['retryCount'] is int ? json['retryCount'] : 0,
        lastError: json['lastError'],
      );
}

class SyncService extends ChangeNotifier {
  final ApiService apiService;
  final bool Function(String path)? fileExistsChecker;
  final Future<bool> Function(String key, String value)? storageWriter;
  final Future<Directory> Function()? controlledDirProvider;

  List<SyncRequest> _pendingRequests = [];
  Timer? _retryTimer;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  late final Future<void> _initialization;
  bool _isOnline = true;
  static const int maxRetries = 5;

  String? _controlledDirectoryCanonical;

  // Fila sequencial (mutex) para serialização de operações concorrentes
  Future<void> _queueLock = Future.value();

  Future<T> _synchronized<T>(Future<T> Function() criticalSection) {
    final completer = Completer<T>();
    _queueLock = _queueLock.then((_) async {
      try {
        final result = await criticalSection();
        completer.complete(result);
      } catch (e, st) {
        completer.completeError(e, st);
      }
    });
    return completer.future;
  }

  /// Gera UUID v4 padrão RFC 4122 com entropia criptograficamente segura.
  static String generateUuid() {
    final rnd = Random.secure();
    final bytes = List<int>.generate(16, (_) => rnd.nextInt(256));
    bytes[6] = (bytes[6] & 0x0F) | 0x40; // Versão 4
    bytes[8] = (bytes[8] & 0x3F) | 0x80; // Variante RFC 4122
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}';
  }

  List<SyncRequest> get pendingRequests => List.unmodifiable(_pendingRequests);
  bool get isOnline => _isOnline;
  String? get controlledDirectoryCanonical => _controlledDirectoryCanonical;

  bool _checkFileExists(String path) {
    if (fileExistsChecker != null) {
      return fileExistsChecker!(path);
    }
    try {
      return File(path).existsSync();
    } catch (_) {
      return false;
    }
  }

  /// Resolve o caminho canônico do diretório controlado na inicialização da instância.
  Future<void> _resolveControlledDirectory() async {
    try {
      Directory dir;
      if (controlledDirProvider != null) {
        dir = await controlledDirProvider!();
      } else if (WidgetsBinding.instance.runtimeType.toString().contains('Test')) {
        dir = Directory(
            '${Directory.systemTemp.path}${Platform.pathSeparator}pending_receipts');
      } else {
        final supportDir = await getApplicationSupportDirectory();
        dir = Directory(
            '${supportDir.path}${Platform.pathSeparator}pending_receipts');
      }
      if (!dir.existsSync()) {
        await dir.create(recursive: true);
      }
      try {
        _controlledDirectoryCanonical = p.canonicalize(dir.resolveSymbolicLinksSync());
      } catch (_) {
        _controlledDirectoryCanonical = p.canonicalize(dir.absolute.path);
      }
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Falha ao resolver diretório controlado (falha fechada): $e');
      }
      _controlledDirectoryCanonical = null;
    }
  }

  /// Valida se o caminho canônico real do arquivo é descendente estrito do diretório controlado.
  /// Falha de forma estritamente fechada caso a raiz não esteja disponível.
  bool isPathInsideControlledDirectory(String path) {
    if (path.trim().isEmpty) return false;
    if (_controlledDirectoryCanonical == null ||
        _controlledDirectoryCanonical!.isEmpty) {
      return false; // Falha fechada
    }

    // 1. Bloqueio de tentativas de travessia léxica ../ ou ..\
    final normSlashes = path.replaceAll('\\', '/');
    if (normSlashes.contains('/../') ||
        normSlashes.contains('/..') ||
        normSlashes.endsWith('/..') ||
        normSlashes.startsWith('../') ||
        normSlashes == '..') {
      return false;
    }

    try {
      final canonRoot = p.canonicalize(_controlledDirectoryCanonical!);
      String canonTarget;
      final file = File(path);
      try {
        if (file.existsSync()) {
          canonTarget = p.canonicalize(file.resolveSymbolicLinksSync());
        } else {
          canonTarget = p.canonicalize(file.absolute.path);
        }
      } catch (_) {
        canonTarget = p.canonicalize(file.absolute.path);
      }

      // Exige que o arquivo seja estritamente descendente da raiz canônica
      return p.isWithin(canonRoot, canonTarget);
    } catch (_) {
      return false;
    }
  }

  /// Remove com segurança apenas arquivos validados dentro da raiz controlada canônica
  Future<void> _safeDeleteControlledReceipt(String? path) async {
    if (path == null || path.trim().isEmpty) return;
    if (!isPathInsideControlledDirectory(path)) {
      if (kDebugMode) {
        print(
            '[SyncService] Segurança: exclusão de arquivo fora da raiz controlada bloqueada: $path');
      }
      return;
    }
    try {
      final file = File(path);
      if (await file.exists()) {
        await file.delete();
        if (kDebugMode) {
          print(
              '[SyncService] Comprovante local da pasta controlada excluído: $path');
        }
      }
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao excluir comprovante controlado: $e');
      }
    }
  }

  bool isLegacyRequest(SyncRequest req) {
    if (req.type == 'REGISTER_SALE') {
      final path = req.payload['pendingReceiptPath'] as String?;
      if (path == null || path.trim().isEmpty) return true;
      return !_checkFileExists(path);
    }
    return false;
  }

  List<SyncRequest> get syncableRequests =>
      _pendingRequests.where((req) => !isLegacyRequest(req)).toList();

  List<SyncRequest> get legacyRequests =>
      _pendingRequests.where((req) => isLegacyRequest(req)).toList();

  bool _isDisposed = false;

  @visibleForTesting
  Timer? get retryTimer => _retryTimer;

  @visibleForTesting
  bool get isSyncing => _isSyncing;

  @visibleForTesting
  Future<void> setOnlineForTesting(bool online, {bool triggerSync = true}) async {
    await _initialization;
    final wasOffline = !_isOnline;
    _isOnline = online;
    _safeNotifyListeners();

    if (triggerSync && wasOffline && _isOnline && _pendingRequests.isNotEmpty) {
      await syncAllPending();
    }
  }

  void _safeNotifyListeners() {
    if (!_isDisposed) {
      notifyListeners();
    }
  }

  @visibleForTesting
  static int calculateBackoff(int retryLevel) {
    return (15 * (1 << (retryLevel > 3 ? 3 : retryLevel))).clamp(15, 120);
  }

  SyncService(
    this.apiService, {
    bool? initialOnline,
    this.fileExistsChecker,
    this.storageWriter,
    this.controlledDirProvider,
  }) {
    if (initialOnline != null) _isOnline = initialOnline;
    _initialization = _initService();
  }

  Future<void> _initService() async {
    await _resolveControlledDirectory();
    await _loadPendingRequests();
    if (!WidgetsBinding.instance.runtimeType.toString().contains('Test')) {
      _initConnectivityListener();
    }
    if (_pendingRequests.isNotEmpty && _isOnline && !_isDisposed) {
      syncAllPending();
    }
  }

  void _initConnectivityListener() {
    _connectivitySubscription = Connectivity()
        .onConnectivityChanged
        .listen((List<ConnectivityResult> results) {
      final hasConnection = results.any((r) => r != ConnectivityResult.none);
      final wasOffline = !_isOnline;
      _isOnline = hasConnection;
      _safeNotifyListeners();

      if (wasOffline && _isOnline && _pendingRequests.isNotEmpty) {
        if (kDebugMode) {
          print(
              '[SyncService] Conexão restabelecida com ${_pendingRequests.length} pendências! Iniciando sincronização.');
        }
        syncAllPending();
      }
    });
  }

  @override
  void dispose() {
    _isDisposed = true;
    _cancelRetryTimer();
    _connectivitySubscription?.cancel();
    super.dispose();
  }

  void _cancelRetryTimer() {
    _retryTimer?.cancel();
    _retryTimer = null;
  }

  void _scheduleNextRetry() {
    _cancelRetryTimer();
    if (_pendingRequests.isEmpty || !_isOnline) return;

    int maxRetryLevel = 0;
    for (var req in _pendingRequests) {
      if (req.retryCount > maxRetryLevel) maxRetryLevel = req.retryCount;
    }

    final delaySeconds =
        (15 * (1 << (maxRetryLevel > 3 ? 3 : maxRetryLevel))).clamp(15, 120);

    if (kDebugMode) {
      print(
          '[SyncService] Agendando próxima tentativa de sync para daqui a ${delaySeconds}s');
    }

    _retryTimer = Timer(Duration(seconds: delaySeconds), () {
      _retryTimer = null;
      if (_isOnline && _pendingRequests.isNotEmpty) {
        syncAllPending();
      }
    });
  }

  Future<void> _loadPendingRequests() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String? data = prefs.getString('offline_backups');
      if (data != null) {
        final List<dynamic> decoded = json.decode(data);
        _pendingRequests = decoded.map((e) => SyncRequest.fromJson(e)).toList();
        _safeNotifyListeners();
      }
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao carregar fila de sync: $e');
      }
    }
  }

  /// Persiste a fila de requisições de forma atômica e retorna booleano do storage.
  Future<bool> _persistQueue(List<SyncRequest> queue) async {
    try {
      final String encoded = json.encode(queue.map((e) => e.toJson()).toList());
      if (storageWriter != null) {
        final ok = await storageWriter!('offline_backups', encoded);
        return ok == true;
      }
      final prefs = await SharedPreferences.getInstance();
      final ok = await prefs.setString('offline_backups', encoded);
      return ok == true;
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Falha ao persistir fila offline: $e');
      }
      return false;
    }
  }

  /// Adiciona uma nova requisição na fila offline com persistência serializada e atômica.
  Future<bool> addPendingRequest(
      String type, Map<String, dynamic> payload) async {
    await _initialization;
    return _synchronized(() async {
      final oldReceiptsToDelete = <String>[];

      // Venda sem arquivo de comprovante local válido não pode entrar na fila offline
      if (type == 'REGISTER_SALE') {
        final pendingReceiptPath = payload['pendingReceiptPath'] as String?;
        if (pendingReceiptPath == null ||
            pendingReceiptPath.trim().isEmpty ||
            !_checkFileExists(pendingReceiptPath) ||
            !isPathInsideControlledDirectory(pendingReceiptPath)) {
          if (kDebugMode) {
            print(
                '[SyncService] Venda sem arquivo de comprovante válido na pasta controlada não pode ser enfileirada offline.');
          }
          return false;
        }

        // Se já existia pendência deste cliente, coleta o caminho antigo para remoção posterior à persistência
        if (payload['clientId'] != null) {
          final existingSales = _pendingRequests
              .where((request) =>
                  request.type == 'REGISTER_SALE' &&
                  request.payload['clientId']?.toString() ==
                      payload['clientId']?.toString())
              .toList();

          for (final oldSale in existingSales) {
            final oldPath = oldSale.payload['pendingReceiptPath'] as String?;
            if (oldPath != null && oldPath != pendingReceiptPath) {
              oldReceiptsToDelete.add(oldPath);
            }
          }
        }
      }

      // 1. Monta a lista candidata
      final candidate = List<SyncRequest>.from(_pendingRequests);
      if (type == 'REGISTER_SALE' && payload['clientId'] != null) {
        candidate.removeWhere((request) =>
            request.type == 'REGISTER_SALE' &&
            request.payload['clientId']?.toString() ==
                payload['clientId']?.toString());
      }

      final req = SyncRequest(
        id: generateUuid(),
        type: type,
        payload: payload,
        createdAt: DateTime.now(),
        retryCount: 0,
      );
      candidate.add(req);

      // 2. Persiste a lista candidata e checa o retorno real
      final persistSuccess = await _persistQueue(candidate);
      if (!persistSuccess) {
        if (kDebugMode) {
          print(
              '[SyncService] Falha na persistência atômica da fila. Estado e arquivos anteriores preservados.');
        }
        return false;
      }

      // 3. Atualiza o estado em memória somente após confirmação da persistência
      _pendingRequests = candidate;
      _safeNotifyListeners();

      // 4. Somente após a fila ser persistida com sucesso, apaga os comprovantes antigos substituídos
      for (final oldPath in oldReceiptsToDelete) {
        await _safeDeleteControlledReceipt(oldPath);
      }

      // Também persiste no SQLite local através do DbHelper (não-bloqueante fora de testes)
      if (!WidgetsBinding.instance.runtimeType.toString().contains('Test')) {
        try {
          await DbHelper.instance.insertSyncTask('/$type', 'POST', payload);
        } catch (_) {}
      }

      if (_isOnline) {
        // Dispara sync em background sem bloquear o retorno imediato do addPendingRequest
        unawaited(syncAllPending());
      } else {
        _scheduleNextRetry();
      }

      return true;
    });
  }

  /// Remove manualmente um envio pendente com serialização atômica.
  Future<bool> removePendingRequest(String id) async {
    await _initialization;
    return _synchronized(() async {
      final toRemove = _pendingRequests.where((e) => e.id == id).toList();
      if (toRemove.isEmpty) return true;

      final candidate = _pendingRequests.where((e) => e.id != id).toList();
      final persistSuccess = await _persistQueue(candidate);
      if (!persistSuccess) {
        if (kDebugMode) {
          print(
              '[SyncService] Falha ao persistir remoção de pendência. Fila e arquivos preservados.');
        }
        return false;
      }

      _pendingRequests = candidate;
      _safeNotifyListeners();

      for (final req in toRemove) {
        if (req.type == 'REGISTER_SALE') {
          final path = req.payload['pendingReceiptPath'] as String?;
          await _safeDeleteControlledReceipt(path);
        }
      }

      if (_pendingRequests.isEmpty) {
        _cancelRetryTimer();
      }
      return true;
    });
  }

  Future<bool> removeLegacyRequests() async {
    await _initialization;
    return _synchronized(() async {
      final candidate =
          _pendingRequests.where((e) => !isLegacyRequest(e)).toList();
      final persistSuccess = await _persistQueue(candidate);
      if (!persistSuccess) {
        return false;
      }
      _pendingRequests = candidate;
      _safeNotifyListeners();
      if (_pendingRequests.isEmpty) {
        _cancelRetryTimer();
      }
      return true;
    });
  }

  bool _isSyncing = false;

  Future<void> syncAllPending() async {
    await _initialization;
    return _synchronized(() async {
      if (_isSyncing || _pendingRequests.isEmpty || !_isOnline) return;
      _isSyncing = true;

      try {
        final requestsToSync = List<SyncRequest>.from(_pendingRequests);
        bool hasChanges = false;
        bool hasErrors = false;

        for (var req in requestsToSync) {
          if (isLegacyRequest(req)) {
            req.lastError =
                'Registro antigo sem a fotografia do comprovante. Não pode ser enviado automaticamente.';
            hasChanges = true;
            continue;
          }

          if (req.retryCount >= maxRetries) continue;
          if (req.isSyncing) continue;

          req.isSyncing = true;
          bool success = false;
          String? failureError;

          try {
            if (req.type == 'SYNC_CLIENTS') {
              await apiService.syncClients([req.payload]);
              success = true;
            } else if (req.type == 'REGISTER_SALE') {
              final pendingReceiptPath =
                  req.payload['pendingReceiptPath'] as String?;
              if (pendingReceiptPath != null &&
                  pendingReceiptPath.isNotEmpty &&
                  _checkFileExists(pendingReceiptPath)) {
                await apiService.registerSaleWithReceipt(
                    req.payload, pendingReceiptPath);

                // Persistência transacional da remoção do item antes de apagar a foto
                final candidate =
                    _pendingRequests.where((e) => e.id != req.id).toList();
                final persistOk = await _persistQueue(candidate);
                if (persistOk) {
                  _pendingRequests = candidate;
                  _safeNotifyListeners();
                  await _safeDeleteControlledReceipt(pendingReceiptPath);
                  success = true;
                } else {
                  throw StateError(
                      'Falha ao persistir remoção do item sincronizado. Comprovante preservado.');
                }
              } else {
                throw StateError('Comprovante local ausente ou inacessível.');
              }
            } else if (req.type == 'UPLOAD_RECEIPT') {
              final saleId = req.payload['saleId']?.toString();
              final filePath = req.payload['filePath']?.toString();
              if (saleId != null &&
                  filePath != null &&
                  !saleId.startsWith('offline_')) {
                await apiService.uploadSaleReceipt(saleId, filePath);
                success = true;
              } else {
                success = true;
              }
            } else if (req.type == 'REGISTER_NONSALE') {
              await apiService.registerNonSale(req.payload);
              success = true;
            } else if (req.type == 'REGISTER_APPOINTMENT') {
              await apiService.registerAppointment(req.payload);
              success = true;
            } else if (req.type == 'SUBMIT_COST') {
              await apiService.submitCost(req.payload);
              success = true;
            }
          } catch (e) {
            hasErrors = true;
            failureError = e.toString();
            if (e is ApiRequestException && !e.retryable) {
              req.retryCount = maxRetries;
            }
            if (kDebugMode) {
              print(
                  '[SyncService] Falha ao sincronizar requisição ${req.id} (Tentativa ${req.retryCount + 1}): $e');
            }
          } finally {
            req.isSyncing = false;
          }

          if (success) {
            _pendingRequests.removeWhere((e) => e.id == req.id);
            hasChanges = true;
          } else {
            req.retryCount += 1;
            req.lastError = failureError;
            hasChanges = true;
          }
        }

        if (_pendingRequests.isEmpty) {
          _cancelRetryTimer();
        } else if (hasErrors && syncableRequests.isNotEmpty) {
          _scheduleNextRetry();
        }

        if (hasChanges) {
          await _persistQueue(_pendingRequests);
        }
      } finally {
        _isSyncing = false;
      }
    });
  }
}
