import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'servico_api.dart';

class SyncRequest {
  final String id;
  final String type; // 'SYNC_CLIENTS', 'REGISTER_SALE', 'REGISTER_NONSALE', 'REGISTER_APPOINTMENT', 'SUBMIT_COST', etc
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  bool isSyncing = false;

  SyncRequest({
    required this.id,
    required this.type,
    required this.payload,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'payload': payload,
    'createdAt': createdAt.toIso8601String(),
  };

  factory SyncRequest.fromJson(Map<String, dynamic> json) => SyncRequest(
    id: json['id'],
    type: json['type'],
    payload: json['payload'],
    createdAt: DateTime.parse(json['createdAt']),
  );
}

class SyncService extends ChangeNotifier {
  final ApiService apiService;
  List<SyncRequest> _pendingRequests = [];
  Timer? _timer;
  bool _isAutoSyncRunning = false;

  List<SyncRequest> get pendingRequests => _pendingRequests;

  SyncService(this.apiService) {
    _loadPendingRequests();
    startAutoSync();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void startAutoSync() {
    if (_isAutoSyncRunning) return;
    _isAutoSyncRunning = true;
    _timer = Timer.periodic(const Duration(seconds: 10), (_) {
      syncAllPending();
    });
  }

  Future<void> _loadPendingRequests() async {
    final prefs = await SharedPreferences.getInstance();
    final String? data = prefs.getString('offline_backups');
    if (data != null) {
      final List<dynamic> decoded = json.decode(data);
      _pendingRequests = decoded.map((e) => SyncRequest.fromJson(e)).toList();
      notifyListeners();
    }
  }

  Future<void> _savePendingRequests() async {
    final prefs = await SharedPreferences.getInstance();
    final String encoded = json.encode(_pendingRequests.map((e) => e.toJson()).toList());
    await prefs.setString('offline_backups', encoded);
    notifyListeners();
  }

  Future<void> addPendingRequest(String type, Map<String, dynamic> payload) async {
    final req = SyncRequest(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      type: type,
      payload: payload,
      createdAt: DateTime.now(),
    );
    _pendingRequests.add(req);
    await _savePendingRequests();
  }

  Future<void> removePendingRequest(String id) async {
    _pendingRequests.removeWhere((e) => e.id == id);
    await _savePendingRequests();
  }

  Future<void> syncAllPending() async {
    if (_pendingRequests.isEmpty) return;
    
    // Create a copy to iterate
    final requestsToSync = List<SyncRequest>.from(_pendingRequests);
    bool hasChanges = false;

    for (var req in requestsToSync) {
      if (req.isSyncing) continue;
      req.isSyncing = true;
      
      bool success = false;
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
        // If other types are needed, add here
      } catch (e) {
        // Failed to sync (maybe still offline)
        print("Failed to sync request ${req.id}: $e");
      } finally {
        req.isSyncing = false;
      }

      if (success) {
        _pendingRequests.removeWhere((e) => e.id == req.id);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await _savePendingRequests();
    }
  }
}
