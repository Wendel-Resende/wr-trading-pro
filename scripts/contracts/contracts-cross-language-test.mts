import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { WireContractV1Schema } from "../../src/contracts/v1/index.ts";

const valid = JSON.parse(readFileSync("contracts/fixtures/v1/valid.json", "utf8"));
const invalid: Array<{name: string; payload: unknown}> = JSON.parse(readFileSync("contracts/fixtures/v1/invalid.json", "utf8"));
const normalized = valid.map((payload: unknown) => WireContractV1Schema.parse(payload));
assert.equal(normalized.length, 8);

const tsInvalidResults = invalid.map((fixture) => ({
  name: fixture.name,
  accepted: WireContractV1Schema.safeParse(fixture.payload).success,
}));
for (const result of tsInvalidResults) assert.equal(result.accepted, false, `TS aceitou inválido: ${result.name}`);

const numericCases: Array<[string, number, string, number]> = [];
for (const special of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  numericCases.push(["signal", 0, "confidence", special]);
  for (const fixtureIndex of [3, 4]) {
    for (const field of ["quantity", "limitPrice", "stopLoss", "takeProfit"]) numericCases.push([fixtureIndex === 3 ? "proposal" : "draft", fixtureIndex, field, special]);
  }
}
for (const [kind, fixtureIndex, field, special] of numericCases) {
  const payload = structuredClone(valid[fixtureIndex]);
  payload[field] = special;
  assert.equal(WireContractV1Schema.safeParse(payload).success, false, `TS aceitou ${String(special)} em ${kind}.${field}`);
}
for (const [fixtureIndex, fields] of [[0, ["confidence"]], [3, ["quantity", "limitPrice", "stopLoss", "takeProfit"]], [4, ["quantity", "limitPrice", "stopLoss", "takeProfit"]]] as const) {
  for (const field of fields) {
    const payload = structuredClone(valid[fixtureIndex]);
    payload[field] = true;
    assert.equal(WireContractV1Schema.safeParse(payload).success, false, `TS aceitou bool em ${payload.kind}.${field}`);
  }
}

const python = spawnSync("python", ["scripts/contracts/python_contract_runner.py"], { encoding: "utf8", cwd: process.cwd() });
assert.equal(python.status, 0, python.stderr || python.stdout);
const pythonResult = JSON.parse(python.stdout);
assert.deepEqual(pythonResult.normalizedValid, normalized, "round-trip Python/TS divergiu");
assert.equal(pythonResult.invalidResults.length, invalid.length);
for (let index = 0; index < invalid.length; index += 1) {
  const py = pythonResult.invalidResults[index];
  const ts = tsInvalidResults[index];
  assert.equal(py.name, ts.name, `ordem/nome divergiu no inválido ${index}`);
  assert.equal(py.accepted, ts.accepted, `decisão Python/Zod divergiu: ${ts.name}`);
  assert.equal(typeof py.error, "string", `Python não retornou erro para ${ts.name}`);
}
console.log(`contracts v1: ${normalized.length} válidos normalizados e ${invalid.length} inválidos comparados caso a caso em Zod/Pydantic; ${numericCases.length + 9} casos numéricos TS programáticos rejeitados`);
