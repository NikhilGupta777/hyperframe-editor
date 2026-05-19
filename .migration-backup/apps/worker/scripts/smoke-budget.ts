/**
 * Budget enforcement smoke test. Confirms `assertWithinBudget` throws cleanly
 * when an estimate would push the project over its cap. No infrastructure
 * required.
 */
import { assertWithinBudget, priceText, priceImage, priceRender } from "../src/orchestrator/cost.js";

let failed = 0;

// 1. inside budget
try {
  assertWithinBudget({ budgetUsd: 1.0, spentUsd: 0.2, estimateUsd: 0.05 });
  console.log("PASS  inside budget");
} catch (e) {
  console.error("FAIL  inside budget — should not throw:", e);
  failed++;
}

// 2. would exceed budget
try {
  assertWithinBudget({ budgetUsd: 1.0, spentUsd: 0.95, estimateUsd: 0.1 });
  console.error("FAIL  exceed budget — should have thrown");
  failed++;
} catch {
  console.log("PASS  exceed budget");
}

// 3. price math sanity
const text = priceText("gemini-3.1-pro-preview", 12_000, 4_000);
const img = priceImage("imagen-4.0-fast-generate-001", 3);
const ren = priceRender(45);
const totalText = text.reduce((a, e) => a + e.costUsd, 0);
const expectText = (12000 / 1_000_000) * 1.25 + (4000 / 1_000_000) * 10.0;
if (Math.abs(totalText - expectText) > 1e-6) {
  console.error(`FAIL  text price math: got ${totalText}, expected ${expectText}`);
  failed++;
} else {
  console.log("PASS  text price math");
}
if (Math.abs(img.costUsd - 3 * 0.02) > 1e-6) {
  console.error(`FAIL  image price math: got ${img.costUsd}`);
  failed++;
} else {
  console.log("PASS  image price math");
}
if (Math.abs(ren.costUsd - 45 * 0.001) > 1e-6) {
  console.error(`FAIL  render price math: got ${ren.costUsd}`);
  failed++;
} else {
  console.log("PASS  render price math");
}

if (failed > 0) process.exit(1);
console.log("\nbudget smoke OK.");
