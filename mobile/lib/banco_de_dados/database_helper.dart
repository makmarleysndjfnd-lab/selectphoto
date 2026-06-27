import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  DatabaseHelper._init();

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
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    // Tabela de Clientes Offline
    await db.execute('''
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        localId TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        cpf TEXT,
        address TEXT,
        latitude REAL,
        longitude REAL,
        signatureBase64 TEXT,
        qrCode TEXT,
        fichaNumber TEXT,
        synced INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      )
    ''');

    // Tabela de Filhos
    await db.execute('''
      CREATE TABLE children (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientLocalId TEXT NOT NULL,
        name TEXT NOT NULL,
        birthDate TEXT NOT NULL,
        school TEXT,
        grade TEXT
      )
    ''');
  }

  // --- Operações de Cliente ---

  Future<int> insertClient(Map<String, dynamic> clientData) async {
    final db = await instance.database;
    return await db.insert('clients', clientData);
  }

  Future<int> insertChild(Map<String, dynamic> childData) async {
    final db = await instance.database;
    return await db.insert('children', childData);
  }

  Future<List<Map<String, dynamic>>> getUnsyncedClients() async {
    final db = await instance.database;
    return await db.query('clients', where: 'synced = ?', whereArgs: [0]);
  }

  Future<List<Map<String, dynamic>>> getChildrenForClient(String clientLocalId) async {
    final db = await instance.database;
    return await db.query('children', where: 'clientLocalId = ?', whereArgs: [clientLocalId]);
  }

  Future<int> markClientAsSynced(String localId) async {
    final db = await instance.database;
    return await db.update('clients', {'synced': 1}, where: 'localId = ?', whereArgs: [localId]);
  }
}
