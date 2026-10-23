/**
 * Script de auditoria de alinhamento de páginas de memória de 16 KB em arquivos ELF (.so)
 * Inspeciona cada biblioteca compartilhada contida no APK ou diretório nativo.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Função para ler cabeçalhos ELF de um buffer
function checkElfAlignment(buffer, fileName) {
  if (buffer.length < 64) {
    return { fileName, isElf: false, error: 'Arquivo menor que o cabeçalho ELF' };
  }

  // Verifica magic bytes: 0x7F 'E' 'L' 'F'
  if (buffer[0] !== 0x7F || buffer[1] !== 0x45 || buffer[2] !== 0x4C || buffer[3] !== 0x46) {
    return { fileName, isElf: false, error: 'Magic bytes inválidos (não é ELF)' };
  }

  const is64Bit = buffer[4] === 2; // EI_CLASS: 2 = 64-bit
  const isLittleEndian = buffer[5] === 1; // EI_DATA: 1 = Little Endian

  if (!is64Bit) {
    // 32-bit (armeabi-v7a / x86): 16 KB page size aplica-se primordialmente a arquiteturas 64-bit (arm64-v8a / x86_64)
    return { fileName, isElf: true, is64Bit: false, compatible16Kb: true, note: '32-bit (não sujeito a 16 KB obrigatório)' };
  }

  // Ler e_phoff, e_phentsize, e_phnum para 64-bit Little Endian
  const e_phoff = Number(buffer.readBigUInt64LE(32));
  const e_phentsize = buffer.readUInt16LE(54);
  const e_phnum = buffer.readUInt16LE(56);

  const loadSegments = [];
  let minAlign = Infinity;
  let maxAlign = 0;

  for (let i = 0; i < e_phnum; i++) {
    const phOffset = e_phoff + i * e_phentsize;
    if (phOffset + e_phentsize > buffer.length) break;

    const p_type = buffer.readUInt32LE(phOffset); // 1 = PT_LOAD
    if (p_type === 1) {
      const p_vaddr = Number(buffer.readBigUInt64LE(phOffset + 16));
      const p_offset = Number(buffer.readBigUInt64LE(phOffset + 8));
      const p_align = Number(buffer.readBigUInt64LE(phOffset + 48));

      loadSegments.push({ p_offset, p_vaddr, p_align });
      if (p_align < minAlign) minAlign = p_align;
      if (p_align > maxAlign) maxAlign = p_align;
    }
  }

  // Compatibilidade com 16 KB exige alinhamento >= 0x4000 (16384) para todos os segmentos PT_LOAD
  const PAGE_SIZE_16KB = 0x4000;
  const is16KbCompatible = loadSegments.length > 0 && loadSegments.every(seg => seg.p_align >= PAGE_SIZE_16KB);

  return {
    fileName,
    isElf: true,
    is64Bit: true,
    loadSegmentsCount: loadSegments.length,
    minAlign,
    maxAlign,
    minAlignHex: '0x' + minAlign.toString(16),
    maxAlignHex: '0x' + maxAlign.toString(16),
    compatible16Kb: is16KbCompatible,
    details: loadSegments
  };
}

// Extrai e analisa todos os .so de um arquivo zip (APK)
function inspectApkSoFiles(apkPath) {
  console.log(`🔍 [AUDITORIA DE ALINHAMENTO DE 16 KB NO APK]`);
  console.log(`📦 APK: ${apkPath}`);

  if (!fs.existsSync(apkPath)) {
    console.error(`❌ Arquivo não encontrado: ${apkPath}`);
    process.exit(1);
  }

  const AdmZip = require('node:util');
  // Usar buffer do arquivo zip
  const apkBuffer = fs.readFileSync(apkPath);

  // Leitura simples de ZIP central directory
  // Para robustez sem dependências externas, encontrar arquivos no ZIP
  const results = [];
  let offset = 0;

  // Percorrer local file headers
  while (offset < apkBuffer.length - 30) {
    if (apkBuffer.readUInt32LE(offset) === 0x04034b50) { // Local file header signature
      const compressionMethod = apkBuffer.readUInt16LE(offset + 8);
      const compressedSize = apkBuffer.readUInt32LE(offset + 18);
      const uncompressedSize = apkBuffer.readUInt32LE(offset + 22);
      const fileNameLength = apkBuffer.readUInt16LE(offset + 26);
      const extraFieldLength = apkBuffer.readUInt16LE(offset + 28);

      const fileName = apkBuffer.toString('utf8', offset + 30, offset + 30 + fileNameLength);
      const fileDataStart = offset + 30 + fileNameLength + extraFieldLength;

      if (fileName.endsWith('.so') && fileName.startsWith('lib/')) {
        const compressedData = apkBuffer.subarray(fileDataStart, fileDataStart + compressedSize);
        let uncompressedData;

        if (compressionMethod === 0) {
          uncompressedData = compressedData;
        } else if (compressionMethod === 8) {
          try {
            uncompressedData = zlib.inflateRawSync(compressedData);
          } catch (e) {
            uncompressedData = null;
          }
        }

        if (uncompressedData) {
          const res = checkElfAlignment(uncompressedData, fileName);
          results.push(res);
        }
      }

      offset = fileDataStart + compressedSize;
    } else {
      offset++;
    }
  }

  console.log(`\nResultados da verificação de alinhamento (.so):`);
  let all64BitCompatible = true;

  for (const r of results) {
    if (r.is64Bit) {
      const statusIcon = r.compatible16Kb ? '✅' : '⚠️';
      console.log(`${statusIcon} ${r.fileName}: minAlign = ${r.minAlignHex} (${r.minAlign} bytes) -> ${r.compatible16Kb ? '16 KB COMPATÍVEL' : '4 KB PADRÃO (Requer NDK r27+ / -Wl,-z,max-page-size=16384 para Play Store 2026/2027)'}`);
      if (!r.compatible16Kb) all64BitCompatible = false;
    } else {
      console.log(`ℹ️  ${r.fileName}: 32-bit (${r.note})`);
    }
  }

  console.log(`\nResumo:`);
  console.log(`- Total de bibliotecas nativas analisadas: ${results.length}`);
  console.log(`- Status geral 16 KB nativo: ${all64BitCompatible ? '✅ Totalmente compatível' : '⚠️ Contém bibliotecas com alinhamento 4 KB legado'}`);

  return results;
}

const apkPath = process.argv[2] || path.resolve(__dirname, '../mobile/build/app/outputs/flutter-apk/app-release.apk');
inspectApkSoFiles(apkPath);
