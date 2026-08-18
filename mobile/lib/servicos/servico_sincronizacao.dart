import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'servico_api.dart';
import 'ajudante_bd.dart';

class SyncRequest {
  final String id;
  final String type; // 'SYNC_CLIENTS', 'REGISTER_SALE', 'REGISTER_NONSALE', 'REGISTER_APPOINTMENT', 'SUBMIT_COST', etc
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
    id: json['id']?.toString() ?? DateTime.now().millisecondsSinceEpoch.toString(),
    type: json['type'] ?? '',
    payload: json['payload'] is Map<String, dynamic> ? json['payload'] : {},
    createdAt: json['createdAt'] != null ? DateTime.tryParse(json['createdAt']) ?? DateTime.now() : DateTime.now(),
    retryCount: json['retryCount'] is int ? json['retryCount'] : 0,
    lastError: json['lastError'],
  );
}

class SyncService extends ChangeNotifier {
  final ApiService apiService;
  List<SyncRequest> _pendingRequests = [];
  Timer? _timer;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  bool _isAutoSyncRunning = false;
  bool _isOnline = true;
  static const int maxRetries = 5;

  List<SyncRequest> get pendingRequests => _pendingRequests;
  bool get isOnline => _isOnline;

  SyncService(this.apiService) {
    _initConnectivityListener();
    _loadPendingRequests();
    startAutoSync();
  }

  void _initConnectivityListener() {
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen((List<ConnectivityResult> results) {
      final hasConnection = results.any((r) => r != ConnectivityResult.none);
      final wasOffline = !_isOnline;
      _isOnline = hasConnection;
      notifyListeners();

      // Dispara sincronização imediatamente ao recuperar conectividade
      if (wasOffline && _isOnline) {
        if (kDebugMode) {
          print('[SyncService] Conexão restabelecida! Iniciando sincronização da fila.');
        }
        syncAllPending();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _connectivitySubscription?.cancel();
    super.dispose();
  }

  void startAutoSync() {
    if (_isAutoSyncRunning) return;
    _isAutoSyncRunning = true;
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_isOnline) {
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
        notifyListeners();
      }
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao carregar fila de sync: $e');
      }
    }
  }

  Future<void> _savePendingRequests() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String encoded = json.encode(_pendingRequests.map((e) => e.toJson()).toList());
      await prefs.setString('offline_backups', encoded);
      notifyListeners();
    } catch (e) {
      if (kDebugMode) {
        print('[SyncService] Erro ao salvar fila de sync: $e');
      }
    }
  }

  Future<void> addPendingRequest(String type, Map<String, dynamic> payload) async {
    final req = SyncRequest(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      type: type,
      payload: payload,
      createdAt: DateTime.now(),
      retryCount: 0,
    );
    _pendingRequests.add(req);
    await _savePendingRequests();

    // Também persiste no SQLite local através do DbHelper
    try {
      await DbHelper.instance.insertSyncTask('/$type', 'POST', payload);
    } catch (_) {}

    if (_isOnline) {
      syncAllPending();
    }
  }

  Future<void> removePendingRequest(String id) async {
    _pendingRequests.removeWhere((e) => e.id == id);
    await _savePendingRequests();
  }

  bool _isSyncing = false;

  Future<void> syncAllPending() async {
    if (_isSyncing || _pendingRequests.isEmpty || !_isOnline) return;
    _isSyncing = true;
    
    try {
      final requestsToSync = List<SyncRequest>.from(_pendingRequests);
      bool hasChanges = false;

      for (var req in requestsToSync) {
        // Se excedeu o número máximo de tentativas, ignora para não sobrecarregar
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
            await apiService.registerSale(req.payload);
            success = true;
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
          failureError = e.toString();
          if (kDebugMode) {
            print('[SyncService] Falha ao sincronizar requisição ${req.id} (Tentativa ${req.retryCount + 1}): $e');
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

      if (hasChanges) {
        await _savePendingRequests();
      }
    } finally {
      _isSyncing = false;
    }
  }
}

