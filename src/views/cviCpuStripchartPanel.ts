import * as vscode from 'vscode';
import { CviProcessDebugInfo, CviThreadInfo, CviThreadTrackerService } from '../services/cviThreadTrackerService';

export class CviCpuStripchartPanel {
  public static currentPanel: CviCpuStripchartPanel | undefined;
  public static readonly viewType = 'labwindowsCviCpuStripchart';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, tracker: CviThreadTrackerService): CviCpuStripchartPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (CviCpuStripchartPanel.currentPanel) {
      CviCpuStripchartPanel.currentPanel._panel.reveal(column);
      return CviCpuStripchartPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      CviCpuStripchartPanel.viewType,
      'Process Threads',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    CviCpuStripchartPanel.currentPanel = new CviCpuStripchartPanel(panel, extensionUri, tracker);
    return CviCpuStripchartPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly tracker: CviThreadTrackerService
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        const info = this.tracker.processInfo;
        if (info) {
          this.updateData({
            processName: info.processName || 'CVI Process',
            processId: info.processId,
            cpuPercent: info.cpuPercent,
            cpuHistory: info.cpuHistory,
            threads: info.threads
          });
        }
      } else if (msg?.command === 'suspendThread' && typeof msg.tid === 'number') {
        void this.tracker.suspendThread(msg.tid);
      } else if (msg?.command === 'resumeThread' && typeof msg.tid === 'number') {
        void this.tracker.resumeThread(msg.tid);
      }
    }, null, this._disposables);
    this._panel.webview.html = this._getHtmlForWebview();

    // Initial update if process info is already present
    const info = this.tracker.processInfo;
    if (info) {
      this.updateData({
        processName: info.processName || 'CVI Process',
        processId: info.processId,
        cpuPercent: info.cpuPercent,
        cpuHistory: info.cpuHistory,
        threads: info.threads
      });
    }
  }

  public updateData(payload: {
    processName: string;
    processId?: number;
    cpuPercent?: number;
    cpuHistory?: Array<{ time: number; cpuPercent: number }>;
    threads: CviThreadInfo[];
  }): void {
    if (!this._panel.visible) {
      return;
    }
    void this._panel.webview.postMessage({
      type: 'telemetry',
      data: payload
    });
  }

  public dispose(): void {
    CviCpuStripchartPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Process Threads</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-widget-border, #3c3c3c);
      --accent: var(--vscode-progressBar-background, #007acc);
      --green: var(--vscode-testing-iconPassed, #4ec9b0);
      --amber: var(--vscode-editorWarning-foreground, #cca700);
      --red: var(--vscode-errorForeground, #f14c4c);
    }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      margin: 0;
      padding: 16px;
      user-select: none;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }
    .pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
    }
    .metrics {
      display: flex;
      gap: 12px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      min-width: 90px;
      text-align: center;
    }
    .metric-label {
      font-size: 10px;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .metric-val {
      font-size: 18px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .chart-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 20px;
      position: relative;
    }
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
      opacity: 0.8;
    }
    canvas {
      display: block;
      width: 100%;
      height: 200px;
    }
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .table-header {
      padding: 10px 12px;
      font-weight: 600;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    th {
      background: rgba(128, 128, 128, 0.08);
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      opacity: 0.8;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
    }
    th.sortable:hover {
      background: rgba(128, 128, 128, 0.18);
    }
    .sort-icon {
      display: inline-block;
      margin-left: 4px;
      font-size: 10px;
      opacity: 0.8;
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.1);
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover td {
      background: rgba(128, 128, 128, 0.05);
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }
    .badge-running { background: rgba(78, 201, 176, 0.2); color: var(--green); }
    .badge-wait { background: rgba(204, 167, 0, 0.2); color: var(--amber); }
    .badge-suspended { background: rgba(241, 76, 76, 0.2); color: var(--red); }
    .action-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .action-btn:hover {
      background: rgba(128, 128, 128, 0.2);
    }
    .pause-btn { color: var(--amber); border-color: rgba(204, 167, 0, 0.4); }
    .pause-btn:hover { background: rgba(204, 167, 0, 0.15); }
    .resume-btn { color: var(--green); border-color: rgba(78, 201, 176, 0.4); }
    .resume-btn:hover { background: rgba(78, 201, 176, 0.15); }
    .mono { font-family: var(--vscode-editor-font-family, monospace); }
    .empty-msg {
      padding: 24px;
      text-align: center;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1 id="procTitle">LabWindows/CVI Diagnostics</h1>
      <span id="procPid" class="pill">PID: Waiting</span>
    </div>
    <div class="metrics">
      <div class="metric-card">
        <div class="metric-label">Current CPU</div>
        <div id="valCurrent" class="metric-val" style="color:var(--accent);">0.0%</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Peak CPU</div>
        <div id="valPeak" class="metric-val">0.0%</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Average (60s)</div>
        <div id="valAvg" class="metric-val">0.0%</div>
      </div>
    </div>
  </div>

  <div class="chart-container">
    <div class="chart-header">
      <span>CPU Usage</span>
    </div>
    <canvas id="stripchartCanvas"></canvas>
  </div>

  <div class="table-container">
    <div class="table-header">
      <span>Active Process Threads</span>
      <span id="threadCountBadge" class="pill">0 Threads</span>
    </div>
    <table id="threadsTable">
      <thead>
        <tr>
          <th class="sortable" data-col="id"># <span class="sort-icon" id="sort-id"></span></th>
          <th class="sortable" data-col="osThreadId">TID <span class="sort-icon" id="sort-osThreadId"></span></th>
          <th class="sortable" data-col="name">Name <span class="sort-icon" id="sort-name"></span></th>
          <th class="sortable" data-col="entryPoint">Entry Point <span class="sort-icon" id="sort-entryPoint"></span></th>
          <th class="sortable" data-col="state">Status <span class="sort-icon" id="sort-state"></span></th>
          <th class="sortable" data-col="waitReason">Reason <span class="sort-icon" id="sort-waitReason"></span></th>
          <th class="sortable" data-col="priority">Priority <span class="sort-icon" id="sort-priority"></span></th>
          <th class="sortable" data-col="cpuMs">CPU Time <span class="sort-icon" id="sort-cpuMs"></span></th>
          <th class="sortable" data-col="location">Location <span class="sort-icon" id="sort-location"></span></th>
          <th>Control</th>
        </tr>
      </thead>
      <tbody id="threadsBody">
        <tr>
          <td colspan="10" class="empty-msg">Waiting for CVI debug session telemetry…</td>
        </tr>
      </tbody>
    </table>
  </div>

  <script>
    const vscodeApi = acquireVsCodeApi();
    const canvas = document.getElementById('stripchartCanvas');
    const ctx = canvas.getContext('2d');
    const procTitle = document.getElementById('procTitle');
    const procPid = document.getElementById('procPid');
    const valCurrent = document.getElementById('valCurrent');
    const valPeak = document.getElementById('valPeak');
    const valAvg = document.getElementById('valAvg');
    const threadCountBadge = document.getElementById('threadCountBadge');
    const threadsBody = document.getElementById('threadsBody');

    let historyData = [];
    let resizeTimer = null;
    let currentSortCol = 'id';
    let currentSortAsc = true;
    let latestThreads = [];

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      drawStripchart();
    }

    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resizeCanvas, 100);
    });

    function drawStripchart() {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width <= 0 || height <= 0) return;

      ctx.clearRect(0, 0, width, height);

      const paddingLeft = 45;
      const paddingRight = 15;
      const paddingTop = 15;
      const paddingBottom = 25;
      const plotWidth = width - paddingLeft - paddingRight;
      const plotHeight = height - paddingTop - paddingBottom;

      // Autoscale Y with Fixed Zero:
      // Minimum Y is ALWAYS 0.
      let maxVal = 10;
      if (historyData.length > 0) {
        const peak = Math.max(...historyData.map(d => d.cpuPercent || 0));
        maxVal = Math.max(10, Math.ceil(peak * 1.25 / 10) * 10);
      }

      // Draw Grid Lines & Y Axis Labels
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const val = (maxVal / steps) * i;
        const y = paddingTop + plotHeight - (i / steps) * plotHeight;
        
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(paddingLeft + plotWidth, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(212, 212, 212, 0.6)';
        ctx.fillText(\`\${Math.round(val)}%\`, paddingLeft - 6, y);
      }

      // Draw X Axis Time Labels (-60s to 0s)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const timeTicks = [
        { label: '-60s', frac: 0 },
        { label: '-45s', frac: 0.25 },
        { label: '-30s', frac: 0.5 },
        { label: '-15s', frac: 0.75 },
        { label: 'Now', frac: 1.0 }
      ];
      for (const t of timeTicks) {
        const x = paddingLeft + t.frac * plotWidth;
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
        ctx.beginPath();
        ctx.moveTo(x, paddingTop);
        ctx.lineTo(x, paddingTop + plotHeight);
        ctx.stroke();

        ctx.fillStyle = 'rgba(212, 212, 212, 0.6)';
        ctx.fillText(t.label, x, paddingTop + plotHeight + 6);
      }

      // If no data, return
      if (historyData.length === 0) return;

      // Plot data points
      const maxSamples = 60;
      const count = historyData.length;
      const points = [];

      for (let i = 0; i < count; i++) {
        const indexFromRight = count - 1 - i;
        const x = paddingLeft + plotWidth - (indexFromRight / (maxSamples - 1)) * plotWidth;
        const cpu = Math.max(0, Math.min(maxVal, historyData[i].cpuPercent || 0));
        const y = paddingTop + plotHeight - (cpu / maxVal) * plotHeight;
        points.push({ x, y });
      }

      // Gradient area under curve
      const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + plotHeight);
      gradient.addColorStop(0, 'rgba(0, 122, 204, 0.4)');
      gradient.addColorStop(1, 'rgba(0, 122, 204, 0.02)');

      ctx.beginPath();
      ctx.moveTo(points[0].x, paddingTop + plotHeight);
      for (const p of points) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(points[points.length - 1].x, paddingTop + plotHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // Stroke line
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = '#007acc';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw current live point dot
      const last = points[points.length - 1];
      ctx.fillStyle = '#007acc';
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function getThreadVal(t, col) {
      switch (col) {
        case 'id': return Number(t.id) || 0;
        case 'osThreadId': return Number(t.osThreadId) || 0;
        case 'name': return (t.role === 'main' ? 'Main GUI Thread' : (t.name || 'Thread')).toLowerCase();
        case 'entryPoint': return (t.entryPoint || '').toLowerCase();
        case 'state': return (t.state || 'Running').toLowerCase();
        case 'waitReason': return (t.waitReason || '').toLowerCase();
        case 'priority': {
          const prioOrder = {
            'idle': 0,
            'lowest': 1,
            'belownormal': 2,
            'normal': 3,
            'abovenormal': 4,
            'highest': 5,
            'timecritical': 6
          };
          const p = String(t.priority || 'Normal').toLowerCase().replace(/[\s_-]+/g, '');
          return prioOrder[p] !== undefined ? prioOrder[p] : 3;
        }
        case 'cpuMs': return Number(t.cpuMs) || 0;
        case 'location': {
          return t.topFrame ? (t.topFrame.name || '').toLowerCase() : '';
        }
        default: return '';
      }
    }

    function sortThreads(threads) {
      if (!threads || threads.length === 0) return [];
      const list = threads.slice();
      list.sort((a, b) => {
        const valA = getThreadVal(a, currentSortCol);
        const valB = getThreadVal(b, currentSortCol);
        if (valA < valB) return currentSortAsc ? -1 : 1;
        if (valA > valB) return currentSortAsc ? 1 : -1;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      });
      return list;
    }

    function updateSortIcons() {
      document.querySelectorAll('.sort-icon').forEach(span => {
        span.textContent = '';
      });
      const icon = document.getElementById('sort-' + currentSortCol);
      if (icon) {
        icon.textContent = currentSortAsc ? '▲' : '▼';
      }
    }

    document.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (currentSortCol === col) {
          currentSortAsc = !currentSortAsc;
        } else {
          currentSortCol = col;
          currentSortAsc = true;
        }
        updateSortIcons();
        renderThreads(latestThreads);
      });
    });

    function suspendThread(tid) {
      vscodeApi.postMessage({ command: 'suspendThread', tid });
    }

    function resumeThread(tid) {
      vscodeApi.postMessage({ command: 'resumeThread', tid });
    }

    function renderThreads(threads) {
      latestThreads = threads || [];
      if (!latestThreads || latestThreads.length === 0) {
        threadsBody.innerHTML = '<tr><td colspan="10" class="empty-msg">No active threads detected.</td></tr>';
        threadCountBadge.textContent = '0 Threads';
        return;
      }

      threadCountBadge.textContent = \`\${latestThreads.length} Thread\${latestThreads.length === 1 ? '' : 's'}\`;
      const sorted = sortThreads(latestThreads);
      let html = '';

      for (const t of sorted) {
        let stateClass = 'badge-wait';
        if (t.state === 'Running' || t.state === 'Ready') {
          stateClass = 'badge-running';
        } else if (t.state === 'Suspended') {
          stateClass = 'badge-suspended';
        }

        const loc = t.topFrame
          ? \`\${t.topFrame.name} (\${t.topFrame.file ? t.topFrame.file.split(/[\\\\/]/).pop() : 'unknown'}:\${t.topFrame.line || 0})\`
          : '-';
        const entry = t.entryPoint || '-';
        const nameText = t.role === 'main' ? 'Main GUI Thread' : (t.name || \`Thread #\${t.id}\`);
        const reasonText = (t.waitReason && t.waitReason !== '-') ? t.waitReason : (t.state === 'Running' ? '-' : 'Wait');

        const btnClass = t.state === 'Suspended' ? 'action-btn resume-btn' : 'action-btn pause-btn';
        const btnText = t.state === 'Suspended' ? '▶ Resume' : '⏸ Suspend';
        const btnAction = t.state === 'Suspended' ? 'resumeThread' : 'suspendThread';
        const tidVal = t.osThreadId || t.id;

        html += \`<tr>
          <td>#\${t.id}</td>
          <td class="mono">\${t.osThreadId || '-'}</td>
          <td><strong>\${escapeHtml(nameText)}</strong></td>
          <td class="mono" title="\${escapeHtml(entry)}">\${escapeHtml(entry)}</td>
          <td><span class="badge \${stateClass}">\${escapeHtml(t.state || 'Running')}</span></td>
          <td>\${escapeHtml(reasonText)}</td>
          <td>\${escapeHtml(t.priority || 'Normal')}</td>
          <td class="mono">\${t.cpuMs !== undefined ? t.cpuMs.toFixed(1) + ' ms' : '-'}</td>
          <td title="\${escapeHtml(loc)}">\${escapeHtml(loc)}</td>
          <td><button class="\${btnClass}" onclick="\${btnAction}(\${tidVal})">\${btnText}</button></td>
        </tr>\`;
      }

      threadsBody.innerHTML = html;
    }

    function escapeHtml(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'telemetry' && msg.data) {
        const d = msg.data;
        if (d.processName) {
          procTitle.textContent = \`\${d.processName}\`;
        }
        if (d.processId) {
          procPid.textContent = \`PID: \${d.processId}\`;
        }
        if (d.cpuPercent !== undefined) {
          valCurrent.textContent = \`\${d.cpuPercent.toFixed(1)}%\`;
        }
        if (Array.isArray(d.cpuHistory)) {
          historyData = d.cpuHistory;
          const vals = historyData.map(h => h.cpuPercent || 0);
          const peak = vals.length ? Math.max(...vals) : 0;
          const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
          valPeak.textContent = \`\${peak.toFixed(1)}%\`;
          valAvg.textContent = \`\${avg.toFixed(1)}%\`;
        }
        drawStripchart();
        renderThreads(d.threads);
      }
    });

    updateSortIcons();
    setTimeout(resizeCanvas, 50);
    vscodeApi.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
