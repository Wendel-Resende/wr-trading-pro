/**
 * Runtime shim para o alias `@/*` (mapeado para `src/*` em tsconfig.json)
 * dentro do output CJS compilado deste harness. O TypeScript resolve
 * "paths" só em tempo de compilação — em runtime, o Node precisa de um
 * resolvedor próprio para o mesmo alias usado pela rota real em
 * src/app/api/mt5/mcp/status/route.ts.
 */
const Module = require('node:module');
const path = require('node:path');

const distSrcRoot = path.join(__dirname, '.dist', 'src');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    const mapped = path.join(distSrcRoot, request.slice(2));
    return originalResolveFilename.call(this, mapped, ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
};
