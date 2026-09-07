/**
 * Parser PURO do CSV de cabeçalho dos pacotes anuais da CVM
 * (`itr_cia_aberta_YYYY.csv` / `dfp_cia_aberta_YYYY.csv`).
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * O painel de fundamentos da WR carimba o instante de conhecimento como
 * `data_ref + prazo legal` (+45 dias ITR, +90 dias DFP) porque nunca
 * coletou a data de publicação. O proxy é conservador e não vaza pelo lado
 * do tempo — medido no ITR 2024, a defasagem real tem mediana de 43 dias
 * contra os 45 assumidos.
 *
 * O que ele NÃO cobre é retificação. `fundamental_indicators` guarda uma
 * linha por (empresa, trimestre): quando uma empresa republica, o número
 * novo sobrescreve o antigo e o painel histórico passa a usar o valor
 * retificado como se fosse conhecido na data original. Medido: 11% dos
 * documentos do ITR 2024 são retificação, com mediana de 15 dias e p90 de
 * 94 até a última versão.
 *
 * Este parser traz o que faltava — `DT_RECEB` (entrega real) e `VERSAO`
 * (cadeia de retificação) — para os modelos canônicos `CvmFiling`/`Issuer`,
 * que já existiam no schema e estavam vazios.
 *
 * O QUE ELE NÃO RESOLVE
 * ---------------------
 * Os pacotes anuais da CVM publicam APENAS a versão corrente nos arquivos
 * de valores. Os números originais de um documento retificado não existem
 * mais na fonte, e nenhuma coleta futura os recupera. Este parser dá as
 * datas e o mapa de quem foi retificado e quando; a partir da primeira
 * execução, cada sync acumula point-in-time de verdade. Para trás, a
 * história é o que é.
 *
 * PUREZA
 * ------
 * Sem I/O: recebe texto já decodificado (os arquivos da CVM são latin-1) e
 * devolve estrutura. Download, unzip e decodificação ficam no script.
 */
import type { CvmFilingSubmission } from '../../domain/v1/models/cvm-filing';
import type { IssuerRegistration } from '../../domain/v1/models/issuer';

export class CvmHeaderParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CvmHeaderParseError';
  }
}

export interface CvmHeaderParseResult {
  readonly issuers: readonly IssuerRegistration[];
  readonly filings: readonly CvmFilingSubmission[];
  /** Linhas puladas por categoria fora de ITR/DFP — contadas para não sumirem em silêncio. */
  readonly skipped: number;
  /**
   * ITR além do terceiro no mesmo pacote, que o schema não sabe representar
   * (ITR exige trimestre 1..3). Nomeados, nunca só contados — ver
   * `MAX_ITR_PER_YEAR`.
   */
  readonly unrepresentable: readonly string[];
}

/** Colunas exigidas. Ausência de qualquer uma é erro, nunca campo vazio. */
const REQUIRED_COLUMNS = [
  'CNPJ_CIA',
  'DT_REFER',
  'VERSAO',
  'DENOM_CIA',
  'CD_CVM',
  'CATEG_DOC',
  'ID_DOC',
  'DT_RECEB',
  'LINK_DOC',
] as const;

const SUPPORTED_DOCUMENT_TYPES = new Set(['ITR', 'DFP']);

/** Um exercício social tem no máximo três ITR; o quarto período vira DFP. */
const MAX_ITR_PER_YEAR = 3;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Só dígitos — o `Issuer.cnpj` é único e `00.000.000/0001-91` e `00000000000191` são a mesma empresa. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * `DT_RECEB` vem como data civil (`2024-05-08`), sem hora, e o campo
 * `publishedAt` é `DateTime`. Ancoramos em meia-noite UTC; o desempate
 * abaixo do segundo é aplicado depois, quando a ordem do documento é
 * conhecida (ver `chainOffsetMs`).
 */
function civilDateToInstant(value: string, field: string, line: number): string {
  if (!CIVIL_DATE.test(value)) {
    throw new CvmHeaderParseError(`linha ${line}: ${field} inválido (${value || 'vazio'}); esperado YYYY-MM-DD`);
  }
  return `${value}T00:00:00.000Z`;
}

/**
 * Desloca o instante em `position` MILISSEGUNDOS para que a cadeia de
 * retificação seja estritamente crescente, como o domínio exige.
 *
 * Duas anomalias do dado real tornam isso necessário, e nenhuma é rara:
 *  - 24% dos documentos multiversão têm duas versões entregues NO MESMO
 *    DIA (a ENERGISA entregou v1 e v2 do ITR do 1T2023 em 2023-05-11);
 *  - `VERSAO` NÃO é ordinal confiável: a DIBENS LEASING tem dois
 *    documentos distintos ambos marcados `VERSAO=1`, e há emissor com v1,
 *    v2 e um SEGUNDO v1 entregue meses depois da v2.
 *
 * Por isso a ordem da cadeia sai de `DT_RECEB` primeiro, com `VERSAO` e o
 * protocolo só como desempate estável — a data de entrega é o fato; o
 * número da versão é rótulo, e o dado mostra que o rótulo escorrega.
 *
 * Isto não inventa horário: a data continua exata nos 10 primeiros
 * caracteres, e o milissegundo apenas codifica uma ordem que já é dado.
 */
function chainOffsetMs(instant: string, position: number): string {
  if (position > 999) {
    throw new CvmHeaderParseError(`documento com ${position + 1} versões não cabe no desempate de milissegundos`);
  }
  return `${instant.slice(0, 20)}${String(position).padStart(3, '0')}Z`;
}

function splitCsvLine(line: string): readonly string[] {
  // O arquivo da CVM é separado por ";" e não usa aspas nem escape —
  // verificado nos pacotes de 2023 e 2024.
  return line.split(';').map((cell) => cell.trim());
}

export function parseCvmHeaderCsv(csvText: string, rawSha256: string): CvmHeaderParseResult {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new CvmHeaderParseError('arquivo vazio: nem o cabeçalho foi encontrado');
  }

  const header = splitCsvLine(lines[0]);
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new CvmHeaderParseError(`cabeçalho não tem as colunas exigidas: ${missing.join(', ')}`);
  }
  const indexOf = (column: string): number => header.indexOf(column);

  interface Draft {
    readonly version: number;
    readonly submission: Omit<CvmFilingSubmission, 'isRestatement' | 'supersedesCvmProtocol'>;
  }

  const issuersByCode = new Map<string, IssuerRegistration>();
  // Chave do documento: (emissor, tipo, data de referência). É por ela que
  // as versões de um mesmo documento se agrupam para formar a cadeia.
  const draftsByDocument = new Map<string, Draft[]>();
  let skipped = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const at = (column: string): string => cells[indexOf(column)] ?? '';
    const lineNumber = i + 1;

    const documentType = at('CATEG_DOC').toUpperCase();
    if (!SUPPORTED_DOCUMENT_TYPES.has(documentType)) {
      skipped += 1;
      continue;
    }

    const cvmCode = onlyDigits(at('CD_CVM')).replace(/^0+/, '') || '0';
    const protocol = at('ID_DOC');
    if (protocol.length === 0) {
      throw new CvmHeaderParseError(`linha ${lineNumber}: ID_DOC vazio; o protocolo é a identidade do documento`);
    }

    const referenceDate = at('DT_REFER');
    if (!CIVIL_DATE.test(referenceDate)) {
      throw new CvmHeaderParseError(`linha ${lineNumber}: DT_REFER inválido (${referenceDate || 'vazio'})`);
    }

    const version = Number(at('VERSAO'));
    if (!Number.isInteger(version) || version < 1) {
      throw new CvmHeaderParseError(`linha ${lineNumber}: VERSAO inválida (${at('VERSAO') || 'vazio'})`);
    }

    // O trimestre NÃO sai do mês da data de referência. Empresas com
    // exercício social não-calendário entregam ITR em outros meses: CAMIL
    // (exercício fecha em fevereiro) entrega em mai/ago/nov; JALLES
    // MACHADO, BRASILAGRO e CTC (fecham em março) entregam em jun/set/dez.
    // Derivar pelo mês trataria o ITR de dezembro dessas empresas como erro
    // ou como um T4 que não existe.
    //
    // A regra que vale nos dois casos é a ORDINAL: o trimestre é a posição
    // do ITR entre os ITR daquele emissor no pacote, ordenados por data de
    // referência. Para exercício calendário isso devolve exatamente
    // 03→1, 06→2, 09→3. Atribuído depois do laço, quando o pacote inteiro
    // é conhecido.

    const name = at('DENOM_CIA');
    if (!issuersByCode.has(cvmCode)) {
      const cnpj = onlyDigits(at('CNPJ_CIA'));
      issuersByCode.set(cvmCode, { cvmCode, name, cnpj: cnpj.length > 0 ? cnpj : null });
    }

    const publishedAt = civilDateToInstant(at('DT_RECEB'), 'DT_RECEB', lineNumber);
    const documentKey = `${cvmCode}|${documentType}|${referenceDate}`;
    const drafts = draftsByDocument.get(documentKey) ?? [];
    drafts.push({
      version,
      submission: {
        issuerCvmCode: cvmCode,
        documentType: documentType as CvmFilingSubmission['documentType'],
        cvmProtocol: protocol,
        referenceDate,
        fiscalYear: Number(referenceDate.slice(0, 4)),
        fiscalQuarter: null,
        // A CVM publica uma única data por versão; entrega e publicação
        // são o mesmo evento nesta fonte.
        filedAt: publishedAt,
        publishedAt,
        sourceUrl: at('LINK_DOC'),
        rawSha256,
      },
    });
    draftsByDocument.set(documentKey, drafts);
  }

  // Passo 2a — trimestre por ordinal. Um documento tem várias versões mas
  // uma única data de referência, então o ordinal é contado sobre datas
  // distintas, não sobre linhas.
  const itrDatesByIssuer = new Map<string, Set<string>>();
  for (const drafts of draftsByDocument.values()) {
    const first = drafts[0].submission;
    if (first.documentType !== 'ITR') continue;
    const dates = itrDatesByIssuer.get(first.issuerCvmCode) ?? new Set<string>();
    dates.add(first.referenceDate);
    itrDatesByIssuer.set(first.issuerCvmCode, dates);
  }
  const quarterByIssuerAndDate = new Map<string, number>();
  const unrepresentable: string[] = [];
  for (const [cvmCode, dates] of itrDatesByIssuer) {
    const ordered = [...dates].sort();
    // Dado real de 2011: ITAPEBI, GLOBAL BRASIL e CERAMICA CHIARELLI
    // entregaram QUATRO ITR (03/06/09/12) — um ITR de 4º trimestre, que o
    // schema não sabe representar (ITR exige trimestre 1..3; o quarto
    // período chega por DFP). Os três primeiros mapeiam exatamente; o
    // excedente é descartado e NOMEADO na saída. Falhar o pacote inteiro
    // por causa dele perderia um ano de datas de publicação; escondê-lo
    // seria pior ainda.
    ordered.slice(0, MAX_ITR_PER_YEAR).forEach((date, position) => {
      quarterByIssuerAndDate.set(`${cvmCode}|${date}`, position + 1);
    });
    for (const date of ordered.slice(MAX_ITR_PER_YEAR)) {
      unrepresentable.push(`emissor ${cvmCode} ITR ${date} (${ordered.length} ITR no pacote)`);
    }
  }

  // Passo 2b — a cadeia é montada por versão, não pela ordem do arquivo: o
  // pacote real não vem ordenado, e a v3 sucede a v2, nunca a v1.
  const filings: CvmFilingSubmission[] = [];
  for (const drafts of draftsByDocument.values()) {
    // Ordem por DATA DE ENTREGA; versão e protocolo só desempatam. Ver
    // `chainOffsetMs`: `VERSAO` se repete no dado real, então ordenar por
    // ela produziria empates e até inversões temporais.
    const ordered = [...drafts].sort((a, b) => {
      if (a.submission.publishedAt !== b.submission.publishedAt) {
        return a.submission.publishedAt < b.submission.publishedAt ? -1 : 1;
      }
      if (a.version !== b.version) return a.version - b.version;
      return a.submission.cvmProtocol < b.submission.cvmProtocol ? -1 : 1;
    });
    // Um ITR sem trimestre atribuído é o excedente acima: não entra.
    const first = drafts[0].submission;
    if (first.documentType === 'ITR' && !quarterByIssuerAndDate.has(`${first.issuerCvmCode}|${first.referenceDate}`)) {
      continue;
    }
    ordered.forEach((draft, position) => {
      const predecessor = position > 0 ? ordered[position - 1] : null;
      const publishedAt = chainOffsetMs(draft.submission.publishedAt, position);
      filings.push({
        ...draft.submission,
        filedAt: publishedAt,
        publishedAt,
        fiscalQuarter:
          draft.submission.documentType === 'ITR'
            ? (quarterByIssuerAndDate.get(`${draft.submission.issuerCvmCode}|${draft.submission.referenceDate}`) ?? null)
            : null,
        isRestatement: predecessor !== null,
        supersedesCvmProtocol: predecessor === null ? null : predecessor.submission.cvmProtocol,
      });
    });
  }

  return {
    issuers: [...issuersByCode.values()],
    filings,
    skipped,
    unrepresentable,
  };
}
