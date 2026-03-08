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
  dutyStations: []
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
      settings.dutyStations = settings.dutyStations.filter(s => s.name !== station.name);
      await saveSettings({ dutyStations: settings.dutyStations });
      renderDutyStations(settings.dutyStations);
      notifyContentScript();
    });

    item.appendChild(name);
    item.appendChild(removeBtn);
    list.appendChild(item);
  }
}

async function init() {
  const settings = await loadSettings();

  // Enable toggle
  const toggle = document.getElementById('enableToggle');
  toggle.checked = settings.enabled;
  toggle.addEventListener('change', async () => {
    await saveSettings({ enabled: toggle.checked });
    notifyContentScript();
  });

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

  // Select all / none
  document.getElementById('selectAllGrades').addEventListener('click', async () => {
    await saveSettings({ selectedGrades: [...ALL_GRADES] });
    renderGrades(ALL_GRADES);
    notifyContentScript();
  });
  document.getElementById('selectNoGrades').addEventListener('click', async () => {
    await saveSettings({ selectedGrades: [] });
    renderGrades([]);
    notifyContentScript();
  });

  // Duty stations
  renderDutyStations(settings.dutyStations);

  const input = document.getElementById('dutyStationInput');
  const addBtn = document.getElementById('addDutyStation');

  async function addDutyStation() {
    const name = input.value.trim();
    if (!name) return;
    const s = await loadSettings();
    if (s.dutyStations.some(d => d.name.toLowerCase() === name.toLowerCase())) {
      input.value = '';
      return;
    }
    s.dutyStations.push({ name });
    await saveSettings({ dutyStations: s.dutyStations });
    renderDutyStations(s.dutyStations);
    input.value = '';
    notifyContentScript();
  }

  addBtn.addEventListener('click', addDutyStation);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') addDutyStation();
  });
}

init();
