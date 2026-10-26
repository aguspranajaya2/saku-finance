const assert = require("node:assert/strict");
const { test } = require("node:test");
const loadTypeScript = require("./helpers/load-typescript.cjs");
const parser = loadTypeScript("lib/receipts/parse.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(createWorker) {
  let deadline;
  let timerCleared = false;
  const ocr = loadTypeScript("lib/receipts/ocr.ts", {
    modules: {
      "node:fs/promises": { mkdir: async () => {} },
      "tesseract.js": { createWorker },
      "@/lib/receipts/parse": parser,
    },
    globals: {
      setTimeout: callback => { deadline = callback; return 1; },
      clearTimeout: () => { timerCleared = true; },
    },
  });
  return { recognize: ocr.recognizeReceipt, expire: () => deadline(), cleared: () => timerCleared };
}

test("OCR parses the result and always terminates its worker", async () => {
  let terminated = 0;
  const ocr = setup(async () => ({
    recognize: async () => ({ data: { text: "TEST SHOP\n26/10/2026\nTOTAL Rp 25.000", confidence: 91 } }),
    terminate: async () => { terminated++; },
  }));
  const result = await ocr.recognize(Buffer.from("test image"));
  assert.equal(result.amount, 25000);
  assert.equal(result.merchant, "TEST SHOP");
  assert.equal(result.date, "2026-10-26");
  assert.equal(terminated, 1);
  assert.equal(ocr.cleared(), true);
});

test("worker initialization errors reject with a fixed message instead of hanging or leaking details", async () => {
  const ocr = setup((languages, mode, options) => {
    queueMicrotask(() => options.errorHandler(new Error("private OCR detail")));
    return new Promise(() => {});
  });
  await assert.rejects(ocr.recognize(Buffer.alloc(0)), error => error.message === "Receipt OCR failed.");
  assert.equal(ocr.cleared(), true);
});

test("recognition errors are sanitized and the worker is terminated", async () => {
  let terminated = 0;
  const ocr = setup(async () => ({
    recognize: async () => { throw Error("private receipt text"); },
    terminate: async () => { terminated++; },
  }));
  await assert.rejects(ocr.recognize(Buffer.alloc(0)), error => error.message === "Receipt OCR failed.");
  assert.equal(terminated, 1);
});

test("a timed-out initialization rejects and terminates a worker that becomes ready later", async () => {
  let ready;
  let terminated = 0;
  const ocr = setup(() => new Promise(resolve => { ready = resolve; }));
  const result = ocr.recognize(Buffer.alloc(0));
  const rejected = assert.rejects(result, error => error.message === "Receipt OCR timed out.");
  await tick();
  ocr.expire();
  await rejected;
  ready({ terminate: async () => { terminated++; } });
  await tick();
  assert.equal(terminated, 1);
  assert.equal(ocr.cleared(), true);
});

test("worker cleanup errors do not turn a successful receipt into failure", async () => {
  const ocr = setup(async () => ({
    recognize: async () => ({ data: { text: "TEST SHOP\nTOTAL 25000", confidence: 90 } }),
    terminate: async () => { throw Error("cleanup failed"); },
  }));
  assert.equal((await ocr.recognize(Buffer.alloc(0))).amount, 25000);
});

test("only two OCR workers can run at once and capacity returns after termination", async () => {
  const jobs = [];
  let started = 0;
  let terminated = 0;
  const ocr = setup(async () => {
    started++;
    return {
      recognize: () => new Promise(resolve => { jobs.push(resolve); }),
      terminate: async () => { terminated++; },
    };
  });
  const first = ocr.recognize(Buffer.alloc(0));
  const second = ocr.recognize(Buffer.alloc(0));
  await tick();
  await assert.rejects(ocr.recognize(Buffer.alloc(0)), error => error.name === "ReceiptOcrBusyError" && error.message === "Receipt OCR is busy.");
  assert.equal(started, 2);

  const result = { data: { text: "TEST SHOP\nTOTAL 25000", confidence: 90 } };
  jobs[0](result);
  await first;
  const third = ocr.recognize(Buffer.alloc(0));
  await tick();
  assert.equal(started, 3);
  jobs[1](result);
  jobs[2](result);
  await Promise.all([second, third]);
  assert.equal(terminated, 3);
});

test("initialization failures keep slots until still-starting workers settle", async () => {
  const ocr = setup((languages, mode, options) => {
    queueMicrotask(() => options.errorHandler(new Error("private initialization detail")));
    return new Promise(() => {});
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(ocr.recognize(Buffer.alloc(0)), error => error.message === "Receipt OCR failed.");
  }
  await assert.rejects(ocr.recognize(Buffer.alloc(0)), error => error.name === "ReceiptOcrBusyError");
});

test("failed termination retains the slot instead of creating unlimited live workers", async () => {
  let started = 0;
  const ocr = setup(async () => {
    started++;
    return {
      recognize: async () => ({ data: { text: "TOTAL 25000", confidence: 90 } }),
      terminate: async () => { throw new Error("worker did not stop"); },
    };
  });
  await ocr.recognize(Buffer.alloc(0));
  await ocr.recognize(Buffer.alloc(0));
  await assert.rejects(ocr.recognize(Buffer.alloc(0)), error => error.name === "ReceiptOcrBusyError");
  assert.equal(started, 2);
});
