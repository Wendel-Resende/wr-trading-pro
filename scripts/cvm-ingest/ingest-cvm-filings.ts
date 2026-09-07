/**
 * Ingestão point-in-time dos filings da CVM.
 *
 * Baixa os pacotes anuais de ITR e DFP do portal de dados abertos, lê
 * APENAS o CSV de cabeçalho de cada um (~500 KB, contra centenas de MB dos
 * arquivos de valores) e popula `Issuer` + `CvmFiling` pelos unit-of-work
 * canônicos, que já existiam e estavam vazios.
 *
 * O que entra: protocolo do documento, data de referência, `DT_RECEB`
 * (entrega real, no lugar do prazo legal presumido) e a cadeia de
 * retificação por `VERSAO`.
 *
 * O que NÃO entra: `CvmFact` (valores contábeis). Ver o docblock de
 * `src/lib/server/cvm-header-parser.ts` para o porquê e para o limite
 * intransponível — a CVM só publica a versão corrente dos valores, então a
 * história anterior a esta primeira execução é irrecuperável.
 *
 * Uso:
 *   npm run cvm:ingest                    # todos os anos disponíveis
 *   npm run cvm:ingest -- --from 2020     # a partir de um ano
 *   npm run cvm:ingest -- --dry-run       # baixa, parseia e relata, sem gravar
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { parseCvmHeaderCsv, type CvmHeaderParseResult } from '../../src/lib/server/cvm-header-parser';
import { PrismaCvmIngestionUnitOfWork } from '../../src/adapters/prisma/cvm/unit-of-work';
import { PrismaReferenceDataIngestionUnitOfWork } from '../../src/adapters/prisma/reference-data/unit-of-work';
import type { CvmFilingSubmission } from '../../src/domain/v1/models/cvm-filing';
import type { IssuerRegistration } from '../../src/domain/v1/models/issuer';

const BASE_URL = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC';
/** A CVM publica ITR e DFP a partir de 2011. */
const FIRST_YEAR = 2011;

interface Package {
  readonly kind: 'ITR' | 'DFP';
  readonly year: number;
  readonly url: string;
  readonly headerCsv: string;
}

function packagesFor(fromYear: number, toYear: number): readonly Package[] {
  const out: Package[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const kind of ['ITR', 'DFP'] as const) {
      const slug = kind.toLowerCase();
      out.push({
        kind,
        year,
        url: `${BASE_URL}/${kind}/DADOS/${slug}_cia_aberta_${year}.zip`,
        headerCsv: `${slug}_cia_aberta_${year}.csv`,
      });
    }
  }
  return out;
}

/**
 * Extrai um único membro do ZIP sem dependência nova: o PowerShell do
 * Windows já traz `System.IO.Compression`. Extrair só o cabeçalho evita
 * descompactar centenas de MB de valores que esta ingestão não usa.
 */
function extractMember(zipPath: string, member: string, outPath: string): boolean {
  const script = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead(${JSON.stringify(zipPath)})
    try {
      $entry = $zip.Entries | Where-Object { $_.Name -eq ${JSON.stringify(member)} }
      if (-not $entry) { exit 3 }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, ${JSON.stringify(outPath)}, $true)
    } finally { $zip.Dispose() }
  `;
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, destination: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) return false;
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  return true;
}

function parseArgs(argv: readonly string[]): { fromYear: number; dryRun: boolean } {
  const fromIndex = argv.indexOf('--from');
  const fromYear = fromIndex >= 0 ? Number(argv[fromIndex + 1]) : FIRST_YEAR;
  if (!Number.isInteger(fromYear) || fromYear < FIRST_YEAR) {
    throw new Error(`--from inválido; a CVM publica a partir de ${FIRST_YEAR}`);
  }
  return { fromYear, dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { fromYear, dryRun } = parseArgs(process.argv.slice(2));
  const toYear = new Date().getUTCFullYear();
  const workDir = mkdtempSync(join(tmpdir(), 'wr-cvm-ingest-'));
  const prisma = new PrismaClient();

  const issuers = new Map<string, IssuerRegistration>();
  // Por PACOTE, não num lote único: o contrato do unit-of-work limita o
  // lote a 10.000 filings, e a história completa passa disso. Uma run por
  // pacote também significa que uma falha em 2019 não desfaz 2011-2018.
  const perPackage: { readonly label: string; readonly filings: readonly CvmFilingSubmission[] }[] = [];
  let skippedRows = 0;
  const unrepresentable: string[] = [];
  const absent: string[] = [];

  try {
    for (const pkg of packagesFor(fromYear, toYear)) {
      const zipPath = join(workDir, `${pkg.kind}-${pkg.year}.zip`);
      const csvPath = join(workDir, pkg.headerCsv);

      // Ano ainda não publicado (ex.: a DFP do ano corrente) não é erro.
      if (!(await download(pkg.url, zipPath))) {
        absent.push(`${pkg.kind} ${pkg.year}`);
        continue;
      }
      if (!extractMember(zipPath, pkg.headerCsv, csvPath)) {
        absent.push(`${pkg.kind} ${pkg.year} (cabeçalho ausente no pacote)`);
        continue;
      }

      const raw = readFileSync(csvPath);
      // Os arquivos da CVM são latin-1; ler como utf-8 corrompe acentos nos
      // nomes das empresas.
      const text = new TextDecoder('latin1').decode(raw);
      const sha = createHash('sha256').update(raw).digest('hex');

      const parsed: CvmHeaderParseResult = parseCvmHeaderCsv(text, sha);
      // O pacote MAIS RECENTE vence, não o mais antigo: os pacotes são
      // percorridos em ordem crescente de ano, e empresas mudam de nome ao
      // longo de 15 anos. O unit-of-work de reference-data proíbe
      // sobrescrever identidade de emissor (SCD-1 destrutivo), então
      // registrar o nome antigo brigaria com a linha já gravada — e o nome
      // corrente é o que serve para reconciliar com a base de hoje.
      for (const issuer of parsed.issuers) issuers.set(issuer.cvmCode, issuer);
      perPackage.push({ label: `${pkg.kind} ${pkg.year}`, filings: parsed.filings });
      skippedRows += parsed.skipped;
      for (const item of parsed.unrepresentable) unrepresentable.push(`${pkg.kind} ${pkg.year}: ${item}`);
      console.log(`${pkg.kind} ${pkg.year}: ${parsed.filings.length} filings, ${parsed.issuers.length} emissores`);
    }

    const filings = perPackage.flatMap((p) => [...p.filings]);
    const restatements = filings.filter((f) => f.isRestatement).length;
    console.log('');
    console.log(`emissores distintos: ${issuers.size}`);
    console.log(`filings: ${filings.length} (retificações: ${restatements}, ${((100 * restatements) / Math.max(filings.length, 1)).toFixed(1)}%)`);
    if (skippedRows > 0) console.log(`linhas puladas (categoria fora de ITR/DFP): ${skippedRows}`);
    if (absent.length > 0) console.log(`pacotes ausentes: ${absent.join(', ')}`);
    if (unrepresentable.length > 0) {
      console.log(`
ITR não representáveis (4º do exercício; o schema só admite 1..3):`);
      for (const item of unrepresentable) console.log(`  ${item}`);
    }

    if (dryRun) {
      console.log('\n--dry-run: nada foi gravado.');
      return;
    }

    // Identidade de emissor é imutável para o unit-of-work de
    // reference-data (SCD-1 destrutivo é proibido), então o lote precisa
    // respeitar o que já está gravado e resolver as ambiguidades do dado
    // ANTES de tentar escrever. Dois conflitos reais aparecem na história
    // completa:
    //
    //  1. Empresas mudam de nome em 15 anos. Um emissor já gravado tem que
    //     entrar no lote com a identidade EXATA que está no banco, ou a
    //     escrita é recusada.
    //  2. `Issuer.cnpj` é único, mas dois códigos CVM distintos podem
    //     carregar o mesmo CNPJ (re-registro). O código CVM é a identidade
    //     de verdade — é ele que os filings referenciam. Quando o CNPJ é
    //     ambíguo, gravar `null` é honesto; escolher um dos dois seria
    //     inventar qual registro é o dono.
    const stored = await prisma.issuer.findMany({ select: { cvmCode: true, cnpj: true, name: true } });
    const storedByCode = new Map(stored.map((i) => [i.cvmCode, i]));
    const takenCnpj = new Map(stored.filter((i) => i.cnpj !== null).map((i) => [i.cnpj as string, i.cvmCode]));

    const cnpjOwners = new Map<string, string[]>();
    for (const issuer of issuers.values()) {
      if (issuer.cnpj == null || storedByCode.has(issuer.cvmCode)) continue;
      const owners = cnpjOwners.get(issuer.cnpj) ?? [];
      owners.push(issuer.cvmCode);
      cnpjOwners.set(issuer.cnpj, owners);
    }

    const ambiguous: string[] = [];
    const resolved: IssuerRegistration[] = [];
    for (const issuer of issuers.values()) {
      const existing = storedByCode.get(issuer.cvmCode);
      if (existing) {
        // Já gravado: repetir a identidade do banco, sem tentar atualizar.
        resolved.push({ cvmCode: existing.cvmCode, name: existing.name, cnpj: existing.cnpj });
        continue;
      }
      const owners = issuer.cnpj == null ? [] : (cnpjOwners.get(issuer.cnpj) ?? []);
      const clashesWithStored = issuer.cnpj != null && takenCnpj.has(issuer.cnpj);
      if (issuer.cnpj != null && (owners.length > 1 || clashesWithStored)) {
        ambiguous.push(`${issuer.cvmCode} (CNPJ ${issuer.cnpj} compartilhado)`);
        resolved.push({ ...issuer, cnpj: null });
        continue;
      }
      resolved.push(issuer);
    }
    if (ambiguous.length > 0) {
      console.log(`
emissores gravados SEM CNPJ (ambíguo entre códigos CVM): ${ambiguous.length}`);
      for (const item of ambiguous.slice(0, 10)) console.log(`  ${item}`);
      if (ambiguous.length > 10) console.log(`  ... e mais ${ambiguous.length - 10}`);
    }

    // Duas transações, nesta ordem e não na inversa: o lote de CVM lança
    // `UnknownIssuerReferenceError` por design — "o lote CVM nunca cria
    // Issuer". Sem emissores gravados antes, todo filing falha.
    const now = new Date().toISOString();
    const referenceUow = new PrismaReferenceDataIngestionUnitOfWork(prisma);
    const referenceRun = await referenceUow.begin('cvm-portal-issuers', now);
    try {
      const referenceSummary = JSON.stringify({ source: 'cvm-portal', issuers: resolved.length, ambiguousCnpj: ambiguous.length, fromYear, toYear });
      await referenceUow.commit(referenceRun, new Date().toISOString(), referenceSummary, {
        issuers: resolved,
        instrumentVersions: [],
      });
    } catch (error) {
      await referenceUow.fail(referenceRun, new Date().toISOString(), JSON.stringify({ stage: 'issuers', failed: true }));
      throw error;
    }
    console.log(`\nemissores gravados (run ${referenceRun})`);

    const cvmUow = new PrismaCvmIngestionUnitOfWork(prisma);
    for (const pkg of perPackage) {
      if (pkg.filings.length === 0) continue;
      const runId = await cvmUow.begin(`cvm-portal-filings:${pkg.label.replace(/\s+/g, '-').toLowerCase()}`, new Date().toISOString());
      try {
        const summary = JSON.stringify({
          source: 'cvm-portal',
          package: pkg.label,
          filings: pkg.filings.length,
          restatements: pkg.filings.filter((f) => f.isRestatement).length,
        });
        await cvmUow.commit(runId, new Date().toISOString(), summary, {
          filings: [...pkg.filings],
          facts: [],
          shareCapitalFacts: [],
        });
        console.log(`${pkg.label}: ${pkg.filings.length} filings gravados (run ${runId})`);
      } catch (error) {
        await cvmUow.fail(runId, new Date().toISOString(), JSON.stringify({ stage: 'filings', package: pkg.label, failed: true }));
        throw error;
      }
    }
  } finally {
    await prisma.$disconnect();
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
