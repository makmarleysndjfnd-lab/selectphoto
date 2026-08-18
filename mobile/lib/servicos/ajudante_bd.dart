import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'dart:convert';

class DbHelper {
  static final DbHelper instance = DbHelper._init();
  static Database? _database;

  DbHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('central_fotografica.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 2,
      onCreate: _createDB,
      onUpgrade: _onUpgradeDB,
    );
  }

  Future<String> getDbPath() async {
    final dbPath = await getDatabasesPath();
    return join(dbPath, 'central_fotografica.db');
  }

  Future<void> _createDB(Database db, int version) async {
    // Sync Queue Table with retry tracking
    await db.execute('''
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        retryCount INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT
      )
    ''');

    // Local Clients
    await db.execute('''
      CREATE TABLE local_clients (
        sequenceNumber TEXT PRIMARY KEY,
        name TEXT,
        phone1 TEXT,
        signaturePath TEXT,
        synced INTEGER DEFAULT 0
      )
    ''');

    // Local Sales
    await db.execute('''
      CREATE TABLE local_sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientId TEXT,
        value REAL,
        city TEXT,
        paymentMethod TEXT,
        date TEXT,
        synced INTEGER DEFAULT 0
      )
    ''');

    // Local Non-Sales
    await db.execute('''
      CREATE TABLE local_nonsales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientId TEXT,
        reason TEXT,
        signaturePath TEXT,
        date TEXT,
        synced INTEGER DEFAULT 0
      )
    ''');
    
    // Local Photos
    await db.execute('''
      CREATE TABLE local_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientId TEXT,
        photoPath TEXT,
        date TEXT,
        synced INTEGER DEFAULT 0
      )
    ''');

    // Local Car Checklists
    await db.execute('''
      CREATE TABLE local_checklists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        carId TEXT,
        mileage INTEGER,
        fuelLevel TEXT,
        damageReport TEXT,
        frontPhotoPath TEXT,
        backPhotoPath TEXT,
        leftPhotoPath TEXT,
        rightPhotoPath TEXT,
        dashboardPhotoPath TEXT,
        date TEXT,
        synced INTEGER DEFAULT 0
      )
    ''');

    // Local Costs
    await db.execute('''
      CREATE TABLE local_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL,
        category TEXT,
        description TEXT,
        paymentMethod TEXT,
        receiptPhotoPath TEXT,
        date TEXT,
        synced INTEGER DEFAULT 0
      )
    ''');
  }

  Future<void> _onUpgradeDB(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      try {
        await db.execute('ALTER TABLE sync_queue ADD COLUMN retryCount INTEGER NOT NULL DEFAULT 0');
      } catch (_) {}
      try {
        await db.execute('ALTER TABLE sync_queue ADD COLUMN lastError TEXT');
      } catch (_) {}
      try {
        await db.execute('ALTER TABLE sync_queue ADD COLUMN updatedAt TEXT');
      } catch (_) {}
    }
  }

  Future<int> insertSyncTask(String endpoint, String method, Map<String, dynamic> payload) async {
    final db = await instance.database;
    final now = DateTime.now().toIso8601String();
    return await db.insert('sync_queue', {
      'endpoint': endpoint,
      'method': method,
      'payload': jsonEncode(payload),
      'status': 'PENDING',
      'retryCount': 0,
      'lastError': null,
      'createdAt': now,
      'updatedAt': now,
    });
  }

  Future<List<Map<String, dynamic>>> getPendingSyncTasks({int maxRetries = 5}) async {
    final db = await instance.database;
    return await db.query(
      'sync_queue',
      where: 'status = ? AND retryCount < ?',
      whereArgs: ['PENDING', maxRetries],
      orderBy: 'createdAt ASC',
    );
  }

  Future<void> markTaskSynced(int id) async {
    final db = await instance.database;
    await db.update(
      'sync_queue',
      {
        'status': 'COMPLETED',
        'updatedAt': DateTime.now().toIso8601String(),
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> recordTaskFailure(int id, String error, {int maxRetries = 5}) async {
    final db = await instance.database;
    final tasks = await db.query('sync_queue', where: 'id = ?', whereArgs: [id]);
    if (tasks.isNotEmpty) {
      final currentRetries = (tasks.first['retryCount'] as int? ?? 0) + 1;
      final newStatus = currentRetries >= maxRetries ? 'FAILED' : 'PENDING';
      await db.update(
        'sync_queue',
        {
          'retryCount': currentRetries,
          'lastError': error,
          'status': newStatus,
          'updatedAt': DateTime.now().toIso8601String(),
        },
        where: 'id = ?',
        whereArgs: [id],
      );
    }
  }

  Future<void> clearCompletedTasks() async {
    final db = await instance.database;
    await db.delete(
      'sync_queue',
      where: 'status = ?',
      whereArgs: ['COMPLETED'],
    );
  }
}

