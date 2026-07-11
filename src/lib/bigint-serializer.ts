/**
 * Helper para serializar BigInt em JSON
 * O Prisma retorna alguns campos como BigInt, mas JSON.stringify não consegue serializar BigInt
 */

/**
 * Converte todos os BigInt em uma string recursivamente
 */
export function stringifyBigInt(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return data.toString();
  }

  if (Array.isArray(data)) {
    return data.map(item => stringifyBigInt(item));
  }

  if (typeof data === 'object') {
    const result: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        result[key] = stringifyBigInt(data[key]);
      }
    }
    return result;
  }

  return data;
}

/**
 * JSON.stringify customizado que suporta BigInt
 */
export function safeStringify(obj: any, space?: number): string {
  return JSON.stringify(obj, (_, value) => {
    return typeof value === 'bigint' ? value.toString() : value;
  }, space);
}
