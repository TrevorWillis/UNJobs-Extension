const GRADES = {
  professional: ['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'D-1', 'D-2'],
  gs: ['G-1', 'G-2', 'G-3', 'G-4', 'G-5', 'G-6', 'G-7'],
  no: ['NO-A', 'NO-B', 'NO-C', 'NO-D', 'NO-E'],
  other: ['UNV', 'Intern', 'Consultant']
};

const ALL_GRADES = [...GRADES.professional, ...GRADES.gs, ...GRADES.no, ...GRADES.other];

const DEFAULT_SETTINGS = {
  enabled: true,
  filterMode: 'highlight',
  selectedGrades: [],
  dutyStations: []  // [{name, url}]
};

function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, resolve);
  });
}

function saveSettings(settings) {
  return new Promise(resolve => {
    chrome.storage.sync.set(settings, resolve);
  });
}

function notifyContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('unjobs.org')) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'settingsUpdated' }).catch(() => {});
    }
  });
}

function createGradeButton(grade, isActive) {
  const btn = document.createElement('button');
  btn.className = 'grade-btn' + (isActive ? ' active' : '');
  btn.textContent = grade;
  btn.addEventListener('click', async () => {
    btn.classList.toggle('active');
    const settings = await loadSettings();
    if (btn.classList.contains('active')) {
      if (!settings.selectedGrades.includes(grade)) {
        settings.selectedGrades.push(grade);
      }
    } else {
      settings.selectedGrades = settings.selectedGrades.filter(g => g !== grade);
    }
    await saveSettings({ selectedGrades: settings.selectedGrades });
    updateSearchButton(settings);
    notifyContentScript();
  });
  return btn;
}

function renderGrades(selectedGrades) {
  const containers = {
    professional: document.getElementById('professionalGrades'),
    gs: document.getElementById('gsGrades'),
    no: document.getElementById('noGrades'),
    other: document.getElementById('otherGrades')
  };
  for (const [category, grades] of Object.entries(GRADES)) {
    const container = containers[category];
    container.innerHTML = '';
    for (const grade of grades) {
      container.appendChild(createGradeButton(grade, selectedGrades.includes(grade)));
    }
  }
}

function renderDutyStations(dutyStations) {
  const list = document.getElementById('dutyStationList');
  if (dutyStations.length === 0) {
    list.innerHTML = '<div class="empty-msg">No duty stations saved yet.</div>';
    return;
  }
  list.innerHTML = '';
  for (const station of dutyStations) {
    const item = document.createElement('div');
    item.className = 'duty-station-item';

    const name = document.createElement('span');
    name.className = 'duty-station-name';
    name.textContent = station.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', async () => {
      const settings = await loadSettings();
      settings.dutyStations = settings.dutyStations.filter(s => s.url !== station.url);
      await saveSettings({ dutyStations: settings.dutyStations });
      renderDutyStations(settings.dutyStations);
      updateSearchButton(settings);
      notifyContentScript();
    });

    item.appendChild(name);
    item.appendChild(removeBtn);
    list.appendChild(item);
  }
}

function updateSearchButton(settings) {
  const btn = document.getElementById('searchBtn');
  const summary = document.getElementById('searchSummary');
  const hasDutyStations = settings.dutyStations.length > 0;

  btn.disabled = !hasDutyStations;

  const parts = [];
  if (settings.dutyStations.length > 0) {
    parts.push(`${settings.dutyStations.length} station${settings.dutyStations.length > 1 ? 's' : ''}`);
  }
  if (settings.selectedGrades.length > 0) {
    parts.push(`grades: ${settings.selectedGrades.join(', ')}`);
  } else {
    parts.push('all grades');
  }
  summary.textContent = hasDutyStations ? `Will search: ${parts.join(' | ')}` : 'Add duty stations to enable search';
}

async function init() {
  const settings = await loadSettings();

  // Filter mode
  const highlightBtn = document.getElementById('modeHighlight');
  const filterBtn = document.getElementById('modeFilter');

  function setMode(mode) {
    highlightBtn.classList.toggle('active', mode === 'highlight');
    filterBtn.classList.toggle('active', mode === 'filter');
  }
  setMode(settings.filterMode);

  highlightBtn.addEventListener('click', async () => {
    setMode('highlight');
    await saveSettings({ filterMode: 'highlight' });
    notifyContentScript();
  });
  filterBtn.addEventListener('click', async () => {
    setMode('filter');
    await saveSettings({ filterMode: 'filter' });
    notifyContentScript();
  });

  // Grade buttons
  renderGrades(settings.selectedGrades);

  document.getElementById('selectAllGrades').addEventListener('click', async () => {
    await saveSettings({ selectedGrades: [...ALL_GRADES] });
    renderGrades(ALL_GRADES);
    const s = await loadSettings();
    updateSearchButton(s);
    notifyContentScript();
  });
  document.getElementById('selectNoGrades').addEventListener('click', async () => {
    await saveSettings({ selectedGrades: [] });
    renderGrades([]);
    const s = await loadSettings();
    updateSearchButton(s);
    notifyContentScript();
  });

  // Duty stations
  renderDutyStations(settings.dutyStations);
  updateSearchButton(settings);

  // Search button - sends message to content script to trigger search
  document.getElementById('searchBtn').addEventListener('click', async () => {
    const s = await loadSettings();
    // Send to the active unjobs tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('unjobs.org')) {
        chrome.runtime.sendMessage({
          type: 'fetchJobs',
          dutyStations: s.dutyStations,
          selectedGrades: s.selectedGrades
        });
        window.close();
      } else {
        // Open unjobs.org first, then search
        chrome.tabs.create({ url: 'https://unjobs.org' }, (tab) => {
          // Wait a bit for the content script to load, then trigger
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'fetchJobs',
              dutyStations: s.dutyStations,
              selectedGrades: s.selectedGrades
            });
          }, 2000);
          window.close();
        });
      }
    });
  });
}

// Listen for storage changes to update the UI if stations are added from the page
chrome.storage.onChanged.addListener((changes) => {
  if (changes.dutyStations) {
    renderDutyStations(changes.dutyStations.newValue || []);
    loadSettings().then(updateSearchButton);
  }
});

init();
