// Background service worker: fetches and parses unjobs.org pages
// to aggregate job listings across duty stations and pages.

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

// Parse job listings from an HTML string
function parseJobsFromHTML(html, dutyStationName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const jobEls = doc.querySelectorAll('.job');
  const jobs = [];

  for (const el of jobEls) {
    const link = el.querySelector('a.jtitle');
    if (!link) continue;

    const title = link.textContent.trim();
    const href = link.getAttribute('href');
    const fullText = el.textContent;

    // Extract org from parent div's text (appears before "Updated:")
    const orgMatch = fullText.match(/^(.+?)Updated:/);
    // The org is in the parent .job div, typically in the text node before the link
    let org = '';
    const parentText = el.parentElement ? el.parentElement.textContent : '';
    const orgParse = parentText.match(/^(.*?)Updated:/s);
    if (orgParse) {
      org = orgParse[1].replace(title, '').trim();
    }

    // Extract closing date
    const closingSpan = el.querySelector('span');
    const closingText = closingSpan ? closingSpan.textContent.trim() : '';
    const closingDate = closingText.startsWith('Closing date:') ? closingText : '';

    const grades = detectGrades(fullText);

    jobs.push({
      title,
      url: href ? (href.startsWith('http') ? href : 'https://unjobs.org' + href) : '',
      org,
      grades,
      closingDate,
      dutyStation: dutyStationName,
      fullText: fullText.substring(0, 500)
    });
  }

  return jobs;
}

// Get total pages from HTML
function getTotalFromHTML(html) {
  const match = html.match(/(\d+)\s*-\s*(\d+)\s*of\s*(\d+)/);
  if (match) {
    const perPage = parseInt(match[2]) - parseInt(match[1]) + 1;
    const total = parseInt(match[3]);
    return { total, perPage, pages: Math.ceil(total / perPage) };
  }
  return { total: 0, perPage: 25, pages: 0 };
}

// Fetch a single page
async function fetchPage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return await resp.text();
}

// Fetch all jobs for a duty station
async function fetchDutyStation(station, sendProgress) {
  const baseUrl = station.url;
  const jobs = [];

  // Fetch first page to get total count
  const firstPageHtml = await fetchPage(baseUrl);
  const { total, pages } = getTotalFromHTML(firstPageHtml);
  const firstPageJobs = parseJobsFromHTML(firstPageHtml, station.name);
  jobs.push(...firstPageJobs);

  sendProgress(`${station.name}: page 1/${pages} (${total} total vacancies)`);

  // Fetch remaining pages (with small delays to be polite)
  for (let page = 2; page <= pages; page++) {
    const url = `${baseUrl}/${page}`;
    try {
      const html = await fetchPage(url);
      const pageJobs = parseJobsFromHTML(html, station.name);
      jobs.push(...pageJobs);
      sendProgress(`${station.name}: page ${page}/${pages}`);
    } catch (err) {
      sendProgress(`${station.name}: error on page ${page} - ${err.message}`);
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  return jobs;
}

// Handle messages from content script / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchJobs') {
    handleFetchJobs(msg, sender);
    return false; // We'll respond via separate messages
  }
  if (msg.type === 'fetchVacancyGrade') {
    handleFetchVacancyGrade(msg).then(sendResponse);
    return true;
  }
});

async function handleFetchVacancyGrade(msg) {
  try {
    const html = await fetchPage(msg.url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // Look for structured grade field
    const listItems = doc.querySelectorAll('ul.list-group li');
    for (const li of listItems) {
      if (li.textContent.trim().startsWith('Grade:')) {
        const link = li.querySelector('a');
        return { grade: link ? link.textContent.trim() : li.textContent.replace('Grade:', '').trim() };
      }
    }
    // Fallback: detect from full page text
    const grades = detectGrades(doc.body.textContent);
    return { grade: grades.length > 0 ? grades[0] : null };
  } catch (err) {
    return { grade: null, error: err.message };
  }
}

async function handleFetchJobs(msg, sender) {
  // If called from content script, sender.tab exists. If from popup, find the active unjobs tab.
  let tabId = sender.tab ? sender.tab.id : null;
  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const unjobsTab = tabs.find(t => t.url && t.url.includes('unjobs.org'));
    if (unjobsTab) tabId = unjobsTab.id;
  }

  const { dutyStations, selectedGrades } = msg;

  function sendProgress(text) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'fetchProgress', text }).catch(() => {});
    }
  }

  let allJobs = [];

  for (const station of dutyStations) {
    try {
      const jobs = await fetchDutyStation(station, sendProgress);
      allJobs.push(...jobs);
    } catch (err) {
      sendProgress(`Error fetching ${station.name}: ${err.message}`);
    }
  }

  // Filter by selected grades if any
  let filtered = allJobs;
  if (selectedGrades && selectedGrades.length > 0) {
    filtered = allJobs.filter(job =>
      job.grades.some(g => selectedGrades.includes(g))
    );
  }

  // Sort by closing date (soonest first), jobs without date at the end
  filtered.sort((a, b) => {
    if (!a.closingDate && !b.closingDate) return 0;
    if (!a.closingDate) return 1;
    if (!b.closingDate) return -1;
    return a.closingDate.localeCompare(b.closingDate);
  });

  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'fetchResults',
      jobs: filtered,
      totalScanned: allJobs.length,
      stationsScanned: dutyStations.length
    }).catch(() => {});
  }
}
