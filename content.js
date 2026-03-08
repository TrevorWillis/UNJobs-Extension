(() => {
  // Grade patterns to detect in job text.
  // Some listings have a structured "Grade:" field (link to /grades/p-4),
  // others only mention grade in the title or snippet text, and some don't mention it at all.
  const GRADE_PATTERNS = [
    // Professional & Director
    { grade: 'P-1', patterns: [/\bP[\s-]?1\b/i] },
    { grade: 'P-2', patterns: [/\bP[\s-]?2\b/i] },
    { grade: 'P-3', patterns: [/\bP[\s-]?3\b/i] },
    { grade: 'P-4', patterns: [/\bP[\s-]?4\b/i] },
    { grade: 'P-5', patterns: [/\bP[\s-]?5\b/i] },
    { grade: 'D-1', patterns: [/\bD[\s-]?1\b/i] },
    { grade: 'D-2', patterns: [/\bD[\s-]?2\b/i] },
    // General Service
    { grade: 'G-1', patterns: [/\bG[\s-]?1\b/i] },
    { grade: 'G-2', patterns: [/\bG[\s-]?2\b/i] },
    { grade: 'G-3', patterns: [/\bG[\s-]?3\b/i] },
    { grade: 'G-4', patterns: [/\bG[\s-]?4\b/i] },
    { grade: 'G-5', patterns: [/\bG[\s-]?5\b/i] },
    { grade: 'G-6', patterns: [/\bG[\s-]?6\b/i] },
    { grade: 'G-7', patterns: [/\bG[\s-]?7\b/i] },
    // National Officer
    { grade: 'NO-A', patterns: [/\bNO[\s-]?A\b/i, /\bNOA\b/i] },
    { grade: 'NO-B', patterns: [/\bNO[\s-]?B\b/i, /\bNOB\b/i] },
    { grade: 'NO-C', patterns: [/\bNO[\s-]?C\b/i, /\bNOC\b/i] },
    { grade: 'NO-D', patterns: [/\bNO[\s-]?D\b/i, /\bNOD\b/i] },
    { grade: 'NO-E', patterns: [/\bNO[\s-]?E\b/i, /\bNOE\b/i] },
    // Other categories
    { grade: 'UNV', patterns: [/\bUNV\b/, /\bUN\s*Volunteer\b/i] },
    { grade: 'Intern', patterns: [/\bIntern\b/i, /\bInternship\b/i] },
    { grade: 'Consultant', patterns: [/\bConsultant\b/i, /\bConsultancy\b/i, /\bIndividual\s*Contractor\b/i, /\bIC\b/] }
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

  function detectDutyStation(text, dutyStations) {
    const lower = text.toLowerCase();
    return dutyStations.filter(s => lower.includes(s.name.toLowerCase()));
  }

  function getJobElements() {
    return Array.from(document.querySelectorAll('.job'));
  }

  function isListingPage() {
    // Pages with job listings: homepage, duty_stations, search, closing, grades, organizations
    return document.querySelector('article .job') !== null;
  }

  function isDetailPage() {
    // Single vacancy page: has the list-group with Organization/Country/Grade fields
    return window.location.pathname.startsWith('/vacancies/');
  }

  // Extract grade from detail page structured field
  function getDetailPageGrade() {
    const listItems = document.querySelectorAll('ul.list-group li');
    for (const li of listItems) {
      const text = li.textContent.trim();
      if (text.startsWith('Grade:')) {
        const link = li.querySelector('a');
        return link ? link.textContent.trim() : text.replace('Grade:', '').trim();
      }
    }
    return null;
  }

  function addGradeBadge(jobEl, grades) {
    // Remove existing badges
    jobEl.querySelectorAll('.unjobs-grade-badge').forEach(b => b.remove());
    if (grades.length === 0) return;

    const container = document.createElement('span');
    container.className = 'unjobs-grade-badge-container';

    for (const grade of grades) {
      const badge = document.createElement('span');
      badge.className = 'unjobs-grade-badge';
      badge.textContent = grade;

      // Color by category
      if (grade.startsWith('P-') || grade.startsWith('D-')) {
        badge.classList.add('unjobs-grade-professional');
      } else if (grade.startsWith('G-')) {
        badge.classList.add('unjobs-grade-gs');
      } else if (grade.startsWith('NO')) {
        badge.classList.add('unjobs-grade-no');
      } else {
        badge.classList.add('unjobs-grade-other');
      }
      container.appendChild(badge);
    }

    const titleLink = jobEl.querySelector('a.jtitle');
    if (titleLink) {
      titleLink.parentNode.insertBefore(container, titleLink.nextSibling);
    } else {
      jobEl.prepend(container);
    }
  }

  function addDutyStationBadge(jobEl, stations) {
    jobEl.querySelectorAll('.unjobs-ds-badge').forEach(b => b.remove());
    if (stations.length === 0) return;

    const container = document.createElement('span');
    container.className = 'unjobs-ds-badge-container';

    for (const s of stations) {
      const badge = document.createElement('span');
      badge.className = 'unjobs-ds-badge';
      badge.textContent = '\u2605 ' + s.name;
      container.appendChild(badge);
    }

    const titleLink = jobEl.querySelector('a.jtitle');
    if (titleLink) {
      titleLink.parentNode.insertBefore(container, titleLink.nextSibling);
    }
  }

  function applyFilters(settings) {
    if (!isListingPage()) return;

    const { enabled, filterMode, selectedGrades, dutyStations } = settings;
    const jobs = getJobElements();

    for (const job of jobs) {
      const text = job.textContent;
      const grades = detectGrades(text);
      const matchedStations = detectDutyStation(text, dutyStations);

      // Always add badges for visibility
      addGradeBadge(job, grades);
      if (dutyStations.length > 0) {
        addDutyStationBadge(job, matchedStations);
      }

      // Reset visibility and highlights
      job.classList.remove('unjobs-hidden', 'unjobs-highlight', 'unjobs-dimmed', 'unjobs-ds-highlight');

      if (!enabled) continue;

      const hasGradeFilter = selectedGrades.length > 0;
      const hasDsFilter = dutyStations.length > 0;

      // If no filters active, skip
      if (!hasGradeFilter && !hasDsFilter) continue;

      // Check grade match
      let gradeMatch = !hasGradeFilter; // true if no grade filter
      if (hasGradeFilter) {
        gradeMatch = grades.some(g => selectedGrades.includes(g));
        // If no grade detected and we have a grade filter, treat as non-match
      }

      // Check duty station match
      let dsMatch = !hasDsFilter; // true if no ds filter
      if (hasDsFilter) {
        dsMatch = matchedStations.length > 0;
      }

      const isMatch = gradeMatch && dsMatch;

      if (filterMode === 'filter') {
        if (!isMatch) {
          job.classList.add('unjobs-hidden');
        }
      } else {
        // Highlight mode
        if (isMatch) {
          job.classList.add('unjobs-highlight');
        } else {
          job.classList.add('unjobs-dimmed');
        }
      }
    }

    // Update match count display
    updateMatchCount(jobs, settings);
  }

  function updateMatchCount(jobs, settings) {
    let existing = document.getElementById('unjobs-filter-bar');
    const { enabled, selectedGrades, dutyStations } = settings;

    if (!enabled || (selectedGrades.length === 0 && dutyStations.length === 0)) {
      if (existing) existing.remove();
      return;
    }

    const visible = jobs.filter(j => !j.classList.contains('unjobs-hidden')).length;
    const highlighted = jobs.filter(j => j.classList.contains('unjobs-highlight')).length;
    const total = jobs.length;

    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'unjobs-filter-bar';
      const article = document.querySelector('article');
      if (article) {
        article.parentNode.insertBefore(existing, article);
      }
    }

    const parts = [];
    if (selectedGrades.length > 0) {
      parts.push('Grades: ' + selectedGrades.join(', '));
    }
    if (dutyStations.length > 0) {
      parts.push('Stations: ' + dutyStations.map(s => s.name).join(', '));
    }

    const matchCount = settings.filterMode === 'filter' ? visible : highlighted;
    existing.innerHTML = `
      <span class="unjobs-filter-info">${parts.join(' | ')}</span>
      <span class="unjobs-filter-count">${matchCount} of ${total} jobs match</span>
    `;
  }

  function addDetailPageBadge(settings) {
    if (!isDetailPage()) return;

    const grade = getDetailPageGrade();
    const { selectedGrades } = settings;

    // If there's a grade field and we have filters, show match status
    if (grade && selectedGrades.length > 0) {
      const heading = document.querySelector('h2, h3');
      if (!heading) return;

      let badge = document.getElementById('unjobs-detail-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'unjobs-detail-badge';
        heading.appendChild(badge);
      }

      if (selectedGrades.includes(grade)) {
        badge.className = 'unjobs-detail-match';
        badge.textContent = '\u2713 Matches your ' + grade + ' filter';
      } else {
        badge.className = 'unjobs-detail-nomatch';
        badge.textContent = grade + ' - not in your filter';
      }
    }
  }

  // Load settings and apply
  function loadAndApply() {
    chrome.storage.sync.get({
      enabled: true,
      filterMode: 'highlight',
      selectedGrades: [],
      dutyStations: []
    }, settings => {
      applyFilters(settings);
      addDetailPageBadge(settings);
    });
  }

  // Listen for settings updates from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'settingsUpdated') {
      loadAndApply();
    }
  });

  // Initial load
  loadAndApply();

  // Re-apply on dynamic page changes (some pages may load content dynamically)
  const observer = new MutationObserver(() => {
    loadAndApply();
  });

  const article = document.querySelector('article');
  if (article) {
    observer.observe(article, { childList: true, subtree: true });
  }
})();
