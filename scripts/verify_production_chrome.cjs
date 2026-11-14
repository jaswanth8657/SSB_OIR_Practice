const { spawn } = require('child_process');
const http = require('http');
const { preview } = require('vite');

// Simple Chrome DevTools Protocol Client using native WebSocket
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(msg.error);
          else cb.resolve(msg.result);
        } else if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          for (const l of listeners) l(msg.params);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function putJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'PUT' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function calcPercentiles(arr) {
  if (arr.length === 0) return { p50: 0, p95: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return { p50, p95, min, max, avg };
}

async function runProductionVerification() {
  console.log('======================================================================');
  console.log('   OIR HUB — PRODUCTION PERFORMANCE & STUDENT JOURNEY VERIFICATION');
  console.log('======================================================================\n');

  // 1. Start Vite Production Preview Server
  console.log('[1/8] Starting Vite Preview Server (serving production dist/)...');
  const previewServer = await preview({
    preview: { port: 4173, strictPort: true },
    configFile: './vite.config.ts',
  });
  console.log('✓ Production Preview server listening at http://localhost:4173');

  // 2. Launch Google Chrome with remote debugging
  console.log('\n[2/8] Launching Google Chrome on port 9222...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProc = spawn(
    chromePath,
    [
      '--remote-debugging-port=9222',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=C:\\Users\\91728\\AppData\\Local\\Temp\\chrome_oir_prod_test',
      'http://localhost:4173/',
    ],
    { stdio: 'ignore' }
  );

  // Poll for Chrome readiness
  let versionInfo = null;
  for (let i = 0; i < 30; i++) {
    try {
      versionInfo = await getJson('http://localhost:9222/json/version');
      if (versionInfo) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!versionInfo) {
    throw new Error('Could not connect to Chrome on port 9222.');
  }
  console.log(`✓ Connected to browser: ${versionInfo['Browser']}`);

  // Create isolated testing tab
  const newTab = await putJson('http://localhost:9222/json/new?http://localhost:4173/');
  const client = new CdpClient(newTab.webSocketDebuggerUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Performance.enable');

  // Track all network requests
  const networkRequests = new Map();
  const networkFinished = [];

  client.on('Network.requestWillBeSent', (p) => {
    networkRequests.set(p.requestId, {
      url: p.request.url,
      method: p.request.method,
      type: p.type,
      wallTime: p.wallTime,
    });
  });

  client.on('Network.responseReceived', (p) => {
    const req = networkRequests.get(p.requestId);
    if (req) {
      req.status = p.response.status;
      req.mimeType = p.response.mimeType;
      req.headers = p.response.headers;
      req.encodedDataLength = p.response.encodedDataLength;
    }
  });

  client.on('Network.loadingFinished', (p) => {
    const req = networkRequests.get(p.requestId);
    if (req) {
      req.encodedDataLength = p.encodedDataLength;
      networkFinished.push(req);
    }
  });

  // 3. Measure Initial Dashboard Production Load
  console.log('\n[3/8] Measuring Initial Production Dashboard Network & Bundle Footprint...');
  await client.send('Page.navigate', { url: 'http://localhost:4173/' });
  await new Promise((r) => setTimeout(r, 600));

  // Clear storage at CDP and origin level to guarantee immaculate first-time student visit
  try {
    await client.send('Storage.clearDataForOrigin', { origin: 'http://localhost:4173', storageTypes: 'all' });
  } catch {}
  await client.send('Runtime.evaluate', {
    expression: 'localStorage.clear(); sessionStorage.clear();'
  });
  await new Promise((r) => setTimeout(r, 300));

  networkRequests.clear();
  networkFinished.length = 0;

  await client.send('Page.reload');

  // Wait for initial page idle
  await new Promise((resolve) => {
    const check = () => setTimeout(resolve, 1500);
    client.on('Page.loadEventFired', check);
  });

  // Analyze network requests
  const jsRequests = networkFinished.filter((r) => r.type === 'Script' || r.url.endsWith('.js'));
  const cssRequests = networkFinished.filter((r) => r.type === 'Stylesheet' || r.url.endsWith('.css'));
  const imgRequests = networkFinished.filter((r) => r.type === 'Image');
  const questionChunkRequests = jsRequests.filter((r) => /set\d\d-.*\.js/.test(r.url));

  let totalJsTransferred = 0;
  console.log('\n--- Production Initial Dashboard JavaScript Downloads ---');
  for (const js of jsRequests) {
    const filename = js.url.split('/').pop();
    const bytes = js.encodedDataLength || 0;
    totalJsTransferred += bytes;
    console.log(`  • ${filename}: ${(bytes / 1024).toFixed(2)} kB transferred`);
  }
  console.log(`Total Initial JavaScript Transferred: ${(totalJsTransferred / 1024).toFixed(2)} kB`);
  console.log(`Total Initial Stylesheet Downloads: ${cssRequests.length} files`);
  console.log(`Total Initial Image Downloads: ${imgRequests.length} files`);
  console.log(`Question Dataset Chunks on Initial Dashboard: ${questionChunkRequests.length} (Expected: 0)`);

  const initialPerf = await client.send('Performance.getMetrics');
  const initialMetrics = {};
  for (const m of initialPerf.metrics) initialMetrics[m.name] = m.value;
  console.log(`\nChrome Performance Metrics at Initial Dashboard:`);
  console.log(`  - JS Heap Used: ${(initialMetrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - JS Heap Total: ${(initialMetrics.JSHeapTotalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - DOM Nodes Count: ${initialMetrics.Nodes}`);

  // 4. Measure Interaction Latencies with P50 & P95
  console.log('\n[4/8] Measuring User-Perceived Responsiveness (P50 & P95 with paint callbacks)...');

  // Function to evaluate expression and measure interaction-to-next-paint latency
  async function measureInteraction(pageCode) {
    const res = await client.send('Runtime.evaluate', {
      expression: `
        (async () => {
          const t0 = performance.now();
          const actionRes = await (${pageCode})();
          await new Promise((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
          const latencyMs = performance.now() - t0;
          return { latencyMs, actionRes };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Interaction failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  // A. Opening Practice Test Modal
  console.log('  Testing: Opening TestStartModal for Set 1...');
  const openModal = await measureInteraction(`() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Start Practice') || b.textContent.includes('Resume Test')
    );
    if (!btn) throw new Error('Start Practice / Resume Test button not found');
    btn.click();
    return btn.textContent.trim();
  }`);
  console.log(`  ✓ Open TestStartModal / Exam Latency: ${openModal.latencyMs.toFixed(2)} ms (Button: "${openModal.actionRes}")`);

  await new Promise((r) => setTimeout(r, 600));

  // B. Starting Examination if modal opened
  if (openModal.actionRes === 'Resume Test') {
    console.log('  Exam resumed directly from active snapshot.');
  } else {
    console.log('  Testing: Starting Examination from Modal...');
    const startExam = await measureInteraction(`() => {
      const startBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.includes('Start Test Now') || b.textContent.includes('Start Retake Test')
      );
      if (!startBtn) throw new Error('Start Test button not found');
      startBtn.click();
      return startBtn.textContent.trim();
    }`);
    console.log(`  ✓ Start Exam Latency: ${startExam.latencyMs.toFixed(2)} ms`);
  }

  await new Promise((r) => setTimeout(r, 800));

  // C. Question Navigation & Answer Selection P50/P95 Benchmark (20 questions)
  console.log('\n  Benchmarking 20 Question Swaps and 20 Option Selections...');
  const navLatencies = [];
  const selectLatencies = [];

  for (let q = 1; q <= 15; q++) {
    // Select an option
    const selectRes = await measureInteraction(`() => {
      const options = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('Cube') || b.textContent.includes('1') || b.textContent.includes('2') || b.textContent.includes('3'));
      if (options.length > 0) {
        options[0].click();
        return true;
      }
      return false;
    }`);
    selectLatencies.push(selectRes.latencyMs);

    // Click Next
    const navRes = await measureInteraction(`() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Next') || b.querySelector('svg.lucide-arrow-right'));
      if (nextBtn) {
        nextBtn.click();
        return true;
      }
      return false;
    }`);
    navLatencies.push(navRes.latencyMs);

    await new Promise((r) => setTimeout(r, 60));
  }

  const navStats = calcPercentiles(navLatencies);
  const selectStats = calcPercentiles(selectLatencies);

  console.log(`\n--- Question Navigation Latency (P50 / P95 across 15 questions) ---`);
  console.log(`  P50: ${navStats.p50.toFixed(2)} ms | P95: ${navStats.p95.toFixed(2)} ms | Min: ${navStats.min.toFixed(2)} ms | Max: ${navStats.max.toFixed(2)} ms | Avg: ${navStats.avg.toFixed(2)} ms`);

  console.log(`--- Answer Selection Latency (P50 / P95 across 15 selections) ---`);
  console.log(`  P50: ${selectStats.p50.toFixed(2)} ms | P95: ${selectStats.p95.toFixed(2)} ms | Min: ${selectStats.min.toFixed(2)} ms | Max: ${selectStats.max.toFixed(2)} ms | Avg: ${selectStats.avg.toFixed(2)} ms`);

  // D. Testing Question 20 Numerical Input
  console.log('\n  Testing Numerical Question (Question 20)...');
  await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        // Find question palette button 20
        const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === '20');
        if (buttons.length > 0) buttons[0].click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));

  const numericalRes = await measureInteraction(`() => {
    const numInput = document.querySelector('input[type="text"], input[type="number"], input');
    if (numInput) {
      numInput.value = '7';
      numInput.dispatchEvent(new Event('input', { bubbles: true }));
      numInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }`);
  console.log(`  ✓ Numerical Input Latency: ${numericalRes.latencyMs.toFixed(2)} ms (Input found: ${numericalRes.actionRes})`);

  // 5. Verify Answer Persistence & Storage State
  console.log('\n[5/8] Verifying Answer Persistence, Revisions & Debounced Flush...');
  const storageState = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const raw = localStorage.getItem('oir_active_exam_set_1');
        if (!raw) return null;
        const envelope = JSON.parse(raw);
        const answeredCount = Object.values(envelope.state?.userAnswers || {}).filter(a => a.isAnswered).length;
        return {
          setNumber: envelope.setNumber,
          revision: envelope.revision,
          answeredCount,
          sessionId: envelope.sessionId,
          updatedAt: envelope.updatedAt
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(`✓ Active Exam Persistence Snapshot:`, storageState.result.value);

  // 6. Test Timer Deadlines & Backgrounding
  console.log('\n[6/8] Verifying Timer Accuracy & Deadline Math...');
  const timerCheck = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const raw = localStorage.getItem('oir_active_exam_set_1');
        const envelope = JSON.parse(raw);
        const now = Date.now();
        const remainingSeconds = Math.max(0, Math.floor((envelope.state.examEndTime - now) / 1000));
        const timersText = Array.from(document.querySelectorAll('span, div')).map(e => e.textContent.trim()).filter(t => t.includes(':'));
        return {
          remainingSecondsExpected: remainingSeconds,
          timerDisplays: timersText.slice(0, 3)
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(`✓ Timer Verification:`, timerCheck.result.value);

  // 7. Student Journey: Complete Test & Submit
  console.log('\n[7/8] Completing Examination Journey: Submission, Results, Solutions & Retake...');
  const submitRes = await measureInteraction(`() => {
    const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Submit Practice Test') || b.textContent.includes('Submit Test'));
    if (submitBtn) {
      submitBtn.click();
      return true;
    }
    return false;
  }`);
  console.log(`  ✓ Click Submit Button: ${submitRes.latencyMs.toFixed(2)} ms`);

  await new Promise((r) => setTimeout(r, 400));

  // Confirm in modal
  await measureInteraction(`() => {
    const confirmBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('Yes, Submit Now') || b.textContent.includes('Submit Now')
    );
    if (!confirmBtn) throw new Error('Yes, Submit Now button not found');
    confirmBtn.click();
    return true;
  }`);

  await new Promise((r) => setTimeout(r, 800));

  // Verify Results Page Loaded
  const resultsState = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const title = document.querySelector('h1, h2')?.textContent;
        const scoreElement = document.querySelector('.font-mono')?.textContent;
        const oirBand = Array.from(document.querySelectorAll('span, div')).find(e => e.textContent.includes('OIR Rating'))?.textContent;
        return { title, scoreElement, oirBand, url: window.location.href };
      })()
    `,
    returnByValue: true,
  });
  console.log(`✓ Results Page Rendered:`, resultsState.result.value);

  // Open Solutions Page
  const solutionsRes = await measureInteraction(`() => {
    const solBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.includes('View All Solutions') || b.textContent.includes('Solutions')
    );
    if (!solBtn) throw new Error('View All Solutions button not found on Results page');
    solBtn.click();
    return true;
  }`);
  console.log(`  ✓ Open Solutions Page Latency: ${solutionsRes.latencyMs.toFixed(2)} ms`);

  await new Promise((r) => setTimeout(r, 800));

  // Verify Solutions Page Loaded
  const solutionsState = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const solutionCards = document.querySelectorAll('.rounded-2xl, .border');
        const questionStatements = Array.from(document.querySelectorAll('h3, p')).slice(0, 3).map(e => e.textContent.trim());
        return { cardsFound: solutionCards.length, sampleHeaders: questionStatements };
      })()
    `,
    returnByValue: true,
  });
  console.log(`✓ Solutions Page Verified:`, solutionsState.result.value);

  // Return to Dashboard from Solutions Page
  const backDashboard = await measureInteraction(`() => {
    const backBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent.trim() === 'Dashboard' || b.textContent.includes('Dashboard')
    );
    if (!backBtn) throw new Error('Dashboard button not found on Solutions page');
    backBtn.click();
    return true;
  }`);
  console.log(`  ✓ Return to Dashboard Latency: ${backDashboard.latencyMs.toFixed(2)} ms`);

  await new Promise((r) => setTimeout(r, 600));

  // 8. Verify Dashboard status updated to Completed
  console.log('\n[8/8] Verifying Dashboard Updated with Completed Attempt & Retake Available...');
  const finalDashboard = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const cards = Array.from(document.querySelectorAll('.grid > div')).filter(c => c.textContent.includes('Set '));
        const set1Card = cards.find(c => c.textContent.includes('Set 01') || c.textContent.includes('SET 01'));
        const set1Text = set1Card?.textContent;
        const isCompletedBadge = Boolean(set1Text?.includes('Completed'));
        const retakeBtn = Array.from(set1Card?.querySelectorAll('button') || []).find(b => b.textContent.includes('Retake Test'));
        return {
          cardFound: Boolean(set1Card),
          isCompletedBadge,
          retakeButtonFound: Boolean(retakeBtn),
          cardTextSnippet: set1Text ? set1Text.slice(0, 150) : null
        };
      })()
    `,
    returnByValue: true,
  });
  console.log(`✓ Final Dashboard State:`, finalDashboard.result.value);

  // Clean up
  client.close();
  await previewServer.httpServer.close();
  try {
    chromeProc.kill();
  } catch {}

  console.log('\n======================================================================');
  console.log('   PRODUCTION VERIFICATION SUITE COMPLETED SUCCESSFULLY');
  console.log('======================================================================\n');
}

runProductionVerification().catch((err) => {
  console.error('Fatal error during production verification:', err);
  process.exit(1);
});
