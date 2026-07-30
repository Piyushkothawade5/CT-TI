#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createWorker } = require("tesseract.js");

function numericSignature(value) {
  return (String(value || "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

function exactDimensionMatch(expected, actual) {
  const left = numericSignature(expected);
  const right = numericSignature(actual);
  return left.length >= 3 && left.length === right.length && left.every((value, index) => value === right[index]);
}

function consensusDimension(sources, parseDrawingItemFields) {
  const candidates = sources
    .map((source) => parseDrawingItemFields(source).ct_final_dim || "")
    .filter(Boolean);
  const groups = new Map();
  for (const candidate of candidates) {
    const signature = numericSignature(candidate).join("X");
    if (!signature) continue;
    const group = groups.get(signature) || { count: 0, value: candidate };
    group.count += 1;
    groups.set(signature, group);
  }
  const winner = Array.from(groups.values()).sort((left, right) => right.count - left.count)[0];
  return {
    value: winner?.count >= 2 ? winner.value : "",
    agreement: winner?.count || 0,
    candidates,
  };
}

async function main() {
  const casesPath = path.resolve(process.argv[2]);
  const parserPath = path.resolve(process.argv[3]);
  const outputPath = path.resolve(process.argv[4]);
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const { parseDrawingItemFields } = require(parserPath);
  const worker = await createWorker("eng");
  const results = [];

  for (const testCase of cases) {
    await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
    const threshold = await worker.recognize(testCase.threshold_image);
    const original = await worker.recognize(testCase.original_image);
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    const title = await worker.recognize(testCase.title_image);
    const evidence = [testCase.embedded_text, threshold.data.text, original.data.text, title.data.text];
    const consensus = consensusDimension(evidence, parseDrawingItemFields);
    const actual = consensus.value;
    const passed = exactDimensionMatch(testCase.expected, actual);
    const result = {
      case_id: testCase.case_id,
      relative_path: testCase.relative_path,
      family: testCase.family,
      expected: testCase.expected,
      actual,
      passed,
      agreement: consensus.agreement,
      candidates: consensus.candidates,
    };
    results.push(result);
    console.log(`${String(testCase.case_id).padStart(3, "0")} ${passed ? "PASS" : "FAIL"} ${testCase.relative_path} | ${testCase.expected} -> ${actual || "null"}`);
  }
  await worker.terminate();

  const passed = results.filter((result) => result.passed).length;
  const summary = {
    cases: results.length,
    passed,
    failed: results.length - passed,
    exact_match_rate: results.length ? passed / results.length : 0,
    results,
  };
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({ cases: summary.cases, passed: summary.passed, failed: summary.failed, exact_match_rate: summary.exact_match_rate }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
