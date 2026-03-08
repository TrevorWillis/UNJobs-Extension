(() => {
  const GRADE_PATTERNS = [
    { grade: 'P-1', patterns: [/\bP[\s-]?1\b/i] },
    { grade: 'P-2', patterns: [/\bP[\s-]?2\b/i] },
    { grade: 'P-3', patterns: [/\bP[\s-]?3\b/i] },
    { grade: 'P-4', patterns: [/\bP[\s-]?4\b/i] },
    { grade: 'P-5', patterns: [/\bP[\s-]?5\b/i] },
    { grade: 'D-1', patterns: [/\bD[\s-]?1\b/i] },
    { grade: 'D-2', patterns: [/\bD[\s-]?2\b/i] },
    { grade: 'G-1', patterns: [/\bG[\s-]?1\b/i] },
    { grade: 'G-2', patterns: [/\bG[\s-]?2\b/i] },
    { grade: 'G-3', patterns: [/\bG[\s-]?3\b/i] },
    { grade: 'G-4', patterns: [/\bG[\s-]?4\b/i] },
    { grade: 'G-5', patterns: [/\bG[\s-]?5\b/i] },
    { grade: 'G-6', patterns: [/\bG[\s-]?6\b/i] },
    { grade: 'G-7', patterns: [/\bG[\s-]?7\b/i] },
    { grade: 'NO-A', patterns: [/\bNO[\s-]?A\b/i] },
    { grade: 'NO-B', patterns: [/\bNO[\s-]?B\b/i] },
    { grade: 'NO-C', patterns: [/\bNO[\s-]?C\b/i] },
    { grade: 'NO-D', patterns: [/\bNO[\s-]?D\b/i] },
    { grade: 'NO-E', patterns: [/\bNO[\s-]?E\b/i] },
    { grade: 'UNV', patterns: [/\bUNV\b/, /\bUN\s*Volunteer\b/i] },
    { grade: 'Intern', patterns: [/\bIntern(?:ship)?\b/i] },
    { grade: 'Consultant', patterns: [/\bConsultan(?:t|cy)\b/i, /\bIndividual\s*Contractor\b/i] }
  ];

  function detectGrades(text) {
    const found = [];
    for (const { grade, patterns } of GRADE_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          found.push(grade);
          break;
        }
      }
    }
    return found;
  }

  // ── Inline page filtering (badges on current page) ──

  function applyInlineFilters(settings) {
    const jobs = document.querySelectorAll('.job');
    if (jobs.length === 0) return;

    const { enabled, filterMode, selectedGrades, dutyStations } = settings;

    for (const job of jobs) {
      const text = job.textContent;
      const grades = detectGrades(text);

      // Add grade badges
      job.querySelectorAll('.unjobs-grade-badge-container').forEach(b => b.remove());
      if (grades.length > 0) {
        const container = document.createElement('span');
        container.className = 'unjobs-grade-badge-container';
        for (const grade of grades) {
          const badge = document.createElement('span');
          badge.className = 'unjobs-grade-badge';
          badge.textContent = grade;
          if (grade.startsWith('P-') || grade.startsWith('D-')) badge.classList.add('unjobs-grade-professional');
          else if (grade.startsWith('G-')) badge.classList.add('unjobs-grade-gs');
          else if (grade.startsWith('NO')) badge.classList.add('unjobs-grade-no');
          else badge.classList.add('unjobs-grade-other');
          container.appendChild(badge);
        }
        const titleLink = job.querySelector('a.jtitle');
        if (titleLink) titleLink.after(container);
      }

      // Apply highlight/hide
      job.classList.remove('unjobs-hidden', 'unjobs-highlight', 'unjobs-dimmed');
      if (!enabled || selectedGrades.length === 0) continue;

      const gradeMatch = grades.some(g => selectedGrades.includes(g));
      if (filterMode === 'filter') {
        if (!gradeMatch) job.classList.add('unjobs-hidden');
      } else {
        job.classList.add(gradeMatch ? 'unjobs-highlight' : 'unjobs-dimmed');
      }
    }
  }

  // ── "Save this duty station" buttons on duty station links ──

  function addSaveButtons(settings) {
    // On the duty stations index page, add save buttons next to each station
    const isDutyStationsPage = window.location.pathname === '/duty_stations' ||
                                window.location.pathname === '/duty_stations/';
    if (!isDutyStationsPage) return;

    document.querySelectorAll('.unjobs-save-ds-btn').forEach(b => b.remove());

    const links = document.querySelectorAll('article a[href*="/duty_stations/"], article a[href*="/field_locations/"]');
    const savedUrls = new Set(settings.dutyStations.map(s => s.url));

    for (const link of links) {
      const name = link.textContent.trim();
      const url = link.href;
      const isSaved = savedUrls.has(url);

      const btn = document.createElement('button');
      btn.className = 'unjobs-save-ds-btn' + (isSaved ? ' saved' : '');
      btn.textContent = isSaved ? '\u2713 Saved' : '+ Save';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = await loadSettings();
        if (s.dutyStations.some(d => d.url === url)) {
          // Remove
          s.dutyStations = s.dutyStations.filter(d => d.url !== url);
          btn.textContent = '+ Save';
          btn.classList.remove('saved');
        } else {
          // Add
          s.dutyStations.push({ name, url });
          btn.textContent = '\u2713 Saved';
          btn.classList.add('saved');
        }
        await saveSettings(s);
      });
      link.parentNode.insertBefore(btn, link.nextSibling);
    }
  }

  // Also add a save button on individual duty station pages
  function addSaveButtonOnDutyStationPage(settings) {
    const path = window.location.pathname;
    const isDsPage = path.match(/^\/(duty_stations|field_locations)\/[^/]+$/);
    if (!isDsPage) return;

    if (document.getElementById('unjobs-save-this-ds')) return;

    const heading = document.querySelector('h2, h3');
    if (!heading) return;

    const name = heading.textContent.replace('Vacancies in ', '').trim();
    const url = window.location.origin + path;
    const isSaved = settings.dutyStations.some(d => d.url === url);

    const btn = document.createElement('button');
    btn.id = 'unjobs-save-this-ds';
    btn.className = 'unjobs-save-ds-page-btn' + (isSaved ? ' saved' : '');
    btn.textContent = isSaved ? '\u2713 Saved to filters' : '+ Save this duty station';
    btn.addEventListener('click', async () => {
      const s = await loadSettings();
      if (s.dutyStations.some(d => d.url === url)) {
        s.dutyStations = s.dutyStations.filter(d => d.url !== url);
        btn.textContent = '+ Save this duty station';
        btn.classList.remove('saved');
      } else {
        s.dutyStations.push({ name, url });
        btn.textContent = '\u2713 Saved to filters';
        btn.classList.add('saved');
      }
      await saveSettings(s);
    });
    heading.appendChild(document.createTextNode(' '));
    heading.appendChild(btn);
  }

  // ── Results panel ──

  function createResultsPanel() {
    let panel = document.getElementById('unjobs-results-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'unjobs-results-panel';
    panel.innerHTML = `
      <div class="unjobs-panel-header">
        <span class="unjobs-panel-title">UNJobs Search Results</span>
        <div class="unjobs-panel-controls">
          <button id="unjobs-panel-minimize" title="Minimize">\u2013</button>
          <button id="unjobs-panel-close" title="Close">\u00d7</button>
        </div>
      </div>
      <div id="unjobs-panel-status" class="unjobs-panel-status">Ready</div>
      <div id="unjobs-panel-body" class="unjobs-panel-body"></div>
    `;
    document.body.appendChild(panel);

    document.getElementById('unjobs-panel-close').addEventListener('click', () => {
      panel.remove();
    });
    document.getElementById('unjobs-panel-minimize').addEventListener('click', () => {
      panel.classList.toggle('minimized');
      const btn = document.getElementById('unjobs-panel-minimize');
      btn.textContent = panel.classList.contains('minimized') ? '+' : '\u2013';
    });

    return panel;
  }

  function showProgress(text) {
    const panel = createResultsPanel();
    const status = panel.querySelector('#unjobs-panel-status');
    status.textContent = text;
    status.classList.add('loading');
  }

  function showResults(data) {
    const panel = createResultsPanel();
    const status = panel.querySelector('#unjobs-panel-status');
    const body = panel.querySelector('#unjobs-panel-body');
    status.classList.remove('loading');

    const { jobs, totalScanned, stationsScanned } = data;
    status.textContent = `Found ${jobs.length} matching jobs (scanned ${totalScanned} across ${stationsScanned} station${stationsScanned > 1 ? 's' : ''})`;

    if (jobs.length === 0) {
      body.innerHTML = '<div class="unjobs-no-results">No jobs match your filters. Try selecting more grades or adding more duty stations.</div>';
      return;
    }

    // Group by duty station
    const grouped = {};
    for (const job of jobs) {
      if (!grouped[job.dutyStation]) grouped[job.dutyStation] = [];
      grouped[job.dutyStation].push(job);
    }

    let html = '';
    for (const [station, stationJobs] of Object.entries(grouped)) {
      html += `<div class="unjobs-station-group">`;
      html += `<div class="unjobs-station-header">${escapeHtml(station)} <span class="unjobs-station-count">(${stationJobs.length})</span></div>`;
      for (const job of stationJobs) {
        const gradeHtml = job.grades.map(g => {
          let cls = 'unjobs-grade-other';
          if (g.startsWith('P-') || g.startsWith('D-')) cls = 'unjobs-grade-professional';
          else if (g.startsWith('G-')) cls = 'unjobs-grade-gs';
          else if (g.startsWith('NO')) cls = 'unjobs-grade-no';
          return `<span class="unjobs-grade-badge ${cls}">${escapeHtml(g)}</span>`;
        }).join(' ');

        html += `
          <div class="unjobs-result-item">
            <a href="${escapeHtml(job.url)}" target="_blank" class="unjobs-result-title">${escapeHtml(job.title)}</a>
            <div class="unjobs-result-meta">
              ${gradeHtml}
              ${job.org ? `<span class="unjobs-result-org">${escapeHtml(job.org)}</span>` : ''}
              ${job.closingDate ? `<span class="unjobs-result-closing">${escapeHtml(job.closingDate)}</span>` : ''}
            </div>
          </div>`;
      }
      html += `</div>`;
    }

    body.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Search trigger (floating button) ──

  function addSearchButton(settings) {
    let btn = document.getElementById('unjobs-search-btn');
    if (btn) btn.remove();

    if (settings.dutyStations.length === 0) return;

    btn = document.createElement('button');
    btn.id = 'unjobs-search-btn';
    btn.innerHTML = `<span class="unjobs-search-icon">\uD83D\uDD0D</span> Search ${settings.dutyStations.length} station${settings.dutyStations.length > 1 ? 's' : ''}`;
    if (settings.selectedGrades.length > 0) {
      btn.innerHTML += ` <span class="unjobs-search-grades">(${settings.selectedGrades.join(', ')})</span>`;
    }
    btn.addEventListener('click', () => {
      triggerSearch(settings);
    });
    document.body.appendChild(btn);
  }

  function triggerSearch(settings) {
    showProgress('Starting search...');
    chrome.runtime.sendMessage({
      type: 'fetchJobs',
      dutyStations: settings.dutyStations,
      selectedGrades: settings.selectedGrades
    });
  }

  // ── Listen for messages from background ──

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'fetchProgress') {
      showProgress(msg.text);
    }
    if (msg.type === 'fetchResults') {
      showResults(msg);
    }
    if (msg.type === 'settingsUpdated') {
      loadAndApply();
    }
  });

  // ── Settings helpers ──

  function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get({
        enabled: true,
        filterMode: 'highlight',
        selectedGrades: [],
        dutyStations: []
      }, resolve);
    });
  }

  function saveSettings(settings) {
    return new Promise(resolve => {
      chrome.storage.sync.set(settings, resolve);
    });
  }

  // ── Main ──

  function loadAndApply() {
    loadSettings().then(settings => {
      applyInlineFilters(settings);
      addSaveButtons(settings);
      addSaveButtonOnDutyStationPage(settings);
      addSearchButton(settings);
    });
  }

  loadAndApply();
})();
