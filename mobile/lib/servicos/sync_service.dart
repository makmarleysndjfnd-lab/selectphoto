import 'package:connectivity_plus/connectivity_plus.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'ajudante_bd.dart';

class SyncService {
  final String baseUrl = 'http://192.168.1.6:3000/api';
  bool _isSyncing = false;

  void init() {
    Connectivity().onConnectivityChanged.listen((List<ConnectivityResult> results) {
      if (results.isNotEmpty && results.first != ConnectivityResult.none) {
        syncPendingTasks();
      }
    });
  }

  Future<void> syncPendingTasks() async {
    if (_isSyncing) return;
    _isSyncing = true;

    try {
      final dbHelper = DbHelper.instance;
      final tasks = await dbHelper.getPendingSyncTasks();

      for (var task in tasks) {
        final id = task['id'] as int;
        final endpoint = task['endpoint'] as String;
        final method = task['method'] as String;
        final payloadStr = task['payload'] as String;
        final payload = jsonDecode(payloadStr);

        bool success = false;

        // NOTE: Here we should handle multipart if there's a local file path
        // For now, we will handle standard JSON. If the payload has a 'localFile', we would upload it first.
        
        final url = Uri.parse('$baseUrl$endpoint');
        http.Response response;
        
        if (method == 'POST') {
          response = await http.post(
            url,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(payload),
          );
        } else {
          // Add more methods if needed
          response = await http.get(url);
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          success = true;
        }

        if (success) {
          await dbHelper.markTaskSynced(id);
        }
      }
    } catch (e) {
      print('Sync error: $e');
    } finally {
      _isSyncing = false;
    }
  }
}
